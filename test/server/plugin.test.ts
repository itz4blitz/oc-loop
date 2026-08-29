import { mkdtemp } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import plugin from "../../src/server.js"
import { WorkflowCatalog } from "../../src/persistence/catalog.js"
import type { Workflow } from "../../src/domain/schema.js"

const roots: string[] = []
afterEach(async () => {
  const { rm } = await import("node:fs/promises")
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
  delete process.env.OC_LOOP_ROOT
})

const workflow: Workflow = {
  schemaVersion: 1, id: "wf-1", revision: 1, name: "loop", status: "enabled", sessionBinding: { sessionId: "ses-1" },
  node: { id: "node-1", kind: "prompt", prompt: "continue" }, trigger: { kind: "idle" },
  policy: { permissions: "ask", maxRuns: 20, maxRuntimeMs: 60000, maxFailures: 3, noOverlap: true, delivery: "queue" }, createdAt: 1, updatedAt: 1,
}

async function startPlugin() {
  const root = await mkdtemp(join(tmpdir(), "oc-plugin-"))
  roots.push(root)
  process.env.OC_LOOP_ROOT = root
  let execute!: (input: Record<string, unknown>, context: { sessionID: string }) => Promise<{ content: string }>
  let toolDescription!: string
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
      transform: async (fn: (draft: { add: (tool: { name: string; description: string; execute: typeof execute }) => void }) => void) => {
        const tools: Array<{ name: string; description: string; execute: typeof execute }> = []
        fn({ add: (tool) => tools.push(tool) })
        execute = tools[0]!.execute
        toolDescription = tools[0]!.description
        return { dispose: async () => undefined }
      },
    },
  }
  const dispose = await plugin.setup(ctx as never)
  return {
    description: () => toolDescription,
    call: async (input: Record<string, unknown>) => {
      const result = await execute(input, { sessionID: "ses-1" })
      return result.content as string
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
      expect(session.description()).toContain("autonomous loops")
      expect(session.description()).toContain("template")
    } finally {
      await session.stop()
    }
  })
  it("drives the engine through tool actions", async () => {
    const session = await startPlugin()
    try {
      const catalog = new WorkflowCatalog(session.root)
      await session.call({ action: "list" })
      expect(await session.call({ action: "list" })).toBe("No loops found.")
      const created = await session.call({ action: "create", prompt: "keep going" })
      const loopId = created.replace(/^Loop created: /, "")
      await catalog.save({ ...workflow, id: loopId, revision: 1 })
      expect(await session.call({ action: "list" })).toContain(loopId)
      expect(await session.call({ action: "pause", loopId })).toBe(`Loop paused: ${loopId}`)
      expect((await catalog.get(loopId))?.status).toBe("paused")
      expect((await catalog.get(loopId))?.revision).toBe(2)
      expect(await session.call({ action: "resume", loopId })).toBe(`Loop resumed: ${loopId}`)
      expect(await session.call({ action: "now", loopId })).toBe(`Loop triggered: ${loopId}`)
      expect(await session.call({ action: "timeline", loopId })).toContain("blocked")
      expect(await session.call({ action: "doctor", loopId })).toContain(`${loopId}:`)
      expect(await session.call({ action: "stop", loopId })).toBe(`Loop stopped: ${loopId}`)
      expect(await session.call({ action: "show", loopId: "missing" })).toBe("Loop not found: missing")
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
    } finally {
      await session.stop()
    }
  })
})
