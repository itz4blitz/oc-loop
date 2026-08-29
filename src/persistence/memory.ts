import { initialState, reduce, type DomainAction, type DomainState, type TriggerCursor } from "../domain/reducer.js"
import { domainActionSchema } from "../domain/schema.js"

export type Event = {
  readonly streamId: string
  readonly sequence: number
  readonly action: DomainAction
}
export type Snapshot = { readonly streamId: string; readonly sequence: number; readonly state: DomainState }

export interface EventStore {
  append(streamId: string, action: DomainAction, expectedSequence?: number): Promise<Event>
  replay(streamId: string): Promise<readonly Event[]>
  readSnapshot(streamId: string): Promise<Snapshot | undefined>
  writeSnapshot(snapshot: Snapshot): Promise<void>
}

export class MemoryEventStore implements EventStore {
  private readonly streams = new Map<string, Event[]>()
  private readonly snapshots = new Map<string, Snapshot>()

  async append(streamId: string, action: DomainAction, expectedSequence?: number): Promise<Event> {
    const validated = domainActionSchema.parse(action)
    const stream = this.streams.get(streamId) ?? []
    if (expectedSequence !== undefined && stream.length !== expectedSequence) throw new Error("stream revision conflict")
    const event: Event = { streamId, sequence: stream.length + 1, action: validated }
    stream.push(event)
    this.streams.set(streamId, stream)
    return event
  }

  async replay(streamId: string): Promise<readonly Event[]> {
    return this.streams.get(streamId)?.map((event) => ({ ...event })) ?? []
  }

  async readSnapshot(streamId: string): Promise<Snapshot | undefined> {
    const snapshot = this.snapshots.get(streamId)
    return snapshot ? { ...snapshot, state: { ...snapshot.state } } : undefined
  }

  async writeSnapshot(snapshot: Snapshot): Promise<void> {
    this.snapshots.set(snapshot.streamId, { ...snapshot, state: { ...snapshot.state } })
  }
}

export async function loadState(store: EventStore, streamId: string): Promise<DomainState> {
  const snapshot = await store.readSnapshot(streamId)
  let state = snapshot ? { ...snapshot.state } : initialState
  for (const event of await store.replay(streamId)) {
    if (snapshot && event.sequence <= snapshot.sequence) continue
    state = reduce(state, event.action)
  }
  return state
}

export async function loadTriggerState(store: EventStore, streamId: string, fallback: TriggerCursor): Promise<TriggerCursor> {
  let cursor = fallback
  for (const event of await store.replay(streamId)) if (event.action.type === "trigger-state") cursor = event.action.state
  return cursor
}
