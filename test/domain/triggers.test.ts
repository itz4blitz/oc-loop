import { describe, expect, it } from "vitest"
import { consumePending, evaluateTrigger, type TriggerState } from "../../src/domain/triggers.js"

const clean: TriggerState = { pending: false, onceConsumed: false }

describe("trigger evaluation", () => {
  it("fires idle only at an idle boundary", () => {
    expect(evaluateTrigger({ kind: "idle" }, clean, { type: "clock-tick", nowMs: 1 }).due).toBe(false)
    expect(evaluateTrigger({ kind: "idle" }, clean, { type: "idle-boundary" })).toEqual({
      state: { pending: true, onceConsumed: false }, due: true, reason: "idle",
    })
    expect(evaluateTrigger({ kind: "once", atMs: 1 }, clean, { type: "idle-boundary" }).due).toBe(false)
  })

  it("fires manual only for manual input", () => {
    expect(evaluateTrigger({ kind: "manual" }, clean, { type: "manual" })).toEqual({
      state: { pending: true, onceConsumed: false }, due: true, reason: "manual",
    })
    expect(evaluateTrigger({ kind: "manual" }, clean, { type: "idle-boundary" }).due).toBe(false)
  })

  it("fires once at or after its deadline and consumes it", () => {
    const trigger = { kind: "once" as const, atMs: 100 }
    expect(evaluateTrigger(trigger, clean, { type: "clock-tick", nowMs: 99 }).due).toBe(false)
    expect(evaluateTrigger(trigger, { ...clean, nextDueAtMs: 200 }, { type: "clock-tick", nowMs: 100 }).due).toBe(true)
    const result = evaluateTrigger(trigger, clean, { type: "clock-tick", nowMs: 100 })
    expect(result).toEqual({ due: true, reason: "once", state: { pending: true, onceConsumed: true } })
    expect(evaluateTrigger(trigger, consumePending(result.state), { type: "clock-tick", nowMs: 101 }).due).toBe(false)
  })

  it("fires intervals once and advances past missed periods", () => {
    const trigger = { kind: "interval" as const, everyMs: 10 }
    expect(evaluateTrigger(trigger, { ...clean, nextDueAtMs: 20 }, { type: "clock-tick", nowMs: 19 }).due).toBe(false)
    const first = evaluateTrigger(trigger, { ...clean, nextDueAtMs: 20 }, { type: "clock-tick", nowMs: 20 })
    expect(first).toEqual({ due: true, reason: "interval", state: { pending: true, onceConsumed: false, nextDueAtMs: 30 } })
    const late = evaluateTrigger(trigger, { ...clean, nextDueAtMs: 20 }, { type: "clock-tick", nowMs: 55 })
    expect(late).toEqual({ due: true, reason: "interval", state: { pending: true, onceConsumed: false, nextDueAtMs: 60 } })
    const anchored = evaluateTrigger(trigger, clean, { type: "clock-tick", nowMs: 0 })
    expect(anchored).toEqual({ due: true, reason: "interval", state: { pending: true, onceConsumed: false, nextDueAtMs: 10 } })
    const overdue = evaluateTrigger(trigger, { ...clean, nextDueAtMs: 0 }, { type: "clock-tick", nowMs: 0 })
    expect(overdue).toEqual({ due: true, reason: "interval", state: { pending: true, onceConsumed: false, nextDueAtMs: 10 } })
  })

  it("coalesces any event while work is pending", () => {
    const pending = { ...clean, pending: true }
    const result = evaluateTrigger({ kind: "manual" }, pending, { type: "manual" })
    expect(result).toEqual({ state: pending, due: false })
    expect(consumePending(pending)).toEqual({ ...clean, pending: false })
  })
})
