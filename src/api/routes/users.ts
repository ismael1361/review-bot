import type { FastifyInstance } from 'fastify';
import { and, eq, ne } from 'drizzle-orm';
import { z } from 'zod';
import { v7 as uuidv7 } from 'uuid';
import type { AppDeps } from '../app';
import { AppError } from '../errors';
import { users } from '../../db/schema';
import { hashPassword } from '../../auth/password';
import { requireRole } from '../../auth/guards';
import { revokeUserSessions } from '../../auth/sessions';
import { audit } from '../../audit/audit';

const Role = z.enum(['admin', 'operator', 'viewer']);
const CreateBody = z.object({ username: z.string().min(3).max(64).regex(/^[a-zA-Z0-9._-]+$/), password: z.string().min(12).max(200), role: Role });
const PatchBody = z
  .object({ role: Role.optional(), disabled: z.boolean().optional() })
  .refine((body) => body.role !== undefined || body.disabled !== undefined, { message: 'Informe role ou disabled' });
const ResetBody = z.object({ password: z.string().min(12).max(200) });

function toPublic(row: { id: string; username: string; role: 'admin' | 'operator' | 'viewer'; isRoot: boolean; disabled: boolean; createdAt: number; lastLoginAt: number | null }) {
  return { id: row.id, username: row.username, role: row.role, isRoot: row.isRoot, disabled: row.disabled, createdAt: row.createdAt, lastLoginAt: row.lastLoginAt };
}

function countActiveNonRootAdmins(db: AppDeps['db'], exceptId: string): number {
  return db.select().from(users).where(and(eq(users.role, 'admin'), eq(users.isRoot, false), eq(users.disabled, false), ne(users.id, exceptId))).all().length;
}

function isConstraintError(error: unknown): boolean {
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === 'string' && code.startsWith('SQLITE_CONSTRAINT');
}

export function registerUserRoutes(app: FastifyInstance, deps: AppDeps): void {
  app.get('/api/users', { preHandler: requireRole(deps, 'admin') }, async () => ({
    users: deps.db.select().from(users).all().map(toPublic),
  }));

  app.post('/api/users', { preHandler: requireRole(deps, 'admin') }, async (request, reply) => {
    const actor = request.user!;
    const body = CreateBody.parse(request.body);
    if (body.role === 'admin' && !actor.isRoot) {
      throw new AppError('Somente o root cria administradores', 'forbidden', 403);
    }
    const username = body.username.toLowerCase();
    const existing = deps.db.select().from(users).where(eq(users.username, username)).get();
    if (existing) {
      throw new AppError('Usuário já existe', 'username_taken', 409);
    }
    const passwordHash = await hashPassword(body.password);
    const now = Date.now();
    const id = uuidv7();
    try {
      deps.db.transaction((tx) => {
        tx.insert(users).values({ id, username, passwordHash, role: body.role, isRoot: false, disabled: false, createdAt: now, updatedAt: now }).run();
        audit(tx, { userId: actor.id, action: 'user.create', targetType: 'user', targetId: id, data: { username, role: body.role }, ip: request.ip });
      });
    } catch (error) {
      if (isConstraintError(error)) {
        throw new AppError('Usuário já existe', 'username_taken', 409);
      }
      throw error;
    }
    return reply.code(201).send({ user: toPublic(deps.db.select().from(users).where(eq(users.id, id)).get()!) });
  });

  app.patch('/api/users/:id', { preHandler: requireRole(deps, 'admin') }, async (request) => {
    const actor = request.user!;
    const params = z.object({ id: z.string().min(1) }).parse(request.params);
    const body = PatchBody.parse(request.body);
    const target = deps.db.select().from(users).where(eq(users.id, params.id)).get();
    if (!target) {
      throw new AppError('Usuário não encontrado', 'user_not_found', 404);
    }
    if (target.isRoot) {
      throw new AppError('O root não pode ser alterado', 'root_immutable', 403);
    }
    if ((target.role === 'admin' || body.role === 'admin') && !actor.isRoot) {
      throw new AppError('Somente o root gerencia administradores', 'forbidden', 403);
    }
    const demoting = (target.role === 'admin' && body.role !== undefined && body.role !== 'admin') || (target.role === 'admin' && body.disabled === true);
    if (demoting && countActiveNonRootAdmins(deps.db, target.id) === 0) {
      throw new AppError('É necessário ao menos um administrador ativo', 'last_admin', 409);
    }
    const changes: { role?: 'admin' | 'operator' | 'viewer'; disabled?: boolean; updatedAt: number } = { updatedAt: Date.now() };
    if (body.role !== undefined) {
      changes.role = body.role;
    }
    if (body.disabled !== undefined) {
      changes.disabled = body.disabled;
    }
    deps.db.transaction((tx) => {
      tx.update(users).set(changes).where(eq(users.id, target.id)).run();
      if (changes.disabled === true) {
        revokeUserSessions(tx, target.id);
      }
      audit(tx, { userId: actor.id, action: 'user.update', targetType: 'user', targetId: target.id, data: changes, ip: request.ip });
    });
    return { user: toPublic(deps.db.select().from(users).where(eq(users.id, target.id)).get()!) };
  });

  app.post('/api/users/:id/reset-password', { preHandler: requireRole(deps, 'admin') }, async (request, reply) => {
    const actor = request.user!;
    const params = z.object({ id: z.string().min(1) }).parse(request.params);
    const body = ResetBody.parse(request.body);
    const target = deps.db.select().from(users).where(eq(users.id, params.id)).get();
    if (!target) {
      throw new AppError('Usuário não encontrado', 'user_not_found', 404);
    }
    if (target.isRoot && !actor.isRoot) {
      throw new AppError('Somente o root redefine a senha do root', 'forbidden', 403);
    }
    if (target.role === 'admin' && !actor.isRoot && !target.isRoot) {
      throw new AppError('Somente o root redefine senha de administradores', 'forbidden', 403);
    }
    const passwordHash = await hashPassword(body.password);
    deps.db.transaction((tx) => {
      tx.update(users).set({ passwordHash, updatedAt: Date.now() }).where(eq(users.id, target.id)).run();
      revokeUserSessions(tx, target.id);
      audit(tx, { userId: actor.id, action: 'user.reset_password', targetType: 'user', targetId: target.id, ip: request.ip });
    });
    return reply.code(204).send();
  });
}
