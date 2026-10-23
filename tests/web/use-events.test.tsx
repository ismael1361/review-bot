// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { render } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useEvents } from '../../src/web/hooks/useEvents';

class FakeEventSource {
  static instances: FakeEventSource[] = [];

  readonly url: string;
  onopen: (() => void) | null = null;
  closed = false;

  constructor(url: string) {
    this.url = url;
    FakeEventSource.instances.push(this);
  }

  close() {
    this.closed = true;
  }
}

function Probe() {
  useEvents([['dashboard']]);
  return null;
}

function renderProbe(client: QueryClient) {
  return render(
    <QueryClientProvider client={client}>
      <Probe />
    </QueryClientProvider>,
  );
}

describe('useEvents', () => {
  afterEach(() => {
    FakeEventSource.instances = [];
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('abre o SSE e invalida as queries no onopen, fechando ao desmontar', () => {
    vi.stubGlobal('EventSource', FakeEventSource);
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const invalidate = vi.spyOn(client, 'invalidateQueries');

    const view = renderProbe(client);

    expect(FakeEventSource.instances).toHaveLength(1);
    const source = FakeEventSource.instances[0]!;
    expect(source.url).toBe('/api/events');
    expect(source.onopen).toBeTypeOf('function');

    source.onopen!();

    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['dashboard'] });

    view.unmount();
    expect(source.closed).toBe(true);
  });

  it('não abre conexão quando EventSource não está disponível', () => {
    vi.stubGlobal('EventSource', undefined);
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const invalidate = vi.spyOn(client, 'invalidateQueries');

    const view = renderProbe(client);

    expect(FakeEventSource.instances).toHaveLength(0);
    expect(invalidate).not.toHaveBeenCalled();

    view.unmount();
  });
});
