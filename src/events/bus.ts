export type BusEvent = { type: string; data: unknown; at: number };

export type EventBus = {
  publish(event: BusEvent): void;
  subscribe(listener: (event: BusEvent) => void): () => void;
};

export function createEventBus(): EventBus {
  const listeners = new Set<(event: BusEvent) => void>();
  return {
    publish(event) {
      for (const listener of listeners) {
        listener(event);
      }
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
