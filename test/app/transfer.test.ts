import { describe, expect, it } from "vitest"
import { exportLoops, importLoops } from "../../src/app/transfer.js"
import type { Workflow } from "../../src/domain/schema.js"

const workflow: Workflow = {
  schemaVersion: 1, id: "wf-1", revision: 1, name: "loop", status: "enabled", sessionBinding: { sessionId: "ses-1" },
  node: { id: "node-1", kind: "prompt", prompt: "continue" }, trigger: { kind: "idle" },
  policy: { permissions: "ask", maxRuns: 20, maxRuntimeMs: 1_800_000, maxFailures: 3, noOverlap: true, delivery: "queue" }, createdAt: 1, updatedAt: 1,
}

function catalog(seed: Workflow[] = []) {
  const workflows = new Map(seed.map((item) => [item.id, item]))
  return {
    list: async () => [...workflows.values()],
    get: async (id: string) => workflows.get(id),
    save: async (item: Workflow) => { workflows.set(item.id, item) },
  }
}

describe("loop import/export", () => {
  it("exports a versioned envelope", async () => {
    const text = await exportLoops({ list: async () => [workflow] }, () => 42)
    expect(JSON.parse(text)).toEqual({ schemaVersion: 1, exportedAt: 42, workflows: [workflow] })
    expect(await exportLoops({ list: async () => [] }, () => 0)).toBe('{"schemaVersion":1,"exportedAt":0,"workflows":[]}')
  })
  it("imports every workflow from a valid envelope", async () => {
    const target = catalog()
    const result = await importLoops(target, await exportLoops({ list: async () => [workflow, { ...workflow, id: "wf-2" }] }, () => 5))
    expect(result).toEqual({ imported: 2, skipped: 0 })
    expect((await target.list()).map((item) => item.id)).toEqual(["wf-1", "wf-2"])
  })
  it("skips ids that already exist without overwriting", async () => {
    const target = catalog([workflow])
    const result = await importLoops(target, await exportLoops({ list: async () => [workflow, { ...workflow, id: "wf-2" }] }, () => 5))
    expect(result).toEqual({ imported: 1, skipped: 1 })
    expect((await target.get("wf-1"))?.revision).toBe(1)
  })
  it("rejects malformed envelopes and workflows", async () => {
    const target = catalog()
    await expect(importLoops(target, "not-json")).rejects.toThrow("unsupported transfer envelope")
    await expect(importLoops(target, "{}")).rejects.toThrow("unsupported transfer envelope")
    await expect(importLoops(target, "[]")).rejects.toThrow("unsupported transfer envelope")
    await expect(importLoops(target, "null")).rejects.toThrow("unsupported transfer envelope")
    await expect(importLoops(target, '{"schemaVersion":2,"exportedAt":1,"workflows":[]}')).rejects.toThrow("unsupported transfer envelope")
    await expect(importLoops(target, '{"schemaVersion":1,"exportedAt":1,"workflows":{}}')).rejects.toThrow("unsupported transfer envelope")
    await expect(importLoops(target, '{"schemaVersion":1,"exportedAt":1,"workflows":[{}]}')).rejects.toThrow()
    expect(await target.list()).toEqual([])
  })
})
