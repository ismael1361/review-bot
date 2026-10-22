import { useQuery } from '@tanstack/react-query';
import { api } from '../api';
import { Card, EmptyState } from '../components/ui';

type ReviewRow = { id: string; jobId: string; status: string; url: string | null; commentsPosted: number; postedAt: number | null };

export function Reviews() {
  const reviews = useQuery({ queryKey: ['reviews'], queryFn: () => api<{ reviews: ReviewRow[] }>('/api/reviews') });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-slate-100">Reviews</h1>
        <p className="mt-1 text-sm text-slate-400">Histórico de reviews publicadas</p>
      </div>
      <Card title="Reviews publicadas">
        {reviews.isError ? <p className="text-sm text-red-400">Falha ao carregar as reviews.</p> : null}
        {reviews.data && reviews.data.reviews.length === 0 ? (
          <EmptyState>Nenhuma review ainda. As reviews aparecerão aqui quando o pipeline estiver ativo.</EmptyState>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wide text-slate-500">
                <th className="py-2 font-medium">Status</th>
                <th className="py-2 font-medium">Comentários</th>
                <th className="py-2 font-medium">Link</th>
              </tr>
            </thead>
            <tbody>
              {reviews.data?.reviews.map((review) => (
                <tr key={review.id} className="border-t border-slate-800">
                  <td className="py-2 text-slate-300">{review.status}</td>
                  <td className="py-2 text-slate-300">{review.commentsPosted}</td>
                  <td className="py-2">
                    {review.url ? (
                      <a className="text-sky-400 underline-offset-2 hover:underline" href={review.url}>
                        abrir
                      </a>
                    ) : (
                      <span className="text-slate-500">—</span>
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
