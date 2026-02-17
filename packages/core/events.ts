import type { TranscriptionProgressEvent } from './types.ts'

export type PipelineEvents = {
  progress: TranscriptionProgressEvent
  log: { level: 'info' | 'warn' | 'error'; message: string }
}

export class EventBus<T extends Record<string, unknown>> {
  private listeners = new Map<keyof T, Set<(data: never) => void>>()

  on<K extends keyof T>(event: K, handler: (data: T[K]) => void): () => void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set())
    }
    const handlers = this.listeners.get(event)!
    handlers.add(handler as (data: never) => void)
    return () => {
      handlers.delete(handler as (data: never) => void)
    }
  }

  emit<K extends keyof T>(event: K, data: T[K]): void {
    const handlers = this.listeners.get(event)
    if (!handlers) return
    for (const handler of handlers) {
      handler(data as never)
    }
  }
}

export function createEventBus(): EventBus<PipelineEvents> {
  return new EventBus<PipelineEvents>()
}
