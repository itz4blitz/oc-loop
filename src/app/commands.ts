import { parseLoopArgs } from "../domain/commands.js"
import type { DomainAction } from "../domain/reducer.js"
import type { TriggerEvent } from "../domain/triggers.js"
import { loadState, type EventStore } from "../persistence/memory.js"
import type { Workflow } from "../domain/schema.js"
import type { TriggerState } from "../domain/triggers.js"
import { buildTemplate, templateNames } from "./templates.js"
import { exportLoops, importLoops } from "./transfer.js"
import { timelineLines } from "./timeline.js"
import {
  LOOP_HELP,
  catalogStatusFor,
  createdMessage,
  createLoopWorkflow,
  applyLoopUpdate,
  doctorLines,
  lifecycleMessage,
  listLines,
  logLines,
  notFoundMessage,
  showLines,
  triggeredMessage,
  updatedMessage,
} from "./loop.js"

export type LoopIntent =
  | { kind: "create"; prompt?: string; sessionId?: string; worktree?: string }
  | { kind: "list" }
  | { kind: "show" | "pause" | "resume" | "stop" | "now" | "logs"; loopId: string }
  | { kind: "doctor"; loopId?: string }
  | { kind: "export" }
  | { kind: "import"; transfer: string }
  | { kind: "template"; name?: string; worktree?: string }
  | { kind: "timeline"; loopId: string }
  | { kind: "set"; loopId: string; fields: LoopUpdateFields }
  | { kind: "help" }

export type LoopUpdateFields = {  readonly name?: string | undefined
  readonly prompt?: string | undefined
  readonly trigger?: "idle" | "manual" | "interval" | "once" | undefined
  readonly everyMs?: number | undefined
  readonly atMs?: number | undefined
  readonly maxRuns?: number | undefined
  readonly runtimeMs?: number | undefined
  readonly maxFailures?: number | undefined
  readonly permissions?: "ask" | "ask-never" | undefined
}

export type LoopCommandPorts = {
  catalog: {
    list(): Promise<readonly Workflow[]>
    get(id: string): Promise<Workflow | undefined>
    save(workflow: Workflow, expectedRevision?: number): Promise<void>
  }
  coordinator: {
    register(workflow: Workflow): void
    inspect(id: string): { trigger?: TriggerState } | undefined
    pause(id: string): Promise<void>
    resume(id: string): Promise<void>
    stop(id: string): Promise<void>
    signalWorkflow(id: string, event: TriggerEvent): Promise<void>
    recentDispatches(id: string): readonly number[]
  }
  store: EventStore
  host: { inspect(sessionId: string): Promise<{ host: string; statusReadSucceeded: boolean }> }
  nowMs: () => number
  ids: () => { workflowId: string; nodeId: string }
}

export async function executeLoopCommand(text: string, sessionId: string, ports: LoopCommandPorts): Promise<string> {
  const parsed = parseLoopArgs(text.trim() ? text.trim().split(/\s+/u) : [])
  if (!parsed.ok) return parsed.message
  return executeLoopIntent(parsed.intent, sessionId, ports)
}

export function nowEvent(trigger: Workflow["trigger"], nowMs: number): TriggerEvent {
  if (trigger.kind === "idle") return { type: "idle-boundary" }
  if (trigger.kind === "manual") return { type: "manual" }
  return { type: "clock-tick", nowMs }
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export async function executeLoopIntent(intent: LoopIntent, sessionId: string, ports: LoopCommandPorts): Promise<string> {
  if (intent.kind === "create") {
    const workflow = createLoopWorkflow({
      sessionId: intent.sessionId ?? sessionId,
      ...(intent.prompt ? { prompt: intent.prompt } : {}),
      ...(intent.worktree ? { worktree: intent.worktree } : {}),
      nowMs: ports.nowMs(),
      ...ports.ids(),
    })
    await ports.catalog.save(workflow)
    ports.coordinator.register(workflow)
    return createdMessage(workflow.id)
  }
  if (intent.kind === "list") return listLines(await ports.catalog.list())
  if (intent.kind === "export") return exportLoops(ports.catalog, ports.nowMs)
  if (intent.kind === "template") {
    if (!intent.name) return `Templates: ${templateNames().join(", ")}.`
    let workflow: Workflow
    try {
      workflow = buildTemplate(intent.name, {
        sessionId,
        ...(intent.worktree ? { worktree: intent.worktree } : {}),
        nowMs: ports.nowMs(),
        ...ports.ids(),
      })
    } catch (error) {
      return errorMessage(error)
    }
    await ports.catalog.save(workflow)
    ports.coordinator.register(workflow)
    return `Loop created: ${workflow.id} from template ${intent.name}.`
  }
  if (intent.kind === "import") {
    try {
      const result = await importLoops(ports.catalog, intent.transfer)
      return `Imported ${result.imported} loop(s), skipped ${result.skipped}.`
    } catch (error) {
      return errorMessage(error)
    }
  }
  if (intent.kind === "help") return LOOP_HELP
  if (intent.kind === "doctor") {
    let targets: readonly Workflow[]
    if (intent.loopId) {
      const found = await ports.catalog.get(intent.loopId)
      if (!found) return notFoundMessage(intent.loopId)
      targets = [found]
    } else targets = await ports.catalog.list()
    const rows = []
    for (const workflow of targets) {
      const trigger = ports.coordinator.inspect(workflow.id)?.trigger
      rows.push({
        workflow,
        domain: await loadState(ports.store, workflow.id),
        ...(trigger ? { trigger } : {}),
        host: await ports.host.inspect(workflow.sessionBinding.sessionId),
        recentDispatches: ports.coordinator.recentDispatches(workflow.id),
        nowMs: ports.nowMs(),
      })
    }
    return doctorLines(rows)
  }
  const loopId = intent.loopId
  const workflow = await ports.catalog.get(loopId)
  if (!workflow) return notFoundMessage(intent.loopId)
  if (intent.kind === "set") {
    let updated: Workflow
    try {
      updated = applyLoopUpdate(workflow, intent.fields, ports.nowMs())
    } catch (error) {
      return errorMessage(error)
    }
    try {
      await ports.catalog.save(updated, workflow.revision)
    } catch (error) {
      return errorMessage(error)
    }
    // A new trigger starts a fresh cursor; otherwise the live cursor is preserved.
    if (intent.fields.trigger !== undefined) ports.coordinator.register(updated)
    return updatedMessage(intent.loopId)
  }
  if (intent.kind === "pause" || intent.kind === "resume" || intent.kind === "stop") {
    if (intent.kind === "pause") await ports.coordinator.pause(intent.loopId)
    if (intent.kind === "resume") await ports.coordinator.resume(intent.loopId)
    if (intent.kind === "stop") await ports.coordinator.stop(intent.loopId)
    await ports.catalog.save({ ...workflow, revision: workflow.revision + 1, status: catalogStatusFor(intent.kind), updatedAt: ports.nowMs() }, workflow.revision)
    return lifecycleMessage(intent.kind, intent.loopId)
  }
  if (intent.kind === "now") {
    await ports.coordinator.signalWorkflow(intent.loopId, nowEvent(workflow.trigger, ports.nowMs()))
    return triggeredMessage(intent.loopId)
  }
  if (intent.kind === "show") return showLines(workflow, (await ports.store.replay(intent.loopId)).length)
  if (intent.kind === "timeline") return timelineLines(await ports.store.replay(intent.loopId)).join("\n")
  return logLines(await ports.store.replay(intent.loopId))
}
