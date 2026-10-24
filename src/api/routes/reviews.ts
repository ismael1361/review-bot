import type { FastifyInstance } from 'fastify';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import type { AppDeps } from '../app';
import { AppError } from '../errors';
import { agentMessages, jobs, reviews } from '../../db/schema';
import { requireRole } from '../../auth/guards';
import { listFindings } from '../../jobs/findings';

const IdParam = z.object({ id: z.string().min(1) });

export function registerReviewDetailRoutes(app: FastifyInstance, deps: AppDeps): void {
  app.get(
    '/api/reviews/:id',
    { preHandler: requireRole(deps, 'viewer', 'operator', 'admin') },
    async (request) => {
      const { id } = IdParam.parse(request.params);
      const review = deps.db.select().from(reviews).where(eq(reviews.id, id)).get();
      if (!review) {
        throw new AppError('Review não encontrada', 'review_not_found', 404);
      }
      const job = deps.db.select().from(jobs).where(eq(jobs.id, review.jobId)).get() ?? null;
      return {
        review,
        job,
        findings: listFindings(deps.db, review.jobId),
        transcript: deps.db
          .select()
          .from(agentMessages)
          .where(eq(agentMessages.jobId, review.jobId))
          .orderBy(agentMessages.seq)
          .all(),
      };
    },
  );
}
