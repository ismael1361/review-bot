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
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <header className="border-b border-slate-800 bg-slate-900">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-3">
          <div className="flex items-center gap-6">
            <span className="text-sm font-semibold tracking-tight text-slate-100">review-bot</span>
            <nav className="flex gap-4 text-sm">
              {visibleLinks.map((link) => (
                <NavLink
                  key={link.to}
                  to={link.to}
                  end={link.to === '/'}
                  className={({ isActive }) =>
                    isActive ? 'font-semibold text-slate-100' : 'text-slate-400 transition hover:text-slate-200'
                  }
                >
                  {link.label}
                </NavLink>
              ))}
            </nav>
          </div>
          <div className="flex items-center gap-3 text-sm text-slate-400">
            <span>
              {me.data?.username}
              {me.data ? ` · ${me.data.role}` : ''}
            </span>
            <button
              type="button"
              onClick={logout}
              className="rounded-lg border border-slate-700 px-2.5 py-1 text-slate-300 transition hover:border-slate-500 hover:text-slate-100"
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
