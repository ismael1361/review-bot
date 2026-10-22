import cookie from '@fastify/cookie';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { AppDeps } from '../app';
import { AppError } from '../errors';

const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

export function isAllowedOrigin(origin: string, host: string | undefined, publicUrl: string | undefined): boolean {
  let expected: string;
  if (publicUrl) {
    expected = new URL(publicUrl).origin;
  } else if (host) {
    expected = `http://${host}`;
  } else {
    return false;
  }
  return origin === expected;
}

export async function registerSecurityPlugin(app: FastifyInstance, deps: AppDeps): Promise<void> {
  await app.register(cookie);
  await app.register(helmet, {
    contentSecurityPolicy: deps.config.isProduction
      ? {
          directives: {
            defaultSrc: ["'self'"],
            scriptSrc: ["'self'"],
            styleSrc: ["'self'", "'unsafe-inline'"],
            imgSrc: ["'self'", 'data:'],
            connectSrc: ["'self'"],
            frameAncestors: ["'none'"],
            baseUri: ["'self'"],
          },
        }
      : false,
  });
  await app.register(rateLimit, { global: false });

  app.addHook('onRequest', async (request: FastifyRequest) => {
    if (!MUTATING.has(request.method)) {
      return;
    }
    const origin = request.headers.origin;
    if (origin && !isAllowedOrigin(origin, request.headers.host, deps.config.PUBLIC_URL)) {
      throw new AppError('Origem não permitida', 'invalid_origin', 403);
    }
  });
}
