import { readFile } from "node:fs/promises"
import { join } from "node:path"
import { parseWorkflow, type Workflow } from "../domain/schema.js"
import { writeFileAtomic } from "./atomic.js"

export class WorkflowCatalog {
  private readonly path: string
  constructor(root: string) { this.path = join(root, "catalog.json") }

  async list(): Promise<readonly Workflow[]> {
    try {
      const parsed: unknown = JSON.parse((await readFile(this.path)).toString())
      if (!Array.isArray(parsed)) throw new Error("corrupt workflow catalog")
      return parsed.map(parseWorkflow)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return []
      throw error
    }
  }

  async get(id: string): Promise<Workflow | undefined> { return (await this.list()).find((workflow) => workflow.id === id) }

  async save(workflow: Workflow, expectedRevision?: number): Promise<void> {
    const valid = parseWorkflow(workflow)
    const entries = [...await this.list()]
    const index = entries.findIndex((item) => item.id === valid.id)
    if (expectedRevision !== undefined && (index < 0 || entries[index]!.revision !== expectedRevision)) throw new Error("catalog revision conflict")
    if (index < 0) entries.push(valid)
    else entries[index] = valid
    await writeFileAtomic(this.path, JSON.stringify(entries), 0o600)
  }
}
