export type ObservedStatus = "idle" | "busy" | "retrying" | "unknown"

export type ObserveState = {
  readonly status: Readonly<Record<string, ObservedStatus>>
  readonly tools: Readonly<Record<string, readonly string[]>>
  readonly parent: Readonly<Record<string, string>>
}

export const emptyObserveState: ObserveState = { status: {}, tools: {}, parent: {} }

type EventValue = {
  type?: unknown
  data?: { sessionID?: unknown; status?: { type?: unknown }; id?: unknown; parentID?: unknown }
}

export function applySessionEvent(state: ObserveState, event: unknown): ObserveState {
  if (typeof event !== "object" || event === null || !("type" in event) || !("data" in event)) return state
  const value = event as EventValue
  const data = value.data
  if (typeof data?.sessionID !== "string") return state
  const sessionId = data.sessionID
  if (value.type === "session.status") {
    const status = data.status?.type
    const mapped: ObservedStatus = status === "idle" ? "idle" : status === "busy" ? "busy" : status === "retry" ? "retrying" : "unknown"
    return { ...state, status: { ...state.status, [sessionId]: mapped } }
  }
  if (value.type === "session.tool.input.started" || value.type === "session.tool.called") {
    if (typeof data.id !== "string") return state
    const current = state.tools[sessionId] ?? []
    if (current.includes(data.id)) return state
    return { ...state, tools: { ...state.tools, [sessionId]: [...current, data.id] } }
  }
  if (value.type === "session.tool.success" || value.type === "session.tool.failed") {
    if (typeof data.id !== "string") return state
    const current = state.tools[sessionId]
    if (!current) return state
    const next = current.filter((id) => id !== data.id)
    const tools = { ...state.tools }
    if (next.length === 0) delete tools[sessionId]
    else tools[sessionId] = next
    return { ...state, tools }
  }
  if ((value.type === "session.created" || value.type === "session.forked") && typeof data.parentID === "string") {
    return { ...state, parent: { ...state.parent, [sessionId]: data.parentID } }
  }
  if (value.type === "session.deleted") {
    const { [sessionId]: _status, ...status } = state.status
    const { [sessionId]: _tools, ...tools } = state.tools
    const { [sessionId]: _parent, ...parent } = state.parent
    return { status, tools, parent }
  }
  return state
}

export function observedHost(state: ObserveState, sessionId: string): ObservedStatus {
  return state.status[sessionId] ?? "unknown"
}

export function hasActiveTool(state: ObserveState, sessionId: string): boolean {
  return (state.tools[sessionId]?.length ?? 0) > 0
}

export function hasBusyChild(state: ObserveState, sessionId: string): boolean {
  return Object.entries(state.parent).some(([child, parent]) => parent === sessionId && state.status[child] !== "idle")
}
