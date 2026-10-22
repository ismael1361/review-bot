import { describe, expect, it } from 'vitest';
import { v7 as uuidv7 } from 'uuid';
import { createTestDb } from '../helpers/db';
import { getSetting, setSetting, deleteSetting } from '../../src/db/settings';
import { users } from '../../src/db/schema';

describe('banco', () => {
  it('grava e lê settings', () => {
    const db = createTestDb();
    expect(getSetting<string>(db, 'x')).toBeUndefined();
    setSetting(db, 'x', { a: 1 });
    expect(getSetting<{ a: number }>(db, 'x')).toEqual({ a: 1 });
    setSetting(db, 'x', 2);
    expect(getSetting<number>(db, 'x')).toBe(2);
    deleteSetting(db, 'x');
    expect(getSetting(db, 'x')).toBeUndefined();
  });

  it('rejeita username duplicado', () => {
    const db = createTestDb();
    const now = Date.now();
    const row = { id: uuidv7(), username: 'ana', passwordHash: 'h', role: 'admin' as const, createdAt: now, updatedAt: now };
    db.insert(users).values(row).run();
    expect(() => db.insert(users).values({ ...row, id: uuidv7() }).run()).toThrow();
  });
});
