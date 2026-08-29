import { mkdir, mkdtemp, readFile, stat } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import { FileEventStore } from "../../src/persistence/filesystem.js"

const roots: string[] = []
afterEach(async () => { const { rm } = await import("node:fs/promises"); await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))) })
async function makeStore() { const root = await mkdtemp(join(tmpdir(), "oc-loop-")); roots.push(root); return { root, store: new FileEventStore(root) } }

describe("filesystem event store", () => {
  it("persists ordered events across instances", async () => {
    const { root, store } = await makeStore()
    await store.append("session:1", { type: "trigger-due" })
    await store.append("session:1", { type: "admit", runId: "run-1" })
    const reopened = new FileEventStore(root)
    expect(await reopened.replay("session:1")).toEqual([
      { streamId: "session:1", sequence: 1, action: { type: "trigger-due" } },
      { streamId: "session:1", sequence: 2, action: { type: "admit", runId: "run-1" } },
    ])
    const streamPath = join(root, "streams", Buffer.from("session:1").toString("base64url") + ".jsonl")
    expect((await stat(streamPath)).mode & 0o777).toBe(0o600)
  })
  it("serializes concurrent appends", async () => {
    const { store } = await makeStore()
    await Promise.all([store.append("same", { type: "trigger-due" }), store.append("same", { type: "pause" })])
    expect((await store.replay("same")).map((event) => event.sequence)).toEqual([1, 2])
  })
  it("isolates streams and rejects unsafe IDs", async () => {
    const { store } = await makeStore()
    await store.append("a", { type: "trigger-due" })
    expect(await store.replay("b")).toEqual([])
    await expect(store.replay("../escape")).rejects.toThrow("invalid stream id")
    await expect(store.readSnapshot("../escape")).rejects.toThrow("invalid stream id")
    await expect(store.writeSnapshot({ streamId: "../escape", sequence: 0, state: { status: "waiting", dueSequence: 0 } })).rejects.toThrow("invalid stream id")
    const created = await store.append("ok.id_1", { type: "pause" })
    expect(created).toMatchObject({ streamId: "ok.id_1", sequence: 1, action: { type: "pause" } })
    await expect(store.append("../escape", { type: "pause" })).rejects.toThrow("invalid stream id")
    await expect(store.append("", { type: "pause" })).rejects.toThrow("invalid stream id")
    await expect(store.append("a".repeat(129), { type: "pause" })).rejects.toThrow("invalid stream id")
    await store.append("A-b", { type: "pause" })
    const longId = "a".repeat(128)
    await store.append(longId, { type: "pause" })
    expect((await store.replay(longId))[0]?.streamId).toBe(longId)
  })
  it("rejects corrupt or mismatched records", async () => {
    const { root, store } = await makeStore()
    await store.append("bad", { type: "trigger-due" })
    const path = join(root, "streams", Buffer.from("bad").toString("base64url") + ".jsonl")
    await (await import("node:fs/promises")).writeFile(path, "not-json\n")
    await expect(store.replay("bad")).rejects.toThrow()
    await (await import("node:fs/promises")).writeFile(path, JSON.stringify({ streamId: "other", sequence: 1, action: { type: "pause" } }) + "\n")
    expect(await readFile(path, "utf8")).toContain("other")
    await expect(store.replay("bad")).rejects.toThrow("corrupt event stream")
    await (await import("node:fs/promises")).writeFile(path, JSON.stringify({ streamId: "bad", sequence: 2, action: { type: "pause" } }) + "\n")
    await expect(store.replay("bad")).rejects.toThrow("corrupt event stream")
  })
  it("rejects valid JSON containing an invalid action", async () => {
    const { root, store } = await makeStore()
    const streamPath = join(root, "streams", Buffer.from("invalid-action").toString("base64url") + ".jsonl")
    await mkdir(join(root, "streams"), { recursive: true })
    await (await import("node:fs/promises")).writeFile(streamPath, JSON.stringify({ streamId: "invalid-action", sequence: 1, action: { type: "unknown" } }) + "\n")
    await expect(store.replay("invalid-action")).rejects.toThrow()
  })

  it("surfaces storage errors other than a missing stream", async () => {
    const { root, store } = await makeStore()
    const path = join(root, "streams", Buffer.from("directory").toString("base64url") + ".jsonl")
    await mkdir(join(root, "streams"), { recursive: true })
    await mkdir(path)
    await expect(store.replay("directory")).rejects.toThrow()
  })

  it("atomically round-trips snapshots", async () => {
    const { root, store } = await makeStore()
    await store.writeSnapshot({ streamId: "snap", sequence: 1, state: { status: "waiting", dueSequence: 1 } })
    const reopened = new FileEventStore(root)
    expect(await reopened.readSnapshot("snap")).toEqual({ streamId: "snap", sequence: 1, state: { status: "waiting", dueSequence: 1 } })
    expect(await reopened.readSnapshot("none")).toBeUndefined()
  })
  it("rejects corrupt snapshots and invalid sequences", async () => {
    const { root, store } = await makeStore()
    await store.writeSnapshot({ streamId: "bad-snap", sequence: 1, state: { status: "waiting", dueSequence: 1 } })
    await expect(store.writeSnapshot({ streamId: "bad-snap", sequence: -1, state: { status: "waiting", dueSequence: 0 } })).rejects.toThrow("invalid snapshot")
    await expect(store.writeSnapshot({ streamId: "bad-snap", sequence: 1.5, state: { status: "waiting", dueSequence: 0 } })).rejects.toThrow("invalid snapshot")
    await store.writeSnapshot({ streamId: "zero", sequence: 0, state: { status: "waiting", dueSequence: 0 } })
    expect(await store.readSnapshot("zero")).toMatchObject({ sequence: 0 })
    const snapshotPath = join(root, "snapshots", Buffer.from("bad-snap").toString("base64url") + ".json")
    await (await import("node:fs/promises")).unlink(snapshotPath)
    await (await import("node:fs/promises")).writeFile(snapshotPath, "not-json")
    await expect(store.readSnapshot("bad-snap")).rejects.toThrow()
    await (await import("node:fs/promises")).writeFile(snapshotPath, JSON.stringify({ streamId: "other", sequence: 1, state: {} }))
    await expect(store.readSnapshot("bad-snap")).rejects.toThrow("corrupt snapshot")
    await (await import("node:fs/promises")).writeFile(snapshotPath, JSON.stringify({ streamId: "bad-snap", sequence: 1 }))
    await expect(store.readSnapshot("bad-snap")).rejects.toThrow("corrupt snapshot")
    await (await import("node:fs/promises")).writeFile(snapshotPath, JSON.stringify({ streamId: "bad-snap", sequence: 1.5, state: { status: "waiting", dueSequence: 0 } }))
    await expect(store.readSnapshot("bad-snap")).rejects.toThrow("corrupt snapshot")
    await (await import("node:fs/promises")).writeFile(snapshotPath, JSON.stringify({ streamId: "bad-snap", sequence: -1, state: {} }))
    await expect(store.readSnapshot("bad-snap")).rejects.toThrow("corrupt snapshot")
  })
  it("cleans a temporary snapshot when replacement fails", async () => {
    const { root, store } = await makeStore()
    const target = join(root, "snapshots", Buffer.from("collision").toString("base64url") + ".json")
    await mkdir(join(root, "snapshots"), { recursive: true })
    await mkdir(target)
    await (await import("node:fs/promises")).writeFile(join(target, "occupied"), "x")
    await expect(store.writeSnapshot({ streamId: "collision", sequence: 0, state: { status: "waiting", dueSequence: 0 } })).rejects.toThrow()
  })
  it("rejects appends that miss the expected sequence", async () => {
    const { store } = await makeStore()
    await store.append("cas", { type: "pause" }, 0)
    await expect(store.append("cas", { type: "resume" }, 0)).rejects.toThrow("stream revision conflict")
  })
  it("serializes appends across store instances", async () => {
    const { root } = await makeStore()
    const left = new FileEventStore(root)
    const right = new FileEventStore(root)
    await Promise.all([left.append("shared", { type: "pause" }), right.append("shared", { type: "resume" })])
    expect((await left.replay("shared")).map((event) => event.sequence)).toEqual([1, 2])
  })
  it("rejects invalid actions before writing", async () => {
    const { store } = await makeStore()
    await expect(store.append("a", { type: "succeed" } as never)).rejects.toThrow()
    expect(await store.replay("a")).toEqual([])
  })
})
