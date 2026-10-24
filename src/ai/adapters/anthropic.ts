import { AppError } from '../../api/errors';
import { excerpt, ProviderError, type ChatInput, type ChatResult, type ProviderAdapter } from './types';

function messagesUrl(baseUrl: string): string {
  const trimmed = baseUrl.replace(/\/+$/, '');
  if (trimmed.endsWith('/v1/messages')) {
    return trimmed;
  }
  return trimmed.endsWith('/v1') ? `${trimmed}/messages` : `${trimmed}/v1/messages`;
}

function toAnthropicMessages(messages: ChatInput['messages']): unknown[] {
  const result: unknown[] = [];
  for (let index = 0; index < messages.length; index += 1) {
    const message = messages[index];
    if (!message || message.role === 'system') {
      continue;
    }
    if (message.role === 'tool') {
      const content: unknown[] = [];
      let nextIndex = index;
      while (nextIndex < messages.length) {
        const toolMessage = messages[nextIndex];
        if (toolMessage?.role !== 'tool') {
          break;
        }
        content.push({ type: 'tool_result', tool_use_id: toolMessage.toolCallId, content: toolMessage.content });
        nextIndex += 1;
      }
      result.push({ role: 'user', content });
      index = nextIndex - 1;
      continue;
    }
    if (message.role === 'assistant') {
      const blocks: unknown[] = [];
      if (message.content) {
        blocks.push({ type: 'text', text: message.content });
      }
      for (const call of message.toolCalls ?? []) {
        blocks.push({
          type: 'tool_use',
          id: call.id,
          name: call.name,
          input: JSON.parse(call.argumentsJson) as unknown,
        });
      }
      result.push({ role: 'assistant', content: blocks });
      continue;
    }
    result.push({ role: 'user', content: message.content });
  }
  return result;
}

function toAnthropicToolChoice(choice: ChatInput['toolChoice']): unknown {
  if (choice === 'required') {
    return { type: 'any' };
  }
  if (choice === undefined || choice === 'auto') {
    return { type: 'auto' };
  }
  return { type: 'tool', name: choice.name };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

async function fetchChat(url: string, init: RequestInit, fetchImpl?: typeof fetch): Promise<Response> {
  try {
    return await (fetchImpl ?? fetch)(url, init);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new ProviderError(`Falha de rede ao chamar o provedor: ${detail}`, true);
  }
}

async function readBody(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    throw new ProviderError('Resposta inválida do provedor: JSON malformado', true);
  }
}

async function providerHttpError(response: Response): Promise<ProviderError> {
  const body = await response.text().catch(() => '');
  const detail = excerpt(body);
  return new ProviderError(
    `Provedor respondeu ${response.status}${detail ? `: ${detail}` : ''}`,
    response.status === 429 || response.status >= 500,
    response.status,
  );
}

function parseResponse(data: unknown): ChatResult {
  if (!isRecord(data) || !Array.isArray(data.content)) {
    throw new ProviderError('Resposta inválida do provedor: content ausente', true);
  }
  const textParts: string[] = [];
  const toolCalls: ChatResult['toolCalls'] = [];
  for (const block of data.content) {
    if (!isRecord(block) || typeof block.type !== 'string') {
      throw new ProviderError('Resposta inválida do provedor: bloco de conteúdo malformado', true);
    }
    if (block.type === 'text') {
      if (typeof block.text !== 'string') {
        throw new ProviderError('Resposta inválida do provedor: bloco de texto malformado', true);
      }
      textParts.push(block.text);
      continue;
    }
    if (block.type === 'tool_use') {
      if (typeof block.id !== 'string' || typeof block.name !== 'string') {
        throw new ProviderError('Resposta inválida do provedor: bloco tool_use malformado', true);
      }
      const argumentsJson = JSON.stringify(block.input);
      toolCalls.push({ id: block.id, name: block.name, argumentsJson: argumentsJson ?? '{}' });
    }
  }
  const text = textParts.join('\n');
  const usage = isRecord(data.usage) ? data.usage : {};
  return {
    content: text || undefined,
    toolCalls,
    usage: {
      input: typeof usage.input_tokens === 'number' ? usage.input_tokens : 0,
      output: typeof usage.output_tokens === 'number' ? usage.output_tokens : 0,
    },
    finishReason: typeof data.stop_reason === 'string' ? data.stop_reason : 'stop',
  };
}

export async function anthropicChat(input: ChatInput, fetchImpl?: typeof fetch): Promise<ChatResult> {
  const system = input.messages
    .filter((message) => message.role === 'system')
    .map((message) => message.content)
    .join('\n\n');
  const response = await fetchChat(
    messagesUrl(input.baseUrl),
    {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': input.apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: input.model,
        temperature: input.temperature,
        max_tokens: input.maxOutputTokens,
        ...(system ? { system } : {}),
        messages: toAnthropicMessages(input.messages),
        tools: input.tools.map((tool) => ({ name: tool.name, description: tool.description, input_schema: tool.parameters })),
        tool_choice: toAnthropicToolChoice(input.toolChoice),
      }),
      redirect: 'error',
      signal: AbortSignal.timeout(120_000),
    },
    fetchImpl,
  );
  if (!response.ok) {
    throw await providerHttpError(response);
  }
  return parseResponse(await readBody(response));
}

export const anthropicAdapter: ProviderAdapter = {
  kind: 'anthropic',
  async testConnection(input, fetchImpl) {
    const response = await (fetchImpl ?? fetch)(messagesUrl(input.baseUrl), {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': input.apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({ model: input.model, max_tokens: 1, messages: [{ role: 'user', content: 'ping' }] }),
      redirect: 'error',
      signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) {
      throw new AppError(`Provedor respondeu ${response.status}: ${excerpt(await response.text())}`, 'provider_test_failed', 400);
    }
    return { ok: true };
  },
  chat: anthropicChat,
};
