// Live-artifact smoke test for oc-loop.
// Loads the BUILT plugin (dist/src/server.js), drives the registered oc_loop
// tool in an isolated subprocess with a throwaway data root.
// Touches nothing global: no opencode.json, no ~/.config, no running sessions.
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

const root = await mkdtemp(join(tmpdir(), "oc-loop-smoke-"))
process.env.OC_LOOP_ROOT = root

const { default: plugin } = await import(new URL("../dist/src/server.js", import.meta.url))
const { WorkflowCatalog } = await import(new URL("../dist/src/persistence/catalog.js", import.meta.url))

let execute
const aborts = []
const ctx = {
  event: {
    subscribe: async function* ({ signal } = {}) {
      aborts.push(signal)
      await new Promise((resolve) => {
        if (signal?.aborted) return resolve()
        signal?.addEventListener("abort", () => resolve(), { once: true })
      })
    },
  },
  session: {
    get: async () => ({ id: "ses-smoke" }),
    prompt: async () => undefined,
    synthetic: async () => undefined,
  },
  tool: {
    transform: async (fn) => {
      const tools = []
      fn({ add: (tool) => tools.push(tool) })
      execute = tools[0].execute
      return { dispose: async () => undefined }
    },
  },
  command: {
    transform: async () => ({ dispose: async () => undefined }),
  },
}

const cleanup = await plugin.setup(ctx)
const toolContext = { sessionID: "ses-smoke", agent: "build", messageID: "m1", id: "call1", progress: async () => undefined }
const run = async (input) => (await execute(input, toolContext)).content

const failures = []
const check = (name, condition) => { console.log(`${condition ? "PASS" : "FAIL"}  ${name}`); if (!condition) failures.push(name) }

const catalog = new WorkflowCatalog(root)

// 1. create (idle trigger, bound to the invoking session)
const created = await run({ action: "create", prompt: "keep the build green" })
check("create replies with loop id", /^Loop created: wf-/.test(created))
const loopId = created.replace("Loop created: ", "")

// 2. read paths
check("list contains the loop", (await run({ action: "list" })).includes(loopId))
check("show reports event count", /Events: \d+/.test(await run({ action: "show", loopId })))
check("doctor diagnoses", (await run({ action: "doctor", loopId })).includes(`${loopId}:`))

// 3. lifecycle + fail-closed dispatch
check("pause parks the loop", (await run({ action: "pause", loopId })) === `Loop paused: ${loopId}`)
check("resume continues the loop", (await run({ action: "resume", loopId })) === `Loop resumed: ${loopId}`)
check("now attempts dispatch", (await run({ action: "now", loopId })) === `Loop triggered: ${loopId}`)
check("dispatch was fail-closed (no status observed)", (await run({ action: "timeline", loopId })).includes("blocked"))
check("stop is terminal", (await run({ action: "stop", loopId })) === `Loop stopped: ${loopId}`)

// 4. logs + timeline now have real lifecycle events to render
check("logs renders events", (await run({ action: "logs", loopId })).includes("pause"))
check("timeline renders events", (await run({ action: "timeline", loopId })).includes("resumed"))
check("missing loop is graceful", (await run({ action: "pause", loopId: "wf-missing" })) === "Loop not found: wf-missing")

// 5. templates
check("template clones test-fix", /^Loop created: wf-.* from template test-fix\.$/.test(await run({ action: "template", template: "test-fix" })))
check("template rejects unknown", (await run({ action: "template", template: "nope" })) === "unknown template: nope")

// 6. export / import round-trip into an ISOLATED second plugin instance + root
const transfer = await run({ action: "export" })
check("export is a versioned envelope", JSON.parse(transfer).schemaVersion === 1)
const secondRoot = `${root}-second`
process.env.OC_LOOP_ROOT = secondRoot
const cleanup2 = await plugin.setup(ctx)
check("import lands in a fresh catalog", /^Imported \d+ loop\(s\), skipped 0\.$/.test(await run({ action: "import", transfer })))
await cleanup2()
process.env.OC_LOOP_ROOT = root

// 7. help + unknown action
check("help documents the surface", (await run({ action: "help" })).includes("template"))
check("unknown action rejected", (await run({ action: "nope" })) === "unknown action: nope")

await cleanup()
await rm(root, { recursive: true, force: true })
await rm(secondRoot, { recursive: true, force: true })

if (failures.length > 0) {
  console.error(`\n${failures.length} smoke failure(s)`)
  process.exit(1)
}
console.log("\nAll smoke checks passed.")
process.exit(0)
