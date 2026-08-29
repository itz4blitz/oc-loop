import { mkdtemp, readFile, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import { withExclusiveLock, writeFileAtomic } from "../../src/persistence/atomic.js"

const roots: string[] = []
afterEach(async () => {
  const { rm } = await import("node:fs/promises")
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe("atomic persistence helpers", () => {
  it("replaces a file durably", async () => {
    const root = await mkdtemp(join(tmpdir(), "oc-atomic-"))
    roots.push(root)
    const path = join(root, "nested", "file.txt")
    await writeFileAtomic(path, "one")
    await writeFileAtomic(path, "two")
    expect(await readFile(path, "utf8")).toBe("two")
  })
  it("cleans a temporary file when replacement fails", async () => {
    const root = await mkdtemp(join(tmpdir(), "oc-atomic-"))
    roots.push(root)
    const path = join(root, "dir")
    const { mkdir } = await import("node:fs/promises")
    await mkdir(path)
    await expect(writeFileAtomic(path, "x")).rejects.toThrow()
  })
  it("serializes exclusive lock holders", async () => {
    const root = await mkdtemp(join(tmpdir(), "oc-atomic-"))
    roots.push(root)
    const lock = join(root, "file.lock")
    const order: number[] = []
    await Promise.all([
      withExclusiveLock(lock, async () => { order.push(1); await new Promise((resolve) => setTimeout(resolve, 20)); order.push(2) }),
      withExclusiveLock(lock, async () => { order.push(3); order.push(4) }),
    ])
    expect([[1, 2, 3, 4], [3, 4, 1, 2]]).toContainEqual(order)
  })
  it("times out when a lock is stuck", async () => {
    const root = await mkdtemp(join(tmpdir(), "oc-atomic-"))
    roots.push(root)
    const lock = join(root, "stuck.lock")
    await writeFile(lock, "held")
    await expect(withExclusiveLock(lock, async () => "ok", 20)).rejects.toThrow("lock timeout")
  })
  it("rethrows non-conflict lock errors", async () => {
    await expect(withExclusiveLock("/proc/1/not-allowed.lock", async () => "ok", 20)).rejects.toThrow()
  })
})
