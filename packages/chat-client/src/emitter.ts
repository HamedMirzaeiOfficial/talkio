export type Listener<T> = (payload: T) => void;

/** Minimal typed event emitter; listeners that throw do not break others. */
export class Emitter<Events extends Record<string, unknown>> {
  private listeners = new Map<keyof Events, Set<Listener<never>>>();

  on<K extends keyof Events>(event: K, listener: Listener<Events[K]>): () => void {
    const set = this.listeners.get(event) ?? new Set();
    set.add(listener as Listener<never>);
    this.listeners.set(event, set);
    return () => set.delete(listener as Listener<never>);
  }

  emit<K extends keyof Events>(event: K, payload: Events[K]): void {
    for (const listener of this.listeners.get(event) ?? []) {
      try {
        (listener as Listener<Events[K]>)(payload);
      } catch (error) {
        console.error('[realtime-chat] listener failed', error);
      }
    }
  }

  clear(): void {
    this.listeners.clear();
  }
}
