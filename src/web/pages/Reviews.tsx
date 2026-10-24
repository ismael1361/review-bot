import { useQuery, type QueryKey } from '@tanstack/react-query';
import { api } from '../api';
import { Card, EmptyState } from '../components/ui';
import { useEvents } from '../hooks/useEvents';

type ReviewRow = { id: string; jobId: string; status: string; url: string | null; commentsPosted: number; postedAt: number | null };

const REVIEWS_QUERIES: QueryKey[] = [['reviews']];

export function Reviews() {
  useEvents(REVIEWS_QUERIES);
  const reviews = useQuery({ queryKey: ['reviews'], queryFn: () => api<{ reviews: ReviewRow[] }>('/api/reviews') });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-[var(--text)]">Reviews</h1>
        <p className="mt-1 text-sm text-[var(--text-muted)]">Histórico de reviews publicadas</p>
      </div>
      <Card title="Reviews publicadas">
        {reviews.isError ? <p className="text-sm text-[var(--link)]">Falha ao carregar as reviews.</p> : null}
        {reviews.data && reviews.data.reviews.length === 0 ? (
          <EmptyState>Nenhuma review ainda. As reviews aparecerão aqui quando o pipeline estiver ativo.</EmptyState>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wide text-[var(--text-muted)]">
                <th className="py-2 font-medium">Status</th>
                <th className="py-2 font-medium">Comentários</th>
                <th className="py-2 font-medium">Link</th>
              </tr>
            </thead>
            <tbody>
              {reviews.data?.reviews.map((review) => (
                <tr key={review.id} className="border-t border-[var(--border)]">
                  <td className="py-2 text-[var(--text)]">{review.status}</td>
                  <td className="py-2 text-[var(--text)]">{review.commentsPosted}</td>
                  <td className="py-2">
                    {review.url ? (
                      <a className="text-[var(--link)] underline-offset-2 hover:underline" href={review.url}>
                        abrir
                      </a>
                    ) : (
                      <span className="text-[var(--text-muted)]">—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}
