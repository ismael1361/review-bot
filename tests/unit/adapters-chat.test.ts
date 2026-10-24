import { describe, expect, it, vi } from 'vitest';
import { getAdapter } from '../../src/ai/adapters';
import { ProviderError, type ChatInput } from '../../src/ai/adapters/types';

const input: ChatInput = {
  baseUrl: 'https://p.exemplo.com/v1',
  apiKey: 'k',
  model: 'm',
  temperature: 0.2,
  maxOutputTokens: 100,
  messages: [
    { role: 'system', content: 'sys' },
    { role: 'user', content: 'oi' },
    { role: 'assistant', content: 'vou olhar', toolCalls: [{ id: 'c1', name: 'read_file', argumentsJson: '{"path":"a.ts"}' }] },
    { role: 'tool', toolCallId: 'c1', name: 'read_file', content: 'conteúdo' },
  ],
  tools: [{ name: 'read_file', description: 'lê', parameters: { type: 'object', properties: {} } }],
  toolChoice: 'required',
};

type FetchCall = [string, RequestInit];

function calls(fetchImpl: typeof fetch): FetchCall[] {
  return (fetchImpl as unknown as { mock: { calls: FetchCall[] } }).mock.calls;
}

function requestBody(fetchImpl: typeof fetch): Record<string, unknown> {
  const [, init] = calls(fetchImpl)[0]!;
  return JSON.parse(String(init.body)) as Record<string, unknown>;
}

function openAiOk(): Response {
  return new Response(
    JSON.stringify({
      choices: [{ message: { content: 'ok' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 1, completion_tokens: 1 },
    }),
    { status: 200 },
  );
}

function anthropicOk(): Response {
  return new Response(
    JSON.stringify({
      content: [{ type: 'text', text: 'ok' }],
      stop_reason: 'end_turn',
      usage: { input_tokens: 1, output_tokens: 1 },
    }),
    { status: 200 },
  );
}

async function expectProviderError(
  promise: Promise<unknown>,
  expected: { retryable: boolean; status?: number; message?: RegExp },
): Promise<void> {
  await expect(promise).rejects.toBeInstanceOf(ProviderError);
  await expect(promise).rejects.toMatchObject(expected);
}

describe('chat openai-compatible', () => {
  it('mapeia mensagens, ferramentas, tool_choice e resposta', async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            choices: [
              {
                message: {
                  content: 'ok',
                  tool_calls: [{ id: 'c2', type: 'function', function: { name: 'add_finding', arguments: '{"a":1}' } }],
                },
                finish_reason: 'tool_calls',
              },
            ],
            usage: { prompt_tokens: 10, completion_tokens: 5 },
          }),
          { status: 200 },
        ),
    ) as unknown as typeof fetch;

    const result = await getAdapter('openai_compatible').chat(input, fetchImpl);

    const [url, init] = calls(fetchImpl)[0]!;
    expect(url).toBe('https://p.exemplo.com/v1/chat/completions');
    expect(init.method).toBe('POST');
    expect(init.redirect).toBe('error');
    expect(init.signal).toBeInstanceOf(AbortSignal);
    const headers = init.headers as Record<string, string>;
    expect(headers['content-type']).toBe('application/json');
    expect(headers.authorization).toBe('Bearer k');

    const body = requestBody(fetchImpl);
    expect(body).toMatchObject({ model: 'm', temperature: 0.2, max_tokens: 100, tool_choice: 'required' });
    expect(body.messages).toEqual([
      { role: 'system', content: 'sys' },
      { role: 'user', content: 'oi' },
      {
        role: 'assistant',
        content: 'vou olhar',
        tool_calls: [{ id: 'c1', type: 'function', function: { name: 'read_file', arguments: '{"path":"a.ts"}' } }],
      },
      { role: 'tool', tool_call_id: 'c1', content: 'conteúdo' },
    ]);
    expect(body.tools).toEqual([
      { type: 'function', function: { name: 'read_file', description: 'lê', parameters: { type: 'object', properties: {} } } },
    ]);
    expect(result).toEqual({
      content: 'ok',
      toolCalls: [{ id: 'c2', name: 'add_finding', argumentsJson: '{"a":1}' }],
      usage: { input: 10, output: 5 },
      finishReason: 'tool_calls',
    });
  });

  it('mapeia toolChoice auto e função nomeada', async () => {
    const autoFetch = vi.fn(async () => openAiOk()) as unknown as typeof fetch;
    await getAdapter('openai_compatible').chat({ ...input, toolChoice: 'auto' }, autoFetch);
    expect(requestBody(autoFetch).tool_choice).toBe('auto');

    const namedFetch = vi.fn(async () => openAiOk()) as unknown as typeof fetch;
    await getAdapter('openai_compatible').chat({ ...input, toolChoice: { name: 'submit_review' } }, namedFetch);
    expect(requestBody(namedFetch).tool_choice).toEqual({ type: 'function', function: { name: 'submit_review' } });
  });

  it('classifica 500 e 429 como retryable', async () => {
    for (const status of [500, 429]) {
      const fetchImpl = vi.fn(async () => new Response(`erro ${status}`, { status })) as unknown as typeof fetch;
      await expectProviderError(getAdapter('openai_compatible').chat(input, fetchImpl), {
        retryable: true,
        status,
        message: /erro/,
      });
    }
  });

  it('classifica 400 como permanente', async () => {
    const fetchImpl = vi.fn(async () => new Response('requisição inválida', { status: 400 })) as unknown as typeof fetch;
    await expectProviderError(getAdapter('openai_compatible').chat(input, fetchImpl), {
      retryable: false,
      status: 400,
      message: /requisição inválida/,
    });
  });

  it('classifica falha de rede como retryable', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new TypeError('fetch failed');
    }) as unknown as typeof fetch;
    await expectProviderError(getAdapter('openai_compatible').chat(input, fetchImpl), {
      retryable: true,
      status: undefined,
      message: /fetch failed/,
    });
  });

  it('classifica JSON malformado como retryable', async () => {
    const fetchImpl = vi.fn(async () => new Response('não é json', { status: 200 })) as unknown as typeof fetch;
    await expectProviderError(getAdapter('openai_compatible').chat(input, fetchImpl), {
      retryable: true,
      status: undefined,
      message: /JSON malformado/,
    });
  });

  it('classifica choices ausente como retryable', async () => {
    const fetchImpl = vi.fn(async () => new Response('{}', { status: 200 })) as unknown as typeof fetch;
    await expectProviderError(getAdapter('openai_compatible').chat(input, fetchImpl), {
      retryable: true,
      status: undefined,
      message: /choices ausente/,
    });
  });

  it('classifica choice sem message como retryable', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ choices: [{}] }), { status: 200 })) as unknown as typeof fetch;
    await expectProviderError(getAdapter('openai_compatible').chat(input, fetchImpl), {
      retryable: true,
      status: undefined,
      message: /choice ou message ausente/,
    });
  });

  it.each([
    ['https://p.exemplo.com/v1', 'https://p.exemplo.com/v1/chat/completions'],
    ['https://p.exemplo.com/v1/', 'https://p.exemplo.com/v1/chat/completions'],
    ['https://p.exemplo.com/v1/chat/completions/', 'https://p.exemplo.com/v1/chat/completions'],
  ])('monta a URL a partir de %s', async (baseUrl, expected) => {
    const fetchImpl = vi.fn(async () => openAiOk()) as unknown as typeof fetch;
    await getAdapter('openai_compatible').chat({ ...input, baseUrl }, fetchImpl);
    expect(calls(fetchImpl)[0]![0]).toBe(expected);
  });
});

describe('chat anthropic', () => {
  it('mapeia system, tool_use, tool_result e resposta', async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            content: [
              { type: 'text', text: 'ok' },
              { type: 'tool_use', id: 'c3', name: 'submit_review', input: { summary: 's' } },
            ],
            stop_reason: 'tool_use',
            usage: { input_tokens: 7, output_tokens: 3 },
          }),
          { status: 200 },
        ),
    ) as unknown as typeof fetch;

    const result = await getAdapter('anthropic').chat({ ...input, baseUrl: 'https://api.anthropic.com' }, fetchImpl);

    const [url, init] = calls(fetchImpl)[0]!;
    expect(url).toBe('https://api.anthropic.com/v1/messages');
    expect(init.method).toBe('POST');
    expect(init.redirect).toBe('error');
    expect(init.signal).toBeInstanceOf(AbortSignal);
    const headers = init.headers as Record<string, string>;
    expect(headers['content-type']).toBe('application/json');
    expect(headers['x-api-key']).toBe('k');
    expect(headers['anthropic-version']).toBe('2023-06-01');

    const body = requestBody(fetchImpl);
    expect(body).toMatchObject({ model: 'm', temperature: 0.2, max_tokens: 100, system: 'sys', tool_choice: { type: 'any' } });
    expect(body.messages).toEqual([
      { role: 'user', content: 'oi' },
      {
        role: 'assistant',
        content: [
          { type: 'text', text: 'vou olhar' },
          { type: 'tool_use', id: 'c1', name: 'read_file', input: { path: 'a.ts' } },
        ],
      },
      { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'c1', content: 'conteúdo' }] },
    ]);
    expect(body.tools).toEqual([
      { name: 'read_file', description: 'lê', input_schema: { type: 'object', properties: {} } },
    ]);
    expect(result).toEqual({
      content: 'ok',
      toolCalls: [{ id: 'c3', name: 'submit_review', argumentsJson: '{"summary":"s"}' }],
      usage: { input: 7, output: 3 },
      finishReason: 'tool_use',
    });
  });

  it('agrupa tool_results paralelos em uma única mensagem de usuário', async () => {
    const fetchImpl = vi.fn(async () => anthropicOk()) as unknown as typeof fetch;
    await getAdapter('anthropic').chat(
      {
        ...input,
        baseUrl: 'https://api.anthropic.com',
        messages: [
          { role: 'user', content: 'oi' },
          {
            role: 'assistant',
            content: 'vou ler',
            toolCalls: [
              { id: 'c1', name: 'read_file', argumentsJson: '{"path":"a.ts"}' },
              { id: 'c2', name: 'read_file', argumentsJson: '{"path":"b.ts"}' },
            ],
          },
          { role: 'tool', toolCallId: 'c1', name: 'read_file', content: 'conteúdo a' },
          { role: 'tool', toolCallId: 'c2', name: 'read_file', content: 'conteúdo b' },
        ],
      },
      fetchImpl,
    );

    expect(requestBody(fetchImpl).messages).toEqual([
      { role: 'user', content: 'oi' },
      {
        role: 'assistant',
        content: [
          { type: 'text', text: 'vou ler' },
          { type: 'tool_use', id: 'c1', name: 'read_file', input: { path: 'a.ts' } },
          { type: 'tool_use', id: 'c2', name: 'read_file', input: { path: 'b.ts' } },
        ],
      },
      {
        role: 'user',
        content: [
          { type: 'tool_result', tool_use_id: 'c1', content: 'conteúdo a' },
          { type: 'tool_result', tool_use_id: 'c2', content: 'conteúdo b' },
        ],
      },
    ]);
  });

  it('omite system quando não há mensagens de sistema', async () => {
    const fetchImpl = vi.fn(async () => anthropicOk()) as unknown as typeof fetch;
    await getAdapter('anthropic').chat(
      { ...input, baseUrl: 'https://api.anthropic.com', messages: [{ role: 'user', content: 'oi' }] },
      fetchImpl,
    );
    expect(requestBody(fetchImpl)).not.toHaveProperty('system');
  });

  it('mapeia toolChoice auto, required e função nomeada', async () => {
    const cases: [ChatInput['toolChoice'], unknown][] = [
      ['auto', { type: 'auto' }],
      ['required', { type: 'any' }],
      [{ name: 'submit_review' }, { type: 'tool', name: 'submit_review' }],
    ];
    for (const [toolChoice, expected] of cases) {
      const fetchImpl = vi.fn(async () => anthropicOk()) as unknown as typeof fetch;
      await getAdapter('anthropic').chat({ ...input, baseUrl: 'https://api.anthropic.com', toolChoice }, fetchImpl);
      expect(requestBody(fetchImpl).tool_choice).toEqual(expected);
    }
  });

  it('classifica 500 como retryable', async () => {
    const fetchImpl = vi.fn(async () => new Response('erro 500', { status: 500 })) as unknown as typeof fetch;
    await expectProviderError(getAdapter('anthropic').chat(input, fetchImpl), {
      retryable: true,
      status: 500,
      message: /erro 500/,
    });
  });

  it('classifica 400 como permanente', async () => {
    const fetchImpl = vi.fn(async () => new Response('requisição inválida', { status: 400 })) as unknown as typeof fetch;
    await expectProviderError(getAdapter('anthropic').chat(input, fetchImpl), {
      retryable: false,
      status: 400,
      message: /requisição inválida/,
    });
  });

  it('classifica falha de rede como retryable', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new TypeError('fetch failed');
    }) as unknown as typeof fetch;
    await expectProviderError(getAdapter('anthropic').chat(input, fetchImpl), {
      retryable: true,
      status: undefined,
      message: /fetch failed/,
    });
  });

  it('classifica JSON malformado como retryable', async () => {
    const fetchImpl = vi.fn(async () => new Response('não é json', { status: 200 })) as unknown as typeof fetch;
    await expectProviderError(getAdapter('anthropic').chat(input, fetchImpl), {
      retryable: true,
      status: undefined,
      message: /JSON malformado/,
    });
  });

  it('classifica content ausente como retryable', async () => {
    const fetchImpl = vi.fn(async () => new Response('{}', { status: 200 })) as unknown as typeof fetch;
    await expectProviderError(getAdapter('anthropic').chat(input, fetchImpl), {
      retryable: true,
      status: undefined,
      message: /content ausente/,
    });
  });

  it.each([
    ['https://api.anthropic.com', 'https://api.anthropic.com/v1/messages'],
    ['https://api.anthropic.com/', 'https://api.anthropic.com/v1/messages'],
    ['https://api.anthropic.com/v1', 'https://api.anthropic.com/v1/messages'],
    ['https://api.anthropic.com/v1/', 'https://api.anthropic.com/v1/messages'],
    ['https://api.anthropic.com/v1/messages/', 'https://api.anthropic.com/v1/messages'],
  ])('monta a URL a partir de %s', async (baseUrl, expected) => {
    const fetchImpl = vi.fn(async () => anthropicOk()) as unknown as typeof fetch;
    await getAdapter('anthropic').chat({ ...input, baseUrl }, fetchImpl);
    expect(calls(fetchImpl)[0]![0]).toBe(expected);
  });
});
