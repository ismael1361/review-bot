import { randomBytes } from 'node:crypto';
import { eq, lt } from 'drizzle-orm';
import { v7 as uuidv7 } from 'uuid';
import type { FastifyReply } from 'fastify';
import type { Config } from '../config';
import type { Db } from '../db/client';
import { sessions, users } from '../db/schema';
import { hashToken } from './crypto';

export const SESSION_COOKIE = 'prr_session';
const IDLE_MS = 12 * 60 * 60 * 1000;
const ABSOLUTE_MS = 7 * 24 * 60 * 60 * 1000;

export type PublicUser = {
  id: string;
  username: string;
  role: 'admin' | 'operator' | 'viewer';
  isRoot: boolean;
};

export function createSession(db: Db, userId: string, meta: { ip?: string; userAgent?: string }): { token: string; sessionId: string } {
  const token = randomBytes(32).toString('base64url');
  const now = Date.now();
  const sessionId = uuidv7();
  db.insert(sessions)
    .values({
      id: sessionId,
      userId,
      tokenHash: hashToken(token),
      createdAt: now,
      lastSeenAt: now,
      idleExpiresAt: now + IDLE_MS,
      absoluteExpiresAt: now + ABSOLUTE_MS,
      ip: meta.ip ?? null,
      userAgent: meta.userAgent ?? null,
    })
    .run();
  return { token, sessionId };
}

export function resolveSession(db: Db, token: string): { user: PublicUser; absoluteExpiresAt: number } | undefined {
  const row = db.select().from(sessions).where(eq(sessions.tokenHash, hashToken(token))).get();
  if (!row) {
    return undefined;
  }
  const now = Date.now();
  if (now > row.idleExpiresAt || now > row.absoluteExpiresAt) {
    db.delete(sessions).where(eq(sessions.id, row.id)).run();
    return undefined;
  }
  const user = db.select().from(users).where(eq(users.id, row.userId)).get();
  if (!user || user.disabled) {
    return undefined;
  }
  db.update(sessions)
    .set({ lastSeenAt: now, idleExpiresAt: now + IDLE_MS })
    .where(eq(sessions.id, row.id))
    .run();
  return { user: { id: user.id, username: user.username, role: user.role, isRoot: user.isRoot }, absoluteExpiresAt: row.absoluteExpiresAt };
}

export function destroySession(db: Db, token: string): void {
  db.delete(sessions).where(eq(sessions.tokenHash, hashToken(token))).run();
}

export function revokeUserSessions(db: Db, userId: string): void {
  db.delete(sessions).where(eq(sessions.userId, userId)).run();
}

export function purgeExpiredSessions(db: Db): void {
  db.delete(sessions).where(lt(sessions.absoluteExpiresAt, Date.now())).run();
}

export function setSessionCookie(reply: FastifyReply, token: string, config: Config, absoluteExpiresAt?: number): void {
  const now = Date.now();
  const remaining = (absoluteExpiresAt ?? now + ABSOLUTE_MS) - now;
  reply.setCookie(SESSION_COOKIE, token, {
    path: '/',
    httpOnly: true,
    sameSite: 'lax',
    secure: config.isProduction && (config.PUBLIC_URL?.startsWith('https://') ?? false),
    maxAge: Math.max(60, Math.floor(Math.min(IDLE_MS, remaining) / 1000)),
  });
}

export function clearSessionCookie(reply: FastifyReply): void {
  reply.clearCookie(SESSION_COOKIE, { path: '/' });
}
