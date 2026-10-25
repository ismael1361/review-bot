import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api';
import { Button, Card, EmptyState, ErrorText, Field, Input, PageHeader, StatusBadge } from '../components/ui';
import { useEvents } from '../hooks/useEvents';
import { formatRelativeTime } from '../format';

type ReviewRow = {
  id: string;
  jobId: string;
  status: string;
  url: string | null;
  commentsPosted: number;
  postedAt: number | null;
  repoFullName: string;
  prNumber: number;
  prTitle: string;
  critical: number;
  medium: number;
  suggestion: number;
};

type Filters = {
  repoFullName: string;
  status: string;
  severity: string;
  periodDays: string;
};

const EMPTY_FILTERS: Filters = { repoFullName: '', status: '', severity: '', periodDays: '' };
const PAGE_SIZE = 20;

const selectClass =
  'w-full rounded-lg border border-[var(--border-strong)] bg-[var(--bg)] px-3 py-2 text-sm text-[var(--text)] focus:border-[var(--primary)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)]/40';

function plural(value: number, singular: string, pluralForm: string): string {
  return `${value} ${value === 1 ? singular : pluralForm}`;
}

function severitySummary(row: ReviewRow): string {
  const parts: string[] = [];
  if (row.critical > 0) {
    parts.push(plural(row.critical, 'crítico', 'críticos'));
  }
  if (row.medium > 0) {
    parts.push(plural(row.medium, 'médio', 'médios'));
  }
  if (row.suggestion > 0) {
    parts.push(plural(row.suggestion, 'sugestão', 'sugestões'));
  }
  return parts.length > 0 ? parts.join(' · ') : '—';
}

function queryString(filters: Filters, page: number): string {
  const params = new URLSearchParams({ page: String(page), limit: String(PAGE_SIZE) });
  const repoFullName = filters.repoFullName.trim();
  if (repoFullName) {
    params.set('repoFullName', repoFullName);
  }
  if (filters.status) {
    params.set('status', filters.status);
  }
  if (filters.severity) {
    params.set('severity', filters.severity);
  }
  if (filters.periodDays) {
    params.set('periodDays', filters.periodDays);
  }
  return params.toString();
}

export function Reviews() {
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState<Filters>(EMPTY_FILTERS);
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  const [page, setPage] = useState(1);
  useEvents(() => {
    void queryClient.invalidateQueries({ queryKey: ['reviews'] });
    void queryClient.invalidateQueries({ queryKey: ['dashboard'] });
  });

  const reviews = useQuery({
    queryKey: ['reviews', filters, page],
    queryFn: () => api<{ reviews: ReviewRow[]; total: number; page: number; limit: number }>(`/api/reviews?${queryString(filters, page)}`),
  });

  const total = reviews.data?.total ?? 0;
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));

  function applyFilters(event?: FormEvent) {
    event?.preventDefault();
    const normalized: Filters = { ...draft, repoFullName: draft.repoFullName.trim() };
    const unchanged =
      normalized.repoFullName === filters.repoFullName &&
      normalized.status === filters.status &&
      normalized.severity === filters.severity &&
      normalized.periodDays === filters.periodDays;
    setDraft(normalized);
    setFilters(normalized);
    setPage(1);
    if (unchanged && page === 1) {
      void reviews.refetch();
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Reviews"
        subtitle="Histórico de reviews publicadas"
        actions={
          <Button type="submit" form="reviews-filters" variant="secondary" disabled={reviews.isFetching}>
            Atualizar
          </Button>
        }
      />

      <Card>
        <form id="reviews-filters" onSubmit={applyFilters} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="Repositório">
            <Input
              value={draft.repoFullName}
              onChange={(event) => setDraft({ ...draft, repoFullName: event.target.value })}
              placeholder="owner/repo"
            />
          </Field>
          <Field label="Status">
            <select
              className={selectClass}
              value={draft.status}
              onChange={(event) => setDraft({ ...draft, status: event.target.value })}
            >
              <option value="">Todos</option>
              <option value="posted">Publicada</option>
              <option value="fallback">Fallback</option>
              <option value="failed">Falhou</option>
            </select>
          </Field>
          <Field label="Severidade">
            <select
              className={selectClass}
              value={draft.severity}
              onChange={(event) => setDraft({ ...draft, severity: event.target.value })}
            >
              <option value="">Todas</option>
              <option value="critical">Crítico</option>
              <option value="medium">Médio</option>
              <option value="suggestion">Sugestão</option>
              <option value="strength">Ponto forte</option>
            </select>
          </Field>
          <Field label="Período">
            <select
              className={selectClass}
              value={draft.periodDays}
              onChange={(event) => setDraft({ ...draft, periodDays: event.target.value })}
            >
              <option value="">Todo o período</option>
              <option value="7">7 dias</option>
              <option value="30">30 dias</option>
              <option value="90">90 dias</option>
            </select>
          </Field>
        </form>
      </Card>

      <Card title="Reviews publicadas">
        <ErrorText>{reviews.isError ? 'Falha ao carregar as reviews.' : ''}</ErrorText>
        {reviews.isLoading ? (
          <p className="text-sm text-[var(--text-muted)]">Carregando…</p>
        ) : reviews.data && reviews.data.reviews.length === 0 ? (
          <EmptyState>Nenhuma review ainda. As reviews aparecerão aqui quando o pipeline estiver ativo.</EmptyState>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs uppercase tracking-wide text-[var(--text-muted)]">
                    <th className="py-2 font-medium">PR</th>
                    <th className="py-2 font-medium">Repositório</th>
                    <th className="py-2 font-medium">Status</th>
                    <th className="py-2 font-medium">Achados</th>
                    <th className="py-2 font-medium">Comentários</th>
                    <th className="py-2 font-medium">Publicado</th>
                  </tr>
                </thead>
                <tbody>
                  {reviews.data?.reviews.map((review) => (
                    <tr key={review.id} className="border-t border-[var(--border)]">
                      <td className="py-2">
                        <Link
                          className="text-[var(--link)] underline-offset-2 hover:underline"
                          to={`/reviews/${review.id}`}
                        >
                          #{review.prNumber} {review.prTitle}
                        </Link>
                        {review.url ? (
                          <a
                            className="ml-2 text-xs text-[var(--text-muted)] underline-offset-2 hover:underline"
                            href={review.url}
                            target="_blank"
                            rel="noreferrer"
                          >
                            GitHub
                          </a>
                        ) : null}
                      </td>
                      <td className="py-2 text-[var(--text)]">{review.repoFullName}</td>
                      <td className="py-2">
                        <StatusBadge status={review.status} kind="review" />
                      </td>
                      <td className="py-2 text-[var(--text)]">{severitySummary(review)}</td>
                      <td className="py-2 text-[var(--text)]">{review.commentsPosted}</td>
                      <td className="py-2 text-[var(--text-muted)]">
                        {review.postedAt === null ? '—' : formatRelativeTime(review.postedAt)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="mt-4 flex flex-wrap items-center justify-between gap-3 text-sm">
              <span className="text-[var(--text-muted)]">
                Página {page} de {pageCount} · {total} {total === 1 ? 'review' : 'reviews'}
              </span>
              <span className="flex gap-2">
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => setPage((current) => Math.max(1, current - 1))}
                  disabled={page <= 1 || reviews.isFetching}
                >
                  Anterior
                </Button>
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => setPage((current) => Math.min(pageCount, current + 1))}
                  disabled={page >= pageCount || reviews.isFetching}
                >
                  Próxima
                </Button>
              </span>
            </div>
          </>
        )}
      </Card>
    </div>
  );
}
