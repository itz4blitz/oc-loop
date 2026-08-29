import { describe, expect, it } from "vitest"
import { timelineLines } from "../../src/app/timeline.js"

const events = [
  { sequence: 1, action: { type: "trigger-state" as const, state: { pending: true, onceConsumed: false } } },
  { sequence: 2, action: { type: "trigger-due" as const } },
  { sequence: 3, action: { type: "admit" as const, runId: "run-a" } },
  { sequence: 4, action: { type: "succeed" as const, runId: "run-a" } },
]

describe("run timeline", () => {
  it("renders an empty stream", () => {
    expect(timelineLines([])).toEqual(["No events."])
  })
  it("reports no events when only bookkeeping is present", () => {
    expect(timelineLines([{ sequence: 1, action: { type: "trigger-state", state: { pending: true, onceConsumed: false } } }])).toEqual(["No events."])
  })
  it("renders lifecycle events in order and skips cursor bookkeeping", () => {
    expect(timelineLines(events)).toEqual([
      "2. due",
      "3. run run-a admitted",
      "4. run run-a succeeded",
    ])
  })
  it("renders failures, blocks, pauses, and recovery", () => {
    expect(timelineLines([
      { sequence: 1, action: { type: "block", reason: "host-busy" } },
      { sequence: 2, action: { type: "unblock" } },
      { sequence: 3, action: { type: "pause" } },
      { sequence: 4, action: { type: "resume" } },
      { sequence: 5, action: { type: "fail", runId: "run-b", reason: "boom" } },
      { sequence: 6, action: { type: "stop" } },
      { sequence: 7, action: { type: "mark-unknown", runId: "run-c", reason: "service restarted" } },
      { sequence: 8, action: { type: "stop", runId: "run-c" } },
    ])).toEqual([
      "1. blocked: host-busy",
      "2. unblocked",
      "3. paused",
      "4. resumed",
      "5. run run-b failed: boom",
      "6. stopped",
      "7. run run-c unrecovered: service restarted",
      "8. stopped",
    ])
  })
})
