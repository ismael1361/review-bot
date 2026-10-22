import { eq } from 'drizzle-orm';
import type { Db } from './client';
import { appSettings } from './schema';

export function getSetting<T>(db: Db, key: string): T | undefined {
  const row = db.select().from(appSettings).where(eq(appSettings.key, key)).get();
  if (!row) {
    return undefined;
  }
  return JSON.parse(row.valueJson) as T;
}

export function setSetting(db: Db, key: string, value: unknown): void {
  const now = Date.now();
  const valueJson = JSON.stringify(value);
  db.insert(appSettings)
    .values({ key, valueJson, updatedAt: now })
    .onConflictDoUpdate({ target: appSettings.key, set: { valueJson, updatedAt: now } })
    .run();
}

export function deleteSetting(db: Db, key: string): void {
  db.delete(appSettings).where(eq(appSettings.key, key)).run();
}
