export type WorkflowStatus =
  | "waiting"
  | "due"
  | "blocked"
  | "running"
  | "unknown"
  | "paused"
  | "cancelled"

export type DomainState = {
  readonly status: WorkflowStatus
  readonly dueSequence: number
  readonly pendingDue?: boolean
  readonly activeRunId?: string
  readonly reason?: string
}
export type TriggerCursor = { readonly pending: boolean; readonly onceConsumed: boolean; readonly nextDueAtMs?: number | undefined }

export type DomainAction =
  | { type: "trigger-due" }
  | { type: "admit"; runId: string }
  | { type: "block"; reason: string }
  | { type: "unblock" }
  | { type: "pause" }
  | { type: "resume" }
  | { type: "succeed"; runId: string }
  | { type: "fail"; runId: string; reason: string }
  | { type: "stop"; runId?: string | undefined }
  | { type: "trigger-state"; state: TriggerCursor }
  | { type: "mark-unknown"; runId: string; reason: string }

export const initialState: DomainState = {
  status: "waiting",
  dueSequence: 0,
}

export function reduce(state: DomainState, action: DomainAction): DomainState {
  if (action.type === "trigger-state") return state
  switch (action.type) {
    case "trigger-due":
      return state.status === "waiting"
        ? { status: "due", dueSequence: state.dueSequence + 1, pendingDue: true }
        : state
    case "admit":
      return state.status === "due" && action.runId.trim().length > 0
        ? { ...state, status: "running", activeRunId: action.runId, pendingDue: false }
        : state
    case "block":
      return state.status === "due" && action.reason.trim().length > 0
        ? { ...state, status: "blocked", reason: action.reason }
        : state
    case "unblock":
      return state.status === "blocked" ? { ...state, status: "due" } : state
    case "pause":
      return state.status === "waiting" || state.status === "due" || state.status === "blocked"
        ? { ...state, status: "paused" }
        : state
    case "resume":
      return state.status === "paused"
        ? { ...state, status: state.activeRunId ? "running" : state.pendingDue ? "due" : "waiting" }
        : state
    case "succeed":
      return (state.status === "running" || state.status === "unknown") && action.runId === state.activeRunId
        ? { status: "waiting", dueSequence: state.dueSequence, pendingDue: false }
        : state
    case "fail":
      return (state.status === "running" || state.status === "unknown") && action.runId === state.activeRunId && action.reason.trim().length > 0
        ? { status: "waiting", dueSequence: state.dueSequence, pendingDue: false, reason: action.reason }
        : state
    case "mark-unknown":
      return state.status === "running" && action.runId === state.activeRunId && action.reason.trim().length > 0
        ? { ...state, status: "unknown", reason: action.reason }
        : state
    case "stop":
      return (state.status !== "cancelled" && (state.status !== "running" || action.runId === state.activeRunId))
        ? { status: "cancelled", dueSequence: state.dueSequence }
        : state
  }
}
