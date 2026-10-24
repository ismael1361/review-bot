import type { FastifyInstance } from 'fastify';
import { desc, eq } from 'drizzle-orm';
import { z } from 'zod';
import type { AppDeps } from '../app';
import { AppError } from '../errors';
import { agentMessages, events, jobs, reviews } from '../../db/schema';
import { requireRole } from '../../auth/guards';
import { cancelJob, enqueueManual, retryJob } from '../../jobs/queue';
import { listFindings } from '../../jobs/findings';
import { publishReview } from '../../github/publisher';
import { getGithubCredentials } from '../../github/credentials';
import { audit } from '../../audit/audit';

const IdParam = z.object({ id: z.string().min(1) });

const EnqueueBody = z.object({
  repoFullName: z.string().regex(/^[^/]+\/[^/]+$/),
  prNumber: z.number().int().positive(),
  force: z.boolean().optional(),
});

const NON_TERMINAL_STATUSES = new Set(['queued', 'running', 'cancelled']);

export function registerJobRoutes(app: FastifyInstance, deps: AppDeps): void {
  const viewer = requireRole(deps, 'viewer', 'operator', 'admin');
  const operator = requireRole(deps, 'operator', 'admin');

  app.get('/api/jobs/:id', { preHandler: viewer }, async (request) => {
    const { id } = IdParam.parse(request.params);
    const job = deps.db.select().from(jobs).where(eq(jobs.id, id)).get();
    if (!job) {
      throw new AppError('Job não encontrado', 'job_not_found', 404);
    }
    return {
      job,
      findings: listFindings(deps.db, id),
      events: deps.db
        .select()
        .from(events)
        .where(eq(events.jobId, id))
        .orderBy(desc(events.createdAt))
        .limit(100)
        .all(),
      transcript: deps.db
        .select()
        .from(agentMessages)
        .where(eq(agentMessages.jobId, id))
        .orderBy(agentMessages.seq)
        .all(),
      review: deps.db.select().from(reviews).where(eq(reviews.jobId, id)).get() ?? null,
    };
  });

  app.post('/api/jobs', { preHandler: operator }, async (request, reply) => {
    const body = EnqueueBody.parse(request.body);
    const jobId = await enqueueManual(
      { db: deps.db, encryptionKey: deps.encryptionKey, fetchImpl: deps.fetchImpl },
      body,
    );
    audit(deps.db, {
      userId: request.user?.id,
      action: 'job.enqueue_manual',
      targetType: 'job',
      targetId: jobId,
      data: body,
      ip: request.ip,
    });
    deps.bus.publish({ type: 'job.created', data: { jobId }, at: Date.now() });
    return reply.code(201).send({ jobId });
  });

  app.post('/api/jobs/:id/cancel', { preHandler: operator }, async (request, reply) => {
    const { id } = IdParam.parse(request.params);
    if (!cancelJob(deps.db, id)) {
      throw new AppError('Job não pode ser cancelado no estado atual', 'invalid_state', 409);
    }
    audit(deps.db, {
      userId: request.user?.id,
      action: 'job.cancel',
      targetType: 'job',
      targetId: id,
      ip: request.ip,
    });
    deps.bus.publish({ type: 'queue.updated', data: { jobId: id }, at: Date.now() });
    return reply.code(204).send();
  });

  app.post('/api/jobs/:id/retry', { preHandler: operator }, async (request, reply) => {
    const { id } = IdParam.parse(request.params);
    if (!retryJob(deps.db, id)) {
      throw new AppError('Somente jobs falhos ou cancelados podem ser reprocessados', 'invalid_state', 409);
    }
    audit(deps.db, {
      userId: request.user?.id,
      action: 'job.retry',
      targetType: 'job',
      targetId: id,
      ip: request.ip,
    });
    deps.bus.publish({ type: 'queue.updated', data: { jobId: id }, at: Date.now() });
    return reply.code(204).send();
  });

  app.post('/api/jobs/:id/publish-review', { preHandler: operator }, async (request) => {
    const { id } = IdParam.parse(request.params);
    const job = deps.db.select().from(jobs).where(eq(jobs.id, id)).get();
    if (!job) {
      throw new AppError('Job não encontrado', 'job_not_found', 404);
    }
    if (NON_TERMINAL_STATUSES.has(job.status)) {
      throw new AppError('Job não pode ter review publicada no estado atual', 'invalid_state', 409);
    }
    const credentials = getGithubCredentials(deps.db, deps.encryptionKey);
    if (!credentials) {
      throw new AppError('Credencial GitHub ausente', 'github_token_missing', 400);
    }
    const findings = listFindings(deps.db, id);
    if (findings.length === 0 && !job.summaryMd) {
      throw new AppError('Nenhum achado ou resumo para publicar', 'no_findings', 409);
    }
    const summary = job.summaryMd ?? `Review técnico da PR #${job.prNumber}.`;
    const result = await publishReview(
      { db: deps.db, token: credentials.pat, fetchImpl: deps.fetchImpl },
      job,
      summary,
    );
    audit(deps.db, {
      userId: request.user?.id,
      action: 'job.publish_review',
      targetType: 'job',
      targetId: id,
      data: { status: result.status },
      ip: request.ip,
    });
    return result;
  });
}
