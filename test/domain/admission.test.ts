import { describe, expect, it } from "vitest"
import { decideAdmission, type AdmissionInput } from "../../src/domain/admission.js"

const valid: AdmissionInput = {
  workflowId: "workflow-1", sessionId: "session-1", workflowEnabled: true, due: true,
  activeRun: false, host: "idle", foregroundTurn: false, activeTool: false,
  busyChild: false, statusReadSucceeded: true, activeLease: false,
}

describe("admission gate", () => {
  it("admits only safe due work with a stable key", () => {
    expect(decideAdmission(valid, 4)).toEqual({ admitted: true, idempotencyKey: "workflow-1:4" })
  })

  it.each([
    ["disabled", { workflowEnabled: false }, "workflow-disabled"],
    ["not due", { due: false }, "not-due"],
    ["active run", { activeRun: true }, "run-active"],
    ["foreground", { foregroundTurn: true }, "foreground-turn"],
    ["unknown host", { host: "unknown" }, "status-unavailable"],
    ["failed read", { statusReadSucceeded: false }, "status-unavailable"],
    ["busy", { host: "busy" }, "host-busy"],
    ["retrying", { host: "retrying" }, "host-retrying"],
    ["tool", { activeTool: true }, "tool-active"],
    ["child", { busyChild: true }, "child-busy"],
    ["lease", { activeLease: true }, "lease-active"],
  ] as const)("blocks %s", (_name, change, reason) => {
    expect(decideAdmission({ ...valid, ...change }, 1)).toEqual({ admitted: false, reason })
  })

  it("rejects invalid identifiers and sequences", () => {
    expect(decideAdmission({ ...valid, workflowId: " " }, 1)).toEqual({ admitted: false, reason: "invalid-request" })
    expect(decideAdmission({ ...valid, sessionId: " " }, 1)).toEqual({ admitted: false, reason: "invalid-request" })
    expect(decideAdmission(valid, 0)).toEqual({ admitted: false, reason: "invalid-request" })
  })

  it("uses stable precedence and never mutates input", () => {
    const input = { ...valid, host: "busy" as const, foregroundTurn: true }
    expect(decideAdmission(input, 1)).toEqual({ admitted: false, reason: "foreground-turn" })
    expect(input).toEqual({ ...valid, host: "busy", foregroundTurn: true })
  })

  it("recognizes host-specific safety states", () => {
    expect(decideAdmission({ ...valid, host: "tool-active" }, 1)).toEqual({ admitted: false, reason: "tool-active" })
    expect(decideAdmission({ ...valid, host: "child-busy" }, 1)).toEqual({ admitted: false, reason: "child-busy" })
  })
})
