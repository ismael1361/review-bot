import { describe, expect, it } from 'vitest';
import { v7 as uuidv7 } from 'uuid';
import type { Db } from '../../src/db/client';
import {
  agentMessages,
  auditLog,
  events,
  githubCache,
  jobs,
  repositories,
  webhookDeliveries,
  webhooks,
} from '../../src/db/schema';
import { setSetting } from '../../src/db/settings';
import { runRetention } from '../../src/ops/retention';
import { createTestDb } from '../helpers/db';

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.UTC(2026, 0, 15, 12);

function seedJob(db: Db): void {
  db.insert(repositories)
    .values({
      id: 'r1',
      githubId: '1',
      owner: 'a',
      name: 'b',
      fullName: 'a/b',
      private: false,
      archived: false,
      enabled: true,
      discoveredAt: NOW,
      updatedAt: NOW,
    })
    .run();
  db.insert(jobs)
    .values({
      id: 'j1',
      repositoryId: 'r1',
      prNumber: 1,
      prTitle: 't',
      prUrl: 'u',
      authorLogin: 'x',
      headSha: 's',
      baseSha: 'b',
      runSeq: 1,
      status: 'succeeded',
      priority: 0,
      attempts: 1,
      maxAttempts: 3,
      queuedAt: NOW,
    })
    .run();
}

function seedWebhook(db: Db): void {
  db.insert(webhooks)
    .values({
      id: 'w1',
      url: 'https://example.com/hook',
      secretEncrypted: 's',
      eventsJson: '[]',
      enabled: true,
      createdAt: NOW,
      updatedAt: NOW,
    })
    .run();
}

function insertMessage(db: Db, createdAt: number, seq: number): void {
  db.insert(agentMessages).values({ id: uuidv7(), jobId: 'j1', seq, role: 'user', contentJson: '{}', createdAt }).run();
}

function insertEvent(db: Db, id: string, createdAt: number): void {
  db.insert(events).values({ id, jobId: 'j1', level: 'info', type: 'x', message: 'm', createdAt }).run();
}

function insertDelivery(db: Db, id: string, createdAt: number): void {
  db.insert(webhookDeliveries)
    .values({ id, webhookId: 'w1', event: 'review.posted', success: true, attempt: 1, createdAt })
    .run();
}

function insertAudit(db: Db, id: string, createdAt: number): void {
  db.insert(auditLog).values({ id, action: 'a', createdAt }).run();
}

describe('retenção', () => {
  it('remove dados antigos e preserva recentes nas cinco tabelas', () => {
    const db = createTestDb();
    const old = NOW - 120 * DAY;
    seedJob(db);
    seedWebhook(db);
    insertMessage(db, old, 1);
    insertMessage(db, NOW, 2);
    insertEvent(db, 'event-old', old);
    insertEvent(db, 'event-new', NOW);
    insertDelivery(db, 'delivery-old', old);
    insertDelivery(db, 'delivery-new', NOW);
    db.insert(githubCache).values({ key: 'expired', etag: 'e', payloadJson: '{}', expiresAt: NOW - 1 }).run();
    db.insert(githubCache).values({ key: 'valid', etag: 'e', payloadJson: '{}', expiresAt: NOW + DAY }).run();
    insertAudit(db, 'audit-120d', old);
    insertAudit(db, 'audit-new', NOW);

    const removed = runRetention(db, NOW);

    expect(removed).toEqual({ messages: 1, events: 1, deliveries: 1, cache: 1, audit: 0 });
    expect(db.select().from(agentMessages).all()).toHaveLength(1);
    expect(db.select().from(events).all().map((row) => row.id)).toEqual(['event-new']);
    expect(db.select().from(webhookDeliveries).all().map((row) => row.id)).toEqual(['delivery-new']);
    expect(db.select().from(githubCache).all().map((row) => row.key)).toEqual(['valid']);
    expect(db.select().from(auditLog).all().map((row) => row.id).sort()).toEqual(['audit-120d', 'audit-new']);
  });

  it('respeita retentionDays customizado e mantém auditoria recente', () => {
    const db = createTestDb();
    setSetting(db, 'system', { retentionDays: 30 });
    const old = NOW - 40 * DAY;
    const recent = NOW - 10 * DAY;
    seedJob(db);
    seedWebhook(db);
    insertMessage(db, old, 1);
    insertMessage(db, recent, 2);
    insertEvent(db, 'event-old', old);
    insertEvent(db, 'event-recent', recent);
    insertDelivery(db, 'delivery-old', old);
    insertDelivery(db, 'delivery-recent', recent);
    db.insert(githubCache).values({ key: 'expired', etag: 'e', payloadJson: '{}', expiresAt: NOW - 1 }).run();
    db.insert(githubCache).values({ key: 'valid', etag: 'e', payloadJson: '{}', expiresAt: NOW + DAY }).run();
    insertAudit(db, 'audit-40d', old);

    const removed = runRetention(db, NOW);

    expect(removed).toEqual({ messages: 1, events: 1, deliveries: 1, cache: 1, audit: 0 });
    expect(db.select().from(agentMessages).all()).toHaveLength(1);
    expect(db.select().from(events).all().map((row) => row.id)).toEqual(['event-recent']);
    expect(db.select().from(webhookDeliveries).all().map((row) => row.id)).toEqual(['delivery-recent']);
    expect(db.select().from(githubCache).all().map((row) => row.key)).toEqual(['valid']);
    expect(db.select().from(auditLog).all().map((row) => row.id)).toEqual(['audit-40d']);
  });

  it('remove auditoria com mais de 180 dias e preserva a de 120 dias', () => {
    const db = createTestDb();
    insertAudit(db, 'audit-181d', NOW - 181 * DAY);
    insertAudit(db, 'audit-180d', NOW - 180 * DAY);
    insertAudit(db, 'audit-120d', NOW - 120 * DAY);
    insertAudit(db, 'audit-new', NOW);

    const removed = runRetention(db, NOW);

    expect(removed.audit).toBe(1);
    expect(db.select().from(auditLog).all().map((row) => row.id).sort()).toEqual([
      'audit-120d',
      'audit-180d',
      'audit-new',
    ]);
  });
});
