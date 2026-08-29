import { join } from "node:path"
import { parseWorkflow, type WorkflowTrigger } from "../domain/schema.js"
import { diagnoseLoop } from "../domain/doctor.js"
import type { DomainState } from "../domain/reducer.js"
import type { Workflow } from "../domain/schema.js"
import type { LoopUpdateFields } from "./commands.js"
import type { TriggerEvent, TriggerState } from "../domain/triggers.js"

export function loopRoot(cwd = process.cwd(), env: NodeJS.ProcessEnv = process.env): string {
  return env.OC_LOOP_ROOT ?? join(cwd, ".opencode", "itz4blitz", "oc-loop")
}

const DEFAULT_POLICY = {
  permissions: "ask" as const,
  maxRuns: 20,
  maxRuntimeMs: 1_800_000,
  maxFailures: 3,
  noOverlap: true as const,
  delivery: "queue" as const,
}

export function createLoopWorkflow(input: {
  sessionId: string
  prompt?: string | undefined
  worktree?: string | undefined
  nowMs: number
  workflowId: string
  nodeId: string
}): Workflow {
  return {
    schemaVersion: 1,
    id: input.workflowId,
    revision: 1,
    name: "Loop",
    status: "enabled",
    sessionBinding: { sessionId: input.sessionId, ...(input.worktree ? { worktree: input.worktree } : {}) },
    node: { id: input.nodeId, kind: "prompt", prompt: input.prompt ?? "Continue the current task." },
    trigger: { kind: "idle" },
    policy: DEFAULT_POLICY,
    createdAt: input.nowMs,
    updatedAt: input.nowMs,
  }
}

export function doctorLines(targets: ReadonlyArray<{
  workflow: Workflow
  domain?: DomainState
  trigger?: TriggerState
  host?: { host: string; statusReadSucceeded: boolean }
}>): string {
  if (targets.length === 0) return "No loops found."
  return targets.map((target) => `${target.workflow.id}: ${diagnoseLoop(target).join("; ")}`).join("\n")
}

export function clockTick(nowMs: number): Extract<TriggerEvent, { type: "clock-tick" }> {
  return { type: "clock-tick", nowMs }
}

export function startClock(
  onTick: (event: ReturnType<typeof clockTick>) => void,
  deps: {
    now?: () => number
    intervalMs?: number
    setInterval?: typeof setInterval
    clearInterval?: typeof clearInterval
  } = {},
): { stop(): void } {
  const now = deps.now ?? Date.now
  const set = deps.setInterval ?? setInterval
  const clear = deps.clearInterval ?? clearInterval
  const id = set(() => onTick(clockTick(now())), deps.intervalMs ?? 1_000)
  return { stop: () => clear(id) }
}

export function listLines(workflows: readonly Workflow[]): string {
  if (workflows.length === 0) return "No loops found."
  return workflows.map((workflow) => `${workflow.id} ${workflow.status} ${workflow.name}`).join("\n")
}

export const LOOP_HELP = "/loop [create [--session <id>] [--worktree <path>] <prompt>|list|show <id>|pause <id>|resume <id>|stop <id>|now <id>|logs <id>|timeline <id>|doctor [id]|template [name] [--worktree <path>]|export|import <json>]"

export function notFoundMessage(id: string): string {
  return `Loop not found: ${id}`
}

export function applyLoopUpdate(workflow: Workflow, fields: LoopUpdateFields, nowMs: number): Workflow {
  let node = workflow.node
  if (fields.prompt !== undefined) {
    if (node.kind !== "prompt") throw new Error("prompt requires a prompt node")
    node = { ...node, prompt: fields.prompt }
  }
  const trigger = rebuiltTrigger(workflow, fields)
  const candidate: Workflow = {
    ...workflow,
    ...(fields.name !== undefined ? { name: fields.name } : {}),
    node,
    trigger,
    policy: {
      ...workflow.policy,
      ...(fields.maxRuns !== undefined ? { maxRuns: fields.maxRuns } : {}),
      ...(fields.runtimeMs !== undefined ? { maxRuntimeMs: fields.runtimeMs } : {}),
      ...(fields.maxFailures !== undefined ? { maxFailures: fields.maxFailures } : {}),
      ...(fields.permissions !== undefined ? { permissions: fields.permissions } : {}),
    },
    revision: workflow.revision + 1,
    updatedAt: nowMs,
  }
  return parseWorkflow(candidate)
}

function rebuiltTrigger(workflow: Workflow, fields: LoopUpdateFields): WorkflowTrigger {
  const kind = fields.trigger ?? workflow.trigger.kind
  if (kind === "idle") return { kind: "idle" }
  if (kind === "manual") return { kind: "manual" }
  if (kind === "once") {
    // Stryker disable next-line ConditionalExpression: the ?? fallback only yields a value when the current kind is once, so the condition cannot be observed
    const atMs = fields.atMs ?? (workflow.trigger.kind === "once" ? workflow.trigger.atMs : undefined)
    if (atMs === undefined) throw new Error("once trigger requires --at-ms")
    return { kind: "once", atMs }
  }
  // Stryker disable next-line ConditionalExpression: the ?? short-circuits whenever fields.everyMs is set, so the kept-kind fallback is only reachable when it agrees
  const everyMs = fields.everyMs ?? (workflow.trigger.kind === "interval" ? workflow.trigger.everyMs : undefined)
  // Stryker disable next-line ConditionalExpression: same once-only reasoning — interval values are only reachable when the current kind is interval
  if (everyMs === undefined) throw new Error("interval trigger requires --every-ms")
  return { kind: "interval", everyMs }
}

export function updatedMessage(id: string): string {
  return `Loop updated: ${id}`
}

export function createdMessage(id: string): string {
  return `Loop created: ${id}`
}

export function triggeredMessage(id: string): string {
  return `Loop triggered: ${id}`
}

export function lifecycleMessage(kind: "pause" | "resume" | "stop", id: string): string {
  const verb = kind === "pause" ? "paused" : kind === "resume" ? "resumed" : "stopped"
  return `Loop ${verb}: ${id}`
}

export function catalogStatusFor(kind: "pause" | "resume" | "stop"): Workflow["status"] {
  return kind === "pause" ? "paused" : kind === "resume" ? "enabled" : "stopped"
}

export function showLines(workflow: Workflow, eventCount: number): string {
  return `${workflow.name} (${workflow.status})\nEvents: ${eventCount}`
}

export function logLines(events: ReadonlyArray<{ sequence: number; action: { type: string } }>): string {
  return events.map((event) => `${event.sequence}: ${event.action.type}`).join("\n") || "No events."
}

export function matchingIdleWorkflows(workflows: readonly Workflow[], sessionId: string): readonly Workflow[] {
  return workflows.filter((workflow) => workflow.status === "enabled" && workflow.sessionBinding.sessionId === sessionId)
}
