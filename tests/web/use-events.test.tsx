// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { render } from '@testing-library/react';
import { useEvents } from '../../src/web/hooks/useEvents';

const EVENT_TYPES = [
  'queue.updated',
  'job.created',
  'job.started',
  'job.progress',
  'job.finished',
  'job.retry_scheduled',
  'job.failed',
  'job.partial',
  'poll.updated',
  'poll.skipped',
  'poller.paused',
  'review.published',
];

class FakeEventSource {
  static instances: FakeEventSource[] = [];

  readonly url: string;
  readonly listeners = new Map<string, Set<(event: MessageEvent) => void>>();
  onopen: (() => void) | null = null;
  closed = false;

  constructor(url: string) {
    this.url = url;
    FakeEventSource.instances.push(this);
  }

  addEventListener(type: string, listener: (event: MessageEvent) => void) {
    const listeners = this.listeners.get(type) ?? new Set();
    listeners.add(listener);
    this.listeners.set(type, listeners);
  }

  emit(type: string) {
    const event = { type } as MessageEvent;
    for (const listener of this.listeners.get(type) ?? []) {
      listener(event);
    }
  }

  close() {
    this.closed = true;
  }
}

function Probe({ onEvent }: { onEvent: (type: string) => void }) {
  useEvents(onEvent);
  return null;
}

describe('useEvents', () => {
  afterEach(() => {
    FakeEventSource.instances = [];
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('abre o SSE, assina os eventos, avisa no open e fecha ao desmontar', () => {
    vi.stubGlobal('EventSource', FakeEventSource);
    const onEvent = vi.fn();

    const view = render(<Probe onEvent={onEvent} />);

    expect(FakeEventSource.instances).toHaveLength(1);
    const source = FakeEventSource.instances[0]!;
    expect(source.url).toBe('/api/events');
    expect(source.onopen).toBeTypeOf('function');
    for (const type of EVENT_TYPES) {
      expect(source.listeners.has(type)).toBe(true);
    }

    source.onopen!();
    expect(onEvent).toHaveBeenCalledWith('open');

    source.emit('review.published');
    expect(onEvent).toHaveBeenCalledWith('review.published');

    view.unmount();
    expect(source.closed).toBe(true);
  });

  it('não reconecta quando o callback muda e usa o callback mais recente', () => {
    vi.stubGlobal('EventSource', FakeEventSource);
    const first = vi.fn();
    const second = vi.fn();

    const view = render(<Probe onEvent={first} />);
    const source = FakeEventSource.instances[0]!;
    expect(FakeEventSource.instances).toHaveLength(1);

    view.rerender(<Probe onEvent={second} />);

    expect(FakeEventSource.instances).toHaveLength(1);

    source.emit('queue.updated');
    expect(second).toHaveBeenCalledWith('queue.updated');
    expect(first).not.toHaveBeenCalledWith('queue.updated');
  });

  it('não abre conexão quando EventSource não está disponível', () => {
    vi.stubGlobal('EventSource', undefined);
    const onEvent = vi.fn();

    const view = render(<Probe onEvent={onEvent} />);

    expect(FakeEventSource.instances).toHaveLength(0);
    expect(onEvent).not.toHaveBeenCalled();

    view.unmount();
  });
});
