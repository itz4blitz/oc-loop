import type { DomainAction } from "../domain/reducer.js"

type Event = { readonly sequence: number; readonly action: DomainAction }

export function timelineLines(events: readonly Event[]): readonly string[] {
  if (events.length === 0) return ["No events."]
  const lines: string[] = []
  for (const event of events) {
    const line = timelineLine(event.action)
    if (line) lines.push(`${event.sequence}. ${line}`)
  }
  return lines.length > 0 ? lines : ["No events."]
}

function timelineLine(action: DomainAction): string | undefined {
  switch (action.type) {
    case "trigger-state": return undefined
    case "trigger-due": return "due"
    case "admit": return `run ${action.runId} admitted`
    case "succeed": return `run ${action.runId} succeeded`
    case "fail": return `run ${action.runId} failed: ${action.reason}`
    case "block": return `blocked: ${action.reason}`
    case "unblock": return "unblocked"
    case "pause": return "paused"
    case "resume": return "resumed"
    case "stop": return "stopped"
    case "mark-unknown": return `run ${action.runId} unrecovered: ${action.reason}`
  }
}
