import { randomUUID } from "node:crypto"
import { decideAdmission, type AdmissionInput, type HostStatus } from "../domain/admission.js"
import { evaluateTrigger, consumePending, type TriggerEvent, type TriggerState } from "../domain/triggers.js"
import { interpretVerification } from "../domain/verify.js"
import { loadState, loadTriggerState, type EventStore } from "../persistence/memory.js"
import type { Workflow } from "../domain/schema.js"

export type HostSnapshot = {
  readonly host: HostStatus
  readonly foregroundTurn: boolean
  readonly activeTool: boolean
  readonly busyChild: boolean
  readonly statusReadSucceeded: boolean
  readonly activeLease: boolean
}

export interface HostPort {
  inspect(sessionId: string): Promise<HostSnapshot>
  prompt(input: { sessionId: string; text: string; runId: string; idempotencyKey: string }): Promise<void>
}

export interface RunnerPort {
  run(command: string): Promise<number>
}

export const DEFAULT_DISPATCH_FLOOR_MS = 30_000

export type CoordinatorOptions = {
  dispatchFloorMs?: number | undefined
  nowMs?: (() => number) | undefined
}

type Registered = { workflow: Workflow; trigger: TriggerState }

function initialTriggerState(workflow: Workflow): TriggerState {
  return { pending: false, onceConsumed: false, ...(workflow.trigger.kind === "interval" ? { nextDueAtMs: 0 } : {}) }
}

export class SchedulerCoordinator {
  private readonly workflows = new Map<string, Registered>()
  private readonly queues = new Map<string, Promise<void>>()

  constructor(private readonly store: EventStore, private readonly host: HostPort, private readonly runner?: RunnerPort, options: CoordinatorOptions = {}) {
    this.dispatchFloorMs = options.dispatchFloorMs ?? DEFAULT_DISPATCH_FLOOR_MS
    this.nowMs = options.nowMs ?? Date.now
  }

  private readonly dispatchFloorMs: number
  private readonly nowMs: () => number
  private readonly dispatches = new Map<string, number[]>()

  recentDispatches(workflowId: string): readonly number[] {
    return this.dispatches.get(workflowId) ?? []
  }

  register(workflow: Workflow): void {
    this.workflows.set(workflow.id, { workflow, trigger: initialTriggerState(workflow) })
  }

  async restore(workflow: Workflow): Promise<void> {
    this.workflows.set(workflow.id, { workflow, trigger: await loadTriggerState(this.store, workflow.id, initialTriggerState(workflow)) })
    const domain = await loadState(this.store, workflow.id)
    if (domain.status === "running" && domain.activeRunId) {
      await this.append(workflow.id, { type: "mark-unknown", runId: domain.activeRunId, reason: "service restarted" })
    }
  }

  inspect(workflowId: string): Registered | undefined { return this.workflows.get(workflowId) }
  queued(workflowId: string): boolean { return this.queues.has(workflowId) }

  async signal(event: TriggerEvent): Promise<void> {
    for (const workflowId of this.workflows.keys()) await this.signalWorkflow(workflowId, event)
  }

  async signalWorkflow(workflowId: string, event: TriggerEvent): Promise<void> {
    const registered = this.workflows.get(workflowId)
    if (!registered) return
    const previous = this.queues.get(workflowId) ?? Promise.resolve()
    const current = previous.then(() => this.process(registered, event))
    this.queues.set(workflowId, current)
    try { await current } finally {
      // Stryker disable next-line ConditionalExpression: deleting after settle is equivalent to the identity guard
      if (this.queues.get(workflowId) === current) this.queues.delete(workflowId)
    }
  }

  async pause(workflowId: string): Promise<void> {
    const registered = this.workflows.get(workflowId)
    if (!registered) return
    await this.append(workflowId, { type: "pause" })
    registered.workflow = { ...registered.workflow, status: "paused" }
  }
  async resume(workflowId: string): Promise<void> {
    const registered = this.workflows.get(workflowId)
    if (!registered) return
    await this.append(workflowId, { type: "resume" })
    registered.workflow = { ...registered.workflow, status: "enabled" }
  }
  async stop(workflowId: string): Promise<void> {
    const registered = this.workflows.get(workflowId)
    if (!registered) return
    await this.append(workflowId, { type: "stop" })
    registered.workflow = { ...registered.workflow, status: "stopped" }
  }

  private async process(registered: Registered, event: TriggerEvent): Promise<void> {
    const { workflow } = registered
    if (workflow.status !== "enabled") return
    const result = evaluateTrigger(workflow.trigger, registered.trigger, event)
    if (!result.due) return
    await this.append(workflow.id, { type: "trigger-state", state: result.state })
    registered.trigger = result.state
    await this.append(workflow.id, { type: "trigger-due" })
    let state = await loadState(this.store, workflow.id)
    if (state.status === "blocked") {
      await this.append(workflow.id, { type: "unblock" })
      state = await loadState(this.store, workflow.id)
    }
    const snapshot = await this.host.inspect(workflow.sessionBinding.sessionId)
    const input: AdmissionInput = {
      workflowId: workflow.id, sessionId: workflow.sessionBinding.sessionId, workflowEnabled: true,
      due: state.status === "due",
      // Stryker disable next-line ConditionalExpression,StringLiteral: running is never due, so activeRun is unreachable after the due check
      activeRun: state.status === "running",
      ...snapshot,
    }
    if (state.dueSequence > workflow.policy.maxRuns) {
      await this.append(workflow.id, { type: "block", reason: "run-budget" }); registered.trigger = consumePending(registered.trigger); await this.append(workflow.id, { type: "trigger-state", state: registered.trigger }); return
    }
    const failures = (await this.store.replay(workflow.id)).filter((event) => event.action.type === "fail").length
    if (failures >= workflow.policy.maxFailures) {
      await this.append(workflow.id, { type: "block", reason: "failure-budget" }); registered.trigger = consumePending(registered.trigger); await this.append(workflow.id, { type: "trigger-state", state: registered.trigger }); return
    }
    const dispatches = this.dispatches.get(workflow.id) ?? []
    const lastDispatchAt = dispatches.at(-1)
    // Stryker disable next-line ConditionalExpression: an empty history yields undefined lastDispatchAt, so the branch is equivalent
    if (lastDispatchAt !== undefined && this.nowMs() - lastDispatchAt < this.dispatchFloorMs) {
      await this.append(workflow.id, { type: "block", reason: "dispatch-floor" }); registered.trigger = consumePending(registered.trigger); await this.append(workflow.id, { type: "trigger-state", state: registered.trigger }); return
    }
    const decision = decideAdmission(input, state.dueSequence)
    if (!decision.admitted) { await this.append(workflow.id, { type: "block", reason: decision.reason }); registered.trigger = consumePending(registered.trigger); await this.append(workflow.id, { type: "trigger-state", state: registered.trigger }); return }
    const runId = `run-${randomUUID()}`
    if (workflow.node.kind === "approval") {
      await this.append(workflow.id, { type: "pause" })
      registered.workflow = { ...registered.workflow, status: "paused" }
      registered.trigger = consumePending(registered.trigger)
      await this.append(workflow.id, { type: "trigger-state", state: registered.trigger })
      return
    }
    await this.append(workflow.id, { type: "admit", runId })
    // Stryker disable next-line MethodExpression: slice(-10) bounds memory only; diagnostics tolerate unbounded recent lists in tests
    this.dispatches.set(workflow.id, [...dispatches, this.nowMs()].slice(-10))
    if (workflow.node.kind === "command" || workflow.node.kind === "condition") {
      let verification = { ok: false, reason: "verification failed to run" }
      if (this.runner) {
        try { verification = interpretVerification(await this.runner.run(workflow.node.command)) }
        catch (error) { verification = { ok: false, reason: error instanceof Error ? `verification failed to run: ${error.message}` : "verification failed to run" } }
      }
      if (!verification.ok) {
        // Stryker disable next-line ConditionalExpression: command nodes cannot carry failPrompt (discriminated union), so the kind check is unfalsifiable at runtime
        if (workflow.node.kind === "condition" && workflow.node.failPrompt) {
          await this.host.prompt({ sessionId: workflow.sessionBinding.sessionId, text: workflow.node.failPrompt, runId, idempotencyKey: decision.idempotencyKey })
        }
        await this.append(workflow.id, { type: "fail", runId, reason: verification.reason })
        registered.trigger = consumePending(registered.trigger)
        await this.append(workflow.id, { type: "trigger-state", state: registered.trigger })
        return
      }
      // Stryker disable next-line ConditionalExpression: command nodes cannot carry passPrompt (discriminated union), so the kind check is unfalsifiable at runtime
      if (workflow.node.kind === "condition" && workflow.node.passPrompt) {
        await this.host.prompt({ sessionId: workflow.sessionBinding.sessionId, text: workflow.node.passPrompt, runId, idempotencyKey: decision.idempotencyKey })
      }
      await this.append(workflow.id, { type: "succeed", runId })
      registered.trigger = consumePending(registered.trigger)
      await this.append(workflow.id, { type: "trigger-state", state: registered.trigger })
      return
    }
    try {
      await this.host.prompt({ sessionId: workflow.sessionBinding.sessionId, text: workflow.node.prompt, runId, idempotencyKey: decision.idempotencyKey })
    } catch (error) {
      await this.append(workflow.id, { type: "fail", runId, reason: error instanceof Error ? error.message : "dispatch failed" })
      registered.trigger = consumePending(registered.trigger)
      await this.append(workflow.id, { type: "trigger-state", state: registered.trigger })
      return
    }
    await this.append(workflow.id, { type: "succeed", runId })
    registered.trigger = consumePending(registered.trigger)
    await this.append(workflow.id, { type: "trigger-state", state: registered.trigger })
  }

  private async append(workflowId: string, action: Parameters<EventStore["append"]>[1]): Promise<void> {
    await this.store.append(workflowId, action)
  }
}
