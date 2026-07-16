export interface ServerEvent {
  id: number
  /** Owner of the mutated data. Server-side only — the SSE route filters on it and never sends it. */
  userId: string
  /** `${entity}.${verb}` e.g. 'task.completed' */
  type: string
  entity: 'task' | 'project' | 'section' | 'label' | 'filter' | 'comment' | 'settings'
  ids: string[]
  at: string
}
type Listener = (e: ServerEvent) => void

export class EventBus {
  private seq = 0
  private ring: ServerEvent[] = []
  private listeners = new Set<Listener>()
  constructor(private capacity = 256) {}
  publish(e: Omit<ServerEvent, 'id' | 'at'>): ServerEvent {
    const event: ServerEvent = { ...e, id: ++this.seq, at: new Date().toISOString() }
    this.ring.push(event)
    if (this.ring.length > this.capacity) this.ring.shift()
    for (const l of this.listeners) l(event)
    return event
  }
  subscribe(l: Listener): () => void {
    this.listeners.add(l)
    return () => this.listeners.delete(l)
  }
  since(lastId: number): ServerEvent[] {
    return this.ring.filter((e) => e.id > lastId)
  }
}
