import type { HostPort, HostSnapshot } from "../scheduler/coordinator.js"
import { applySessionEvent, emptyObserveState, hasActiveTool, hasBusyChild, observedHost } from "./observe.js"

type OpenCodeContext = {
  session: {
    get(input: { sessionID: string }): Promise<unknown>
    prompt(input: { sessionID: string; text: string; delivery: "queue" }): Promise<unknown>
  }
}

const conservative = {
  foregroundTurn: false,
  activeLease: false,
} as const

export function createOpenCodeHost(context: OpenCodeContext): HostPort & { observe(event: unknown): void } {
  let observed = emptyObserveState
  return {
    observe(event) {
      observed = applySessionEvent(observed, event)
    },
    async inspect(sessionId: string): Promise<HostSnapshot> {
      try {
        await context.session.get({ sessionID: sessionId })
      } catch {
        return { host: "unknown", statusReadSucceeded: false, activeTool: false, busyChild: false, ...conservative }
      }
      const host = observedHost(observed, sessionId)
      return {
        host,
        statusReadSucceeded: host !== "unknown",
        activeTool: hasActiveTool(observed, sessionId),
        busyChild: hasBusyChild(observed, sessionId),
        ...conservative,
      }
    },
    async prompt(input) {
      await context.session.prompt({ sessionID: input.sessionId, text: input.text, delivery: "queue" })
    },
  }
}
