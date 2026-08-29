import { describe, expect, it } from "vitest"
import { domainActionSchema, parseWorkflow, policySchema, triggerSchema, workflowSchema } from "../../src/domain/schema.js"

const policy = { permissions: "ask" as const, maxRuns: 20, maxRuntimeMs: 60_000, maxFailures: 3, noOverlap: true as const, delivery: "queue" as const }
const base = {
  schemaVersion: 1 as const, id: "wf-1", revision: 1, name: "Test and fix", status: "enabled" as const,
  sessionBinding: { sessionId: "ses-1" }, node: { id: "node-1", kind: "prompt" as const, prompt: "Run tests" },
  trigger: { kind: "idle" as const }, policy, createdAt: 100, updatedAt: 100,
}

describe("workflow schemas", () => {
  it("parses a strict valid workflow", () => expect(parseWorkflow(base)).toEqual(base))
  it("parses command verification nodes", () => {
    const command = { id: "node-2", kind: "command" as const, command: "pnpm test", timeoutMs: 60_000 }
    expect(parseWorkflow({ ...base, node: command })).toEqual({ ...base, node: command })
    expect(workflowSchema.safeParse({ ...base, node: { id: "node-2", kind: "command", command: " " } }).success).toBe(false)
    expect(workflowSchema.safeParse({ ...base, node: { id: "node-2", kind: "command", command: "pnpm test", timeoutMs: -1 } }).success).toBe(false)
    expect(workflowSchema.safeParse({ ...base, node: { id: "node-2", kind: "command" } }).success).toBe(false)
  })
  it("defaults command timeout and trims the command", () => {
    const parsed = parseWorkflow({ ...base, node: { id: "  node-2  ", kind: "command", command: "  pnpm test  " } })
    expect(parsed.node).toEqual({ id: "node-2", kind: "command", command: "pnpm test", timeoutMs: 600_000 })
  })
  it("parses every supported trigger", () => {
    for (const trigger of [{ kind: "idle" }, { kind: "manual" }, { kind: "once", atMs: 1 }, { kind: "interval", everyMs: 1 }]) {
      expect(triggerSchema.parse(trigger)).toEqual(trigger)
    }
  })
  it("parses persisted trigger state actions", () => {
    expect(domainActionSchema.parse({ type: "trigger-state", state: { pending: true, onceConsumed: false, nextDueAtMs: 10 } })).toEqual({ type: "trigger-state", state: { pending: true, onceConsumed: false, nextDueAtMs: 10 } })
  })
  it("parses every domain action branch", () => {
    const actions = [{ type: "trigger-due" }, { type: "admit", runId: "run-1" }, { type: "block", reason: "busy" }, { type: "unblock" }, { type: "pause" }, { type: "resume" }, { type: "succeed", runId: "run-1" }, { type: "fail", runId: "run-1", reason: "failed" }, { type: "stop" }, { type: "stop", runId: "run-1" }, { type: "mark-unknown", runId: "run-1", reason: "service restarted" }]
    for (const action of actions) expect(domainActionSchema.parse(action)).toEqual(action)
    expect(domainActionSchema.safeParse({ type: "admit" }).success).toBe(false)
    expect(domainActionSchema.safeParse({ type: "fail", runId: "run-1" }).success).toBe(false)
  })
  it("trims identifiers, reasons, and prompts", () => {
    expect(domainActionSchema.parse({ type: "admit", runId: "  run-1  " })).toEqual({ type: "admit", runId: "run-1" })
    expect(domainActionSchema.parse({ type: "block", reason: "  busy  " })).toEqual({ type: "block", reason: "busy" })
    expect(parseWorkflow({ ...base, id: "  wf-1  ", node: { ...base.node, prompt: "  Run tests  " } })).toEqual({
      ...base, id: "wf-1", node: { ...base.node, prompt: "Run tests" },
    })
  })
  it("rejects unknown fields and unsupported versions", () => {
    expect(workflowSchema.safeParse({ ...base, extra: true }).success).toBe(false)
    expect(workflowSchema.safeParse({ ...base, schemaVersion: 2 }).success).toBe(false)
  })
  it("rejects malformed values and invalid time order", () => {
    expect(workflowSchema.safeParse({ ...base, name: " " }).success).toBe(false)
    expect(workflowSchema.safeParse({ ...base, trigger: { kind: "interval", everyMs: 0 } }).success).toBe(false)
    const order = workflowSchema.safeParse({ ...base, updatedAt: 99 })
    expect(order.success).toBe(false)
    if (!order.success) {
      expect(order.error.issues).toEqual(expect.arrayContaining([expect.objectContaining({
        message: "updatedAt must not precede createdAt",
        path: ["updatedAt"],
      })]))
    }
    expect(workflowSchema.safeParse({ ...base, policy: { ...policy, noOverlap: false } }).success).toBe(false)
  })
  it("parses approval nodes", () => {
    const approval = { id: "node-3", kind: "approval" as const }
    expect(parseWorkflow({ ...base, node: approval })).toEqual({ ...base, node: approval })
    expect(workflowSchema.safeParse({ ...base, node: { id: "node-3", kind: "approval", extra: true } }).success).toBe(false)
  })
  it("parses condition nodes", () => {
    const condition = { id: "node-4", kind: "condition" as const, command: "pnpm test", passPrompt: "ship it", failPrompt: "fix it", timeoutMs: 30_000 }
    expect(parseWorkflow({ ...base, node: condition })).toEqual({ ...base, node: condition })
    expect(parseWorkflow({ ...base, node: { id: "node-4", kind: "condition", command: "pnpm test" } }).node).toEqual({
      id: "node-4", kind: "condition", command: "pnpm test", timeoutMs: 600_000,
    })
    expect(parseWorkflow({ ...base, node: { id: " node-4 ", kind: "condition", command: "  pnpm test  ", passPrompt: "  ship it  ", failPrompt: "  fix it  " } }).node).toEqual({
      id: "node-4", kind: "condition", command: "pnpm test", passPrompt: "ship it", failPrompt: "fix it", timeoutMs: 600_000,
    })
    expect(workflowSchema.safeParse({ ...base, node: { id: "node-4", kind: "condition" } }).success).toBe(false)
    expect(workflowSchema.safeParse({ ...base, node: { id: "node-4", kind: "condition", command: "pnpm test", passPrompt: "" } }).success).toBe(false)
    expect(workflowSchema.safeParse({ ...base, node: { id: "node-4", kind: "condition", command: "pnpm test", failPrompt: "" } }).success).toBe(false)
  })
  it("parses optional worktree bindings", () => {
    expect(parseWorkflow({ ...base, sessionBinding: { sessionId: "ses-1", worktree: "/tmp/wt" } }).sessionBinding).toEqual({
      sessionId: "ses-1", worktree: "/tmp/wt",
    })
    expect(parseWorkflow({ ...base, sessionBinding: { sessionId: "ses-1", worktree: "  /tmp/wt  " } }).sessionBinding.worktree).toBe("/tmp/wt")
    expect(workflowSchema.safeParse({ ...base, sessionBinding: { sessionId: "ses-1", worktree: "" } }).success).toBe(false)
  })
  it("rejects unsupported node kinds and policy values", () => {    expect(workflowSchema.safeParse({ ...base, node: { ...base.node, kind: "command" } }).success).toBe(false)
    expect(policySchema.parse({ ...policy, permissions: "ask-never" })).toEqual({ ...policy, permissions: "ask-never" })
    expect(parseWorkflow({ ...base, status: "paused" }).status).toBe("paused")
    expect(parseWorkflow({ ...base, status: "stopped" }).status).toBe("stopped")
    expect(policySchema.safeParse({ ...policy, permissions: "unsafe" }).success).toBe(false)
    expect(triggerSchema.safeParse({ kind: "once" }).success).toBe(false)
    expect(triggerSchema.safeParse({ kind: "interval" }).success).toBe(false)
    expect(triggerSchema.safeParse({ kind: "idle", extra: true }).success).toBe(false)
    expect(triggerSchema.safeParse({ kind: "manual", extra: true }).success).toBe(false)
  })
})
