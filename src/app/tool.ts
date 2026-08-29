import type { LoopIntent, LoopUpdateFields } from "./commands.js"

export type ToolInput = {
  readonly action: string
  readonly loopId?: string | undefined
  readonly prompt?: string | undefined
  readonly template?: string | undefined
  readonly worktree?: string | undefined
  readonly sessionId?: string | undefined
  readonly transfer?: string | undefined
  readonly fields?: LoopUpdateFields | undefined
}

export type ToolMapping =
  | { readonly ok: true; readonly intent: LoopIntent }
  | { readonly ok: false; readonly message: string }

const LOOP_SCOPED = ["show", "pause", "resume", "stop", "now", "logs", "timeline"] as const

export function toolToIntent(input: ToolInput): ToolMapping {
  switch (input.action) {
    case "list": return { ok: true, intent: { kind: "list" } }
    case "export": return { ok: true, intent: { kind: "export" } }
    case "help": return { ok: true, intent: { kind: "help" } }
    case "doctor":
      return { ok: true, intent: { kind: "doctor", ...(input.loopId ? { loopId: input.loopId } : {}) } }
    case "create":
      return {
        ok: true,
        intent: {
          kind: "create",
          ...(input.prompt ? { prompt: input.prompt } : {}),
          ...(input.sessionId ? { sessionId: input.sessionId } : {}),
          ...(input.worktree ? { worktree: input.worktree } : {}),
        },
      }
    case "template":
      return {
        ok: true,
        intent: {
          kind: "template",
          ...(input.template ? { name: input.template } : {}),
          ...(input.worktree ? { worktree: input.worktree } : {}),
        },
      }
    case "import":
      return input.transfer
        ? { ok: true, intent: { kind: "import", transfer: input.transfer } }
        : { ok: false, message: "import requires a transfer payload" }
  }
  if ((LOOP_SCOPED as readonly string[]).includes(input.action)) {
    if (!input.loopId) return { ok: false, message: `${input.action} requires a loop id` }
    return { ok: true, intent: { kind: input.action as (typeof LOOP_SCOPED)[number], loopId: input.loopId } }
  }
  if (input.action === "set") {
    if (!input.loopId) return { ok: false, message: "set requires a loop id" }
    const { loopId, fields } = { loopId: input.loopId, fields: input.fields ?? {} }
    return { ok: true, intent: { kind: "set", loopId, fields } }
  }
  return { ok: false, message: `unknown action: ${input.action}` }
}
