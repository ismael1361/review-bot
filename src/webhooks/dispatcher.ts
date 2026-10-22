import { eq } from 'drizzle-orm';
import { v7 as uuidv7 } from 'uuid';
import type { Db } from '../db/client';
import { webhookDeliveries, webhooks } from '../db/schema';
import { decryptSecret } from '../auth/crypto';
import { assertSafeUrl } from '../shared/url-guard';
import { signPayload } from './sign';

export const WEBHOOK_EVENTS = ['review.published', 'job.failed', 'job.partial', 'poller.paused', 'webhook.test'] as const;
export type WebhookEvent = (typeof WEBHOOK_EVENTS)[number];
export type WebhookRow = typeof webhooks.$inferSelect;

export type DispatchDeps = {
  db: Db;
  encryptionKey: Buffer;
  allowPrivate: boolean;
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
};

const RETRY_DELAYS = [0, 1000, 5000];

async function defaultSleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

function record(deps: DispatchDeps, webhookId: string, event: string, attempt: number, success: boolean, statusCode: number | null, responseExcerpt: string): void {
  deps.db.insert(webhookDeliveries)
    .values({ id: uuidv7(), webhookId, event, success, statusCode, attempt, responseExcerpt: responseExcerpt.slice(0, 512), createdAt: Date.now() })
    .run();
}

export async function dispatchToWebhook(deps: DispatchDeps, webhook: WebhookRow, event: WebhookEvent, payload: unknown): Promise<boolean> {
  const secret = decryptSecret(deps.encryptionKey, webhook.secretEncrypted);
  const body = JSON.stringify({ event, timestamp: Date.now(), data: payload });
  for (let attempt = 0; attempt < RETRY_DELAYS.length; attempt++) {
    const delay = RETRY_DELAYS[attempt]!;
    if (delay > 0) {
      await (deps.sleep ?? defaultSleep)(delay);
    }
    try {
      let currentUrl = webhook.url;
      let response: Response | undefined;
      for (let hop = 0; hop <= 3; hop += 1) {
        await assertSafeUrl(currentUrl, { allowPrivate: deps.allowPrivate });
        response = await (deps.fetchImpl ?? fetch)(currentUrl, {
          method: 'POST',
          redirect: 'manual',
          signal: AbortSignal.timeout(10_000),
          headers: {
            'content-type': 'application/json',
            'x-prreviewer-event': event,
            'x-prreviewer-signature': `sha256=${signPayload(secret, body)}`,
          },
          body,
        });
        if (response.status >= 300 && response.status < 400) {
          const location = response.headers.get('location');
          if (!location || hop === 3) {
            throw new Error('Redirecionamento inválido');
          }
          currentUrl = new URL(location, currentUrl).toString();
          continue;
        }
        break;
      }
      if (!response) {
        throw new Error('Sem resposta do webhook');
      }
      const excerpt = (await response.text()).slice(0, 512);
      record(deps, webhook.id, event, attempt + 1, response.ok, response.status, excerpt);
      if (response.ok) {
        return true;
      }
    } catch (error) {
      record(deps, webhook.id, event, attempt + 1, false, null, error instanceof Error ? error.message : 'erro desconhecido');
    }
  }
  return false;
}

export async function dispatchEvent(deps: DispatchDeps, event: WebhookEvent, payload: unknown): Promise<void> {
  const rows = deps.db.select().from(webhooks).where(eq(webhooks.enabled, true)).all();
  const interested = rows.filter((row) => (JSON.parse(row.eventsJson) as string[]).includes(event));
  for (const row of interested) {
    await dispatchToWebhook(deps, row, event, payload);
  }
}
