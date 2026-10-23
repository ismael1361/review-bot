import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../api';
import { Button, Card, EmptyState } from '../../components/ui';

type AuditEntry = {
  id: string;
  userId: string | null;
  action: string;
  targetType: string | null;
  targetId: string | null;
  ip: string | null;
  createdAt: number;
};

const PAGE_SIZE = 20;

function targetLabel(entry: AuditEntry): string {
  if (entry.targetType && entry.targetId) {
    return `${entry.targetType}/${entry.targetId}`;
  }
  return entry.targetType ?? entry.targetId ?? '—';
}

export function Audit() {
  const [page, setPage] = useState(1);
  const audit = useQuery({
    queryKey: ['audit', page],
    queryFn: () => api<{ entries: AuditEntry[]; total: number }>(`/api/audit?page=${page}&limit=${PAGE_SIZE}`),
  });

  const entries = audit.data?.entries ?? [];
  const total = audit.data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <Card title="Auditoria">
      {audit.isError ? <p className="text-sm text-red-400">Falha ao carregar a auditoria.</p> : null}
      {audit.isLoading ? <p className="text-sm text-slate-500">Carregando…</p> : null}
      {!audit.isLoading && !audit.isError && entries.length === 0 ? (
        <EmptyState>Nenhuma entrada de auditoria.</EmptyState>
      ) : null}
      {entries.length > 0 ? (
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs uppercase tracking-wide text-slate-500">
              <th className="py-2 font-medium">Data</th>
              <th className="py-2 font-medium">Usuário</th>
              <th className="py-2 font-medium">Ação</th>
              <th className="py-2 font-medium">Alvo</th>
              <th className="py-2 font-medium">IP</th>
            </tr>
          </thead>
          <tbody>
            {entries.map((entry) => (
              <tr key={entry.id} className="border-t border-slate-800">
                <td className="py-2 text-slate-300">{new Date(entry.createdAt).toLocaleString('pt-BR')}</td>
                <td className="py-2 text-slate-300">{entry.userId ?? '—'}</td>
                <td className="py-2 text-slate-300">{entry.action}</td>
                <td className="py-2 text-slate-300">{targetLabel(entry)}</td>
                <td className="py-2 text-slate-300">{entry.ip ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
      <div className="mt-4 flex items-center justify-between gap-2">
        <Button type="button" onClick={() => setPage((current) => current - 1)} disabled={page === 1 || audit.isFetching}>
          Anterior
        </Button>
        <span className="text-sm text-slate-400">
          Página {page} de {totalPages}
        </span>
        <Button
          type="button"
          onClick={() => setPage((current) => current + 1)}
          disabled={page * PAGE_SIZE >= total || audit.isFetching}
        >
          Próxima
        </Button>
      </div>
    </Card>
  );
}
