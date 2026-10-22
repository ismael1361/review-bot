import { describe, expect, it } from 'vitest';
import { createLogger } from '../../src/logger';
import { loadConfig } from '../../src/config';

describe('logger', () => {
  it('redige segredos em chaves de topo, aninhadas e no corpo', () => {
    const chunks: string[] = [];
    const logger = createLogger(loadConfig({ ...process.env, NODE_ENV: 'test' }), { write: (chunk: string) => chunks.push(chunk) });
    logger.info({ token: 'ghp_segredo_de_teste', password: 'senha_secreta', apiKey: 'sk_segredo', nested: { token: 'nested_segredo' }, req: { body: { token: 'body_segredo' } } }, 'teste');
    const output = chunks.join('');
    for (const secret of ['ghp_segredo_de_teste', 'senha_secreta', 'sk_segredo', 'nested_segredo', 'body_segredo']) {
      expect(output).not.toContain(secret);
    }
  });
});
