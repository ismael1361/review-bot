import { execFileSync } from 'node:child_process';
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { verify } from '@node-rs/argon2';
import { afterEach, describe, expect, it } from 'vitest';
import { v7 as uuidv7 } from 'uuid';
import { hashPassword } from '../../src/auth/password';
import { createDb } from '../../src/db/client';
import { runMigrations } from '../../src/db/migrate';
import { sessions, users } from '../../src/db/schema';

const dirs: string[] = [];

function tempDb() {
  const dir = mkdtempSync(join(tmpdir(), 'review-bot-scripts-'));
  dirs.push(dir);
  const { sqlite, db } = createDb(join(dir, 'review-bot.db'));
  runMigrations(db, 'drizzle');
  return { dir, sqlite, db };
}

afterEach(() => {
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});

describe('scripts operacionais', () => {
  it('backup cria cópia consistente', () => {
    const { dir, sqlite, db } = tempDb();
    const now = Date.now();
    db.insert(users).values({
      id: uuidv7(),
      username: 'root',
      passwordHash: 'h',
      role: 'admin',
      isRoot: true,
      disabled: false,
      createdAt: now,
      updatedAt: now,
    }).run();
    sqlite.close();

    const output = execFileSync(process.execPath, ['scripts/backup.mjs'], {
      env: { ...process.env, DATA_DIR: dir },
      encoding: 'utf8',
    }).trim();

    const files = readdirSync(join(dir, 'backups'));
    expect(files).toHaveLength(1);
    const backupPath = join(dir, 'backups', files[0]!);
    expect(output).toBe(backupPath);
    const copy = new Database(backupPath, { readonly: true });
    const row = copy.prepare('SELECT username, password_hash AS passwordHash FROM users').get() as {
      username: string;
      passwordHash: string;
    };
    expect(row).toEqual({ username: 'root', passwordHash: 'h' });
    copy.close();
  });

  it('reset-password atualiza o hash e revoga sessões', async () => {
    const { dir, sqlite, db } = tempDb();
    const now = Date.now();
    const id = uuidv7();
    db.insert(users).values({
      id,
      username: 'root',
      passwordHash: await hashPassword('senha-antiga-longa'),
      role: 'admin',
      isRoot: true,
      disabled: false,
      createdAt: now,
      updatedAt: now - 1000,
    }).run();
    db.insert(sessions).values({
      id: uuidv7(),
      userId: id,
      tokenHash: `token-${id}`,
      createdAt: now,
      lastSeenAt: now,
      idleExpiresAt: now + 60 * 60 * 1000,
      absoluteExpiresAt: now + 24 * 60 * 60 * 1000,
      ip: '127.0.0.1',
      userAgent: 'vitest',
    }).run();
    sqlite.close();

    execFileSync(process.execPath, ['scripts/reset-password.mjs', 'ROOT'], {
      env: { ...process.env, DATA_DIR: dir },
      input: 'senha-nova-muito-longa\n',
      encoding: 'utf8',
    });

    const copy = new Database(join(dir, 'review-bot.db'), { readonly: true });
    const row = copy.prepare('SELECT password_hash AS passwordHash, updated_at AS updatedAt FROM users WHERE id = ?').get(id) as {
      passwordHash: string;
      updatedAt: number;
    };
    const sessionCount = copy.prepare('SELECT COUNT(*) AS count FROM sessions WHERE user_id = ?').get(id) as { count: number };
    expect(await verify(row.passwordHash, 'senha-nova-muito-longa')).toBe(true);
    expect(row.updatedAt).toBeGreaterThan(now - 1000);
    expect(sessionCount.count).toBe(0);
    copy.close();
  });
});
