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
