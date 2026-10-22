import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppDeps } from '../app';
import { requireRole } from '../../auth/guards';
import { ProfileInput, activateProfile, createProfile, deleteProfile, getProfileRow, listProfiles, testProfile, toPublicProfile, updateProfile } from '../../ai/profiles';
import { audit } from '../../audit/audit';

const IdParam = z.object({ id: z.string().min(1) });
const TestBody = z.object({ apiKey: z.string().min(1).max(500).optional() });

export function registerAiProfileRoutes(app: FastifyInstance, deps: AppDeps): void {
  const admin = requireRole(deps, 'admin');

  app.get('/api/ai-profiles', { preHandler: admin }, async () => ({ profiles: listProfiles(deps.db) }));

  app.post('/api/ai-profiles', { preHandler: admin }, async (request, reply) => {
    const input = ProfileInput.parse(request.body);
    const profile = createProfile(deps.db, deps.encryptionKey, input);
    audit(deps.db, { userId: request.user?.id, action: 'ai_profile.create', targetType: 'ai_profile', targetId: profile.id, data: { name: profile.name }, ip: request.ip });
    return reply.code(201).send({ profile });
  });

  app.get('/api/ai-profiles/:id', { preHandler: admin }, async (request) => {
    const { id } = IdParam.parse(request.params);
    return { profile: toPublicProfile(deps.db, getProfileRow(deps.db, id)) };
  });

  app.put('/api/ai-profiles/:id', { preHandler: admin }, async (request) => {
    const { id } = IdParam.parse(request.params);
    const input = ProfileInput.parse(request.body);
    const profile = updateProfile(deps.db, deps.encryptionKey, id, input);
    audit(deps.db, { userId: request.user?.id, action: 'ai_profile.update', targetType: 'ai_profile', targetId: id, ip: request.ip });
    return { profile };
  });

  app.delete('/api/ai-profiles/:id', { preHandler: admin }, async (request, reply) => {
    const { id } = IdParam.parse(request.params);
    deleteProfile(deps.db, id);
    audit(deps.db, { userId: request.user?.id, action: 'ai_profile.delete', targetType: 'ai_profile', targetId: id, ip: request.ip });
    return reply.code(204).send();
  });

  app.post('/api/ai-profiles/:id/activate', { preHandler: admin }, async (request) => {
    const { id } = IdParam.parse(request.params);
    activateProfile(deps.db, id);
    audit(deps.db, { userId: request.user?.id, action: 'ai_profile.activate', targetType: 'ai_profile', targetId: id, ip: request.ip });
    return { profile: toPublicProfile(deps.db, getProfileRow(deps.db, id)) };
  });

  app.post('/api/ai-profiles/:id/test', { preHandler: admin }, async (request) => {
    const { id } = IdParam.parse(request.params);
    const body = TestBody.parse(request.body ?? {});
    await testProfile(deps.db, deps.encryptionKey, id, { overrideApiKey: body.apiKey, allowPrivate: deps.config.ALLOW_PRIVATE_URLS });
    return { ok: true };
  });
}
