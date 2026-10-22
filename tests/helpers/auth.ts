import type { FastifyInstance } from 'fastify';
import type { AppDeps } from '../../src/api/app';

export const SETUP_TOKEN = 'token-de-setup-de-teste-123456';
export const ROOT_PASSWORD = 'senha-muito-segura';

export async function setupRootAndLogin(app: FastifyInstance, _deps: AppDeps): Promise<string> {
  const setup = await app.inject({
    method: 'POST',
    url: '/api/setup',
    payload: { token: SETUP_TOKEN, username: 'root', password: ROOT_PASSWORD },
  });
  if (setup.statusCode !== 201) {
    throw new Error(`setup falhou: ${setup.body}`);
  }
  const login = await app.inject({
    method: 'POST',
    url: '/api/auth/login',
    payload: { username: 'root', password: ROOT_PASSWORD },
  });
  if (login.statusCode !== 200) {
    throw new Error(`login falhou: ${login.body}`);
  }
  const cookie = login.cookies.find((item) => item.name === 'prr_session');
  if (!cookie) {
    throw new Error('cookie de sessão ausente');
  }
  return `prr_session=${cookie.value}`;
}
