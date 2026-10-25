import type { ChatInput, ChatResult } from '../../src/ai/adapters/types';

export function createScriptedChat(results: ChatResult[]) {
  const queue = [...results];
  return async (_input: ChatInput): Promise<ChatResult> => {
    const next = queue.shift();
    if (!next) {
      throw new Error('roteiro do provedor esgotado');
    }
    return next;
  };
}

let toolCallSeq = 0;

export function toolCall(name: string, args: unknown): ChatResult {
  toolCallSeq += 1;
  return {
    toolCalls: [{ id: `call-${toolCallSeq}`, name, argumentsJson: JSON.stringify(args) }],
    usage: { input: 10, output: 5 },
    finishReason: 'tool_calls',
  };
}
