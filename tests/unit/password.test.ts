import { describe, expect, it } from 'vitest';
import { hashPassword, verifyPassword } from '../../src/auth/password';

describe('password', () => {
  it('gera hash verificável', async () => {
    const hash = await hashPassword('senha-muito-forte');
    expect(hash).not.toBe('senha-muito-forte');
    expect(await verifyPassword(hash, 'senha-muito-forte')).toBe(true);
    expect(await verifyPassword(hash, 'outra-senha')).toBe(false);
  });

  it('retorna false para hash inválido', async () => {
    expect(await verifyPassword('nao-e-hash', 'x')).toBe(false);
  });
});
