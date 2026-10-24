import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { api } from '../api';
import { useMe } from './ProtectedRoute';

const links = [
  { to: '/', label: 'Dashboard' },
  { to: '/reviews', label: 'Reviews' },
  { to: '/queue', label: 'Fila' },
  { to: '/settings', label: 'Definições' },
  { to: '/password', label: 'Senha' },
];

export function Layout() {
  const me = useMe();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const visibleLinks = links.filter((link) => link.to !== '/settings' || me.data?.role === 'admin');

  async function logout() {
    await api('/api/auth/logout', { method: 'POST' });
    queryClient.clear();
    navigate('/login');
  }

  return (
    <div className="min-h-screen bg-[var(--bg)] text-[var(--text)]">
      <header className="border-b border-[var(--border)] bg-[var(--surface)]">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-3">
          <div className="flex items-center gap-6">
            <span className="text-sm font-semibold tracking-tight text-[var(--text)]">review-bot</span>
            <nav className="flex gap-4 text-sm">
              {visibleLinks.map((link) => (
                <NavLink
                  key={link.to}
                  to={link.to}
                  end={link.to === '/'}
                  className={({ isActive }) =>
                    isActive ? 'font-semibold text-[var(--text)]' : 'text-[var(--text-muted)] transition hover:text-[var(--text)]'
                  }
                >
                  {link.label}
                </NavLink>
              ))}
            </nav>
          </div>
          <div className="flex items-center gap-3 text-sm text-[var(--text-muted)]">
            <span>
              {me.data?.username}
              {me.data ? ` · ${me.data.role}` : ''}
            </span>
            <button
              type="button"
              onClick={logout}
              className="rounded-lg border border-[var(--border-strong)] px-2.5 py-1 text-[var(--text)] transition hover:border-[var(--text-muted)]"
            >
              Sair
            </button>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-8">
        <Outlet />
      </main>
    </div>
  );
}
