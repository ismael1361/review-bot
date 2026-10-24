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
import { Password } from './pages/Password';
import { SettingsLayout } from './pages/settings';

function SetupGate() {
  const status = useQuery({ queryKey: ['setup-status'], queryFn: () => api<{ needsSetup: boolean }>('/api/setup/status'), retry: false });
  if (status.isLoading || status.isFetching) {
    return <p className="p-8 text-sm text-[var(--text-muted)]">Carregando…</p>;
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
          <Route path="/password" element={<Password />} />
          <Route path="/settings/*" element={<SettingsLayout />} />
        </Route>
      </Route>
    </Routes>
  );
}
