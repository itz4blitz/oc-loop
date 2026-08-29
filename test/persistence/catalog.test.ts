import { mkdtemp, stat } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import { WorkflowCatalog } from "../../src/persistence/catalog.js"
import type { Workflow } from "../../src/domain/schema.js"

const roots: string[] = []
afterEach(async () => { const { rm } = await import("node:fs/promises"); await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))) })
const workflow: Workflow = { schemaVersion: 1, id: "wf-1", revision: 1, name: "loop", status: "enabled", sessionBinding: { sessionId: "ses-1" }, node: { id: "node-1", kind: "prompt", prompt: "continue" }, trigger: { kind: "manual" }, policy: { permissions: "ask", maxRuns: 20, maxRuntimeMs: 60000, maxFailures: 3, noOverlap: true, delivery: "queue" }, createdAt: 1, updatedAt: 1 }
async function makeCatalog() { const root = await mkdtemp(join(tmpdir(), "oc-catalog-")); roots.push(root); return { root, catalog: new WorkflowCatalog(root) } }

describe("workflow catalog", () => {
  it("creates, reopens, and queries workflows", async () => {
    const { root, catalog } = await makeCatalog()
    await catalog.save(workflow)
    await catalog.save({ ...workflow, id: "wf-2" })
    const reopened = new WorkflowCatalog(root)
    expect(await reopened.get("wf-1")).toEqual(workflow)
    expect((await reopened.list()).map((item) => item.id)).toEqual(["wf-1", "wf-2"])
    expect(await reopened.get("missing")).toBeUndefined()
    expect((await stat(join(root, "catalog.json"))).mode & 0o777).toBe(0o600)
  })
  it("requires the expected revision for updates", async () => {
    const { catalog } = await makeCatalog()
    await expect(catalog.save(workflow, 1)).rejects.toThrow("revision conflict")
    await catalog.save(workflow)
    await expect(catalog.save({ ...workflow, revision: 2 }, 2)).rejects.toThrow("revision conflict")
    await catalog.save({ ...workflow, revision: 2 }, 1)
    expect((await catalog.get("wf-1"))?.revision).toBe(2)
  })
  it("rejects malformed catalog data", async () => {
    const { root, catalog } = await makeCatalog()
    const { writeFile, mkdir } = await import("node:fs/promises")
    await mkdir(root, { recursive: true })
    await writeFile(join(root, "catalog.json"), "not-json")
    await expect(catalog.list()).rejects.toThrow()
    await writeFile(join(root, "catalog.json"), "{}")
    await expect(catalog.list()).rejects.toThrow("corrupt workflow catalog")
    await writeFile(join(root, "catalog.json"), "[{}]")
    await expect(catalog.list()).rejects.toThrow()
    await expect(catalog.save({ ...workflow, id: "" })).rejects.toThrow()
  })
  it("cleans temporary data when replacement fails", async () => { const { root, catalog } = await makeCatalog(); const { mkdir, writeFile } = await import("node:fs/promises"); const path = join(root, "catalog.json"); await mkdir(path, { recursive: true }); await writeFile(join(path, "occupied"), "x"); await expect(catalog.save(workflow)).rejects.toThrow() })
})
