import { describe, expect, it } from "vitest"
import { MemoryEventStore, loadState } from "../../src/persistence/memory.js"
import { SchedulerCoordinator, type HostPort } from "../../src/scheduler/coordinator.js"
import type { Workflow } from "../../src/domain/schema.js"

const workflow: Workflow = {
  schemaVersion: 1, id: "wf-1", revision: 1, name: "loop", status: "enabled", sessionBinding: { sessionId: "ses-1" },
  node: { id: "node-1", kind: "prompt", prompt: "continue" }, trigger: { kind: "manual" },
  policy: { permissions: "ask", maxRuns: 20, maxRuntimeMs: 60000, maxFailures: 3, noOverlap: true, delivery: "queue" }, createdAt: 1, updatedAt: 1,
}
function host(overrides: Partial<Awaited<ReturnType<HostPort["inspect"]>>> = {}) {
  const calls: string[] = []
  const port: HostPort = { inspect: async () => ({ host: "idle", foregroundTurn: false, activeTool: false, busyChild: false, statusReadSucceeded: true, activeLease: false, ...overrides }), prompt: async ({ text }) => { calls.push(text) } }
  return { port, calls }
}

describe("scheduler coordinator", () => {
  it("runs a manual prompt through admission and persistence", async () => {
    const store = new MemoryEventStore(); const fake = host(); const coordinator = new SchedulerCoordinator(store, fake.port); coordinator.register(workflow)
    await coordinator.signal({ type: "manual" })
    expect(fake.calls).toEqual(["continue"]); expect((await loadState(store, "wf-1")).status).toBe("waiting")
    expect(coordinator.queued("wf-1")).toBe(false)
  })
  it("blocks without dispatching unsafe work", async () => {
    const store = new MemoryEventStore(); const fake = host({ host: "busy" }); const coordinator = new SchedulerCoordinator(store, fake.port); coordinator.register(workflow)
    await coordinator.signal({ type: "manual" })
    expect(fake.calls).toEqual([]); expect((await loadState(store, "wf-1")).status).toBe("blocked")
  })
  it("records dispatch failures", async () => {
    const store = new MemoryEventStore(); const fake = host(); fake.port.prompt = async () => { throw new Error("no") }; const coordinator = new SchedulerCoordinator(store, fake.port); coordinator.register(workflow)
    await coordinator.signal({ type: "manual" }); expect((await loadState(store, "wf-1")).reason).toBe("no")
  })
  it("does nothing for disabled workflows", async () => {
    const store = new MemoryEventStore(); const fake = host(); const coordinator = new SchedulerCoordinator(store, fake.port); coordinator.register({ ...workflow, status: "paused" })
    await coordinator.signal({ type: "manual" }); expect(fake.calls).toEqual([])
  })
  it("can retry after a blocked admission", async () => {
    const store = new MemoryEventStore(); const fake = host({ host: "busy" }); const coordinator = new SchedulerCoordinator(store, fake.port); coordinator.register(workflow)
    await coordinator.signal({ type: "manual" }); fake.port.inspect = async () => ({ host: "idle", foregroundTurn: false, activeTool: false, busyChild: false, statusReadSucceeded: true, activeLease: false })
    await coordinator.signal({ type: "manual" }); expect(fake.calls).toEqual(["continue"])
  })
  it("updates live lifecycle state", async () => {
    const store = new MemoryEventStore(); const fake = host(); const coordinator = new SchedulerCoordinator(store, fake.port); coordinator.register(workflow)
    await coordinator.pause("wf-1"); await coordinator.signal({ type: "manual" }); expect(fake.calls).toEqual([])
    await coordinator.resume("wf-1"); await coordinator.signal({ type: "manual" }); expect(fake.calls).toEqual(["continue"])
    await coordinator.stop("wf-1"); await coordinator.signal({ type: "manual" }); expect(fake.calls).toEqual(["continue"])
  })
  it("restores a consumed once trigger after restart", async () => {
    const store = new MemoryEventStore(); const first = host(); const coordinator = new SchedulerCoordinator(store, first.port)
    const once = { ...workflow, trigger: { kind: "once" as const, atMs: 1 } }
    coordinator.register(once)
    await coordinator.signal({ type: "clock-tick", nowMs: 1 })
    const second = host(); const restarted = new SchedulerCoordinator(store, second.port)
    await restarted.restore(once)
    await restarted.signal({ type: "clock-tick", nowMs: 2 })
    expect(second.calls).toEqual([])
  })
  it("exposes registration state and ignores unknown controls", async () => {
    const coordinator = new SchedulerCoordinator(new MemoryEventStore(), host().port)
    expect(coordinator.inspect("missing")).toBeUndefined()
    await coordinator.pause("missing"); await coordinator.resume("missing"); await coordinator.stop("missing")
    coordinator.register({ ...workflow, trigger: { kind: "interval", everyMs: 10 } })
    expect(coordinator.inspect("wf-1")?.trigger.nextDueAtMs).toBe(0)
  })
  it("records non-error dispatch failures safely", async () => {
    const store = new MemoryEventStore(); const fake = host(); fake.port.prompt = async () => { throw "failed" }
    const coordinator = new SchedulerCoordinator(store, fake.port); coordinator.register(workflow)
    await coordinator.signal({ type: "manual" })
    expect((await loadState(store, "wf-1")).reason).toBe("dispatch failed")
  })
  it("marks a persisted running run unknown on restore", async () => {
    const store = new MemoryEventStore()
    await store.append("wf-1", { type: "trigger-due" })
    await store.append("wf-1", { type: "admit", runId: "run-1" })
    const fake = host()
    const restarted = new SchedulerCoordinator(store, fake.port)
    await restarted.restore(workflow)
    expect((await loadState(store, "wf-1")).status).toBe("unknown")
    await restarted.restore(workflow)
    expect((await store.replay("wf-1")).filter((event) => event.action.type === "mark-unknown")).toHaveLength(1)
    await restarted.signal({ type: "manual" })
    expect(fake.calls).toEqual([])
  })
  it("restores persisted onceConsumed trigger state onto a new coordinator", async () => {
    const store = new MemoryEventStore(); const first = host(); const coordinator = new SchedulerCoordinator(store, first.port)
    const once = { ...workflow, trigger: { kind: "once" as const, atMs: 1 } }
    coordinator.register(once)
    await coordinator.signal({ type: "clock-tick", nowMs: 1 })
    const restarted = new SchedulerCoordinator(store, host().port)
    await restarted.restore(once)
    expect(restarted.inspect("wf-1")!.trigger.onceConsumed).toBe(true)
  })
  it("initializes manual and interval trigger state on register", () => {
    const coordinator = new SchedulerCoordinator(new MemoryEventStore(), host().port)
    coordinator.register(workflow)
    expect(coordinator.inspect("wf-1")?.trigger.nextDueAtMs).toBeUndefined()
    expect(coordinator.inspect("wf-1")?.trigger.onceConsumed).toBe(false)
    coordinator.register({ ...workflow, trigger: { kind: "interval", everyMs: 10 } })
    expect(coordinator.inspect("wf-1")?.trigger.nextDueAtMs).toBe(0)
  })
  it("does not throw when signaling a missing workflow", async () => {
    const coordinator = new SchedulerCoordinator(new MemoryEventStore(), host().port)
    await coordinator.signalWorkflow("missing", { type: "manual" })
  })
  it("serializes overlapping signals and still accepts a later signal", async () => {
    const store = new MemoryEventStore(); const fake = host()
    let release!: () => void
    let notifyStarted!: () => void
    const started = new Promise<void>((resolve) => { notifyStarted = resolve })
    const gate = new Promise<void>((resolve) => { release = resolve })
    fake.port.prompt = async ({ text }) => { fake.calls.push(text); notifyStarted(); await gate }
    const coordinator = new SchedulerCoordinator(store, fake.port, undefined, { dispatchFloorMs: 0 }); coordinator.register(workflow)
    const first = coordinator.signalWorkflow("wf-1", { type: "manual" })
    const second = coordinator.signalWorkflow("wf-1", { type: "manual" })
    await started
    expect(coordinator.queued("wf-1")).toBe(true)
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(fake.calls).toEqual(["continue"])
    release()
    await Promise.all([first, second])
    expect(fake.calls).toEqual(["continue", "continue"])
    await coordinator.signalWorkflow("wf-1", { type: "manual" })
    expect(fake.calls).toEqual(["continue", "continue", "continue"])
    expect(coordinator.queued("wf-1")).toBe(false)
  })
  it("inspects and persists pause, resume, and stop", async () => {
    const store = new MemoryEventStore(); const coordinator = new SchedulerCoordinator(store, host().port); coordinator.register(workflow)
    await coordinator.pause("wf-1")
    expect(coordinator.inspect("wf-1")!.workflow.status).toBe("paused")
    expect((await store.replay("wf-1")).map((event) => event.action.type)).toContain("pause")
    await coordinator.resume("wf-1")
    expect(coordinator.inspect("wf-1")!.workflow.status).toBe("enabled")
    await coordinator.stop("wf-1")
    expect(coordinator.inspect("wf-1")!.workflow.status).toBe("stopped")
  })
  it("records succeed and trigger-state without unblock on a clean run", async () => {
    const store = new MemoryEventStore(); const coordinator = new SchedulerCoordinator(store, host().port); coordinator.register(workflow)
    await coordinator.signal({ type: "manual" })
    const types = (await store.replay("wf-1")).map((event) => event.action.type)
    expect(types).toContain("succeed")
    expect(types).toContain("trigger-state")
    expect(types).not.toContain("unblock")
    expect(types).not.toContain("fail")
  })
  it("assigns unique durable run ids across successful runs", async () => {
    const store = new MemoryEventStore(); const coordinator = new SchedulerCoordinator(store, host().port, undefined, { dispatchFloorMs: 0 }); coordinator.register(workflow)
    await coordinator.signal({ type: "manual" })
    await coordinator.signal({ type: "manual" })
    const runIds = (await store.replay("wf-1")).flatMap((event) => event.action.type === "admit" ? [event.action.runId] : [])
    expect(runIds).toHaveLength(2)
    expect(runIds[0]).toMatch(/^run-[0-9a-f-]{36}$/)
    expect(runIds[1]).toMatch(/^run-[0-9a-f-]{36}$/)
    expect(runIds[0]).not.toBe(runIds[1])
  })
  it("does not admit over an already running persisted run", async () => {
    const store = new MemoryEventStore(); const fake = host()
    await store.append("wf-1", { type: "trigger-due" })
    await store.append("wf-1", { type: "admit", runId: "run-1" })
    const coordinator = new SchedulerCoordinator(store, fake.port); coordinator.register(workflow)
    await coordinator.signal({ type: "manual" })
    expect(fake.calls).toEqual([])
    const blocked = (await store.replay("wf-1")).filter((event) => event.action.type === "block")
    expect(blocked.at(-1)?.action).toMatchObject({ type: "block", reason: "not-due" })
  })
  it("blocks when the run budget is exhausted", async () => {
    const store = new MemoryEventStore(); const fake = host()
    const coordinator = new SchedulerCoordinator(store, fake.port)
    coordinator.register({ ...workflow, policy: { ...workflow.policy, maxRuns: 1 } })
    await coordinator.signal({ type: "manual" })
    await coordinator.signal({ type: "manual" })
    expect(fake.calls).toEqual(["continue"])
    expect((await store.replay("wf-1")).map((event) => event.action)).toContainEqual({ type: "block", reason: "run-budget" })
  })
  it("blocks when the failure budget is exhausted", async () => {
    const store = new MemoryEventStore(); const fake = host()
    fake.port.prompt = async () => { throw new Error("no") }
    const coordinator = new SchedulerCoordinator(store, fake.port)
    coordinator.register({ ...workflow, policy: { ...workflow.policy, maxFailures: 1 } })
    await coordinator.signal({ type: "manual" })
    fake.port.prompt = async ({ text }) => { fake.calls.push(text) }
    await coordinator.signal({ type: "manual" })
    expect(fake.calls).toEqual([])
    expect((await store.replay("wf-1")).map((event) => event.action)).toContainEqual({ type: "block", reason: "failure-budget" })
  })
  it("dispatches interval workflows on clock ticks", async () => {
    const store = new MemoryEventStore(); const fake = host()
    const coordinator = new SchedulerCoordinator(store, fake.port)
    coordinator.register({ ...workflow, trigger: { kind: "interval", everyMs: 10 } })
    await coordinator.signal({ type: "clock-tick", nowMs: 10 })
    expect(fake.calls).toEqual(["continue"])
  })
  it("gates command nodes on verification exit codes without a model dispatch", async () => {
    const store = new MemoryEventStore(); const fake = host()
    const runs: string[] = []
    const runner = { run: async (command: string) => { runs.push(command); return 0 } }
    const coordinator = new SchedulerCoordinator(store, fake.port, runner)
    coordinator.register({ ...workflow, node: { id: "node-2", kind: "command", command: "pnpm test", timeoutMs: 60_000 } })
    await coordinator.signal({ type: "manual" })
    expect(fake.calls).toEqual([])
    expect(runs).toEqual(["pnpm test"])
    expect((await store.replay("wf-1")).map((event) => event.action)).toContainEqual({ type: "succeed", runId: expect.any(String) })
  })
  it("fails the run when verification exits nonzero", async () => {
    const store = new MemoryEventStore(); const fake = host()
    const coordinator = new SchedulerCoordinator(store, fake.port, { run: async () => 2 })
    coordinator.register({ ...workflow, node: { id: "node-2", kind: "command", command: "pnpm test", timeoutMs: 60_000 } })
    await coordinator.signal({ type: "manual" })
    const actions = (await store.replay("wf-1")).map((event) => event.action)
    expect(actions).toContainEqual({ type: "fail", runId: expect.any(String), reason: "verification failed (exit 2)" })
    expect(actions).not.toContainEqual({ type: "succeed", runId: expect.any(String) })
  })
  it("fails closed when the runner throws", async () => {
    const store = new MemoryEventStore(); const fake = host()
    const coordinator = new SchedulerCoordinator(store, fake.port, { run: async () => { throw new Error("spawn gone") } })
    coordinator.register({ ...workflow, node: { id: "node-2", kind: "command", command: "pnpm test", timeoutMs: 60_000 } })
    await coordinator.signal({ type: "manual" })
    expect((await store.replay("wf-1")).map((event) => event.action)).toContainEqual({
      type: "fail", runId: expect.any(String), reason: "verification failed to run: spawn gone",
    })
  })
  it("fails closed when no runner is configured", async () => {
    const store = new MemoryEventStore(); const fake = host()
    const coordinator = new SchedulerCoordinator(store, fake.port)
    coordinator.register({ ...workflow, node: { id: "node-2", kind: "command", command: "pnpm test", timeoutMs: 60_000 } })
    await coordinator.signal({ type: "manual" })
    expect((await store.replay("wf-1")).map((event) => event.action)).toContainEqual({
      type: "fail", runId: expect.any(String), reason: "verification failed to run",
    })
  })
  it("fails closed on non-error runner rejections", async () => {
    const store = new MemoryEventStore(); const fake = host()
    const coordinator = new SchedulerCoordinator(store, fake.port, { run: async () => { throw "boom" } })
    coordinator.register({ ...workflow, node: { id: "node-2", kind: "command", command: "pnpm test", timeoutMs: 60_000 } })
    await coordinator.signal({ type: "manual" })
    expect((await store.replay("wf-1")).map((event) => event.action)).toContainEqual({
      type: "fail", runId: expect.any(String), reason: "verification failed to run",
    })
  })
  it("approval nodes park the loop on pause without dispatching", async () => {    const store = new MemoryEventStore(); const fake = host()
    let calls = 0
    const coordinator = new SchedulerCoordinator(store, fake.port, { run: async () => { calls += 1; return 0 } })
    coordinator.register({ ...workflow, node: { id: "node-3", kind: "approval" } })
    await coordinator.signal({ type: "manual" })
    expect(fake.calls).toEqual([])
    expect(calls).toBe(0)
    expect((await loadState(store, "wf-1")).status).toBe("paused")
    expect(coordinator.inspect("wf-1")?.workflow.status).toBe("paused")
  })
  it("condition nodes branch prompts on the verification exit code", async () => {
    const store = new MemoryEventStore(); const fake = host()
    const coordinator = new SchedulerCoordinator(store, fake.port, { run: async () => 0 })
    coordinator.register({
      ...workflow, node: { id: "node-4", kind: "condition", command: "pnpm test", passPrompt: "ship it", failPrompt: "fix it", timeoutMs: 30_000 },
    })
    await coordinator.signal({ type: "manual" })
    expect(fake.calls).toEqual(["ship it"])
    expect((await store.replay("wf-1")).map((event) => event.action.type)).toContain("succeed")
  })
  it("condition nodes dispatch the fail prompt and fail on nonzero exit", async () => {
    const store = new MemoryEventStore(); const fake = host()
    const coordinator = new SchedulerCoordinator(store, fake.port, { run: async () => 3 })
    coordinator.register({
      ...workflow, node: { id: "node-4", kind: "condition", command: "pnpm test", passPrompt: "ship it", failPrompt: "fix it", timeoutMs: 30_000 },
    })
    await coordinator.signal({ type: "manual" })
    expect(fake.calls).toEqual(["fix it"])
    expect((await store.replay("wf-1")).map((event) => event.action)).toContainEqual({
      type: "fail", runId: expect.any(String), reason: "verification failed (exit 3)",
    })
  })
  it("condition nodes succeed or fail without prompts when branches are absent", async () => {
    const store = new MemoryEventStore(); const fake = host()
    const pass = new SchedulerCoordinator(store, fake.port, { run: async () => 0 })
    pass.register({ ...workflow, node: { id: "node-4", kind: "condition", command: "pnpm test", timeoutMs: 30_000 } })
    await pass.signal({ type: "manual" })
    expect(fake.calls).toEqual([])
    expect((await store.replay("wf-1")).map((event) => event.action.type)).toContain("succeed")
    const failStore = new MemoryEventStore(); const failFake = host()
    const fail = new SchedulerCoordinator(failStore, failFake.port, { run: async () => 1 })
    fail.register({ ...workflow, node: { id: "node-4", kind: "condition", command: "pnpm test", passPrompt: "ship it", timeoutMs: 30_000 } })
    await fail.signal({ type: "manual" })
    expect(failFake.calls).toEqual([])
    expect((await failStore.replay("wf-1")).map((event) => event.action.type)).toContain("fail")
  })
  it("never runs verification for prompt nodes", async () => {
    const store = new MemoryEventStore(); const fake = host()
    let calls = 0
    const coordinator = new SchedulerCoordinator(store, fake.port, { run: async () => { calls += 1; return 1 } })
    coordinator.register(workflow)
    await coordinator.signal({ type: "manual" })
    expect(calls).toBe(0)
    expect((await store.replay("wf-1")).map((event) => event.action.type)).toContain("succeed")
  })
  it("rate limits dispatches within the floor and allows after it elapses", async () => {
    const store = new MemoryEventStore(); const fake = host()
    let now = 1_000
    const coordinator = new SchedulerCoordinator(store, fake.port, undefined, { dispatchFloorMs: 5_000, nowMs: () => now })
    coordinator.register(workflow)
    await coordinator.signal({ type: "manual" })
    expect(fake.calls).toEqual(["continue"])
    now = 4_000
    await coordinator.signal({ type: "manual" })
    expect(fake.calls).toEqual(["continue"])
    expect((await store.replay("wf-1")).map((event) => event.action)).toContainEqual({ type: "block", reason: "dispatch-floor" })
    now = 6_000
    await coordinator.signal({ type: "manual" })
    expect(fake.calls).toEqual(["continue", "continue"])
  })
  it("defaults to a 30 second dispatch floor", async () => {
    const store = new MemoryEventStore(); const fake = host()
    const coordinator = new SchedulerCoordinator(store, fake.port)
    coordinator.register(workflow)
    await coordinator.signal({ type: "manual" })
    await coordinator.signal({ type: "manual" })
    expect(fake.calls).toEqual(["continue"])
    expect((await store.replay("wf-1")).map((event) => event.action)).toContainEqual({ type: "block", reason: "dispatch-floor" })
  })
  it("exposes recent dispatch timestamps for diagnostics", async () => {
    const store = new MemoryEventStore(); const fake = host()
    let now = 1_000
    const coordinator = new SchedulerCoordinator(store, fake.port, undefined, { dispatchFloorMs: 0, nowMs: () => now })
    coordinator.register(workflow)
    await coordinator.signal({ type: "manual" })
    now = 2_000
    await coordinator.signal({ type: "manual" })
    expect(coordinator.recentDispatches("wf-1")).toEqual([1_000, 2_000])
    expect(coordinator.recentDispatches("missing")).toEqual([])
  })
  it("clears pending on the last trigger-state after success", async () => {
    const store = new MemoryEventStore(); const coordinator = new SchedulerCoordinator(store, host().port); coordinator.register(workflow)
    await coordinator.signal({ type: "manual" })
    const states = (await store.replay("wf-1")).filter((event) => event.action.type === "trigger-state")
    expect(states.at(-1)?.action).toMatchObject({ type: "trigger-state", state: { pending: false } })
  })
})
