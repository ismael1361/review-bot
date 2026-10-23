import type { FastifyInstance, FastifyRequest } from 'fastify';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import type { AppDeps } from '../app';
import { AppError } from '../errors';
import { users } from '../../db/schema';
import { hashPassword, verifyPassword } from '../../auth/password';
import { clearSessionCookie, createSession, destroySession, revokeUserSessions, setSessionCookie, SESSION_COOKIE } from '../../auth/sessions';
import { requireAuth } from '../../auth/guards';
import { hashToken } from '../../auth/crypto';

const LoginBody = z.object({ username: z.string().min(1).max(64), password: z.string().min(1).max(200) });
const PasswordBody = z.object({ currentPassword: z.string().min(1).max(200), newPassword: z.string().min(12).max(200) });

const DUMMY_PASSWORD_HASH = '$argon2id$v=19$m=65536,t=3,p=1$R31FmAY9l/2kgmTmm3NLDQ$k2NbD8btkJdafzew5IH7Jfy7tMAx9TB9umYVtk0ztgk';

function publicUser(user: { id: string; username: string; role: 'admin' | 'operator' | 'viewer'; isRoot: boolean }) {
  return { id: user.id, username: user.username, role: user.role, isRoot: user.isRoot };
}

export function registerAuthRoutes(app: FastifyInstance, deps: AppDeps): void {
  app.post(
    '/api/auth/login',
    {
      config: {
        rateLimit: {
          max: 5,
          timeWindow: '1 minute',
          hook: 'preHandler',
          keyGenerator: (request: FastifyRequest) => {
            const parsed = LoginBody.safeParse(request.body);
            const username = parsed.success ? parsed.data.username.toLowerCase().slice(0, 64) : 'invalid';
            return `${request.ip}:${username}`;
          },
        },
      },
    },
    async (request, reply) => {
      const body = LoginBody.parse(request.body);
      const user = deps.db.select().from(users).where(eq(users.username, body.username.toLowerCase())).get();
      if (!user || user.disabled) {
        await verifyPassword(DUMMY_PASSWORD_HASH, body.password);
        throw new AppError('Credenciais inválidas', 'invalid_credentials', 401);
      }
      const valid = await verifyPassword(user.passwordHash, body.password);
      if (!valid) {
        throw new AppError('Credenciais inválidas', 'invalid_credentials', 401);
      }
      deps.db.update(users).set({ lastLoginAt: Date.now() }).where(eq(users.id, user.id)).run();
      const { token } = createSession(deps.db, user.id, { ip: request.ip, userAgent: request.headers['user-agent'] });
      setSessionCookie(reply, token, deps.config);
      return reply.send({ user: publicUser(user) });
    },
  );

  app.post('/api/auth/logout', { preHandler: requireAuth(deps) }, async (request, reply) => {
    if (request.sessionToken) {
      destroySession(deps.db, request.sessionToken);
    }
    clearSessionCookie(reply);
    return reply.code(204).send();
  });

  app.get('/api/auth/me', { preHandler: requireAuth(deps) }, async (request) => ({ user: request.user }));

  app.post(
    '/api/auth/password',
    {
      preHandler: requireAuth(deps),
      config: {
        rateLimit: {
          max: 5,
          timeWindow: '1 minute',
          hook: 'preHandler',
          keyGenerator: (request: FastifyRequest) => {
            const token = request.cookies[SESSION_COOKIE];
            const identity = request.user?.id ?? (token ? hashToken(token) : 'anonymous');
            return `${request.ip}:${identity}`;
          },
        },
      },
    },
    async (request, reply) => {
      const body = PasswordBody.parse(request.body);
      const user = deps.db.select().from(users).where(eq(users.id, request.user?.id ?? '')).get();
      if (!user) {
        throw new AppError('Usuário não encontrado', 'user_not_found', 404);
      }
      const valid = await verifyPassword(user.passwordHash, body.currentPassword);
      if (!valid) {
        throw new AppError('Senha atual incorreta', 'invalid_current_password', 400);
      }
      const passwordHash = await hashPassword(body.newPassword);
      deps.db.update(users).set({ passwordHash, updatedAt: Date.now() }).where(eq(users.id, user.id)).run();
      revokeUserSessions(deps.db, user.id);
      const { token } = createSession(deps.db, user.id, { ip: request.ip, userAgent: request.headers['user-agent'] });
      setSessionCookie(reply, token, deps.config);
      return reply.code(204).send();
    },
  );
}
