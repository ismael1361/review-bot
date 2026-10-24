import { AppError } from '../../api/errors';
import { excerpt, ProviderError, type ChatInput, type ChatResult, type ProviderAdapter, type ToolSpec } from './types';

function chatUrl(baseUrl: string): string {
  const trimmed = baseUrl.replace(/\/+$/, '');
  return trimmed.endsWith('/chat/completions') ? trimmed : `${trimmed}/chat/completions`;
}

function toOpenAiMessages(messages: ChatInput['messages']): unknown[] {
  return messages.map((message) => {
    if (message.role === 'tool') {
      return { role: 'tool', tool_call_id: message.toolCallId, content: message.content };
    }
    if (message.role === 'assistant') {
      return {
        role: 'assistant',
        content: message.content ?? null,
        ...(message.toolCalls && message.toolCalls.length > 0
          ? {
              tool_calls: message.toolCalls.map((call) => ({
                id: call.id,
                type: 'function',
                function: { name: call.name, arguments: call.argumentsJson },
              })),
            }
          : {}),
      };
    }
    return { role: message.role, content: message.content };
  });
}

function toOpenAiTools(tools: ToolSpec[]): unknown[] {
  return tools.map((tool) => ({
    type: 'function',
    function: { name: tool.name, description: tool.description, parameters: tool.parameters },
  }));
}

function toOpenAiToolChoice(choice: ChatInput['toolChoice']): unknown {
  if (choice === undefined || choice === 'auto') {
    return 'auto';
  }
  if (choice === 'required') {
    return 'required';
  }
  return { type: 'function', function: { name: choice.name } };
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

function parseToolCalls(value: unknown): ChatResult['toolCalls'] {
  if (value === undefined) {
    return [];
  }
  if (!Array.isArray(value)) {
    throw new ProviderError('Resposta inválida do provedor: tool_calls malformado', true);
  }
  return value.map((call) => {
    if (
      !isRecord(call) ||
      typeof call.id !== 'string' ||
      !isRecord(call.function) ||
      typeof call.function.name !== 'string' ||
      typeof call.function.arguments !== 'string'
    ) {
      throw new ProviderError('Resposta inválida do provedor: tool call malformado', true);
    }
    return { id: call.id, name: call.function.name, argumentsJson: call.function.arguments };
  });
}

function parseResponse(data: unknown): ChatResult {
  if (!isRecord(data) || !Array.isArray(data.choices) || data.choices.length === 0) {
    throw new ProviderError('Resposta inválida do provedor: choices ausente', true);
  }
  const choice = data.choices[0];
  if (!isRecord(choice) || !isRecord(choice.message)) {
    throw new ProviderError('Resposta inválida do provedor: choice ou message ausente', true);
  }
  const usage = isRecord(data.usage) ? data.usage : {};
  return {
    content: typeof choice.message.content === 'string' ? choice.message.content : undefined,
    toolCalls: parseToolCalls(choice.message.tool_calls),
    usage: {
      input: typeof usage.prompt_tokens === 'number' ? usage.prompt_tokens : 0,
      output: typeof usage.completion_tokens === 'number' ? usage.completion_tokens : 0,
    },
    finishReason: typeof choice.finish_reason === 'string' ? choice.finish_reason : 'stop',
  };
}

export async function openAiCompatibleChat(input: ChatInput, fetchImpl?: typeof fetch): Promise<ChatResult> {
  const response = await fetchChat(
    chatUrl(input.baseUrl),
    {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${input.apiKey}` },
      body: JSON.stringify({
        model: input.model,
        temperature: input.temperature,
        max_tokens: input.maxOutputTokens,
        messages: toOpenAiMessages(input.messages),
        tools: toOpenAiTools(input.tools),
        tool_choice: toOpenAiToolChoice(input.toolChoice),
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

export const openAiCompatibleAdapter: ProviderAdapter = {
  kind: 'openai_compatible',
  async testConnection(input, fetchImpl) {
    const response = await (fetchImpl ?? fetch)(chatUrl(input.baseUrl), {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${input.apiKey}` },
      body: JSON.stringify({ model: input.model, max_tokens: 1, messages: [{ role: 'user', content: 'ping' }] }),
      redirect: 'error',
      signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) {
      throw new AppError(`Provedor respondeu ${response.status}: ${excerpt(await response.text())}`, 'provider_test_failed', 400);
    }
    return { ok: true };
  },
  chat: openAiCompatibleChat,
};
