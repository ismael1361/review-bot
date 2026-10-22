import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { signPayload } from '../../src/webhooks/sign';

describe('signPayload', () => {
  it('gera HMAC-SHA256 estável', () => {
    const expected = createHmac('sha256', 'segredo').update('{"a":1}').digest('hex');
    expect(signPayload('segredo', '{"a":1}')).toBe(expected);
  });

  it('muda com o segredo', () => {
    expect(signPayload('a', 'x')).not.toBe(signPayload('b', 'x'));
  });
});
