// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { Setup } from '../../src/web/pages/Setup';

describe('Setup', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('mostra erro quando as senhas não coincidem', async () => {
    render(<MemoryRouter><Setup /></MemoryRouter>);
    await userEvent.type(screen.getByLabelText('Senha'), 'senha-muito-longa');
    await userEvent.type(screen.getByLabelText('Confirmação da senha'), 'outra-senha-longa');
    await userEvent.click(screen.getByRole('button', { name: 'Criar root' }));
    expect(await screen.findByText('As senhas não coincidem.')).toBeInTheDocument();
  });

  it('envia o setup quando os dados são válidos', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ userId: '1' }), { status: 201 }));
    vi.stubGlobal('fetch', fetchMock);
    render(<MemoryRouter><Setup /></MemoryRouter>);
    await userEvent.type(screen.getByLabelText('Token de setup'), 'token-de-setup-de-teste-123456');
    await userEvent.type(screen.getByLabelText('Usuário root'), 'root');
    await userEvent.type(screen.getByLabelText('Senha'), 'senha-muito-longa');
    await userEvent.type(screen.getByLabelText('Confirmação da senha'), 'senha-muito-longa');
    await userEvent.click(screen.getByRole('button', { name: 'Criar root' }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/setup', expect.objectContaining({ method: 'POST' })));
  });
});
