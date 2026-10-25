import type { FastifyInstance } from 'fastify';
import { desc, eq } from 'drizzle-orm';
import { z } from 'zod';
import type { AppDeps } from '../app';
import { AppError } from '../errors';
import { agentMessages, aiProfiles, events, jobs, repositories, reviews } from '../../db/schema';
import { requireRole } from '../../auth/guards';
import { listFindings } from '../../jobs/findings';

const IdParam = z.object({ id: z.string().min(1) });
const TIMELINE_LIMIT = 200;

type ProfileSummary = { id: string; name: string; provider: string; model: string };

function profileFromSnapshot(raw: string | null | undefined): ProfileSummary | null {
  if (!raw) {
    return null;
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      return null;
    }
    const profile = parsed as Record<string, unknown>;
    if (
      typeof profile.id !== 'string' ||
      typeof profile.name !== 'string' ||
      typeof profile.provider !== 'string' ||
      typeof profile.model !== 'string'
    ) {
      return null;
    }
    return { id: profile.id, name: profile.name, provider: profile.provider, model: profile.model };
  } catch {
    return null;
  }
}

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
      const repository = job
        ? deps.db
            .select({ id: repositories.id, owner: repositories.owner, name: repositories.name, fullName: repositories.fullName })
            .from(repositories)
            .where(eq(repositories.id, job.repositoryId))
            .get() ?? null
        : null;
      const eventRows = job
        ? deps.db
            .select()
            .from(events)
            .where(eq(events.jobId, job.id))
            .orderBy(desc(events.createdAt))
            .limit(TIMELINE_LIMIT)
            .all()
            .reverse()
        : [];
      const snapshotProfile = profileFromSnapshot(job?.profileSnapshotJson);
      const profile =
        snapshotProfile ??
        (job?.profileId === null || job?.profileId === undefined
          ? null
          : deps.db
              .select({ id: aiProfiles.id, name: aiProfiles.name, provider: aiProfiles.provider, model: aiProfiles.model })
              .from(aiProfiles)
              .where(eq(aiProfiles.id, job.profileId))
              .get() ?? null);
      return {
        review,
        job,
        repository,
        events: eventRows,
        profile,
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
