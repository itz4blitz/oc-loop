import { mkdir, open, rename, unlink } from "node:fs/promises"
import { dirname } from "node:path"
import { randomUUID } from "node:crypto"

export async function writeFileAtomic(path: string, content: string, mode = 0o600): Promise<void> {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 })
  const temporary = `${path}.${randomUUID()}.tmp`
  const handle = await open(temporary, "w", mode)
  await handle.writeFile(content)
  await handle.sync()
  await handle.close()
  try {
    await rename(temporary, path)
  } catch (error) {
    await unlink(temporary).catch(() => undefined)
    throw error
  }
}

export async function withExclusiveLock<T>(lockPath: string, run: () => Promise<T>, timeoutMs = 5_000): Promise<T> {
  await mkdir(dirname(lockPath), { recursive: true, mode: 0o700 })
  const started = Date.now()
  while (true) {
    try {
      const handle = await open(lockPath, "wx", 0o600)
      try {
        return await run()
      } finally {
        await handle.close()
        await unlink(lockPath).catch(() => undefined)
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error
      // Stryker disable next-line EqualityOperator: millisecond boundary is not a functional lock difference
      if (Date.now() - started > timeoutMs) throw new Error("lock timeout")
      await new Promise((resolve) => setTimeout(resolve, 5))
    }
  }
}
