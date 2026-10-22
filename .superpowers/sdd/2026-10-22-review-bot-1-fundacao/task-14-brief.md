### Task 14: SPA React do painel

**Files:**
- Create: `index.html` movido para `src/web/index.html`, `vite.config.ts`, `src/web/main.tsx`, `src/web/app.tsx`, `src/web/api.ts`, `src/web/index.css`, `src/web/components/Layout.tsx`, `src/web/components/ProtectedRoute.tsx`, `src/web/components/ui.tsx`
- Create: `src/web/pages/Setup.tsx`, `Login.tsx`, `Dashboard.tsx`, `Reviews.tsx`, `Queue.tsx`
- Create: `src/web/pages/settings/Github.tsx`, `Profiles.tsx`, `Skills.tsx`, `Users.tsx`, `Webhooks.tsx`, `System.tsx`, `index.tsx`
- Modify: `src/api/app.ts` (servir estáticos com fallback de SPA)
- Test: `tests/web/setup.test.tsx`, `tests/web/login.test.tsx`

**Interfaces:**
- Consumes: todas as rotas REST anteriores.
- Produces: SPA compilada em `dist/web`; helper `api<T>(path, options)`.

- [ ] **Step 1: Criar `vite.config.ts`, `src/web/index.html`, `src/web/index.css`, `src/web/main.tsx`**

`vite.config.ts`:

```ts
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  root: 'src/web',
  plugins: [react(), tailwindcss()],
  build: { outDir: '../../dist/web', emptyOutDir: true },
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:3000',
      '/healthz': 'http://localhost:3000',
    },
  },
});
```

`src/web/index.html`:

```html
<!doctype html>
<html lang="pt-BR">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>review-bot</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/main.tsx"></script>
  </body>
</html>
```

`src/web/index.css`:

```css
@import "tailwindcss";

body {
  background-color: #020617;
  color: #e2e8f0;
}
```

`src/web/main.tsx`:

```tsx
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter } from 'react-router-dom';
import { App } from './app';
import './index.css';

const queryClient = new QueryClient({ defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false } } });

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
);
```

- [ ] **Step 2: Criar `src/web/api.ts` e `src/web/components/ui.tsx`**

Aplicar os tokens escuros da seção "Design tokens": os trechos abaixo mostram a estrutura com classes claras; substituir por `bg-slate-900` (cards), `border-slate-800`, `text-slate-100`/`text-slate-400`, `bg-slate-800` (inputs), `bg-slate-200 text-slate-900` (botão primário). O visual final deve seguir os mockups escuros.

`src/web/api.ts`:

```ts
export class ApiRequestError extends Error {
  constructor(message: string, readonly code: string, readonly status: number) {
    super(message);
  }
}

export async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(path, {
    credentials: 'same-origin',
    headers: { 'content-type': 'application/json', ...(options.headers ?? {}) },
    ...options,
  });
  if (response.status === 204) {
    return undefined as T;
  }
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new ApiRequestError(data?.error?.message ?? 'Erro inesperado', data?.error?.code ?? 'unknown', response.status);
  }
  return data as T;
}
```

`src/web/components/ui.tsx`:

```tsx
import type { ReactNode } from 'react';

export function Card({ title, children }: { title?: string; children: ReactNode }) {
  return (
    <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
      {title ? <h2 className="mb-3 text-sm font-semibold text-slate-700">{title}</h2> : null}
      {children}
    </section>
  );
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="mb-3 block text-sm">
      <span className="mb-1 block font-medium text-slate-700">{label}</span>
      {children}
    </label>
  );
}

export function Input(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className="w-full rounded border border-slate-300 px-3 py-2 text-sm focus:border-slate-500 focus:outline-none" />;
}

export function Button({ children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button {...props} className="rounded bg-slate-900 px-3 py-2 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-50">
      {children}
    </button>
  );
}

export function ErrorText({ children }: { children: ReactNode }) {
  return children ? <p className="mb-3 text-sm text-red-600">{children}</p> : null;
}

export function EmptyState({ children }: { children: ReactNode }) {
  return <p className="py-8 text-center text-sm text-slate-500">{children}</p>;
}
```

- [ ] **Step 3: Criar `src/web/components/ProtectedRoute.tsx`, `src/web/components/Layout.tsx` e `src/web/app.tsx`**

`src/web/components/ProtectedRoute.tsx`:

```tsx
import { useQuery } from '@tanstack/react-query';
import { Navigate, Outlet } from 'react-router-dom';
import { api } from '../api';

export type Me = { id: string; username: string; role: 'admin' | 'operator' | 'viewer'; isRoot: boolean };

export function useMe() {
  return useQuery({
    queryKey: ['me'],
    queryFn: async () => (await api<{ user: Me }>('/api/auth/me')).user,
    retry: false,
  });
}

export function ProtectedRoute() {
  const me = useMe();
  if (me.isLoading) {
    return <p className="p-8 text-sm text-slate-500">Carregando…</p>;
  }
  if (me.isError || !me.data) {
    return <Navigate to="/login" replace />;
  }
  return <Outlet context={{ user: me.data }} />;
}
```

`src/web/components/Layout.tsx`:

```tsx
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { api } from '../api';
import { useMe } from './ProtectedRoute';

const links = [
  { to: '/', label: 'Dashboard' },
  { to: '/reviews', label: 'Reviews' },
  { to: '/queue', label: 'Fila' },
  { to: '/settings', label: 'Definições' },
];

export function Layout() {
  const me = useMe();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  async function logout() {
    await api('/api/auth/logout', { method: 'POST' });
    queryClient.clear();
    navigate('/login');
  }

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-3">
          <nav className="flex gap-4 text-sm">
            {links.map((link) => (
              <NavLink key={link.to} to={link.to} className={({ isActive }) => (isActive ? 'font-semibold' : 'text-slate-600')} end={link.to === '/'}>
                {link.label}
              </NavLink>
            ))}
          </nav>
          <div className="flex items-center gap-3 text-sm text-slate-600">
            <span>{me.data?.username}</span>
            <button type="button" onClick={logout} className="text-slate-500 underline">
              Sair
            </button>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-5xl px-4 py-6">
        <Outlet />
      </main>
    </div>
  );
}
```

`src/web/app.tsx`:

```tsx
import { useQuery } from '@tanstack/react-query';
import { Navigate, Route, Routes } from 'react-router-dom';
import { api } from './api';
import { Layout } from './components/Layout';
import { ProtectedRoute } from './components/ProtectedRoute';
import { Login } from './pages/Login';
import { Setup } from './pages/Setup';
import { Dashboard } from './pages/Dashboard';
import { Reviews } from './pages/Reviews';
import { Queue } from './pages/Queue';
import { SettingsLayout } from './pages/settings';

function SetupGate() {
  const status = useQuery({ queryKey: ['setup-status'], queryFn: () => api<{ needsSetup: boolean }>('/api/setup/status'), retry: false });
  if (status.isLoading) {
    return <p className="p-8 text-sm text-slate-500">Carregando…</p>;
  }
  if (status.data?.needsSetup) {
    return <Navigate to="/setup" replace />;
  }
  return <ProtectedRoute />;
}

export function App() {
  return (
    <Routes>
      <Route path="/setup" element={<Setup />} />
      <Route path="/login" element={<Login />} />
      <Route element={<SetupGate />}>
        <Route element={<Layout />}>
          <Route index element={<Dashboard />} />
          <Route path="/reviews" element={<Reviews />} />
          <Route path="/queue" element={<Queue />} />
          <Route path="/settings/*" element={<SettingsLayout />} />
        </Route>
      </Route>
    </Routes>
  );
}
```

- [ ] **Step 4: Criar as páginas principais**

`src/web/pages/Setup.tsx`:

```tsx
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, ApiRequestError } from '../api';
import { Button, Card, ErrorText, Field, Input } from '../components/ui';

export function Setup() {
  const [token, setToken] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const navigate = useNavigate();

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError('');
    if (password.length < 12) {
      setError('A senha deve ter ao menos 12 caracteres.');
      return;
    }
    if (password !== confirm) {
      setError('As senhas não coincidem.');
      return;
    }
    try {
      await api('/api/setup', { method: 'POST', body: JSON.stringify({ token, username, password }) });
      navigate('/');
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : 'Falha ao concluir o setup.');
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 p-4">
      <form onSubmit={submit} className="w-full max-w-sm">
        <Card title="Configuração inicial">
          <p className="mb-4 text-sm text-slate-600">
            Use o token exibido no log do container para criar o usuário root.
          </p>
          <ErrorText>{error}</ErrorText>
          <Field label="Token de setup">
            <Input value={token} onChange={(event) => setToken(event.target.value)} autoFocus />
          </Field>
          <Field label="Usuário root">
            <Input value={username} onChange={(event) => setUsername(event.target.value)} />
          </Field>
          <Field label="Senha">
            <Input type="password" value={password} onChange={(event) => setPassword(event.target.value)} />
          </Field>
          <Field label="Confirmação da senha">
            <Input type="password" value={confirm} onChange={(event) => setConfirm(event.target.value)} />
          </Field>
          <Button type="submit">Criar root</Button>
        </Card>
      </form>
    </div>
  );
}
```

`src/web/pages/Login.tsx`:

```tsx
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { api, ApiRequestError } from '../api';
import { Button, Card, ErrorText, Field, Input } from '../components/ui';

export function Login() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError('');
    try {
      await api('/api/auth/login', { method: 'POST', body: JSON.stringify({ username, password }) });
      await queryClient.invalidateQueries();
      navigate('/');
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : 'Falha ao entrar.');
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 p-4">
      <form onSubmit={submit} className="w-full max-w-sm">
        <Card title="Entrar">
          <ErrorText>{error}</ErrorText>
          <Field label="Usuário">
            <Input value={username} onChange={(event) => setUsername(event.target.value)} autoFocus />
          </Field>
          <Field label="Senha">
            <Input type="password" value={password} onChange={(event) => setPassword(event.target.value)} />
          </Field>
          <Button type="submit">Entrar</Button>
        </Card>
      </form>
    </div>
  );
}
```

`src/web/pages/Dashboard.tsx`:

```tsx
import { useQuery } from '@tanstack/react-query';
import { api } from '../api';
import { Card } from '../components/ui';

type DashboardData = { queue: { queued: number; running: number }; reviews: { total: number; last24h: number }; failures: number };

export function Dashboard() {
  const dashboard = useQuery({ queryKey: ['dashboard'], queryFn: () => api<DashboardData>('/api/dashboard') });
  const data = dashboard.data;

  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      <Card title="Na fila">
        <p className="text-2xl font-semibold">{data?.queue.queued ?? '—'}</p>
      </Card>
      <Card title="Em execução">
        <p className="text-2xl font-semibold">{data?.queue.running ?? '—'}</p>
      </Card>
      <Card title="Reviews (24 h)">
        <p className="text-2xl font-semibold">{data?.reviews.last24h ?? '—'}</p>
      </Card>
      <Card title="Falhas">
        <p className="text-2xl font-semibold">{data?.failures ?? '—'}</p>
      </Card>
    </div>
  );
}
```

`src/web/pages/Reviews.tsx`:

```tsx
import { useQuery } from '@tanstack/react-query';
import { api } from '../api';
import { Card, EmptyState } from '../components/ui';

type ReviewRow = { id: string; jobId: string; status: string; url: string | null; commentsPosted: number; postedAt: number | null };

export function Reviews() {
  const reviews = useQuery({ queryKey: ['reviews'], queryFn: () => api<{ reviews: ReviewRow[] }>('/api/reviews') });

  return (
    <Card title="Reviews publicadas">
      {reviews.data && reviews.data.reviews.length === 0 ? (
        <EmptyState>Nenhuma review ainda. As reviews aparecerão aqui quando o pipeline estiver ativo.</EmptyState>
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-slate-500">
              <th className="py-2">Status</th>
              <th className="py-2">Comentários</th>
              <th className="py-2">Link</th>
            </tr>
          </thead>
          <tbody>
            {reviews.data?.reviews.map((review) => (
              <tr key={review.id} className="border-t border-slate-100">
                <td className="py-2">{review.status}</td>
                <td className="py-2">{review.commentsPosted}</td>
                <td className="py-2">{review.url ? <a className="underline" href={review.url}>abrir</a> : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Card>
  );
}
```

`src/web/pages/Queue.tsx`:

```tsx
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api';
import { Button, Card, EmptyState } from '../components/ui';

type QueueData = { queued: number; running: number; paused: boolean };
type JobRow = { id: string; prTitle: string; prUrl: string; status: string; runSeq: number; queuedAt: number };

export function Queue() {
  const queryClient = useQueryClient();
  const queue = useQuery({ queryKey: ['queue'], queryFn: () => api<QueueData>('/api/queue') });
  const jobs = useQuery({ queryKey: ['jobs'], queryFn: () => api<{ jobs: JobRow[] }>('/api/jobs') });
  const toggle = useMutation({
    mutationFn: (paused: boolean) => api(paused ? '/api/queue/resume' : '/api/queue/pause', { method: 'POST' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['queue'] }),
  });

  return (
    <div className="space-y-4">
      <Card title="Fila">
        <div className="flex items-center gap-4">
          <p className="text-sm text-slate-600">Na fila: {queue.data?.queued ?? '—'} · Em execução: {queue.data?.running ?? '—'}</p>
          <Button type="button" onClick={() => toggle.mutate(queue.data?.paused ?? false)} disabled={toggle.isPending}>
            {queue.data?.paused ? 'Retomar' : 'Pausar'}
          </Button>
        </div>
      </Card>
      <Card title="Jobs">
        {jobs.data && jobs.data.jobs.length === 0 ? (
          <EmptyState>Nenhum job ainda. Eles aparecerão quando um review for solicitado à conta configurada.</EmptyState>
        ) : (
          <ul className="divide-y divide-slate-100 text-sm">
            {jobs.data?.jobs.map((job) => (
              <li key={job.id} className="flex items-center justify-between py-2">
                <a className="underline" href={job.prUrl}>{job.prTitle}</a>
                <span className="text-slate-500">{job.status} · run {job.runSeq}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
```

- [ ] **Step 5: Criar as páginas de definições**

`src/web/pages/settings/index.tsx`:

```tsx
import { NavLink, Route, Routes } from 'react-router-dom';
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
];

export function SettingsLayout() {
  return (
    <div>
      <nav className="mb-4 flex flex-wrap gap-3 text-sm">
        {tabs.map((tab) => (
          <NavLink key={tab.to} to={tab.to} className={({ isActive }) => (isActive ? 'font-semibold' : 'text-slate-600')}>
            {tab.label}
          </NavLink>
        ))}
      </nav>
      <Routes>
        <Route path="github" element={<GithubSettings />} />
        <Route path="ia" element={<Profiles />} />
        <Route path="skills" element={<Skills />} />
        <Route path="usuarios" element={<Users />} />
        <Route path="webhooks" element={<Webhooks />} />
        <Route path="sistema" element={<SystemSettings />} />
      </Routes>
    </div>
  );
}
```

`src/web/pages/settings/Github.tsx`:

```tsx
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiRequestError } from '../../api';
import { Button, Card, ErrorText, Field, Input } from '../../components/ui';

type GithubInfo = { login: string; patLast4: string; scopes: string } | null;

export function GithubSettings() {
  const queryClient = useQueryClient();
  const [pat, setPat] = useState('');
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const current = useQuery({ queryKey: ['github'], queryFn: () => api<{ credentials: GithubInfo }>('/api/settings/github') });

  const save = useMutation({
    mutationFn: () => api('/api/settings/github', { method: 'PUT', body: JSON.stringify({ pat }) }),
    onSuccess: () => {
      setMessage('Credencial salva.');
      setPat('');
      queryClient.invalidateQueries({ queryKey: ['github'] });
    },
    onError: (err) => setError(err instanceof ApiRequestError ? err.message : 'Falha ao salvar.'),
  });

  return (
    <Card title="Conta GitHub">
      <p className="mb-3 text-sm text-slate-600">
        {current.data?.credentials
          ? `Conectado como ${current.data.credentials.login} (token ••••${current.data.credentials.patLast4})`
          : 'Nenhuma credencial configurada.'}
      </p>
      <ErrorText>{error}</ErrorText>
      {message ? <p className="mb-3 text-sm text-green-700">{message}</p> : null}
      <Field label="Personal Access Token">
        <Input type="password" value={pat} onChange={(event) => setPat(event.target.value)} />
      </Field>
      <Button type="button" onClick={() => { setError(''); setMessage(''); save.mutate(); }} disabled={save.isPending || pat.length < 20}>
        Salvar e testar
      </Button>
    </Card>
  );
}
```

`src/web/pages/settings/Profiles.tsx`:

```tsx
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiRequestError } from '../../api';
import { Button, Card, ErrorText, Field, Input } from '../../components/ui';

type Profile = { id: string; name: string; provider: string; model: string; isActive: boolean; hasApiKey: boolean };

export function Profiles() {
  const queryClient = useQueryClient();
  const profiles = useQuery({ queryKey: ['profiles'], queryFn: () => api<{ profiles: Profile[] }>('/api/ai-profiles') });
  const [form, setForm] = useState({ name: '', provider: 'openai_compatible', baseUrl: 'https://api.openai.com/v1', model: '', apiKey: '' });
  const [error, setError] = useState('');

  const refresh = () => queryClient.invalidateQueries({ queryKey: ['profiles'] });
  const create = useMutation({
    mutationFn: () => api('/api/ai-profiles', { method: 'POST', body: JSON.stringify({ ...form, skillIds: [] }) }),
    onSuccess: () => { setForm({ ...form, name: '', model: '', apiKey: '' }); setError(''); refresh(); },
    onError: (err) => setError(err instanceof ApiRequestError ? err.message : 'Falha ao criar perfil.'),
  });
  const activate = useMutation({ mutationFn: (id: string) => api(`/api/ai-profiles/${id}/activate`, { method: 'POST' }), onSuccess: refresh });
  const test = useMutation({ mutationFn: (id: string) => api(`/api/ai-profiles/${id}/test`, { method: 'POST', body: '{}' }) });

  return (
    <div className="space-y-4">
      <Card title="Perfis de IA">
        <ul className="divide-y divide-slate-100 text-sm">
          {profiles.data?.profiles.map((profile) => (
            <li key={profile.id} className="flex items-center justify-between py-2">
              <span>
                {profile.name} · {profile.provider} · {profile.model} {profile.isActive ? '· ativo' : ''}
              </span>
              <span className="flex gap-2">
                <Button type="button" onClick={() => test.mutate(profile.id)}>Testar</Button>
                {profile.isActive ? null : <Button type="button" onClick={() => activate.mutate(profile.id)}>Ativar</Button>}
              </span>
            </li>
          ))}
          {profiles.data && profiles.data.profiles.length === 0 ? <li className="py-4 text-slate-500">Nenhum perfil ainda.</li> : null}
        </ul>
        {test.isError ? <p className="mt-2 text-sm text-red-600">Falha no teste do provedor.</p> : null}
      </Card>
      <Card title="Novo perfil">
        <ErrorText>{error}</ErrorText>
        <Field label="Nome"><Input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} /></Field>
        <Field label="Provedor">
          <select className="w-full rounded border border-slate-300 px-3 py-2 text-sm" value={form.provider} onChange={(event) => setForm({ ...form, provider: event.target.value })}>
            <option value="openai_compatible">OpenAI-compatible</option>
            <option value="anthropic">Anthropic</option>
          </select>
        </Field>
        <Field label="Base URL"><Input value={form.baseUrl} onChange={(event) => setForm({ ...form, baseUrl: event.target.value })} /></Field>
        <Field label="Modelo"><Input value={form.model} onChange={(event) => setForm({ ...form, model: event.target.value })} /></Field>
        <Field label="Chave de API"><Input type="password" value={form.apiKey} onChange={(event) => setForm({ ...form, apiKey: event.target.value })} /></Field>
        <Button type="button" onClick={() => create.mutate()} disabled={create.isPending}>Criar perfil</Button>
      </Card>
    </div>
  );
}
```

`src/web/pages/settings/Skills.tsx`:

```tsx
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiRequestError } from '../../api';
import { Button, Card, ErrorText, Field, Input } from '../../components/ui';

type Skill = { id: string; name: string; description: string; contentMd: string };

export function Skills() {
  const queryClient = useQueryClient();
  const skills = useQuery({ queryKey: ['skills'], queryFn: () => api<{ skills: Skill[] }>('/api/skills') });
  const [form, setForm] = useState({ name: '', description: '', contentMd: '' });
  const [error, setError] = useState('');

  const create = useMutation({
    mutationFn: () => api('/api/skills', { method: 'POST', body: JSON.stringify(form) }),
    onSuccess: () => { setForm({ name: '', description: '', contentMd: '' }); setError(''); queryClient.invalidateQueries({ queryKey: ['skills'] }); },
    onError: (err) => setError(err instanceof ApiRequestError ? err.message : 'Falha ao criar skill.'),
  });
  const remove = useMutation({
    mutationFn: (id: string) => api(`/api/skills/${id}`, { method: 'DELETE' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['skills'] }),
  });

  return (
    <div className="space-y-4">
      <Card title="Skills">
        <ul className="divide-y divide-slate-100 text-sm">
          {skills.data?.skills.map((skill) => (
            <li key={skill.id} className="flex items-center justify-between py-2">
              <span>{skill.name} · {skill.description || 'sem descrição'}</span>
              <Button type="button" onClick={() => remove.mutate(skill.id)}>Remover</Button>
            </li>
          ))}
          {skills.data && skills.data.skills.length === 0 ? <li className="py-4 text-slate-500">Nenhuma skill ainda.</li> : null}
        </ul>
      </Card>
      <Card title="Nova skill">
        <ErrorText>{error}</ErrorText>
        <Field label="Nome"><Input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} /></Field>
        <Field label="Descrição"><Input value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} /></Field>
        <Field label="Conteúdo (Markdown)">
          <textarea className="h-32 w-full rounded border border-slate-300 px-3 py-2 text-sm" value={form.contentMd} onChange={(event) => setForm({ ...form, contentMd: event.target.value })} />
        </Field>
        <Button type="button" onClick={() => create.mutate()} disabled={create.isPending}>Criar skill</Button>
      </Card>
    </div>
  );
}
```

`src/web/pages/settings/Users.tsx`:

```tsx
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiRequestError } from '../../api';
import { Button, Card, ErrorText, Field, Input } from '../../components/ui';

type UserRow = { id: string; username: string; role: 'admin' | 'operator' | 'viewer'; isRoot: boolean; disabled: boolean };

export function Users() {
  const queryClient = useQueryClient();
  const users = useQuery({ queryKey: ['users'], queryFn: () => api<{ users: UserRow[] }>('/api/users') });
  const [form, setForm] = useState({ username: '', password: '', role: 'viewer' });
  const [error, setError] = useState('');

  const refresh = () => queryClient.invalidateQueries({ queryKey: ['users'] });
  const create = useMutation({
    mutationFn: () => api('/api/users', { method: 'POST', body: JSON.stringify(form) }),
    onSuccess: () => { setForm({ username: '', password: '', role: 'viewer' }); setError(''); refresh(); },
    onError: (err) => setError(err instanceof ApiRequestError ? err.message : 'Falha ao criar usuário.'),
  });
  const patch = useMutation({
    mutationFn: ({ id, disabled }: { id: string; disabled: boolean }) => api(`/api/users/${id}`, { method: 'PATCH', body: JSON.stringify({ disabled }) }),
    onSuccess: refresh,
    onError: (err) => setError(err instanceof ApiRequestError ? err.message : 'Falha ao alterar usuário.'),
  });

  return (
    <div className="space-y-4">
      <Card title="Usuários">
        <ErrorText>{error}</ErrorText>
        <ul className="divide-y divide-slate-100 text-sm">
          {users.data?.users.map((user) => (
            <li key={user.id} className="flex items-center justify-between py-2">
              <span>{user.username} · {user.role} {user.isRoot ? '· root' : ''} {user.disabled ? '· desativado' : ''}</span>
              {user.isRoot ? null : (
                <Button type="button" onClick={() => patch.mutate({ id: user.id, disabled: !user.disabled })}>
                  {user.disabled ? 'Ativar' : 'Desativar'}
                </Button>
              )}
            </li>
          ))}
        </ul>
      </Card>
      <Card title="Novo usuário">
        <Field label="Usuário"><Input value={form.username} onChange={(event) => setForm({ ...form, username: event.target.value })} /></Field>
        <Field label="Senha"><Input type="password" value={form.password} onChange={(event) => setForm({ ...form, password: event.target.value })} /></Field>
        <Field label="Papel">
          <select className="w-full rounded border border-slate-300 px-3 py-2 text-sm" value={form.role} onChange={(event) => setForm({ ...form, role: event.target.value })}>
            <option value="viewer">Viewer</option>
            <option value="operator">Operator</option>
            <option value="admin">Admin</option>
          </select>
        </Field>
        <Button type="button" onClick={() => create.mutate()} disabled={create.isPending}>Criar usuário</Button>
      </Card>
    </div>
  );
}
```

`src/web/pages/settings/Webhooks.tsx`:

```tsx
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiRequestError } from '../../api';
import { Button, Card, ErrorText, Field, Input } from '../../components/ui';

const ALL_EVENTS = ['review.published', 'job.failed', 'job.partial', 'poller.paused'];
type WebhookRow = { id: string; url: string; events: string[]; enabled: boolean };

export function Webhooks() {
  const queryClient = useQueryClient();
  const webhooks = useQuery({ queryKey: ['webhooks'], queryFn: () => api<{ webhooks: WebhookRow[] }>('/api/webhooks') });
  const [url, setUrl] = useState('');
  const [events, setEvents] = useState<string[]>(['review.published', 'job.failed']);
  const [error, setError] = useState('');
  const [secret, setSecret] = useState('');

  const refresh = () => queryClient.invalidateQueries({ queryKey: ['webhooks'] });
  const create = useMutation({
    mutationFn: () => api<{ secret: string }>('/api/webhooks', { method: 'POST', body: JSON.stringify({ url, events }) }),
    onSuccess: (data) => { setSecret(data.secret); setUrl(''); setError(''); refresh(); },
    onError: (err) => setError(err instanceof ApiRequestError ? err.message : 'Falha ao criar webhook.'),
  });
  const test = useMutation({ mutationFn: (id: string) => api<{ ok: boolean }>(`/api/webhooks/${id}/test`, { method: 'POST' }) });

  return (
    <div className="space-y-4">
      <Card title="Webhooks">
        <ErrorText>{error}</ErrorText>
        {secret ? <p className="mb-3 text-sm text-amber-700">Secret gerado (exibido uma única vez): <code>{secret}</code></p> : null}
        <ul className="divide-y divide-slate-100 text-sm">
          {webhooks.data?.webhooks.map((webhook) => (
            <li key={webhook.id} className="flex items-center justify-between py-2">
              <span>{webhook.url} · {webhook.events.join(', ')}</span>
              <Button type="button" onClick={() => test.mutate(webhook.id)}>Testar</Button>
            </li>
          ))}
          {webhooks.data && webhooks.data.webhooks.length === 0 ? <li className="py-4 text-slate-500">Nenhum webhook ainda.</li> : null}
        </ul>
        {test.isSuccess ? <p className="mt-2 text-sm text-green-700">Entrega disparada.</p> : null}
      </Card>
      <Card title="Novo webhook">
        <Field label="URL"><Input value={url} onChange={(event) => setUrl(event.target.value)} /></Field>
        <fieldset className="mb-3 text-sm">
          <legend className="mb-1 font-medium text-slate-700">Eventos</legend>
          {ALL_EVENTS.map((event) => (
            <label key={event} className="mr-3 inline-flex items-center gap-1">
              <input
                type="checkbox"
                checked={events.includes(event)}
                onChange={(changeEvent) => setEvents(changeEvent.target.checked ? [...events, event] : events.filter((item) => item !== event))}
              />
              {event}
            </label>
          ))}
        </fieldset>
        <Button type="button" onClick={() => create.mutate()} disabled={create.isPending || url.length === 0 || events.length === 0}>Criar webhook</Button>
      </Card>
    </div>
  );
}
```

`src/web/pages/settings/System.tsx`:

```tsx
import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiRequestError } from '../../api';
import { Button, Card, ErrorText, Field, Input } from '../../components/ui';

type SystemSettingsData = { pollingIntervalSec: number; retentionDays: number; concurrency: number; ignoreDrafts: boolean; skipOwnPrs: boolean };

export function SystemSettings() {
  const queryClient = useQueryClient();
  const settings = useQuery({ queryKey: ['system'], queryFn: () => api<{ settings: SystemSettingsData }>('/api/settings/system') });
  const [form, setForm] = useState<SystemSettingsData | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    if (settings.data && !form) {
      setForm(settings.data.settings);
    }
  }, [settings.data, form]);

  const save = useMutation({
    mutationFn: () => api('/api/settings/system', { method: 'PUT', body: JSON.stringify(form) }),
    onSuccess: () => { setError(''); queryClient.invalidateQueries({ queryKey: ['system'] }); },
    onError: (err) => setError(err instanceof ApiRequestError ? err.message : 'Falha ao salvar.'),
  });

  if (!form) {
    return <Card title="Sistema">Carregando…</Card>;
  }

  return (
    <Card title="Sistema">
      <ErrorText>{error}</ErrorText>
      <Field label="Intervalo de polling (segundos)">
        <Input type="number" value={form.pollingIntervalSec} onChange={(event) => setForm({ ...form, pollingIntervalSec: Number(event.target.value) })} />
      </Field>
      <Field label="Retenção de logs (dias)">
        <Input type="number" value={form.retentionDays} onChange={(event) => setForm({ ...form, retentionDays: Number(event.target.value) })} />
      </Field>
      <Field label="Concorrência (1–3)">
        <Input type="number" value={form.concurrency} onChange={(event) => setForm({ ...form, concurrency: Number(event.target.value) })} />
      </Field>
      <label className="mb-2 flex items-center gap-2 text-sm">
        <input type="checkbox" checked={form.ignoreDrafts} onChange={(event) => setForm({ ...form, ignoreDrafts: event.target.checked })} />
        Ignorar PRs em rascunho
      </label>
      <label className="mb-3 flex items-center gap-2 text-sm">
        <input type="checkbox" checked={form.skipOwnPrs} onChange={(event) => setForm({ ...form, skipOwnPrs: event.target.checked })} />
        Ignorar PRs da própria conta
      </label>
      <Button type="button" onClick={() => save.mutate()} disabled={save.isPending}>Salvar</Button>
    </Card>
  );
}
```

- [ ] **Step 6: Servir o SPA pelo Fastify**

Em `src/api/app.ts`, adicionar antes do retorno de `buildApp`:

```ts
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import fastifyStatic from '@fastify/static';

  const webRoot = join(process.cwd(), 'dist', 'web');
  if (existsSync(webRoot)) {
    await app.register(fastifyStatic, { root: webRoot, wildcard: false });
    app.setNotFoundHandler((request, reply) => {
      if (request.url.startsWith('/api/')) {
        return reply.code(404).send(errorBody('not_found', 'Rota não encontrada'));
      }
      return reply.sendFile('index.html');
    });
  }
```

- [ ] **Step 7: Escrever os testes de componente**

`tests/web/setup.test.tsx`:

```tsx
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
```

Nota: os rótulos dos campos usam `<span>` dentro do `<label>`, então `getByLabelText` funciona por associação implícita.

`tests/web/login.test.tsx`:

```tsx
// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { Login } from '../../src/web/pages/Login';

function renderLogin() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter><Login /></MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('Login', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('mostra mensagem para credenciais inválidas', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: { code: 'invalid_credentials', message: 'Credenciais inválidas' } }), { status: 401 })));
    renderLogin();
    await userEvent.type(screen.getByLabelText('Usuário'), 'root');
    await userEvent.type(screen.getByLabelText('Senha'), 'errada');
    await userEvent.click(screen.getByRole('button', { name: 'Entrar' }));
    expect(await screen.findByText('Credenciais inválidas')).toBeInTheDocument();
  });
});
```

- [ ] **Step 8: Rodar e verificar**

Run: `yarn test tests/web/setup.test.tsx tests/web/login.test.tsx; yarn build:web`
Expected: testes PASS e build gerando `dist/web/index.html`.

- [ ] **Step 9: Checkpoint**

Run: `yarn typecheck; yarn lint; yarn test; yarn build:web`
Expected: todos verdes.

---
