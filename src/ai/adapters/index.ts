import { anthropicAdapter } from './anthropic';
import { openAiCompatibleAdapter } from './openai-compatible';
import type { ProviderAdapter, ProviderKind } from './types';

const adapters: Record<ProviderKind, ProviderAdapter> = {
  openai_compatible: openAiCompatibleAdapter,
  anthropic: anthropicAdapter,
};

export function getAdapter(kind: ProviderKind): ProviderAdapter {
  return adapters[kind];
}
