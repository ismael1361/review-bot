// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Profiles } from '../../src/web/pages/settings/Profiles';

const profile = {
  id: 'p1',
  name: 'Principal',
  provider: 'openai_compatible',
  baseUrl: 'https://api.exemplo.com/v1',
  model: 'modelo-antigo',
  temperature: 0.2,
  maxOutputTokens: 4096,
  maxTurns: 20,
  maxTotalTokens: 200000,
  maxDurationSec: 600,
  maxFindings: 25,
  maxGithubCalls: 80,
  prePrompt: '',
  isActive: false,
  hasApiKey: true,
  skillIds: ['s2', 's1'],
};

const skills = [
  { id: 's1', name: 'Skill Um', description: 'Primeira', contentMd: 'Conteúdo um' },
  { id: 's2', name: 'Skill Dois', description: 'Segunda', contentMd: 'Conteúdo dois' },
];

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status });
}

function renderProfiles() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <Profiles />
    </QueryClientProvider>,
  );
}

describe('Profiles', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('edita perfil e envia PUT com os campos e a ordem das skills', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString();
      const method = init?.method ?? 'GET';
      if (url === '/api/ai-profiles' && method === 'GET') {
        return json({ profiles: [profile] });
      }
      if (url === '/api/skills' && method === 'GET') {
        return json({ skills });
      }
      if (url === '/api/ai-profiles/p1' && method === 'PUT') {
        return json({ profile: { ...profile, model: 'modelo-novo' } });
      }
      return json({ error: { code: 'not_found', message: 'Rota não encontrada' } }, 404);
    });
    vi.stubGlobal('fetch', fetchMock);
    renderProfiles();

    await userEvent.click(await screen.findByRole('button', { name: 'Editar' }));
    const model = screen.getByLabelText('Modelo');
    expect(model).toHaveValue('modelo-antigo');
    await screen.findByRole('checkbox', { name: 'Skill Dois' });

    await userEvent.clear(model);
    await userEvent.type(model, 'modelo-novo');
    await userEvent.click(screen.getByRole('button', { name: 'Salvar perfil' }));

    await waitFor(() => {
      const call = fetchMock.mock.calls.find(
        ([input, init]) => String(input) === '/api/ai-profiles/p1' && (init as RequestInit | undefined)?.method === 'PUT',
      );
      expect(call).toBeDefined();
    });
    const updateCall = fetchMock.mock.calls.find(
      ([input, init]) => String(input) === '/api/ai-profiles/p1' && (init as RequestInit | undefined)?.method === 'PUT',
    );
    const body = JSON.parse(String((updateCall?.[1] as RequestInit).body));
    expect(body).toMatchObject({
      name: 'Principal',
      provider: 'openai_compatible',
      baseUrl: 'https://api.exemplo.com/v1',
      model: 'modelo-novo',
      temperature: 0.2,
      maxOutputTokens: 4096,
      maxTurns: 20,
      maxTotalTokens: 200000,
      maxDurationSec: 600,
      maxFindings: 25,
      maxGithubCalls: 80,
      prePrompt: '',
      skillIds: ['s2', 's1'],
    });
    expect(body.apiKey).toBeUndefined();
  });

  it('reordena as skills selecionadas ao usar os botões de subir e descer', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString();
      const method = init?.method ?? 'GET';
      if (url === '/api/ai-profiles' && method === 'GET') {
        return json({ profiles: [profile] });
      }
      if (url === '/api/skills' && method === 'GET') {
        return json({ skills });
      }
      if (url === '/api/ai-profiles/p1' && method === 'PUT') {
        return json({ profile });
      }
      return json({ error: { code: 'not_found', message: 'Rota não encontrada' } }, 404);
    });
    vi.stubGlobal('fetch', fetchMock);
    renderProfiles();

    await userEvent.click(await screen.findByRole('button', { name: 'Editar' }));
    await screen.findByRole('checkbox', { name: 'Skill Dois' });
    await userEvent.click(screen.getByRole('button', { name: 'Mover Skill Um para cima' }));
    await userEvent.click(screen.getByRole('button', { name: 'Salvar perfil' }));

    await waitFor(() => {
      const call = fetchMock.mock.calls.find(
        ([input, init]) => String(input) === '/api/ai-profiles/p1' && (init as RequestInit | undefined)?.method === 'PUT',
      );
      const body = JSON.parse(String((call?.[1] as RequestInit).body));
      expect(body.skillIds).toEqual(['s1', 's2']);
    });
  });
});
