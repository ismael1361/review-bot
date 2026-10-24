import { eq } from 'drizzle-orm';
import type { Db } from '../db/client';
import { githubCache } from '../db/schema';

export function getCache(db: Db, key: string): { etag: string; payloadJson: string } | undefined {
  const row = db.select().from(githubCache).where(eq(githubCache.key, key)).get();
  if (!row || row.expiresAt < Date.now()) {
    return undefined;
  }
  return { etag: row.etag, payloadJson: row.payloadJson };
}

export function putCache(db: Db, key: string, etag: string, payloadJson: string, ttlMs: number): void {
  const now = Date.now();
  db.insert(githubCache)
    .values({ key, etag, payloadJson, expiresAt: now + ttlMs })
    .onConflictDoUpdate({ target: githubCache.key, set: { etag, payloadJson, expiresAt: now + ttlMs } })
    .run();
}
