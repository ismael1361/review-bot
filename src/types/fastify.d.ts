import type { PublicUser } from '../auth/sessions';

declare module 'fastify' {
  interface FastifyRequest {
    user?: PublicUser;
    sessionToken?: string;
  }
}
