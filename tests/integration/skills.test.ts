import { describe, expect, it } from 'vitest';
import { createTestApp } from '../helpers/app';
import { setupRootAndLogin } from '../helpers/auth';

const skillBody = { name: 'security-audit', description: 'Foco em segurança', contentMd: 'Verifique injeção, autorização e segredos.' };

describe('skills', () => {
  it('cria, edita, lista e remove', async () => {
    const { app, deps } = await createTestApp();
    const cookie = await setupRootAndLogin(app, deps);
    const created = await app.inject({ method: 'POST', url: '/api/skills', headers: { cookie }, payload: skillBody });
    expect(created.statusCode).toBe(201);
    const id = created.json().skill.id;
    const updated = await app.inject({ method: 'PUT', url: `/api/skills/${id}`, headers: { cookie }, payload: { ...skillBody, contentMd: 'Outro conteúdo.' } });
    expect(updated.json().skill.contentMd).toBe('Outro conteúdo.');
    const list = await app.inject({ method: 'GET', url: '/api/skills', headers: { cookie } });
    expect(list.json().skills).toHaveLength(1);
    const removed = await app.inject({ method: 'DELETE', url: `/api/skills/${id}`, headers: { cookie } });
    expect(removed.statusCode).toBe(204);
    await app.close();
  });

  it('rejeita nome duplicado', async () => {
    const { app, deps } = await createTestApp();
    const cookie = await setupRootAndLogin(app, deps);
    await app.inject({ method: 'POST', url: '/api/skills', headers: { cookie }, payload: skillBody });
    const duplicate = await app.inject({ method: 'POST', url: '/api/skills', headers: { cookie }, payload: skillBody });
    expect(duplicate.statusCode).toBe(409);
    await app.close();
  });

  it('associa skills a um perfil na ordem enviada', async () => {
    const { app, deps } = await createTestApp();
    const cookie = await setupRootAndLogin(app, deps);
    const first = await app.inject({ method: 'POST', url: '/api/skills', headers: { cookie }, payload: { ...skillBody, name: 's1' } });
    const second = await app.inject({ method: 'POST', url: '/api/skills', headers: { cookie }, payload: { ...skillBody, name: 's2' } });
    const profile = await app.inject({
      method: 'POST',
      url: '/api/ai-profiles',
      headers: { cookie },
      payload: {
        name: 'p1',
        provider: 'openai_compatible',
        baseUrl: 'https://provedor.exemplo.com/v1',
        model: 'm',
        apiKey: 'k',
        skillIds: [second.json().skill.id, first.json().skill.id],
      },
    });
    expect(profile.json().profile.skillIds).toEqual([second.json().skill.id, first.json().skill.id]);
    await app.close();
  });

  it('rejeita skill inexistente no perfil', async () => {
    const { app, deps } = await createTestApp();
    const cookie = await setupRootAndLogin(app, deps);
    const response = await app.inject({
      method: 'POST',
      url: '/api/ai-profiles',
      headers: { cookie },
      payload: { name: 'p1', provider: 'openai_compatible', baseUrl: 'https://provedor.exemplo.com/v1', model: 'm', apiKey: 'k', skillIds: ['inexistente'] },
    });
    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe('skill_not_found');
    await app.close();
  });
});
