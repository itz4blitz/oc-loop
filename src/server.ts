import { Plugin } from "@opencode-ai/plugin"
import { randomUUID } from "node:crypto"
import { executeLoopIntent } from "./app/commands.js"
import { loopRoot, matchingIdleWorkflows, startClock } from "./app/loop.js"
import { toolToIntent, type ToolInput } from "./app/tool.js"
import { createOpenCodeHost } from "./host/opencode.js"
import { WorkflowCatalog } from "./persistence/catalog.js"
import { FileEventStore } from "./persistence/filesystem.js"
import { SchedulerCoordinator } from "./scheduler/coordinator.js"

const TOOL_INPUT_SCHEMA = {
  type: "object",
  properties: {
    action: {
      type: "string",
      description: "Loop operation to perform",
      enum: ["list", "create", "now", "pause", "resume", "stop", "show", "logs", "timeline", "doctor", "template", "set", "export", "import", "help"],
    },
    loopId: { type: "string", description: "Loop id (required by now/pause/resume/stop/show/logs/timeline/set)" },
    prompt: { type: "string", description: "Prompt text for create" },
    template: { type: "string", description: "Template name for template action: continuation | test-fix | review | watch" },
    worktree: { type: "string", description: "Optional worktree path for create/template" },
    sessionId: { type: "string", description: "Optional session binding for create (defaults to current session)" },
    transfer: { type: "string", description: "Exported JSON payload for import" },
    fields: {
      type: "object",
      description: "Fields to update (set action)",
      properties: {
        name: { type: "string" },
        prompt: { type: "string" },
        trigger: { type: "string", enum: ["idle", "manual", "interval", "once"] },
        everyMs: { type: "integer" },
        atMs: { type: "integer" },
        maxRuns: { type: "integer" },
        runtimeMs: { type: "integer" },
        maxFailures: { type: "integer" },
        permissions: { type: "string", enum: ["ask", "ask-never"] },
      },
      additionalProperties: false,
    },
  },
  required: ["action"],
  additionalProperties: false,
} as const

export default Plugin.define({
  id: "itz4blitz.oc-loop",
  async setup(context) {
    const root = loopRoot()
    const catalog = new WorkflowCatalog(root)
    const store = new FileEventStore(root)
    const host = createOpenCodeHost(context)
    const coordinator = new SchedulerCoordinator(store, host, undefined, { dispatchFloorMs: 30_000 })
    for (const workflow of await catalog.list()) await coordinator.restore(workflow)
    const events = new AbortController()
    void (async () => {
      try {
        for await (const event of context.event.subscribe({ signal: events.signal })) {
          host.observe(event)
          if (event.type !== "session.idle") continue
          for (const workflow of matchingIdleWorkflows(await catalog.list(), event.data.sessionID)) {
            await coordinator.signalWorkflow(workflow.id, { type: "idle-boundary" })
          }
        }
      } catch { if (!events.signal.aborted) return }
    })()
    const clock = startClock((event) => { void coordinator.signal(event) })
    const ports = {
      catalog,
      coordinator,
      store,
      host,
      nowMs: Date.now,
      ids: () => ({ workflowId: `wf-${randomUUID()}`, nodeId: `node-${randomUUID()}` }),
    }
    const toolRegistration = await context.tool.transform((draft) => {
      draft.add({
        name: "oc_loop",
        description: "Create and control autonomous loops. Actions: list, create, now, pause, resume, stop, show, logs, timeline, doctor, template, export, import.",
        input: TOOL_INPUT_SCHEMA,
        execute: async (rawInput: unknown, toolContext) => {
          const mapping = toolToIntent(rawInput as ToolInput)
          if (!mapping.ok) return { content: mapping.message }
          return { content: await executeLoopIntent(mapping.intent, toolContext.sessionID, ports) }
        },
      })
    })
    return async () => { events.abort(); clock.stop(); await toolRegistration.dispose() }
  },
})
