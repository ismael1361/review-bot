import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppDeps } from '../app';
import { AppError } from '../errors';
import { requireRole } from '../../auth/guards';
import { getGithubCredentials, saveGithubCredentials, testConnection, toPublicGithubCredentials } from '../../github/credentials';
import { audit } from '../../audit/audit';

const SaveBody = z.object({ pat: z.string().min(20).max(255) });
const TestBody = z.object({ pat: z.string().min(20).max(255).optional() });

export function registerGithubSettingsRoutes(app: FastifyInstance, deps: AppDeps): void {
  app.get('/api/settings/github', { preHandler: requireRole(deps, 'admin') }, async () => ({
    credentials: toPublicGithubCredentials(deps.db, deps.encryptionKey),
  }));

  app.put('/api/settings/github', { preHandler: requireRole(deps, 'admin') }, async (request) => {
    const body = SaveBody.parse(request.body);
    const result = await testConnection(body.pat);
    saveGithubCredentials(deps.db, deps.encryptionKey, { login: result.login, pat: body.pat, scopes: result.scopes });
    audit(deps.db, { userId: request.user?.id, action: 'github.credentials.save', targetType: 'github_credentials', targetId: 'singleton', data: { login: result.login }, ip: request.ip });
    return { credentials: toPublicGithubCredentials(deps.db, deps.encryptionKey) };
  });

  app.post('/api/settings/github/test', { preHandler: requireRole(deps, 'admin') }, async (request) => {
    const body = TestBody.parse(request.body ?? {});
    const pat = body.pat ?? getGithubCredentials(deps.db, deps.encryptionKey)?.pat;
    if (!pat) {
      throw new AppError('Nenhum token configurado', 'github_token_missing', 400);
    }
    const result = await testConnection(pat);
    return { ok: true, login: result.login, scopes: result.scopes };
  });
}
