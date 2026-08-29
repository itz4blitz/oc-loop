import { describe, expect, it } from "vitest"
import { parseLoopArgs } from "../../src/domain/commands.js"

describe("/loop parser", () => {
  it("parses bare and prefixed invocations", () => {
    expect(parseLoopArgs([])).toEqual({ ok: true, intent: { kind: "create" } })
    expect(parseLoopArgs(["create", "run", "tests"])).toEqual({ ok: true, intent: { kind: "create", prompt: "run tests" } })
    expect(parseLoopArgs(["create"])).toEqual({ ok: true, intent: { kind: "create" } })
    expect(parseLoopArgs(["create", "--session", "ses-9"])).toEqual({ ok: true, intent: { kind: "create", sessionId: "ses-9" } })
    expect(parseLoopArgs(["create", "--worktree", "/tmp/wt", "watch", "it"])).toEqual({ ok: true, intent: { kind: "create", worktree: "/tmp/wt", prompt: "watch it" } })
    expect(parseLoopArgs(["list"])).toEqual({ ok: true, intent: { kind: "list" } })
    expect(parseLoopArgs(["show", "abc"])).toEqual({ ok: true, intent: { kind: "show", loopId: "abc" } })
    expect(parseLoopArgs(["doctor"])).toEqual({ ok: true, intent: { kind: "doctor" } })
    expect(parseLoopArgs(["doctor", "abc"])).toEqual({ ok: true, intent: { kind: "doctor", loopId: "abc" } })
    expect(parseLoopArgs(["help"])).toEqual({ ok: true, intent: { kind: "help" } })
  })
  it("parses every loop control", () => {
    for (const command of ["pause", "resume", "stop", "now", "logs", "timeline"] as const) {
      expect(parseLoopArgs([command, "x"])).toEqual({ ok: true, intent: { kind: command, loopId: "x" } })
    }
  })
  it("parses export, import, and template commands", () => {
    expect(parseLoopArgs(["export"])).toEqual({ ok: true, intent: { kind: "export" } })
    expect(parseLoopArgs(["export", "x"])).toMatchObject({ ok: false, code: "unexpected-argument" })
    expect(parseLoopArgs(["import"])).toEqual({ ok: false, code: "missing-argument", message: "import requires a transfer payload" })
    expect(parseLoopArgs(["import", "{}"])).toEqual({ ok: true, intent: { kind: "import", transfer: "{}" } })
    expect(parseLoopArgs(["import", "{}", "x"])).toMatchObject({ ok: false, code: "unexpected-argument" })
    expect(parseLoopArgs(["template"])).toEqual({ ok: true, intent: { kind: "template" } })
    expect(parseLoopArgs(["template", "test-fix"])).toEqual({ ok: true, intent: { kind: "template", name: "test-fix" } })
    expect(parseLoopArgs(["template", "watch", "--worktree", "/tmp/wt"])).toEqual({ ok: true, intent: { kind: "template", name: "watch", worktree: "/tmp/wt" } })
    expect(parseLoopArgs(["template", "a", "b"])).toMatchObject({ ok: false, code: "unexpected-argument" })
    expect(parseLoopArgs(["template", "--worktree", "/tmp/wt"])).toEqual({ ok: true, intent: { kind: "template", worktree: "/tmp/wt" } })
  })
  it("treats dangling selector flags as literal prompt words", () => {
    expect(parseLoopArgs(["create", "--session"])).toEqual({ ok: true, intent: { kind: "create", prompt: "--session" } })
    expect(parseLoopArgs(["create", "fix", "--worktree"])).toEqual({ ok: true, intent: { kind: "create", prompt: "fix --worktree" } })
  })
  it("rejects malformed commands", () => {
    expect(parseLoopArgs(["wat"])).toEqual({ ok: false, code: "unknown-subcommand", message: "unknown /loop subcommand: wat" })
    expect(parseLoopArgs(["stop"])).toEqual({ ok: false, code: "missing-argument", message: "stop requires a loop id" })
    expect(parseLoopArgs(["list", "x"])).toEqual({ ok: false, code: "unexpected-argument", message: "unexpected /loop argument" })
    expect(parseLoopArgs(["help", "x"])).toMatchObject({ ok: false, code: "unexpected-argument" })
    expect(parseLoopArgs(["doctor", "a", "b"])).toMatchObject({ ok: false, code: "unexpected-argument" })
    expect(parseLoopArgs(["stop", "a", "b"])).toMatchObject({ ok: false, code: "unexpected-argument" })
  })
})
