export type HostStatus =
  | "idle"
  | "busy"
  | "retrying"
  | "tool-active"
  | "child-busy"
  | "unknown"

export type AdmissionInput = {
  workflowId: string
  sessionId: string
  workflowEnabled: boolean
  due: boolean
  activeRun: boolean
  host: HostStatus
  foregroundTurn: boolean
  activeTool: boolean
  busyChild: boolean
  statusReadSucceeded: boolean
  activeLease: boolean
}

export type AdmissionReason =
  | "invalid-request"
  | "workflow-disabled"
  | "not-due"
  | "run-active"
  | "foreground-turn"
  | "status-unavailable"
  | "host-busy"
  | "host-retrying"
  | "tool-active"
  | "child-busy"
  | "lease-active"

export type AdmissionResult =
  | { admitted: true; idempotencyKey: string }
  | { admitted: false; reason: AdmissionReason }

export function decideAdmission(input: AdmissionInput, dueSequence: number): AdmissionResult {
  if (!input.workflowId.trim() || !input.sessionId.trim() || !Number.isSafeInteger(dueSequence) || dueSequence < 1) {
    return { admitted: false, reason: "invalid-request" }
  }
  if (!input.workflowEnabled) return { admitted: false, reason: "workflow-disabled" }
  if (!input.due) return { admitted: false, reason: "not-due" }
  if (input.activeRun) return { admitted: false, reason: "run-active" }
  if (input.foregroundTurn) return { admitted: false, reason: "foreground-turn" }
  if (!input.statusReadSucceeded || input.host === "unknown") return { admitted: false, reason: "status-unavailable" }
  if (input.host === "busy") return { admitted: false, reason: "host-busy" }
  if (input.host === "retrying") return { admitted: false, reason: "host-retrying" }
  if (input.activeTool || input.host === "tool-active") return { admitted: false, reason: "tool-active" }
  if (input.busyChild || input.host === "child-busy") return { admitted: false, reason: "child-busy" }
  if (input.activeLease) return { admitted: false, reason: "lease-active" }
  return { admitted: true, idempotencyKey: `${input.workflowId}:${dueSequence}` }
}
