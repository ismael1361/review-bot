import { Navigate, NavLink, Route, Routes } from 'react-router-dom';
import { Card } from '../../components/ui';
import { useMe } from '../../components/ProtectedRoute';
import { Audit } from './Audit';
import { GithubSettings } from './Github';
import { Profiles } from './Profiles';
import { Skills } from './Skills';
import { Users } from './Users';
import { Webhooks } from './Webhooks';
import { SystemSettings } from './System';

const tabs = [
  { to: 'github', label: 'GitHub' },
  { to: 'ia', label: 'IA' },
  { to: 'skills', label: 'Skills' },
  { to: 'usuarios', label: 'Usuários' },
  { to: 'webhooks', label: 'Webhooks' },
  { to: 'sistema', label: 'Sistema' },
  { to: 'auditoria', label: 'Auditoria' },
];

export function SettingsLayout() {
  const me = useMe();

  if (me.isLoading) {
    return <p className="p-8 text-sm text-[var(--text-muted)]">Carregando…</p>;
  }

  if (!me.data || me.data.role !== 'admin') {
    return (
      <div className="space-y-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-[var(--text)]">Acesso restrito</h1>
          <p className="mt-1 text-sm text-[var(--text-muted)]">Apenas administradores podem acessar as definições.</p>
        </div>
        <Card>
          <p className="text-sm text-[var(--text-muted)]">Solicite a um administrador a alteração de permissões do seu usuário.</p>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-[var(--text)]">Definições</h1>
        <p className="mt-1 text-sm text-[var(--text-muted)]">Credenciais, perfis e integrações</p>
      </div>
      <nav className="flex flex-wrap gap-1 border-b border-[var(--border)] text-sm">
        {tabs.map((tab) => (
          <NavLink
            key={tab.to}
            to={`/settings/${tab.to}`}
            className={({ isActive }) =>
              isActive
                ? '-mb-px border-b-2 border-[var(--primary)] px-3 py-2 font-semibold text-[var(--text)]'
                : '-mb-px border-b-2 border-transparent px-3 py-2 text-[var(--text-muted)] transition hover:text-[var(--text)]'
            }
          >
            {tab.label}
          </NavLink>
        ))}
      </nav>
      <Routes>
        <Route index element={<Navigate to="/settings/github" replace />} />
        <Route path="github" element={<GithubSettings />} />
        <Route path="ia" element={<Profiles />} />
        <Route path="skills" element={<Skills />} />
        <Route path="usuarios" element={<Users />} />
        <Route path="webhooks" element={<Webhooks />} />
        <Route path="sistema" element={<SystemSettings />} />
        <Route path="auditoria" element={<Audit />} />
      </Routes>
    </div>
  );
}
