import { Link } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api';
import { Card, EmptyState, ErrorText } from '../components/ui';
import { useEvents } from '../hooks/useEvents';

type ReviewRow = {
  id: string;
  jobId: string;
  status: string;
  url: string | null;
  commentsPosted: number;
  postedAt: number | null;
};

export function Reviews() {
  const queryClient = useQueryClient();
  useEvents(() => {
    void queryClient.invalidateQueries({ queryKey: ['reviews'] });
    void queryClient.invalidateQueries({ queryKey: ['dashboard'] });
  });
  const reviews = useQuery({ queryKey: ['reviews'], queryFn: () => api<{ reviews: ReviewRow[] }>('/api/reviews') });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-[var(--text)]">Reviews</h1>
        <p className="mt-1 text-sm text-[var(--text-muted)]">Histórico de reviews publicadas</p>
      </div>
      <Card title="Reviews publicadas">
        <ErrorText>{reviews.isError ? 'Falha ao carregar as reviews.' : ''}</ErrorText>
        {reviews.isLoading ? (
          <p className="text-sm text-[var(--text-muted)]">Carregando…</p>
        ) : reviews.data && reviews.data.reviews.length === 0 ? (
          <EmptyState>Nenhuma review ainda. As reviews aparecerão aqui quando o pipeline estiver ativo.</EmptyState>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs uppercase tracking-wide text-[var(--text-muted)]">
                  <th className="py-2 font-medium">Review</th>
                  <th className="py-2 font-medium">Status</th>
                  <th className="py-2 font-medium">Comentários</th>
                  <th className="py-2 font-medium">Links</th>
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
                        #{review.id.slice(0, 8)}
                      </Link>
                    </td>
                    <td className="py-2 text-[var(--text)]">{review.status}</td>
                    <td className="py-2 text-[var(--text)]">{review.commentsPosted}</td>
                    <td className="py-2">
                      {review.url ? (
                        <a
                          className="text-[var(--link)] underline-offset-2 hover:underline"
                          href={review.url}
                          target="_blank"
                          rel="noreferrer"
                        >
                          GitHub
                        </a>
                      ) : (
                        <span className="text-[var(--text-muted)]">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
