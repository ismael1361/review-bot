import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { githubCredentials, webhooks } from '../../src/db/schema';
import { resolveEncryptionKey } from '../../src/instance/keys';
import { createTestDb } from '../helpers/db';

describe('resolveEncryptionKey', () => {
  it('gera a chave em DATA_DIR com permissão 0600 e reutiliza', () => {
    const dir = mkdtempSync(join(tmpdir(), 'review-bot-key-'));
    const db = createTestDb();
    const first = resolveEncryptionKey(db, dir);
    const file = join(dir, '.encryption-key');
    expect(readFileSync(file, 'utf8').trim()).toBe(first.toString('base64'));
    if (process.platform !== 'win32') {
      expect(statSync(file).mode & 0o777).toBe(0o600);
    }
    expect(resolveEncryptionKey(db, dir).equals(first)).toBe(true);
    rmSync(dir, { recursive: true, force: true });
  });

  it('nomeia o arquivo e as fontes de recuperação quando a chave em arquivo é inválida', () => {
    const dir = mkdtempSync(join(tmpdir(), 'review-bot-key-'));
    const db = createTestDb();
    const file = join(dir, '.encryption-key');
    writeFileSync(file, 'chave-invalida');
    let message = '';
    try {
      resolveEncryptionKey(db, dir);
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toContain(file);
    expect(message).toContain('.encryption-key');
    expect(message).toContain('APP_ENCRYPTION_KEY');
    rmSync(dir, { recursive: true, force: true });
  });

  it('recusa gerar chave nova quando o banco já tem segredos', () => {
    const dir = mkdtempSync(join(tmpdir(), 'review-bot-key-'));
    const db = createTestDb();
    db.insert(githubCredentials).values({ id: 'singleton', login: 'bot', patEncrypted: 'v1:x', patLast4: 'abcd', scopes: 'repo', validatedAt: Date.now(), updatedAt: Date.now() }).run();
    expect(() => resolveEncryptionKey(db, dir)).toThrow(/chave de criptografia/i);
    rmSync(dir, { recursive: true, force: true });
  });

  it('recusa gerar chave nova quando há apenas secret de webhook', () => {
    const dir = mkdtempSync(join(tmpdir(), 'review-bot-key-'));
    const db = createTestDb();
    db.insert(webhooks).values({
      id: 'demo-webhook',
      url: 'https://example.com/hook',
      secretEncrypted: 'v1:x',
      eventsJson: '["review.published"]',
      enabled: true,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }).run();
    expect(() => resolveEncryptionKey(db, dir)).toThrow(/chave de criptografia/i);
    rmSync(dir, { recursive: true, force: true });
  });
});
