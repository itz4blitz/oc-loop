import { describe, expect, it } from "vitest"
import { initialState, reduce, type DomainAction } from "../../src/domain/reducer.js"

describe("workflow reducer", () => {
  it("moves waiting to due and creates a sequence", () => {
    expect(reduce(initialState, { type: "trigger-due" })).toEqual({
      status: "due", dueSequence: 1, pendingDue: true,
    })
    expect(reduce(reduce(initialState, { type: "trigger-due" }), { type: "trigger-due" })).toEqual({ status: "due", dueSequence: 1, pendingDue: true })
  })

  it("admits due work and owns its run", () => {
    const due = reduce(initialState, { type: "trigger-due" })
    expect(reduce(due, { type: "admit", runId: "run-1" })).toEqual({
      status: "running", dueSequence: 1, activeRunId: "run-1", pendingDue: false,
    })
  })
  it("ignores trigger cursors and non-due lifecycle actions", () => {
    expect(reduce(initialState, { type: "trigger-state", state: { pending: true, onceConsumed: false } })).toBe(initialState)
    expect(reduce(initialState, { type: "admit", runId: "run-1" })).toBe(initialState)
    expect(reduce(initialState, { type: "block", reason: "busy" })).toBe(initialState)
  })

  it("blocks without creating a run", () => {
    const due = reduce(initialState, { type: "trigger-due" })
    expect(reduce(due, { type: "block", reason: "host-busy" })).toEqual({
      status: "blocked", dueSequence: 1, pendingDue: true, reason: "host-busy",
    })
  })
  it("unblocks pending work", () => {
    const blocked = reduce(reduce(initialState, { type: "trigger-due" }), { type: "block", reason: "busy" })
    expect(reduce(blocked, { type: "unblock" })).toEqual({ ...blocked, status: "due" })
    expect(reduce(initialState, { type: "unblock" })).toBe(initialState)
  })

  it("returns to waiting after successful recurring work", () => {
    const running = reduce(reduce(initialState, { type: "trigger-due" }), { type: "admit", runId: "run-1" })
    expect(reduce(running, { type: "succeed", runId: "run-1" })).toEqual({ status: "waiting", dueSequence: 1, pendingDue: false })
  })

  it("records an owned failure and ignores resume outside paused state", () => {
    const running = reduce(reduce(initialState, { type: "trigger-due" }), { type: "admit", runId: "run-1" })
    expect(reduce(running, { type: "fail", runId: "run-1", reason: "tests failed" })).toEqual({
      status: "waiting", dueSequence: 1, pendingDue: false, reason: "tests failed",
    })
    expect(reduce(running, { type: "resume" })).toBe(running)
    expect(reduce(running, { type: "fail", runId: "run-1", reason: " " })).toBe(running)
    const due = reduce(initialState, { type: "trigger-due" })
    expect(reduce(due, { type: "fail", runId: "run-1", reason: "bad" })).toBe(due)
  })

  it("rejects invalid transitions without mutation", () => {
    const action: DomainAction = { type: "succeed", runId: "run-1" }
    expect(reduce(initialState, action)).toBe(initialState)
    expect(reduce(initialState, { type: "stop" })).not.toBe(initialState)
    const cancelled = reduce(initialState, { type: "stop" })
    expect(reduce(cancelled, { type: "stop" })).toBe(cancelled)
    expect(reduce(initialState, { type: "stop", runId: "run-1" })).toEqual({ status: "cancelled", dueSequence: 0 })
  })

  it("rejects blank identifiers and reasons", () => {
    const due = reduce(initialState, { type: "trigger-due" })
    expect(reduce(due, { type: "admit", runId: " " })).toBe(due)
    expect(reduce(due, { type: "block", reason: " " })).toBe(due)
  })

  it("pause and resume preserve pending work", () => {
    const due = reduce(initialState, { type: "trigger-due" })
    expect(reduce(due, { type: "pause" })).toEqual({ ...due, status: "paused" })
    expect(reduce(reduce(due, { type: "pause" }), { type: "resume" })).toEqual(due)
    const running = reduce(due, { type: "admit", runId: "run-1" })
    expect(reduce(running, { type: "pause" })).toBe(running)
    const cancelled = reduce(initialState, { type: "stop" })
    expect(reduce(cancelled, { type: "pause" })).toBe(cancelled)
  })

  it("stop is terminal and clears active ownership", () => {
    const running = reduce(reduce(initialState, { type: "trigger-due" }), { type: "admit", runId: "run-1" })
    expect(reduce(running, { type: "stop", runId: "run-1" })).toEqual({ status: "cancelled", dueSequence: 1 })
  })

  it("does not accept stale completion or cancellation", () => {
    const running = reduce(reduce(initialState, { type: "trigger-due" }), { type: "admit", runId: "run-1" })
    expect(reduce(running, { type: "succeed", runId: "run-2" })).toBe(running)
    expect(reduce(running, { type: "fail", runId: "run-2", reason: "late" })).toBe(running)
    expect(reduce(running, { type: "stop", runId: "run-2" })).toBe(running)
    expect(reduce(running, { type: "stop" })).toBe(running)
  })

  it("supports resuming ordinary paused work", () => {
    expect(reduce(reduce(initialState, { type: "pause" }), { type: "resume" })).toEqual({ status: "waiting", dueSequence: 0 })
    const blocked = reduce(reduce(initialState, { type: "trigger-due" }), { type: "block", reason: "busy" })
    expect(reduce(reduce(blocked, { type: "pause" }), { type: "resume" })).toEqual({ ...blocked, status: "due" })
    expect(reduce(reduce(initialState, { type: "pause" }), { type: "pause" })).toEqual({ status: "paused", dueSequence: 0 })
    const pausedRunning = { status: "paused" as const, dueSequence: 2, activeRunId: "run-2" }
    expect(reduce(pausedRunning, { type: "resume" })).toEqual({
      status: "running", dueSequence: 2, activeRunId: "run-2",
    })
    expect(reduce(pausedRunning, { type: "succeed", runId: "run-2" })).toBe(pausedRunning)
    expect(reduce(pausedRunning, { type: "fail", runId: "run-2", reason: "late" })).toBe(pausedRunning)
  })
  it("marks an owned running run unknown and allows explicit recovery", () => {
    const running = reduce(reduce(initialState, { type: "trigger-due" }), { type: "admit", runId: "run-1" })
    const unknown = reduce(running, { type: "mark-unknown", runId: "run-1", reason: "service restarted" })
    expect(unknown).toEqual({ status: "unknown", dueSequence: 1, activeRunId: "run-1", pendingDue: false, reason: "service restarted" })
    expect(reduce(running, { type: "mark-unknown", runId: "run-2", reason: "service restarted" })).toBe(running)
    expect(reduce(running, { type: "mark-unknown", runId: "run-1", reason: " " })).toBe(running)
    expect(reduce({ status: "paused", dueSequence: 2, activeRunId: "run-1" }, { type: "mark-unknown", runId: "run-1", reason: "service restarted" })).toEqual({
      status: "paused", dueSequence: 2, activeRunId: "run-1",
    })
    expect(reduce(unknown, { type: "pause" })).toBe(unknown)
    expect(reduce(unknown, { type: "trigger-due" })).toBe(unknown)
    expect(reduce(unknown, { type: "succeed", runId: "run-1" })).toEqual({ status: "waiting", dueSequence: 1, pendingDue: false })
    expect(reduce(unknown, { type: "fail", runId: "run-1", reason: "lost" })).toEqual({
      status: "waiting", dueSequence: 1, pendingDue: false, reason: "lost",
    })
  })
})
