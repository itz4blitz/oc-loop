import { parseWorkflow, type Workflow } from "../domain/schema.js"

export type CatalogPort = {
  list(): Promise<readonly Workflow[]>
  get(id: string): Promise<Workflow | undefined>
  save(workflow: Workflow, expectedRevision?: number): Promise<void>
}

export async function exportLoops(catalog: Pick<CatalogPort, "list">, nowMs: () => number): Promise<string> {
  return JSON.stringify({ schemaVersion: 1, exportedAt: nowMs(), workflows: await catalog.list() })
}

export async function importLoops(catalog: CatalogPort, transferJson: string): Promise<{ imported: number; skipped: number }> {
  let parsed: unknown
  try { parsed = JSON.parse(transferJson) } catch { throw new Error("unsupported transfer envelope") }
  const envelope = workflowSchemaPick(parsed)
  let imported = 0
  let skipped = 0
  for (const raw of envelope.workflows) {
    const workflow = parseWorkflow(raw)
    if (await catalog.get(workflow.id)) { skipped += 1; continue }
    await catalog.save(workflow)
    imported += 1
  }
  return { imported, skipped }
}

function workflowSchemaPick(parsed: unknown): { readonly workflows: readonly unknown[] } {
  const result = transferEnvelope(parsed)
  if (!result) throw new Error("unsupported transfer envelope")
  return result
}

function transferEnvelope(parsed: unknown): { readonly workflows: readonly unknown[] } | undefined {
  if (parsed === null) return undefined
  const value = parsed as { schemaVersion?: unknown; workflows?: unknown }
  if (value.schemaVersion !== 1 || !Array.isArray(value.workflows)) return undefined
  return { workflows: value.workflows }
}
