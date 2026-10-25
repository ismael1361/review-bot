import { lt } from 'drizzle-orm';
import type { Db } from '../db/client';
import { agentMessages, auditLog, events, githubCache, webhookDeliveries } from '../db/schema';
import { getSystemSettings } from '../api/routes/settings-system';

const DAY_MS = 24 * 60 * 60 * 1000;
const AUDIT_RETENTION_DAYS = 180;

export type RetentionResult = {
  messages: number;
  events: number;
  deliveries: number;
  cache: number;
  audit: number;
};

export function runRetention(db: Db, now = Date.now()): RetentionResult {
  const settings = getSystemSettings(db);
  const cutoff = now - settings.retentionDays * DAY_MS;
  const auditCutoff = now - AUDIT_RETENTION_DAYS * DAY_MS;
  return db.transaction((tx) => {
    const messages = tx.delete(agentMessages).where(lt(agentMessages.createdAt, cutoff)).run().changes;
    const removedEvents = tx.delete(events).where(lt(events.createdAt, cutoff)).run().changes;
    const deliveries = tx.delete(webhookDeliveries).where(lt(webhookDeliveries.createdAt, cutoff)).run().changes;
    const cache = tx.delete(githubCache).where(lt(githubCache.expiresAt, now)).run().changes;
    const audit = tx.delete(auditLog).where(lt(auditLog.createdAt, auditCutoff)).run().changes;
    return { messages, events: removedEvents, deliveries, cache, audit };
  });
}
