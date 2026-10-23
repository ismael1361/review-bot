import type { FastifyInstance } from 'fastify';
import type { AppDeps } from '../app';
import { requireRole } from '../../auth/guards';
import { resolveSession, SESSION_COOKIE } from '../../auth/sessions';
import { AppError } from '../errors';

const MAX_ACTIVE_CONNECTIONS = 50;

export function registerEventRoutes(app: FastifyInstance, deps: AppDeps): void {
  let activeConnections = 0;
  app.get('/api/events', { preHandler: requireRole(deps, 'viewer', 'operator', 'admin') }, async (request, reply) => {
    if (activeConnections >= MAX_ACTIVE_CONNECTIONS) {
      throw new AppError('Limite de conexões SSE', 'too_many_streams', 503);
    }
    activeConnections += 1;
    let closed = false;
    let heartbeat: ReturnType<typeof setInterval> | undefined;
    let unsubscribe: (() => void) | undefined;

    const cleanup = () => {
      if (closed) {
        return;
      }
      closed = true;
      if (heartbeat !== undefined) {
        clearInterval(heartbeat);
        heartbeat = undefined;
      }
      unsubscribe?.();
      unsubscribe = undefined;
      activeConnections -= 1;
    };

    const sessionIsValid = () => {
      const token = request.cookies[SESSION_COOKIE];
      return token !== undefined && resolveSession(deps.db, token) !== undefined;
    };

    const endStream = () => {
      if (closed) {
        return;
      }
      cleanup();
      reply.raw.end();
    };

    const failStream = (error: unknown) => {
      deps.logger.warn({ err: error }, 'falha no stream SSE');
      cleanup();
      reply.raw.end();
    };

    const write = (chunk: string) => {
      if (closed) {
        return;
      }
      if (!sessionIsValid()) {
        endStream();
        return;
      }
      reply.raw.write(chunk);
    };

    request.raw.on('close', cleanup);
    reply.raw.on('error', cleanup);
    reply.raw.on('close', cleanup);
    try {
      reply.hijack();
      reply.raw.writeHead(200, {
        'content-type': 'text/event-stream',
        'cache-control': 'no-cache',
        connection: 'keep-alive',
      });
      reply.raw.write(': connected\n\n');
      unsubscribe = deps.bus.subscribe((event) => {
        try {
          write(`event: ${event.type}\ndata: ${JSON.stringify(event.data)}\n\n`);
        } catch (error) {
          failStream(error);
        }
      });
      heartbeat = setInterval(() => {
        try {
          write(': ping\n\n');
        } catch (error) {
          failStream(error);
        }
      }, 25000);
    } catch (error) {
      failStream(error);
    }
  });
}
