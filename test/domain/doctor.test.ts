import { describe, expect, it } from "vitest"
import { diagnoseLoop } from "../../src/domain/doctor.js"
import type { Workflow } from "../../src/domain/schema.js"

const workflow: Workflow = {
  schemaVersion: 1, id: "wf-1", revision: 1, name: "loop", status: "enabled", sessionBinding: { sessionId: "ses-1" },
  node: { id: "node-1", kind: "prompt", prompt: "continue" }, trigger: { kind: "manual" },
  policy: { permissions: "ask", maxRuns: 20, maxRuntimeMs: 60000, maxFailures: 3, noOverlap: true, delivery: "queue" }, createdAt: 1, updatedAt: 1,
}
const idle = { host: "idle" as const, foregroundTurn: false, activeTool: false, busyChild: false, statusReadSucceeded: true, activeLease: false }

describe("loop doctor", () => {
  it("reports missing loops", () => {
    expect(diagnoseLoop({})).toEqual(["loop not found"])
  })
  it("reports a healthy enabled loop", () => {
    expect(diagnoseLoop({ workflow, domain: { status: "waiting", dueSequence: 0 }, trigger: { pending: false, onceConsumed: false }, host: idle })).toEqual(["healthy"])
  })
  it("warns when a loop fires repeatedly within a minute", () => {
    expect(diagnoseLoop({ workflow, recentDispatches: [99_000, 98_000, 97_000], nowMs: 100_000 })).toEqual(["fired 3 times in the last minute"])
    expect(diagnoseLoop({ workflow, recentDispatches: [99_000, 98_000], nowMs: 100_000 })).toEqual(["healthy"])
    expect(diagnoseLoop({ workflow, recentDispatches: [100_000, 99_999, 99_998], nowMs: 100_000 })).toEqual(["fired 3 times in the last minute"])
    expect(diagnoseLoop({ workflow, recentDispatches: [40_000, 39_000, 38_000], nowMs: 100_000 })).toEqual(["healthy"])
    expect(diagnoseLoop({ workflow, recentDispatches: [99_000], nowMs: 100_000 })).toEqual(["healthy"])
    expect(diagnoseLoop({ workflow, recentDispatches: [150_000, 149_999, 149_998], nowMs: 100_000 })).toEqual(["healthy"])
    expect(diagnoseLoop({ workflow, nowMs: 100_000 })).toEqual(["healthy"])
    expect(diagnoseLoop({ workflow, recentDispatches: [99_000, 98_000, 97_000] })).toEqual(["healthy"])
    expect(diagnoseLoop({ workflow })).toEqual(["healthy"])
  })
  it("reports catalog, domain, trigger, and host problems", () => {
    expect(diagnoseLoop({ workflow: { ...workflow, status: "paused" } })).toEqual(["catalog status is paused"])
    expect(diagnoseLoop({ workflow, domain: { status: "running", dueSequence: 1, activeRunId: "run-1" } })).toEqual(["run run-1 is in-flight"])
    expect(diagnoseLoop({ workflow, domain: { status: "unknown", dueSequence: 1, activeRunId: "run-1" } })).toEqual(["run run-1 is unrecovered"])
    expect(diagnoseLoop({ workflow, domain: { status: "unknown", dueSequence: 1 } })).toEqual(["run unknown is unrecovered"])
    expect(diagnoseLoop({ workflow, domain: { status: "blocked", dueSequence: 1, reason: "host-busy" } })).toEqual(["blocked: host-busy"])
    expect(diagnoseLoop({ workflow, domain: { status: "cancelled", dueSequence: 1 } })).toEqual(["loop is cancelled"])
    expect(diagnoseLoop({ workflow, trigger: { pending: true, onceConsumed: false } })).toEqual(["trigger is pending"])
    expect(diagnoseLoop({ workflow, host: { ...idle, statusReadSucceeded: false, host: "unknown" } })).toEqual(["host status is unavailable"])
    expect(diagnoseLoop({ workflow, host: { ...idle, host: "busy" } })).toEqual(["host is busy"])
    expect(diagnoseLoop({ workflow, host: { ...idle, host: "retrying" } })).toEqual(["host is retrying"])
    expect(diagnoseLoop({ workflow, domain: { status: "running", dueSequence: 1 } })).toEqual(["run unknown is in-flight"])
    expect(diagnoseLoop({ workflow, domain: { status: "blocked", dueSequence: 1 } })).toEqual(["blocked: unknown"])
  })
})
