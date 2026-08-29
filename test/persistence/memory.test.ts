import { describe, expect, it } from "vitest"
import { loadState, loadTriggerState, MemoryEventStore } from "../../src/persistence/memory.js"

describe("memory event store", () => {
  it("replays an empty stream to initial state", async () => {
    expect(await loadState(new MemoryEventStore(), "empty")).toEqual({ status: "waiting", dueSequence: 0 })
  })

  it("appends ordered events and reconstructs state", async () => {
    const store = new MemoryEventStore()
    await store.append("session-1", { type: "trigger-due" })
    await store.append("session-1", { type: "admit", runId: "run-1" })
    expect(await store.replay("session-1")).toMatchObject([{ sequence: 1 }, { sequence: 2 }])
    expect(await loadState(store, "session-1")).toMatchObject({ status: "running", activeRunId: "run-1" })
  })

  it("isolates streams and protects stored event arrays", async () => {
    const store = new MemoryEventStore()
    await store.append("a", { type: "trigger-due" })
    const events = await store.replay("a")
    ;(events as unknown as Array<{ sequence: number }>)[0]!.sequence = 99
    expect((await store.replay("a"))[0]!.sequence).toBe(1)
    expect(await store.replay("b")).toEqual([])
  })

  it("rejects appends that miss the expected sequence", async () => {
    const store = new MemoryEventStore()
    await store.append("a", { type: "pause" }, 0)
    await expect(store.append("a", { type: "resume" }, 0)).rejects.toThrow("stream revision conflict")
  })
  it("replays from a snapshot instead of the full history", async () => {
    const store = new MemoryEventStore()
    await store.append("a", { type: "trigger-due" })
    await store.append("a", { type: "admit", runId: "run-old" })
    await store.writeSnapshot({ streamId: "a", sequence: 2, state: { status: "due", dueSequence: 9, pendingDue: true } })
    expect(await loadState(store, "a")).toEqual({ status: "due", dueSequence: 9, pendingDue: true })
    expect(await loadState(store, "a")).not.toMatchObject({ activeRunId: "run-old" })
    await store.append("a", { type: "pause" })
    expect(await loadState(store, "a")).toEqual({ status: "paused", dueSequence: 9, pendingDue: true })
  })
  it("round-trips an immutable snapshot", async () => {
    const store = new MemoryEventStore()
    await store.writeSnapshot({ streamId: "a", sequence: 2, state: { status: "waiting", dueSequence: 2 } })
    const snapshot = await store.readSnapshot("a")
    expect(snapshot).toEqual({ streamId: "a", sequence: 2, state: { status: "waiting", dueSequence: 2 } })
    expect(await store.readSnapshot("missing")).toBeUndefined()
  })
  it("restores the latest trigger cursor", async () => {
    const store = new MemoryEventStore()
    const fallback = { pending: false, onceConsumed: false }
    await store.append("a", { type: "trigger-state", state: { pending: true, onceConsumed: true, nextDueAtMs: 10 } })
    expect(await loadTriggerState(store, "a", fallback)).toEqual({ pending: true, onceConsumed: true, nextDueAtMs: 10 })
    expect(await loadTriggerState(store, "missing", fallback)).toEqual(fallback)
  })
  it("ignores non-trigger events during cursor recovery", async () => {
    const store = new MemoryEventStore(); const fallback = { pending: false, onceConsumed: false }
    const cursor = { pending: true, onceConsumed: true, nextDueAtMs: 10 }
    await store.append("a", { type: "trigger-state", state: cursor }); await store.append("a", { type: "pause" })
    expect(await loadTriggerState(store, "a", fallback)).toEqual(cursor)
  })
})
