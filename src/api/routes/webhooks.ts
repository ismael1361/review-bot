import { randomBytes } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { desc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { v7 as uuidv7 } from 'uuid';
import type { AppDeps } from '../app';
import { AppError } from '../errors';
import { webhookDeliveries, webhooks } from '../../db/schema';
import { requireRole } from '../../auth/guards';
import { audit } from '../../audit/audit';
import { assertSafeUrl } from '../../shared/url-guard';
import { WEBHOOK_EVENTS, dispatchToWebhook, type WebhookEvent } from '../../webhooks/dispatcher';
import { encryptSecret } from '../../auth/crypto';

const CreateBody = z.object({
  url: z.string().url(),
  events: z.array(z.enum(WEBHOOK_EVENTS)).min(1),
  secret: z.string().min(16).max(200).optional(),
  enabled: z.boolean().default(true),
});

const UpdateBody = CreateBody.partial();

const IdParam = z.object({ id: z.string().min(1) });

function toPublic(row: typeof webhooks.$inferSelect) {
  return { id: row.id, url: row.url, events: JSON.parse(row.eventsJson) as string[], enabled: row.enabled, createdAt: row.createdAt, updatedAt: row.updatedAt };
}

async function ensureSafeWebhookUrl(deps: AppDeps, url: string): Promise<void> {
  try {
    await assertSafeUrl(url, { allowPrivate: deps.config.ALLOW_PRIVATE_URLS });
  } catch (error) {
    throw new AppError(error instanceof Error ? error.message : 'URL inválida', 'invalid_url', 400);
  }
}

export function registerWebhookRoutes(app: FastifyInstance, deps: AppDeps): void {
  const admin = requireRole(deps, 'admin');

  app.get('/api/webhooks', { preHandler: admin }, async () => ({
    webhooks: deps.db.select().from(webhooks).all().map(toPublic),
  }));

  app.post('/api/webhooks', { preHandler: admin }, async (request, reply) => {
    const body = CreateBody.parse(request.body);
    await ensureSafeWebhookUrl(deps, body.url);
    const secret = body.secret ?? randomBytes(32).toString('base64url');
    const now = Date.now();
    const id = uuidv7();
    deps.db.insert(webhooks)
      .values({ id, url: body.url, secretEncrypted: encryptSecret(deps.encryptionKey, secret), eventsJson: JSON.stringify(body.events), enabled: body.enabled, createdAt: now, updatedAt: now })
      .run();
    audit(deps.db, { userId: request.user?.id, action: 'webhook.create', targetType: 'webhook', targetId: id, data: { url: body.url }, ip: request.ip });
    return reply.code(201).send({ webhook: toPublic(deps.db.select().from(webhooks).where(eq(webhooks.id, id)).get()!), secret });
  });

  app.patch('/api/webhooks/:id', { preHandler: admin }, async (request) => {
    const { id } = IdParam.parse(request.params);
    const body = UpdateBody.parse(request.body);
    const row = deps.db.select().from(webhooks).where(eq(webhooks.id, id)).get();
    if (!row) {
      throw new AppError('Webhook não encontrado', 'webhook_not_found', 404);
    }
    if (body.url) {
      await ensureSafeWebhookUrl(deps, body.url);
    }
    deps.db.update(webhooks)
      .set({
        url: body.url ?? row.url,
        eventsJson: body.events ? JSON.stringify(body.events) : row.eventsJson,
        enabled: body.enabled ?? row.enabled,
        secretEncrypted: body.secret ? encryptSecret(deps.encryptionKey, body.secret) : row.secretEncrypted,
        updatedAt: Date.now(),
      })
      .where(eq(webhooks.id, id))
      .run();
    audit(deps.db, { userId: request.user?.id, action: 'webhook.update', targetType: 'webhook', targetId: id, ip: request.ip });
    return { webhook: toPublic(deps.db.select().from(webhooks).where(eq(webhooks.id, id)).get()!) };
  });

  app.delete('/api/webhooks/:id', { preHandler: admin }, async (request, reply) => {
    const { id } = IdParam.parse(request.params);
    const row = deps.db.select().from(webhooks).where(eq(webhooks.id, id)).get();
    if (!row) {
      throw new AppError('Webhook não encontrado', 'webhook_not_found', 404);
    }
    deps.db.delete(webhooks).where(eq(webhooks.id, id)).run();
    audit(deps.db, { userId: request.user?.id, action: 'webhook.delete', targetType: 'webhook', targetId: id, ip: request.ip });
    return reply.code(204).send();
  });

  app.post('/api/webhooks/:id/test', { preHandler: admin }, async (request) => {
    const { id } = IdParam.parse(request.params);
    const row = deps.db.select().from(webhooks).where(eq(webhooks.id, id)).get();
    if (!row) {
      throw new AppError('Webhook não encontrado', 'webhook_not_found', 404);
    }
    const ok = await dispatchToWebhook({ db: deps.db, encryptionKey: deps.encryptionKey, allowPrivate: deps.config.ALLOW_PRIVATE_URLS }, row, 'webhook.test' as WebhookEvent, { message: 'entrega de teste' });
    return { ok };
  });

  app.get('/api/webhooks/:id/deliveries', { preHandler: admin }, async (request) => {
    const { id } = IdParam.parse(request.params);
    const deliveries = deps.db.select().from(webhookDeliveries).where(eq(webhookDeliveries.webhookId, id)).orderBy(desc(webhookDeliveries.createdAt)).limit(50).all();
    return { deliveries };
  });
}
