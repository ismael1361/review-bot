import type { FastifyInstance } from 'fastify';
import type { AppDeps } from '../app';
import { requireRole } from '../../auth/guards';

export function registerEventRoutes(app: FastifyInstance, deps: AppDeps): void {
  app.get('/api/events', { preHandler: requireRole(deps, 'viewer', 'operator', 'admin') }, async (request, reply) => {
    reply.hijack();
    reply.raw.writeHead(200, {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache',
      connection: 'keep-alive',
    });
    reply.raw.write(': connected\n\n');
    const unsubscribe = deps.bus.subscribe((event) => {
      reply.raw.write(`event: ${event.type}\ndata: ${JSON.stringify(event.data)}\n\n`);
    });
    const heartbeat = setInterval(() => reply.raw.write(': ping\n\n'), 25000);
    request.raw.on('close', () => {
      clearInterval(heartbeat);
      unsubscribe();
    });
  });
}
