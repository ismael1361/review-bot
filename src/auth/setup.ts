import { randomBytes } from 'node:crypto';
import { eq } from 'drizzle-orm';
import type { Logger } from 'pino';
import { v7 as uuidv7 } from 'uuid';
import type { Db } from '../db/client';
import { appSettings, users } from '../db/schema';
import { getSetting, setSetting } from '../db/settings';
import { constantTimeEqualHex, hashToken } from './crypto';
import { AppError } from '../api/errors';
import { hashPassword } from './password';

const SETUP_COMPLETE_KEY = 'setup_complete';
const SETUP_TOKEN_HASH_KEY = 'setup_token_hash';

let cachedSetupToken: string | undefined;

export function isSetupComplete(db: Db): boolean {
  return getSetting<boolean>(db, SETUP_COMPLETE_KEY) === true;
}

export function getSetupTokenForDisplay(): string | undefined {
  return cachedSetupToken;
}

export function ensureSetupToken(db: Db, _logger: Logger, envToken?: string): string | undefined {
  if (isSetupComplete(db)) {
    cachedSetupToken = undefined;
    return undefined;
  }
  if (envToken) {
    const hash = hashToken(envToken);
    if (getSetting<string>(db, SETUP_TOKEN_HASH_KEY) !== hash) {
      setSetting(db, SETUP_TOKEN_HASH_KEY, hash);
    }
    cachedSetupToken = undefined;
    return undefined;
  }
  if (cachedSetupToken) {
    return cachedSetupToken;
  }
  const token = randomBytes(32).toString('base64url');
  setSetting(db, SETUP_TOKEN_HASH_KEY, hashToken(token));
  cachedSetupToken = token;
  return token;
}

export async function completeSetup(db: Db, input: { token: string; username: string; password: string }): Promise<{ userId: string }> {
  if (isSetupComplete(db)) {
    throw new AppError('Setup já concluído', 'setup_already_complete', 409);
  }
  const storedHash = getSetting<string>(db, SETUP_TOKEN_HASH_KEY);
  if (!storedHash || !constantTimeEqualHex(hashToken(input.token), storedHash)) {
    throw new AppError('Token de setup inválido', 'invalid_setup_token', 401);
  }
  const passwordHash = await hashPassword(input.password);
  const userId = uuidv7();
  const now = Date.now();
  db.transaction((tx) => {
    const complete = tx.select().from(appSettings).where(eq(appSettings.key, SETUP_COMPLETE_KEY)).get();
    if (complete) {
      throw new AppError('Setup já concluído', 'setup_already_complete', 409);
    }
    const tokenRow = tx.select().from(appSettings).where(eq(appSettings.key, SETUP_TOKEN_HASH_KEY)).get();
    const currentHash = tokenRow ? (JSON.parse(tokenRow.valueJson) as string) : undefined;
    if (!currentHash || !constantTimeEqualHex(hashToken(input.token), currentHash)) {
      throw new AppError('Token de setup inválido', 'invalid_setup_token', 401);
    }
    tx.insert(users)
      .values({
        id: userId,
        username: input.username.toLowerCase(),
        passwordHash,
        role: 'admin',
        isRoot: true,
        disabled: false,
        createdAt: now,
        updatedAt: now,
      })
      .run();
    tx.insert(appSettings)
      .values({ key: SETUP_COMPLETE_KEY, valueJson: 'true', updatedAt: now })
      .onConflictDoUpdate({ target: appSettings.key, set: { valueJson: 'true', updatedAt: now } })
      .run();
    tx.delete(appSettings).where(eq(appSettings.key, SETUP_TOKEN_HASH_KEY)).run();
  });
  cachedSetupToken = undefined;
  return { userId };
}
