import { describe, expect, it, vi } from "vitest"
import { LOOP_HELP, applyLoopUpdate, catalogStatusFor, clockTick, createdMessage, createLoopWorkflow, doctorLines, lifecycleMessage, listLines, logLines, loopRoot, matchingIdleWorkflows, notFoundMessage, showLines, startClock, triggeredMessage } from "../../src/app/loop.js"
import type { Workflow } from "../../src/domain/schema.js"

const workflow: Workflow = {
  schemaVersion: 1, id: "wf-1", revision: 1, name: "loop", status: "enabled", sessionBinding: { sessionId: "ses-1" },
  node: { id: "node-1", kind: "prompt", prompt: "continue" }, trigger: { kind: "idle" },
  policy: { permissions: "ask", maxRuns: 20, maxRuntimeMs: 1_800_000, maxFailures: 3, noOverlap: true, delivery: "queue" }, createdAt: 1, updatedAt: 1,
}

describe("loop application helpers", () => {
  it("resolves the data root from env or cwd", () => {
    expect(loopRoot("/home/proj", {})).toBe("/home/proj/.opencode/itz4blitz/oc-loop")
    expect(loopRoot("/home/proj", { OC_LOOP_ROOT: "/tmp/loops" })).toBe("/tmp/loops")
  })
  it("creates an idle session-bound workflow", () => {
    expect(createLoopWorkflow({ sessionId: "ses-1", nowMs: 10, workflowId: "wf-1", nodeId: "node-1" })).toEqual({
      ...workflow, name: "Loop", node: { id: "node-1", kind: "prompt", prompt: "Continue the current task." }, createdAt: 10, updatedAt: 10,
    })
    const withPrompt = createLoopWorkflow({ sessionId: "ses-1", prompt: "fix tests", nowMs: 10, workflowId: "wf-1", nodeId: "node-1" })
    const withWorktree = createLoopWorkflow({ sessionId: "ses-1", worktree: "/tmp/wt", nowMs: 10, workflowId: "wf-3", nodeId: "node-3" })
    expect(withWorktree.sessionBinding).toEqual({ sessionId: "ses-1", worktree: "/tmp/wt" })
    expect(withPrompt.node.kind === "prompt" && withPrompt.node.prompt).toBe("fix tests")
  })
  it("formats doctor output", () => {
    expect(doctorLines([])).toBe("No loops found.")
    expect(doctorLines([{ workflow }])).toBe("wf-1: healthy")
    expect(doctorLines([{ workflow, domain: { status: "blocked", dueSequence: 1, reason: "busy" }, trigger: { pending: true, onceConsumed: false } }])).toBe("wf-1: blocked: busy; trigger is pending")
    expect(doctorLines([{ workflow }, { workflow: { ...workflow, id: "wf-2", status: "paused" } }])).toBe("wf-1: healthy\nwf-2: catalog status is paused")
  })
  it("starts and stops a fake clock", () => {
    const ticks: number[] = []
    let captured: (() => void) | undefined
    const clock = startClock((event) => { ticks.push(event.nowMs) }, {
      now: () => 42,
      intervalMs: 5,
      setInterval: ((handler: () => void, interval: number) => {
        expect(interval).toBe(5)
        captured = handler
        return 9 as unknown as ReturnType<typeof setInterval>
      }) as typeof setInterval,
      clearInterval: ((id) => { expect(id).toBe(9) }) as typeof clearInterval,
    })
    captured?.()
    expect(ticks).toEqual([42])
    expect(clockTick(7)).toEqual({ type: "clock-tick", nowMs: 7 })
    let cleared = false
    const clearing = startClock(() => undefined, {
      now: () => 1,
      setInterval: (() => 9) as unknown as typeof setInterval,
      clearInterval: ((id) => { expect(id).toBe(9); cleared = true }) as typeof clearInterval,
    })
    clearing.stop()
    expect(cleared).toBe(true)
    clock.stop()
  })
  it("parses loop list replies", () => {
    expect(listLines([])).toBe("No loops found.")
    expect(listLines([workflow])).toBe("wf-1 enabled loop")
    expect(listLines([workflow, { ...workflow, id: "wf-2" }])).toBe("wf-1 enabled loop\nwf-2 enabled loop")
  })
  it("formats command replies and idle matches", () => {
    expect(LOOP_HELP).toBe("/loop [create [--session <id>] [--worktree <path>] <prompt>|list|show <id>|pause <id>|resume <id>|stop <id>|now <id>|logs <id>|timeline <id>|doctor [id]|template [name] [--worktree <path>]|export|import <json>]")
    expect(notFoundMessage("wf-9")).toBe("Loop not found: wf-9")
    expect(createdMessage("wf-1")).toBe("Loop created: wf-1")
    expect(triggeredMessage("wf-1")).toBe("Loop triggered: wf-1")
    expect(lifecycleMessage("pause", "wf-1")).toBe("Loop paused: wf-1")
    expect(lifecycleMessage("resume", "wf-1")).toBe("Loop resumed: wf-1")
    expect(lifecycleMessage("stop", "wf-1")).toBe("Loop stopped: wf-1")
    expect(catalogStatusFor("pause")).toBe("paused")
    expect(catalogStatusFor("resume")).toBe("enabled")
    expect(catalogStatusFor("stop")).toBe("stopped")
    expect(showLines(workflow, 3)).toBe("loop (enabled)\nEvents: 3")
    expect(logLines([])).toBe("No events.")
    expect(logLines([{ sequence: 1, action: { type: "pause" } }, { sequence: 2, action: { type: "resume" } }])).toBe("1: pause\n2: resume")
    expect(matchingIdleWorkflows([
      workflow,
      { ...workflow, id: "wf-2", status: "paused" },
      { ...workflow, id: "wf-3", sessionBinding: { sessionId: "other" } },
    ], "ses-1").map((item) => item.id)).toEqual(["wf-1"])
  })
  it("uses real timers when none are injected", () => {
    vi.useFakeTimers()
    const ticks: number[] = []
    const clock = startClock((event) => { ticks.push(event.nowMs) }, { now: () => 99 })
    vi.advanceTimersByTime(1_000)
    expect(ticks).toEqual([99])
    clock.stop()
    vi.useRealTimers()
  })
  it("uses Date.now when no clock is injected", () => {
    startClock((event) => { expect(event.nowMs).toBeTypeOf("number") }, {
      setInterval: ((handler: () => void) => {
        handler()
        return 1 as unknown as ReturnType<typeof setInterval>
      }) as typeof setInterval,
      clearInterval: () => undefined,
    }).stop()
  })
  it("defaults the clock interval to one second", () => {
    startClock(() => undefined, {
      now: () => 1,
      setInterval: ((handler: () => void, interval: number) => {
        expect(interval).toBe(1_000)
        handler()
        return 1 as unknown as ReturnType<typeof setInterval>
      }) as typeof setInterval,
      clearInterval: () => undefined,
    }).stop()
  })
  it("applyLoopUpdate covers every update path", () => {
    expect(applyLoopUpdate(workflow, { name: "renamed", prompt: "new prompt", maxRuns: 3, runtimeMs: 5000, maxFailures: 1, permissions: "ask-never" }, 5)).toEqual({
      ...workflow, name: "renamed",
      node: { id: "node-1", kind: "prompt", prompt: "new prompt" },
      policy: { permissions: "ask-never", maxRuns: 3, maxRuntimeMs: 5000, maxFailures: 1, noOverlap: true, delivery: "queue" },
      revision: 2, createdAt: 1, updatedAt: 5,
    })
    expect(applyLoopUpdate(workflow, { trigger: "interval", everyMs: 30 }, 5).trigger).toEqual({ kind: "interval", everyMs: 30 })
    expect(applyLoopUpdate(workflow, { trigger: "once", atMs: 99 }, 5).trigger).toEqual({ kind: "once", atMs: 99 })
    expect(applyLoopUpdate(workflow, { trigger: "idle" }, 5).trigger).toEqual({ kind: "idle" })
    const onceLoop = applyLoopUpdate(workflow, { trigger: "once", atMs: 7 }, 5)
    expect(applyLoopUpdate(onceLoop, { name: "again" }, 6).trigger).toEqual({ kind: "once", atMs: 7 })
    expect(applyLoopUpdate(onceLoop, { name: "again" }, 6).updatedAt).toBe(6)
    expect(() => applyLoopUpdate({ ...workflow, node: { id: "n", kind: "command", command: "pnpm test", timeoutMs: 1 } }, { prompt: "x" }, 5)).toThrow("prompt requires a prompt node")
    expect(() => applyLoopUpdate(workflow, { trigger: "once" }, 5)).toThrow("once trigger requires --at-ms")
    expect(() => applyLoopUpdate(workflow, { trigger: "interval" }, 5)).toThrow("interval trigger requires --every-ms")
    expect(() => applyLoopUpdate(workflow, { name: " " }, 5)).toThrow()
    expect(() => applyLoopUpdate(workflow, { maxRuns: 0 }, 5)).toThrow()
  })
  it("applyLoopUpdate keeps the once and interval cursors when only renaming", () => {
    const onceLoop = applyLoopUpdate(workflow, { trigger: "once", atMs: 42 }, 5)
    expect(applyLoopUpdate(onceLoop, { name: "keep" }, 6).trigger).toEqual({ kind: "once", atMs: 42 })
    const intervalLoop = applyLoopUpdate(workflow, { trigger: "interval", everyMs: 45 }, 5)
    expect(applyLoopUpdate(intervalLoop, { name: "keep2" }, 6).trigger).toEqual({ kind: "interval", everyMs: 45 })
    const keptOnce = applyLoopUpdate(onceLoop, { trigger: "once" }, 6)
    expect(keptOnce.trigger).toEqual({ kind: "once", atMs: 42 })
    const keptInterval = applyLoopUpdate(intervalLoop, { trigger: "interval" }, 6)
    expect(keptInterval.trigger).toEqual({ kind: "interval", everyMs: 45 })
  })
})
