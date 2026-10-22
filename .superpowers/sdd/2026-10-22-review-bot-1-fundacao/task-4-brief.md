### Task 4: Criptografia de segredos e senhas

**Files:**
- Create: `src/auth/crypto.ts`, `src/auth/password.ts`
- Test: `tests/unit/crypto.test.ts`, `tests/unit/password.test.ts`

**Interfaces:**
- Consumes: nada.
- Produces: `loadEncryptionKey(base64): Buffer`; `encryptSecret(key, plaintext): string`; `decryptSecret(key, payload): string`; `hashToken(token): string`; `constantTimeEqualHex(a, b): boolean`; `hashPassword(password): Promise<string>`; `verifyPassword(hash, password): Promise<boolean>`.

- [ ] **Step 1: Escrever os testes que falham**

`tests/unit/crypto.test.ts`:

```ts
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
```

`tests/unit/password.test.ts`:

```ts
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
```

- [ ] **Step 2: Rodar e verificar a falha**

Run: `yarn test tests/unit/crypto.test.ts tests/unit/password.test.ts`
Expected: FAIL com módulos não encontrados.

- [ ] **Step 3: Implementar `src/auth/crypto.ts`**

```ts
import { createCipheriv, createDecipheriv, createHash, randomBytes, timingSafeEqual } from 'node:crypto';

const VERSION = 'v1';

export function loadEncryptionKey(base64: string): Buffer {
  const key = Buffer.from(base64, 'base64');
  if (key.length !== 32) {
    throw new Error('APP_ENCRYPTION_KEY deve ter 32 bytes em base64');
  }
  return key;
}

export function encryptSecret(key: Buffer, plaintext: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [VERSION, iv.toString('base64'), tag.toString('base64'), ciphertext.toString('base64')].join(':');
}

export function decryptSecret(key: Buffer, payload: string): string {
  const [version, ivB64, tagB64, dataB64] = payload.split(':');
  if (version !== VERSION || !ivB64 || !tagB64 || !dataB64) {
    throw new Error('Payload cifrado inválido');
  }
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(ivB64, 'base64'));
  decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(dataB64, 'base64')), decipher.final()]).toString('utf8');
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function constantTimeEqualHex(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'hex');
  const bufB = Buffer.from(b, 'hex');
  if (bufA.length !== bufB.length || bufA.length === 0) {
    return false;
  }
  return timingSafeEqual(bufA, bufB);
}
```

- [ ] **Step 4: Implementar `src/auth/password.ts`**

```ts
import { hash, verify } from '@node-rs/argon2';

export function hashPassword(password: string): Promise<string> {
  return hash(password, { memoryCost: 65536, timeCost: 3, parallelism: 1 });
}

export async function verifyPassword(passwordHash: string, password: string): Promise<boolean> {
  try {
    return await verify(passwordHash, password);
  } catch {
    return false;
  }
}
```

- [ ] **Step 5: Rodar os testes**

Run: `yarn test tests/unit/crypto.test.ts tests/unit/password.test.ts`
Expected: PASS.

- [ ] **Step 6: Checkpoint**

Run: `yarn typecheck; yarn lint; yarn test`
Expected: todos verdes.

---
