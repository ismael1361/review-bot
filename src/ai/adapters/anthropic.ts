import { AppError } from '../../api/errors';
import { excerpt, type ProviderAdapter } from './types';

function messagesUrl(baseUrl: string): string {
  const trimmed = baseUrl.replace(/\/+$/, '');
  if (trimmed.endsWith('/v1/messages')) {
    return trimmed;
  }
  return trimmed.endsWith('/v1') ? `${trimmed}/messages` : `${trimmed}/v1/messages`;
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
};
