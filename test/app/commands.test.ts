import { describe, expect, it } from "vitest"
import { executeLoopCommand } from "../../src/app/commands.js"
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

describe("loop command execution", () => {
  it("returns parser errors", async () => {
    expect(await executeLoopCommand("wat", "ses-1", ports())).toContain("unknown /loop subcommand")
    expect(await executeLoopCommand("   ", "ses-1", { ...ports(), ids: () => ({ workflowId: "wf-ws", nodeId: "n" }) })).toBe("Loop created: wf-ws")
  })
  it("creates, lists, and helps", async () => {
    const harness = ports()
    expect(await executeLoopCommand("create keep going", "ses-1", harness)).toBe("Loop created: wf-new")
    expect(await executeLoopCommand("list", "ses-1", harness)).toContain("wf-new")
    expect(await executeLoopCommand("help", "ses-1", harness)).toContain("doctor")
  })
  it("doctors and rejects missing loops", async () => {
    expect(await executeLoopCommand("doctor", "ses-1", ports())).toBe("No loops found.")
    expect(await executeLoopCommand("doctor missing", "ses-1", ports())).toBe("Loop not found: missing")
    expect(await executeLoopCommand("doctor wf-1", "ses-1", ports([base]))).toContain("wf-1: healthy")
  })
  it("pauses, resumes, stops, shows, logs, and triggers", async () => {
    const harness = ports([base])
    expect(await executeLoopCommand("pause wf-1", "ses-1", harness)).toBe("Loop paused: wf-1")
    expect(await executeLoopCommand("resume wf-1", "ses-1", harness)).toBe("Loop resumed: wf-1")
    expect(await executeLoopCommand("show wf-1", "ses-1", harness)).toContain("Events:")
    expect(await executeLoopCommand("logs wf-1", "ses-1", harness)).toContain("resume")
    expect(await executeLoopCommand("now wf-1", "ses-1", harness)).toBe("Loop triggered: wf-1")
    expect(await executeLoopCommand("stop wf-1", "ses-1", harness)).toBe("Loop stopped: wf-1")
    expect(await executeLoopCommand("show missing", "ses-1", harness)).toBe("Loop not found: missing")
  })
})
