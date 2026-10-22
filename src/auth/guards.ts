import type { FastifyReply, FastifyRequest } from 'fastify';
import { AppError } from '../api/errors';
import type { AppDeps } from '../api/app';
import { SESSION_COOKIE, clearSessionCookie, resolveSession, setSessionCookie } from './sessions';

export function requireAuth(deps: AppDeps) {
  return async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    const token = request.cookies[SESSION_COOKIE];
    if (!token) {
      throw new AppError('Autenticação necessária', 'unauthenticated', 401);
    }
    const resolved = resolveSession(deps.db, token);
    if (!resolved) {
      clearSessionCookie(reply);
      throw new AppError('Sessão inválida ou expirada', 'invalid_session', 401);
    }
    request.user = resolved.user;
    request.sessionToken = token;
    setSessionCookie(reply, token, deps.config, resolved.absoluteExpiresAt);
  };
}

export function requireRole(deps: AppDeps, ...roles: Array<'admin' | 'operator' | 'viewer'>) {
  const auth = requireAuth(deps);
  return async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    await auth(request, reply);
    const user = request.user;
    if (!user || !roles.includes(user.role)) {
      throw new AppError('Permissão insuficiente', 'forbidden', 403);
    }
  };
}
