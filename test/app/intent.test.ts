import { describe, expect, it } from "vitest"
import { errorMessage, executeLoopIntent, nowEvent } from "../../src/app/commands.js"
import { toolToIntent } from "../../src/app/tool.js"
import { MemoryEventStore } from "../../src/persistence/memory.js"
import { SchedulerCoordinator } from "../../src/scheduler/coordinator.js"
import type { Workflow } from "../../src/domain/schema.js"
import type { LoopCommandPorts } from "../../src/app/commands.js"

const base: Workflow = {
  schemaVersion: 1, id: "wf-1", revision: 1, name: "loop", status: "enabled", sessionBinding: { sessionId: "ses-1" },
  node: { id: "node-1", kind: "prompt", prompt: "continue" }, trigger: { kind: "manual" },
  policy: { permissions: "ask", maxRuns: 20, maxRuntimeMs: 60000, maxFailures: 3, noOverlap: true, delivery: "queue" }, createdAt: 1, updatedAt: 1,
}

function ports(seed: Workflow[] = []): LoopCommandPorts {
  const workflows = new Map(seed.map((workflow) => [workflow.id, workflow]))
  const store = new MemoryEventStore()
  const coordinator = new SchedulerCoordinator(store, {
    inspect: async () => ({ host: "idle", foregroundTurn: false, activeTool: false, busyChild: false, statusReadSucceeded: true, activeLease: false }),
    prompt: async () => undefined,
  })
  for (const workflow of seed) coordinator.register(workflow)
  return {
    catalog: {
      list: async () => [...workflows.values()],
      get: async (id: string) => workflows.get(id),
      save: async (workflow: Workflow) => { workflows.set(workflow.id, workflow) },
    },
    coordinator,
    store,
    host: { inspect: async () => ({ host: "idle", statusReadSucceeded: true }) },
    nowMs: () => 10,
    ids: () => ({ workflowId: "wf-new", nodeId: "node-new" }),
  }
}

describe("loop intent execution", () => {
  it("exports and imports catalogs", async () => {
    const harness = ports([base])
    const text = await executeLoopIntent({ kind: "export" }, "ses-1", harness)
    expect(JSON.parse(text).schemaVersion).toBe(1)
    expect(await executeLoopIntent({ kind: "import", transfer: text }, "ses-1", harness)).toBe("Imported 0 loop(s), skipped 1.")
    expect(await executeLoopIntent({ kind: "template", name: "nope" }, "ses-1", harness)).toBe("unknown template: nope")
    expect(await executeLoopIntent({ kind: "import", transfer: "not-json" }, "ses-1", harness)).toBe("unsupported transfer envelope")
    expect(await executeLoopIntent({ kind: "import", transfer: text }, "ses-1", ports())).toBe("Imported 1 loop(s), skipped 0.")
  })
  it("help and doctor without id", async () => {
    const harness = ports()
    expect(await executeLoopIntent({ kind: "help" }, "ses-1", harness)).toContain("/loop")
    expect(await executeLoopIntent({ kind: "doctor" }, "ses-1", harness)).toBe("No loops found.")
    expect(await executeLoopIntent({ kind: "doctor", loopId: "wf-1" }, "ses-1", ports([base]))).toContain("wf-1: healthy")
  })
  it("logs and timelines a loop's history", async () => {
    const harness = ports([base])
    await executeLoopIntent({ kind: "now", loopId: "wf-1" }, "ses-1", harness)
    expect(await executeLoopIntent({ kind: "logs", loopId: "wf-1" }, "ses-1", harness)).toContain("admit")
    expect(await executeLoopIntent({ kind: "timeline", loopId: "wf-1" }, "ses-1", harness)).toContain("admitted")
    const quiet = ports([{ ...base, id: "wf-quiet" }])
    expect(await executeLoopIntent({ kind: "logs", loopId: "wf-quiet" }, "ses-1", quiet)).toBe("No events.")
  })
  it("covers optional-field combinations and error fallbacks", async () => {
    const harness = ports()
    expect(await executeLoopIntent({ kind: "create", worktree: "/tmp/wt" }, "ses-1", harness)).toMatch(/^Loop created: wf-/)
    expect(await executeLoopIntent({ kind: "template" }, "ses-1", harness)).toContain("Templates:")
    expect(await executeLoopIntent({ kind: "template", name: "watch", worktree: "/tmp/wt" }, "ses-1", harness)).toContain("from template watch")
    expect(await executeLoopIntent({ kind: "doctor", loopId: "wf-nope" }, "ses-1", harness)).toBe("Loop not found: wf-nope")
    const unregistered = ports()
    await unregistered.catalog.save(base)
    expect(await executeLoopIntent({ kind: "doctor", loopId: "wf-1" }, "ses-1", unregistered)).toContain("wf-1:")
    const runner = ports([base])
    expect(await executeLoopIntent({ kind: "show", loopId: "wf-1" }, "ses-1", runner)).toContain("Events:")
    await executeLoopIntent({ kind: "now", loopId: "wf-1" }, "ses-1", runner)
    expect(await executeLoopIntent({ kind: "timeline", loopId: "wf-1" }, "ses-1", runner)).toContain("admitted")
    const breaking = ports([base])
    breaking.catalog.save = async () => { throw "disk" }
    expect(await executeLoopIntent({ kind: "set", loopId: "wf-1", fields: { name: "renamed" } }, "ses-1", breaking)).toBe("disk")
    const payload = JSON.stringify({ schemaVersion: 1, exportedAt: 1, workflows: [{ ...base, id: "wf-2" }] }).replace(/ /g, "")
    expect(await executeLoopIntent({ kind: "import", transfer: payload }, "ses-1", breaking)).toBe("disk")
  })
  it("set updates fields through the applier", async () => {
    const harness = ports([base])
    const updated = await executeLoopIntent({ kind: "set", loopId: "wf-1", fields: { name: "renamed", maxRuns: 5, permissions: "ask-never" } }, "ses-1", harness)
    expect(updated).toBe("Loop updated: wf-1")
    const workflow = await harness.catalog.get("wf-1")
    expect(workflow?.name).toBe("renamed")
    expect(workflow?.policy.maxRuns).toBe(5)
    expect(workflow?.policy.permissions).toBe("ask-never")
  })
  it("set rebuilds triggers and rejects invalid combinations", async () => {
    const harness = ports([base])
    expect(await executeLoopIntent({ kind: "set", loopId: "wf-1", fields: { trigger: "interval" } }, "ses-1", harness)).toBe("interval trigger requires --every-ms")
    expect(await executeLoopIntent({ kind: "set", loopId: "wf-1", fields: { trigger: "interval", everyMs: 15 } }, "ses-1", harness)).toBe("Loop updated: wf-1")
    expect((await harness.catalog.get("wf-1"))?.trigger).toEqual({ kind: "interval", everyMs: 15 })
    expect(await executeLoopIntent({ kind: "set", loopId: "wf-1", fields: { trigger: "once" } }, "ses-1", harness)).toBe("once trigger requires --at-ms")
  })
  it("drives the oc_loop tool mapping for set", async () => {
    const harness = ports([base])
    expect(toolToIntent({ action: "set" })).toEqual({ ok: false, message: "set requires a loop id" })
    expect(toolToIntent({ action: "set", loopId: "wf-9", fields: { name: "x", trigger: "interval", everyMs: 60, maxRuns: 3, runtimeMs: 1000, maxFailures: 0, permissions: "ask-never" } })).toEqual({
      ok: true,
      intent: { kind: "set", loopId: "wf-9", fields: { name: "x", trigger: "interval", everyMs: 60, maxRuns: 3, runtimeMs: 1000, maxFailures: 0, permissions: "ask-never" } },
    })
    expect(toolToIntent({ action: "set", loopId: "wf-8" })).toEqual({ ok: true, intent: { kind: "set", loopId: "wf-8", fields: {} } })
    expect(await executeLoopIntent({ kind: "set", loopId: "wf-1", fields: { trigger: "manual" } }, "ses-1", harness)).toBe("Loop updated: wf-1")
  })
  it("now maps each trigger kind to its event", () => {
    expect(nowEvent({ kind: "idle" }, 5)).toEqual({ type: "idle-boundary" })
    expect(nowEvent({ kind: "manual" }, 5)).toEqual({ type: "manual" })
    expect(nowEvent({ kind: "once", atMs: 5 }, 5)).toEqual({ type: "clock-tick", nowMs: 5 })
    expect(nowEvent({ kind: "interval", everyMs: 5 }, 5)).toEqual({ type: "clock-tick", nowMs: 5 })
    expect(errorMessage(new Error("boom"))).toBe("boom")
    expect(errorMessage("boom")).toBe("boom")
  })
})
