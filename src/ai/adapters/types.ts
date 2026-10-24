import type { AppError } from '../../api/errors';

export type ProviderKind = 'openai_compatible' | 'anthropic';

export type TestConnectionInput = { baseUrl: string; apiKey: string; model: string };

export type ProviderAdapter = {
  kind: ProviderKind;
  testConnection(input: TestConnectionInput, fetchImpl?: typeof fetch): Promise<{ ok: true }>;
  chat(input: ChatInput, fetchImpl?: typeof fetch): Promise<ChatResult>;
};

export type ToolSpec = { name: string; description: string; parameters: Record<string, unknown> };

export type ChatMessage =
  | { role: 'system' | 'user'; content: string }
  | { role: 'assistant'; content?: string; toolCalls?: { id: string; name: string; argumentsJson: string }[] }
  | { role: 'tool'; toolCallId: string; name: string; content: string };

export type ChatInput = {
  baseUrl: string;
  apiKey: string;
  model: string;
  temperature: number;
  maxOutputTokens: number;
  messages: ChatMessage[];
  tools: ToolSpec[];
  toolChoice?: 'auto' | 'required' | { name: string };
};

export type ChatResult = {
  content?: string;
  toolCalls: { id: string; name: string; argumentsJson: string }[];
  usage: { input: number; output: number };
  finishReason: string;
};

export class ProviderError extends Error {
  constructor(message: string, readonly retryable: boolean, readonly status?: number) {
    super(message);
  }
}

export function excerpt(text: string, size = 200): string {
  return text.replace(/\s+/g, ' ').slice(0, size);
}

export type { AppError };
