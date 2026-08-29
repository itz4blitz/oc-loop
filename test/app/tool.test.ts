import { describe, expect, it } from "vitest"
import { toolToIntent } from "../../src/app/tool.js"

describe("oc_loop tool mapping", () => {
  it("maps read-only actions", () => {
    expect(toolToIntent({ action: "list" })).toEqual({ ok: true, intent: { kind: "list" } })
    expect(toolToIntent({ action: "export" })).toEqual({ ok: true, intent: { kind: "export" } })
    expect(toolToIntent({ action: "help" })).toEqual({ ok: true, intent: { kind: "help" } })
    expect(toolToIntent({ action: "doctor" })).toEqual({ ok: true, intent: { kind: "doctor" } })
    expect(toolToIntent({ action: "doctor", loopId: "wf-1" })).toEqual({ ok: true, intent: { kind: "doctor", loopId: "wf-1" } })
  })
  it("maps loop-scoped actions and rejects missing ids", () => {
    for (const action of ["show", "pause", "resume", "stop", "now", "logs", "timeline"] as const) {
      expect(toolToIntent({ action })).toEqual({ ok: false, message: `${action} requires a loop id` })
      expect(toolToIntent({ action, loopId: "wf-1" })).toEqual({ ok: true, intent: { kind: action, loopId: "wf-1" } })
    }
  })
  it("maps create with optional prompt, session, and worktree", () => {
    expect(toolToIntent({ action: "create" })).toEqual({ ok: true, intent: { kind: "create" } })
    expect(toolToIntent({ action: "create", prompt: "fix tests", sessionId: "ses-9", worktree: "/tmp/wt" })).toEqual({
      ok: true,
      intent: { kind: "create", prompt: "fix tests", sessionId: "ses-9", worktree: "/tmp/wt" },
    })
  })
  it("maps templates and imports", () => {
    expect(toolToIntent({ action: "template" })).toEqual({ ok: true, intent: { kind: "template" } })
    expect(toolToIntent({ action: "template", template: "watch", worktree: "/tmp/wt" })).toEqual({
      ok: true,
      intent: { kind: "template", name: "watch", worktree: "/tmp/wt" },
    })
    expect(toolToIntent({ action: "import", transfer: "{}" })).toEqual({ ok: true, intent: { kind: "import", transfer: "{}" } })
    expect(toolToIntent({ action: "import" })).toEqual({ ok: false, message: "import requires a transfer payload" })
  })
  it("rejects unknown actions and missing payloads", () => {
    expect(toolToIntent({ action: "nope" })).toEqual({ ok: false, message: "unknown action: nope" })
    expect(toolToIntent({ action: "template", template: "nope" })).toEqual({ ok: true, intent: { kind: "template", name: "nope" } })
  })
})
