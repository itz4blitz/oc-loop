export type LoopIntent =
  | { kind: "create"; prompt?: string; sessionId?: string; worktree?: string }
  | { kind: "list" }
  | { kind: "show" | "pause" | "resume" | "stop" | "now" | "logs"; loopId: string }
  | { kind: "doctor"; loopId?: string }
  | { kind: "export" }
  | { kind: "import"; transfer: string }
  | { kind: "template"; name?: string; worktree?: string }
  | { kind: "timeline"; loopId: string }
  | { kind: "help" }

export type ParseResult =
  | { ok: true; intent: LoopIntent }
  | { ok: false; code: "unknown-subcommand" | "missing-argument" | "unexpected-argument"; message: string }

export function parseLoopArgs(args: readonly string[]): ParseResult {
  if (args.length === 0) return { ok: true, intent: { kind: "create" } }
  const command = args[0]!
  const rest = args.slice(1)
  if (command === "help") return rest.length === 0 ? { ok: true, intent: { kind: "help" } } : unexpected()
  if (command === "create") {
    const words: string[] = []
    let sessionId: string | undefined
    let worktree: string | undefined
    for (let index = 0; index < rest.length; index += 1) {
      const word = rest[index]!
      if (word === "--session" && rest[index + 1]) { sessionId = rest[index + 1]!; index += 1; continue }
      if (word === "--worktree" && rest[index + 1]) { worktree = rest[index + 1]!; index += 1; continue }
      words.push(word)
    }
    const prompt = words.join(" ")
    return {
      ok: true,
      intent: {
        kind: "create",
        ...(prompt ? { prompt } : {}),
        ...(sessionId ? { sessionId } : {}),
        ...(worktree ? { worktree } : {}),
      },
    }
  }
  if (command === "list") return rest.length === 0 ? { ok: true, intent: { kind: "list" } } : unexpected()
  if (command === "export") return rest.length === 0 ? { ok: true, intent: { kind: "export" } } : unexpected()
  if (command === "import") {
    if (!rest[0]) return { ok: false, code: "missing-argument", message: "import requires a transfer payload" }
    if (rest.length !== 1) return unexpected()
    return { ok: true, intent: { kind: "import", transfer: rest[0] } }
  }
  if (command === "template") {
    const words: string[] = []
    let worktree: string | undefined
    for (let index = 0; index < rest.length; index += 1) {
      const word = rest[index]!
      if (word === "--worktree" && rest[index + 1]) { worktree = rest[index + 1]!; index += 1; continue }
      words.push(word)
    }
    if (words.length > 1) return unexpected()
    return { ok: true, intent: { kind: "template", ...(words[0] ? { name: words[0] } : {}), ...(worktree ? { worktree } : {}) } }
  }
  if (command === "doctor") return rest.length <= 1 ? { ok: true, intent: { kind: "doctor", ...(rest[0] ? { loopId: rest[0] } : {}) } } : unexpected()
  if (["show", "pause", "resume", "stop", "now", "logs", "timeline"].includes(command)) {
    if (!rest[0]) return { ok: false, code: "missing-argument", message: `${command} requires a loop id` }
    if (rest.length !== 1) return unexpected()
    return { ok: true, intent: { kind: command, loopId: rest[0] } as LoopIntent }
  }
  return { ok: false, code: "unknown-subcommand", message: `unknown /loop subcommand: ${command}` }
}

function unexpected(): ParseResult {
  return { ok: false, code: "unexpected-argument", message: "unexpected /loop argument" }
}
