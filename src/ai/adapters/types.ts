import type { AppError } from '../../api/errors';

export type ProviderKind = 'openai_compatible' | 'anthropic';

export type TestConnectionInput = { baseUrl: string; apiKey: string; model: string };

export type ProviderAdapter = {
  kind: ProviderKind;
  testConnection(input: TestConnectionInput, fetchImpl?: typeof fetch): Promise<{ ok: true }>;
};

export function excerpt(text: string, size = 200): string {
  return text.replace(/\s+/g, ' ').slice(0, size);
}

export type { AppError };
