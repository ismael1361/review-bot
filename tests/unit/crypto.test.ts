import { describe, expect, it } from 'vitest';
import { constantTimeEqualHex, decryptSecret, encryptSecret, hashToken, loadEncryptionKey } from '../../src/auth/crypto';

const key = loadEncryptionKey('MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY=');

describe('crypto', () => {
  it('cifra e decifra preservando o texto', () => {
    const payload = encryptSecret(key, 'ghp_segredo');
    expect(payload.startsWith('v1:')).toBe(true);
    expect(payload).not.toContain('ghp_segredo');
    expect(decryptSecret(key, payload)).toBe('ghp_segredo');
  });

  it('gera IVs diferentes', () => {
    expect(encryptSecret(key, 'a')).not.toBe(encryptSecret(key, 'a'));
  });

  it('rejeita chave de tamanho errado', () => {
    expect(() => loadEncryptionKey('YWJj')).toThrow(/32 bytes/);
  });

  it('detecta payload adulterado', () => {
    const payload = encryptSecret(key, 'a');
    const tampered = `${payload.slice(0, -2)}AA`;
    expect(() => decryptSecret(key, tampered)).toThrow();
  });

  it('compara hashes em tempo constante', () => {
    expect(constantTimeEqualHex(hashToken('a'), hashToken('a'))).toBe(true);
    expect(constantTimeEqualHex(hashToken('a'), hashToken('b'))).toBe(false);
  });
});
