import { describe, expect, it } from "vitest"
import { createOpenCodeHost } from "../../src/host/opencode.js"

const closed = { host: "unknown" as const, foregroundTurn: false, activeTool: false, busyChild: false, statusReadSucceeded: false, activeLease: false }

describe("OpenCode host adapter", () => {
  it("fails closed when session get throws even if a status was cached", async () => {
    const host = createOpenCodeHost({ session: { get: async () => { throw new Error("no") }, prompt: async () => undefined } })
    host.observe({ type: "session.status", data: { sessionID: "ses-1", status: { type: "idle" } } })
    expect(await host.inspect("ses-1")).toEqual(closed)
  })
  it("keeps unknown until a verified session.status event arrives", async () => {
    const seen: string[] = []
    const host = createOpenCodeHost({ session: { get: async (input) => { seen.push(input.sessionID); return {} }, prompt: async () => undefined } })
    expect(await host.inspect("ses-1")).toEqual(closed)
    host.observe({ type: "session.status", data: { sessionID: "ses-1", status: { type: "idle" } } })
    expect(await host.inspect("ses-1")).toEqual({ ...closed, host: "idle", statusReadSucceeded: true })
    host.observe({ type: "session.idle", data: { sessionID: "ses-1" } })
    expect(await host.inspect("ses-1")).toEqual({ ...closed, host: "idle", statusReadSucceeded: true })
    host.observe({ type: "session.status", data: { sessionID: "ses-1", status: { type: "busy" } } })
    expect(await host.inspect("ses-1")).toEqual({ ...closed, host: "busy", statusReadSucceeded: true })
    host.observe({ type: "session.status", data: { sessionID: "ses-1", status: { type: "retry" } } })
    expect(await host.inspect("ses-1")).toEqual({ ...closed, host: "retrying", statusReadSucceeded: true })
    host.observe({ type: "session.status", data: { sessionID: "ses-1", status: { type: "other" } } })
    expect(await host.inspect("ses-1")).toEqual(closed)
    expect(seen.length).toBeGreaterThan(0)
    expect(seen.every((id) => id === "ses-1")).toBe(true)
  })
  it("ignores malformed events", async () => {
    const host = createOpenCodeHost({ session: { get: async () => ({}), prompt: async () => undefined } })
    host.observe(null)
    host.observe("x")
    host.observe({ type: "session.status" })
    host.observe({ type: "session.status", data: undefined })
    host.observe({ type: "session.status", data: { status: { type: "idle" } } })
    host.observe({ type: "session.status", data: { sessionID: "ses-1" } })
    expect(await host.inspect("ses-1")).toEqual(closed)
  })
  it("queues prompts with the bound session id", async () => {
    const calls: Array<{ sessionID: string; text: string; delivery: string }> = []
    const host = createOpenCodeHost({
      session: { get: async () => ({}), prompt: async (input) => { calls.push(input) } },
    })
    await host.prompt({ sessionId: "ses-1", text: "continue", runId: "run-1", idempotencyKey: "wf-1:1" })
    expect(calls).toEqual([{ sessionID: "ses-1", text: "continue", delivery: "queue" }])
  })
})
