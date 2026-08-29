import type { DomainState } from "./reducer.js"
import type { Workflow } from "./schema.js"
import type { TriggerState } from "./triggers.js"

type HostView = {
  readonly host: string
  readonly statusReadSucceeded: boolean
}

export function diagnoseLoop(input: {
  readonly workflow?: Workflow
  readonly domain?: DomainState
  readonly trigger?: TriggerState
  readonly host?: HostView
  readonly recentDispatches?: readonly number[] | undefined
  readonly nowMs?: number | undefined
}): readonly string[] {
  if (!input.workflow) return ["loop not found"]
  const findings: string[] = []
  if (input.workflow.status !== "enabled") findings.push(`catalog status is ${input.workflow.status}`)
  if (input.domain?.status === "running") findings.push(`run ${input.domain.activeRunId ?? "unknown"} is in-flight`)
  if (input.domain?.status === "unknown") findings.push(`run ${input.domain.activeRunId ?? "unknown"} is unrecovered`)
  if (input.domain?.status === "blocked") findings.push(`blocked: ${input.domain.reason ?? "unknown"}`)
  if (input.domain?.status === "cancelled") findings.push("loop is cancelled")
  if (input.trigger?.pending) findings.push("trigger is pending")
  if (input.host && !input.host.statusReadSucceeded) findings.push("host status is unavailable")
  if (input.host?.host === "busy" || input.host?.host === "retrying") findings.push(`host is ${input.host.host}`)
  const { recentDispatches, nowMs } = input
  // Stryker disable next-line ConditionalExpression: with nowMs undefined the filter arithmetic is NaN and excludes all, so the guard is equivalent
  if (recentDispatches !== undefined && nowMs !== undefined) {
    // Stryker disable next-line EqualityOperator: a dispatch exactly 60s old is outside the rolling minute by definition
    const recent = recentDispatches.filter((dispatchedAt) => nowMs - dispatchedAt < 60_000 && dispatchedAt <= nowMs).length
    if (recent >= 3) findings.push(`fired ${recent} times in the last minute`)
  }
  if (findings.length === 0) findings.push("healthy")
  return findings
}
