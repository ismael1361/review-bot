import cookie from "@fastify/cookie";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import type { FastifyInstance, FastifyRequest } from "fastify";
import type { AppDeps } from "../app";
import { AppError } from "../errors";
import { createRateLimiter } from "../../auth/rate-limit";
import { hashToken } from "../../auth/crypto";
import { SESSION_COOKIE } from "../../auth/sessions";

const MUTATING = new Set(["POST", "PUT", "PATCH", "DELETE"]);
const RATE_LIMIT_SKIP = new Set(["/api/auth/login", "/api/setup"]);

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
            imgSrc: ["'self'", "data:"],
            connectSrc: ["'self'"],
            frameAncestors: ["'none'"],
            baseUri: ["'self'"],
          },
        }
      : false,
  });
  await app.register(rateLimit, { global: false });

  const sessionLimiter = createRateLimiter({ max: 120, windowMs: 60_000 });

  app.addHook("onRequest", async (request: FastifyRequest): Promise<void> => {
    if (!MUTATING.has(request.method)) {
      return;
    }
    const origin = request.headers.origin;
    if (origin) {
      if (!isAllowedOrigin(origin, request.headers.host, deps.config.PUBLIC_URL)) {
        throw new AppError("Origem não permitida", "invalid_origin", 403);
      }
      return;
    }
    const referer = request.headers.referer;
    if (!referer) {
      return;
    }
    let refererOrigin: string;
    try {
      refererOrigin = new URL(referer).origin;
    } catch {
      throw new AppError("Origem não permitida", "invalid_origin", 403);
    }
    if (!isAllowedOrigin(refererOrigin, request.headers.host, deps.config.PUBLIC_URL)) {
      throw new AppError("Origem não permitida", "invalid_origin", 403);
    }
  });

  app.addHook("onRequest", async (request: FastifyRequest): Promise<void> => {
    const path = request.url.split("?")[0] ?? request.url;
    if (!path.startsWith("/api/") || RATE_LIMIT_SKIP.has(path)) {
      return;
    }
    const token = request.cookies[SESSION_COOKIE];
    if (!token) {
      return;
    }
    if (!sessionLimiter.check(hashToken(token))) {
      throw new AppError("Muitas requisições", "rate_limited", 429);
    }
  });
}
