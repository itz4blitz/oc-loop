import { mkdtemp } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import plugin from "../../src/server.js"
import { WorkflowCatalog } from "../../src/persistence/catalog.js"

const roots: string[] = []
afterEach(async () => {
  const { rm } = await import("node:fs/promises")
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
  delete process.env.OC_LOOP_ROOT
})

type ToolInvoke = (input: Record<string, unknown>, context: { sessionID: string }) => Promise<{ content: string }>
type CommandInvoke = (input: { sessionID: string; prompt: { text: string } }) => Promise<void>

async function startPlugin() {
  const root = await mkdtemp(join(tmpdir(), "oc-plugin-"))
  roots.push(root)
  process.env.OC_LOOP_ROOT = root
  let toolExecute!: ToolInvoke
  let toolDescription!: string
  let commandExecute!: CommandInvoke
  const ctx = {
    event: {
      subscribe: async function* ({ signal }: { signal?: AbortSignal } = {}) {
        await new Promise<void>((resolve) => {
          if (signal?.aborted) return resolve()
          signal?.addEventListener("abort", () => resolve(), { once: true })
        })
      },
    },
    session: {
      get: async () => ({}),
      prompt: async () => undefined,
      synthetic: async () => undefined,
    },
    tool: {
      transform: async (fn: (draft: { add: (tool: { name: string; description: string; execute: ToolInvoke }) => void }) => void) => {
        const tools: Array<{ name: string; description: string; execute: ToolInvoke }> = []
        fn({ add: (tool) => tools.push(tool) })
        toolExecute = tools[0]!.execute
        toolDescription = tools[0]!.description
        return { dispose: async () => undefined }
      },
    },
    command: {
      transform: async (fn: (draft: { add: (command: { name: string; description: string; execute: CommandInvoke }) => void }) => void) => {
        const commands: Array<{ execute: CommandInvoke }> = []
        fn({ add: (command) => commands.push(command) })
        commandExecute = commands[0]!.execute
        return { dispose: async () => undefined }
      },
    },
  }
  const dispose = await plugin.setup(ctx as never)
  return {
    toolDescription: () => toolDescription,
    call: async (input: Record<string, unknown>) => {
      const result = await toolExecute(input, { sessionID: "ses-1" })
      return result.content as string
    },
    run: async (text: string) => {
      await commandExecute({ sessionID: "ses-1", prompt: { text } })
    },
    root,
    async stop() {
      await dispose?.()
    },
  }
}

describe("server plugin", () => {
  it("registers the oc_loop tool with a documented surface", async () => {
    const session = await startPlugin()
    try {
      expect(session.toolDescription()).toContain("autonomous loops")
      expect(session.toolDescription()).toContain("template")
    } finally {
      await session.stop()
    }
  })
  it("creates loops and rejects bad input through the tool", async () => {
    const session = await startPlugin()
    try {
      const created = await session.call({ action: "create", prompt: "keep going" })
      expect(created).toMatch(/^Loop created: wf-/)
      expect(await session.call({ action: "template", template: "watch" })).toMatch(/from template watch/)
      expect(await session.call({ action: "now" })).toBe("now requires a loop id")
      expect(await session.call({ action: "wat" })).toBe("unknown action: wat")
      expect(await session.call({ action: "set", loopId: "wf-1", fields: { name: "x" } })).toBe("Loop not found: wf-1")
    } finally {
      await session.stop()
    }
  })
  it("drives the engine through tool actions", async () => {
    const session = await startPlugin()
    try {
      const created = await session.call({ action: "create", prompt: "continue" })
      const loopId = created.replace("Loop created: ", "")
      expect(await session.call({ action: "list" })).toContain(loopId)
      expect(await session.call({ action: "pause", loopId })).toBe(`Loop paused: ${loopId}`)
      expect(await session.call({ action: "resume", loopId })).toBe(`Loop resumed: ${loopId}`)
      expect(await session.call({ action: "now", loopId })).toBe(`Loop triggered: ${loopId}`)
      // fail-closed: no session.status observed, so the dispatch attempt blocks
      expect(await session.call({ action: "timeline", loopId })).toContain("blocked")
      expect(await session.call({ action: "doctor", loopId })).toContain(`${loopId}:`)
      expect(await session.call({ action: "stop", loopId })).toBe(`Loop stopped: ${loopId}`)
      expect(await session.call({ action: "show", loopId: "missing" })).toBe("Loop not found: missing")
    } finally {
      await session.stop()
    }
  })
  it("runs slash commands with instant synthetic replies", async () => {
    const session = await startPlugin()
    try {
      const catalog = new WorkflowCatalog(session.root)
      await session.run("list")
      await session.run("help")
      await session.run("pause missing")
    } finally {
      await session.stop()
    }
  })
})
