import { AppError } from '../../api/errors';
import { excerpt, type ProviderAdapter } from './types';

function chatUrl(baseUrl: string): string {
  const trimmed = baseUrl.replace(/\/+$/, '');
  return trimmed.endsWith('/chat/completions') ? trimmed : `${trimmed}/chat/completions`;
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
};
