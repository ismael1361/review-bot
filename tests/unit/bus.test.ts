import { describe, expect, it } from 'vitest';
import { createEventBus } from '../../src/events/bus';

describe('EventBus', () => {
  it('entrega eventos e respeita unsubscribe', () => {
    const bus = createEventBus();
    const received: string[] = [];
    const unsubscribe = bus.subscribe((event) => received.push(event.type));
    bus.publish({ type: 'a', data: null, at: 1 });
    unsubscribe();
    bus.publish({ type: 'b', data: null, at: 2 });
    expect(received).toEqual(['a']);
  });
});
