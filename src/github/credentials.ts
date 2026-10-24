import { eq } from 'drizzle-orm';
import type { Db } from '../db/client';
import { githubCredentials } from '../db/schema';
import { decryptSecret, encryptSecret } from '../auth/crypto';

export { testConnection } from './client';

export type GithubCredentials = { login: string; pat: string; patLast4: string; scopes: string };

export function getGithubCredentials(db: Db, key: Buffer): GithubCredentials | undefined {
  const row = db.select().from(githubCredentials).where(eq(githubCredentials.id, 'singleton')).get();
  if (!row) {
    return undefined;
  }
  return { login: row.login, pat: decryptSecret(key, row.patEncrypted), patLast4: row.patLast4, scopes: row.scopes ?? '' };
}

export function saveGithubCredentials(db: Db, key: Buffer, input: { login: string; pat: string; scopes: string }): void {
  const now = Date.now();
  const values = {
    id: 'singleton',
    login: input.login,
    patEncrypted: encryptSecret(key, input.pat),
    patLast4: input.pat.slice(-4),
    scopes: input.scopes,
    validatedAt: now,
    updatedAt: now,
  };
  db.insert(githubCredentials)
    .values(values)
    .onConflictDoUpdate({ target: githubCredentials.id, set: { login: values.login, patEncrypted: values.patEncrypted, patLast4: values.patLast4, scopes: values.scopes, validatedAt: now, updatedAt: now } })
    .run();
}

export function toPublicGithubCredentials(db: Db, key: Buffer) {
  const credentials = getGithubCredentials(db, key);
  if (!credentials) {
    return null;
  }
  return { login: credentials.login, patLast4: credentials.patLast4, scopes: credentials.scopes };
}
