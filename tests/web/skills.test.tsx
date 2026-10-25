// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Skills } from '../../src/web/pages/settings/Skills';

const skill = { id: 's1', name: 'Skill Um', description: 'Descrição', contentMd: 'Conteúdo da skill' };

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status });
}

function renderSkills() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <Skills />
    </QueryClientProvider>,
  );
}

describe('Skills', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('exclui a skill após confirmação e remove a linha', async () => {
    let removed = false;
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString();
      const method = init?.method ?? 'GET';
      if (url === '/api/skills' && method === 'GET') {
        return json({ skills: removed ? [] : [skill] });
      }
      if (url === '/api/skills/s1' && method === 'DELETE') {
        removed = true;
        return new Response(null, { status: 204 });
      }
      return json({ error: { code: 'not_found', message: 'Rota não encontrada' } }, 404);
    });
    vi.stubGlobal('fetch', fetchMock);
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
    renderSkills();

    expect(await screen.findByRole('heading', { name: 'Skills' })).toBeInTheDocument();
    await screen.findByText('Conteúdo da skill');
    await userEvent.click(screen.getByRole('button', { name: 'Excluir' }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith('/api/skills/s1', expect.objectContaining({ method: 'DELETE' }));
    });
    expect(confirm).toHaveBeenCalled();
    await waitFor(() => expect(screen.queryByText('Skill Um')).not.toBeInTheDocument());
    expect(screen.getByText('Nenhuma skill ainda.')).toBeInTheDocument();
  });

  it('edita uma skill existente e envia PUT', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString();
      const method = init?.method ?? 'GET';
      if (url === '/api/skills' && method === 'GET') {
        return json({ skills: [skill] });
      }
      if (url === '/api/skills/s1' && method === 'PUT') {
        return json({ skill: { ...skill, contentMd: 'Novo conteúdo' } });
      }
      return json({ error: { code: 'not_found', message: 'Rota não encontrada' } }, 404);
    });
    vi.stubGlobal('fetch', fetchMock);
    renderSkills();

    await screen.findByText('Conteúdo da skill');
    await userEvent.click(screen.getByRole('button', { name: 'Editar' }));
    const content = screen.getByLabelText('Conteúdo (Markdown)');
    expect(content).toHaveValue('Conteúdo da skill');
    await userEvent.clear(content);
    await userEvent.type(content, 'Novo conteúdo');
    await userEvent.click(screen.getByRole('button', { name: 'Salvar skill' }));

    await waitFor(() => {
      const call = fetchMock.mock.calls.find(
        ([input, init]) => String(input) === '/api/skills/s1' && (init as RequestInit | undefined)?.method === 'PUT',
      );
      expect(call).toBeDefined();
      const body = JSON.parse(String((call?.[1] as RequestInit).body));
      expect(body).toEqual({ name: 'Skill Um', description: 'Descrição', contentMd: 'Novo conteúdo' });
    });
  });
});
