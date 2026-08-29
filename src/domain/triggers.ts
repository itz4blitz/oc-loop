export type Trigger =
  | { kind: "idle" }
  | { kind: "manual" }
  | { kind: "once"; atMs: number }
  | { kind: "interval"; everyMs: number }

export type TriggerState = {
  readonly pending: boolean
  readonly nextDueAtMs?: number | undefined
  readonly onceConsumed: boolean
}

export type TriggerEvent =
  | { type: "idle-boundary" }
  | { type: "manual" }
  | { type: "clock-tick"; nowMs: number }

export type TriggerResult = {
  readonly state: TriggerState
  readonly due: boolean
  readonly reason?: Trigger["kind"]
}

export function evaluateTrigger(trigger: Trigger, state: TriggerState, event: TriggerEvent): TriggerResult {
  if (state.pending) return { state, due: false }
  if (trigger.kind === "idle") {
    if (event.type !== "idle-boundary") return { state, due: false }
    return { state: { ...state, pending: true }, due: true, reason: trigger.kind }
  }
  if (trigger.kind === "manual") {
    if (event.type !== "manual") return { state, due: false }
    return { state: { ...state, pending: true }, due: true, reason: trigger.kind }
  }
  if (event.type !== "clock-tick") return { state, due: false }
  if (trigger.kind === "once") {
    if (state.onceConsumed || event.nowMs < trigger.atMs) return { state, due: false }
    return { state: { ...state, pending: true, onceConsumed: true }, due: true, reason: trigger.kind }
  }
  if (state.nextDueAtMs === undefined) {
    return {
      state: { ...state, pending: true, nextDueAtMs: event.nowMs + trigger.everyMs },
      due: true, reason: trigger.kind,
    }
  }
  if (event.nowMs < state.nextDueAtMs) return { state, due: false }
  const periods = Math.floor((event.nowMs - state.nextDueAtMs) / trigger.everyMs) + 1
  return {
    state: { ...state, pending: true, nextDueAtMs: state.nextDueAtMs + periods * trigger.everyMs },
    due: true, reason: trigger.kind,
  }
}

export function consumePending(state: TriggerState): TriggerState {
  return { ...state, pending: false }
}
