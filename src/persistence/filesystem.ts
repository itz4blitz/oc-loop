import { readFile } from "node:fs/promises"
import { join } from "node:path"
import type { DomainAction } from "../domain/reducer.js"
import { domainActionSchema } from "../domain/schema.js"
import { withExclusiveLock, writeFileAtomic } from "./atomic.js"
import type { Event, EventStore, Snapshot } from "./memory.js"

function assertStreamId(streamId: string): void {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/.test(streamId)) throw new Error("invalid stream id")
}

function filename(streamId: string): string {
  return Buffer.from(streamId).toString("base64url") + ".jsonl"
}
function snapshotFilename(streamId: string): string {
  return Buffer.from(streamId).toString("base64url") + ".json"
}

export class FileEventStore implements EventStore {
  private readonly streamsDir: string
  private readonly snapshotsDir: string

  constructor(root: string) {
    this.streamsDir = join(root, "streams")
    this.snapshotsDir = join(root, "snapshots")
  }

  async append(streamId: string, action: DomainAction, expectedSequence?: number): Promise<Event> {
    return withExclusiveLock(join(this.streamsDir, `${filename(streamId)}.lock`), async () => {
      const events = await this.replay(streamId)
      if (expectedSequence !== undefined && events.length !== expectedSequence) throw new Error("stream revision conflict")
      const event: Event = { streamId, sequence: events.length + 1, action: domainActionSchema.parse(action) }
      const path = join(this.streamsDir, filename(streamId))
      const content = [...events, event].map((item) => JSON.stringify(item)).join("\n")
      await writeFileAtomic(path, content, 0o600)
      return event
    })
  }

  async replay(streamId: string): Promise<readonly Event[]> {
    assertStreamId(streamId)
    let content: string
    try { content = (await readFile(join(this.streamsDir, filename(streamId)))).toString() }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return []
      throw error
    }
    const lines = content.split("\n").filter((line) => line.length > 0)
    const events = lines.map((line) => {
      const event = JSON.parse(line) as Event
      const action = domainActionSchema.parse(event.action)
      return { ...event, action }
    })
    for (const [index, event] of events.entries()) {
      if (event.streamId !== streamId || event.sequence !== index + 1) throw new Error("corrupt event stream")
    }
    return events.map((event) => ({ ...event, action: { ...event.action } }))
  }

  async readSnapshot(streamId: string): Promise<Snapshot | undefined> {
    assertStreamId(streamId)
    try {
      const value = JSON.parse((await readFile(join(this.snapshotsDir, snapshotFilename(streamId)))).toString()) as Snapshot
      if (value.streamId !== streamId || !Number.isSafeInteger(value.sequence) || value.sequence < 0 || !value.state) throw new Error("corrupt snapshot")
      return { ...value, state: { ...value.state } }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined
      throw error
    }
  }

  async writeSnapshot(snapshot: Snapshot): Promise<void> {
    assertStreamId(snapshot.streamId)
    if (!Number.isSafeInteger(snapshot.sequence) || snapshot.sequence < 0) throw new Error("invalid snapshot")
    const path = join(this.snapshotsDir, snapshotFilename(snapshot.streamId))
    await writeFileAtomic(path, JSON.stringify(snapshot), 0o600)
  }
}
