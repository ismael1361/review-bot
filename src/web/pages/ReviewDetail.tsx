import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiRequestError } from '../api';
import { Button, Card, EmptyState, ErrorText, StatusBadge } from '../components/ui';
import { useMe } from '../components/ProtectedRoute';
import { useEvents } from '../hooks/useEvents';
import { Markdown } from '../components/Markdown';
import { DiffBlock } from '../components/DiffBlock';
import { SeverityChip } from '../components/SeverityChip';
import { formatDuration, formatRelativeTime, formatTokens } from '../format';
import type { DiffLine } from '../../github/diff';

type Finding = {
  id: string;
  path: string;
  endLine: number | null;
  severity: string;
  title: string;
  bodyMd: string;
  suggestionMd: string | null;
  status: string;
  snippetJson: string | null;
};

type ReviewRecord = {
  id: string;
  body: string;
  url: string | null;
  status: string;
  commentsPosted: number;
  commentsFallback: number;
  postedAt: number | null;
};

type JobRecord = {
  id: string;
  prNumber?: number;
  prTitle: string;
  prUrl: string;
  headSha: string;
  status: string;
  attempts?: number;
  maxAttempts?: number;
  startedAt?: number | null;
  finishedAt?: number | null;
  errorMessage?: string | null;
  usageJson: string | null;
};

type RepositoryRecord = { id: string; owner: string; name: string; fullName: string };

type ProfileRecord = { id: string; name: string; provider: string; model: string };

type EventRecord = {
  id: string;
  level: string;
  type: string;
  message: string;
  createdAt: number;
};

type TranscriptEntry = { id: string; seq: number; role: string; toolName: string | null };

type ReviewPayload = {
  review: ReviewRecord;
  job: JobRecord | null;
  repository?: RepositoryRecord | null;
  profile?: ProfileRecord | null;
  events?: EventRecord[] | null;
  findings: Finding[] | null;
  transcript: TranscriptEntry[] | null;
};

type Usage = { input: number; output: number; turns: number | null; githubCalls: number | null };

const TERMINAL_STATUSES = new Set(['succeeded', 'partial', 'failed']);
const SEVERITY_ORDER = ['critical', 'medium', 'suggestion', 'strength'];

function stripComments(body: string): string {
  return body.replace(/<!--[\s\S]*?-->/g, '').trim();
}

function finiteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function parseUsage(raw: string | null | undefined): Usage | null {
  if (!raw) {
    return null;
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      return null;
    }
    const usage = parsed as Record<string, unknown>;
    return {
      input: finiteNumber(usage.input) ?? 0,
      output: finiteNumber(usage.output) ?? 0,
      turns: finiteNumber(usage.turns),
      githubCalls: finiteNumber(usage.githubCalls),
    };
  } catch {
    return null;
  }
}

function isLineNumber(value: unknown): boolean {
  return value === null || (typeof value === 'number' && Number.isInteger(value));
}

function isDiffLine(value: unknown): value is DiffLine {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }
  const line = value as Record<string, unknown>;
  return (
    (line.type === 'add' || line.type === 'del' || line.type === 'context') &&
    isLineNumber(line.oldLine) &&
    isLineNumber(line.newLine) &&
    typeof line.text === 'string'
  );
}

function parseSnippet(raw: string | null | undefined): { lines: DiffLine[]; targetLine?: number } | null {
  if (!raw) {
    return null;
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      return null;
    }
    const snippet = parsed as Record<string, unknown>;
    if (!Array.isArray(snippet.lines)) {
      return null;
    }
    const lines = snippet.lines.filter(isDiffLine);
    if (lines.length === 0) {
      return null;
    }
    const targetLine =
      typeof snippet.targetLine === 'number' && Number.isInteger(snippet.targetLine) ? snippet.targetLine : undefined;
    return { lines, targetLine };
  } catch {
    return null;
  }
}

function highestSeverity(findings: Finding[]): string | null {
  for (const severity of SEVERITY_ORDER) {
    if (findings.some((finding) => finding.severity === severity)) {
      return severity;
    }
  }
  return null;
}

function jobDurationSec(job: JobRecord | null): number | null {
  if (
    job?.startedAt !== null &&
    job?.startedAt !== undefined &&
    job.finishedAt !== null &&
    job.finishedAt !== undefined &&
    job.finishedAt >= job.startedAt
  ) {
    return (job.finishedAt - job.startedAt) / 1000;
  }
  return null;
}

function groupFindings(findings: Finding[]): Array<{ path: string; items: Finding[] }> {
  const groups = new Map<string, Finding[]>();
  for (const finding of findings) {
    const path = finding.path.trim() || 'Sem arquivo';
    const items = groups.get(path) ?? [];
    items.push(finding);
    groups.set(path, items);
  }
  return [...groups.entries()].map(([path, items]) => ({ path, items }));
}

const levelClasses: Record<string, string> = {
  info: 'text-[var(--text-muted)]',
  warn: 'text-[var(--warning)]',
  error: 'text-[var(--danger)]',
};

export function ReviewDetail() {
  const { id } = useParams<{ id: string }>();
  const queryClient = useQueryClient();
  const me = useMe();
  const canMutate = me.data?.role === 'operator' || me.data?.role === 'admin';
  const [error, setError] = useState('');
  const detail = useQuery({
    queryKey: ['review', id],
    queryFn: () => api<ReviewPayload>(`/api/reviews/${id}`),
    enabled: id !== undefined,
  });
  useEvents(() => {
    void queryClient.invalidateQueries({ queryKey: ['review', id] });
    void queryClient.invalidateQueries({ queryKey: ['reviews'] });
    void queryClient.invalidateQueries({ queryKey: ['dashboard'] });
  });
  const publish = useMutation({
    mutationFn: () => {
      const jobId = detail.data?.job?.id;
      if (!jobId) {
        throw new Error('Job indisponível');
      }
      return api(`/api/jobs/${jobId}/publish-review`, { method: 'POST' });
    },
    onSuccess: () => {
      setError('');
      void queryClient.invalidateQueries({ queryKey: ['review', id] });
      void queryClient.invalidateQueries({ queryKey: ['reviews'] });
      void queryClient.invalidateQueries({ queryKey: ['dashboard'] });
      void queryClient.invalidateQueries({ queryKey: ['jobs'] });
    },
    onError: (mutationError) => {
      setError(
        mutationError instanceof ApiRequestError ? mutationError.message : 'Não foi possível republicar a review.',
      );
    },
  });

  if (detail.isLoading) {
    return <p className="text-sm text-[var(--text-muted)]">Carregando…</p>;
  }

  if (detail.isError) {
    const notFound = detail.error instanceof ApiRequestError && detail.error.status === 404;
    return <ErrorText>{notFound ? 'Review não encontrada.' : 'Falha ao carregar a review.'}</ErrorText>;
  }

  if (!detail.data) {
    return <EmptyState>Review indisponível.</EmptyState>;
  }

  const review = detail.data.review;
  const job = detail.data.job;
  const repository = detail.data.repository ?? null;
  const profile = detail.data.profile ?? null;
  const events = detail.data.events ?? [];
  const findings = detail.data.findings ?? [];
  const transcript = detail.data.transcript ?? [];
  const usage = parseUsage(job?.usageJson);
  const severity = highestSeverity(findings);
  const durationSec = jobDurationSec(job);
  const showPublish = canMutate && job !== null && TERMINAL_STATUSES.has(job.status);
  const groups = groupFindings(findings);

  return (
    <div className="space-y-4">
      <Link className="text-sm text-[var(--link)] underline-offset-2 hover:underline" to="/reviews">
        ← Reviews
      </Link>

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-[var(--text)]">{job?.prTitle ?? 'Review'}</h1>
          <p className="mt-1 text-xs text-[var(--text-muted)]">
            {repository ? (
              <span className="text-[var(--text)]">{repository.fullName}</span>
            ) : job?.prUrl ? (
              <a className="text-[var(--link)] underline-offset-2 hover:underline" href={job.prUrl} target="_blank" rel="noreferrer">
                {job.prUrl}
              </a>
            ) : (
              'Job indisponível'
            )}
            {job?.prNumber ? <span> · PR #{job.prNumber}</span> : null}
            {job?.headSha ? <span> · head {job.headSha.slice(0, 7)}</span> : null}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {review.url ? (
            <a
              className="rounded-lg border border-[var(--border-strong)] px-3 py-2 text-sm text-[var(--text)] transition hover:bg-[var(--border)]"
              href={review.url}
              target="_blank"
              rel="noreferrer"
            >
              Abrir no GitHub
            </a>
          ) : null}
          {showPublish ? (
            <Button
              type="button"
              onClick={() => {
                setError('');
                publish.mutate();
              }}
              disabled={publish.isPending}
            >
              {publish.isPending ? 'Republicando…' : 'Republicar'}
            </Button>
          ) : null}
        </div>
      </div>

      <ErrorText>{error}</ErrorText>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-4 py-3 text-sm">
        {job ? <StatusBadge status={job.status} kind="job" /> : null}
        {severity ? <SeverityChip severity={severity} /> : null}
        {profile ? (
          <span className="text-[var(--text)]">
            {profile.name} · {profile.provider} · {profile.model}
          </span>
        ) : null}
        <span className="text-[var(--text-muted)]">
          Duração <span className="text-[var(--text)]">{durationSec === null ? '—' : formatDuration(durationSec)}</span>
        </span>
        <span className="text-[var(--text-muted)]">
          Tokens{' '}
          <span className="text-[var(--text)]">
            {usage ? `${formatTokens(usage.input)} in · ${formatTokens(usage.output)} out` : '—'}
          </span>
        </span>
        <span className="text-[var(--text-muted)]">
          Comentários <span className="text-[var(--text)]">{review.commentsPosted}</span>
        </span>
      </div>

      <Card title="Corpo do review">
        <Markdown source={stripComments(review.body)} />
        {review.status === 'fallback' ? (
          <p className="mt-2 text-xs text-[var(--warning)]">Publicado com fallback: achados no corpo do review.</p>
        ) : null}
      </Card>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <Card title={`Achados (${findings.length})`} className="min-w-0">
          {findings.length === 0 ? (
            <EmptyState>Nenhum achado registrado.</EmptyState>
          ) : (
            <div className="space-y-5">
              {groups.map((group) => (
                <section key={group.path}>
                  <h3 className="mb-2 font-mono text-xs font-semibold text-[var(--text-muted)]">
                    {group.path} <span>({group.items.length})</span>
                  </h3>
                  <ul className="space-y-4">
                    {group.items.map((finding) => {
                      const snippet = parseSnippet(finding.snippetJson);
                      return (
                        <li key={finding.id} className="rounded-lg border border-[var(--border)] bg-[var(--bg)] p-3">
                          <div className="mb-2 flex flex-wrap items-center gap-2">
                            <SeverityChip severity={finding.severity} />
                            <span className="text-sm font-semibold text-[var(--text)]">{finding.title}</span>
                            <span className="ml-auto font-mono text-xs text-[var(--text-muted)]">
                              {finding.path}
                              {typeof finding.endLine === 'number' ? `:${finding.endLine}` : ''}
                            </span>
                          </div>
                          {snippet ? (
                            <div className="mb-2">
                              <DiffBlock lines={snippet.lines} targetLine={snippet.targetLine} fileName={finding.path} />
                            </div>
                          ) : null}
                          <Markdown source={finding.bodyMd} />
                          {finding.suggestionMd ? (
                            <div className="mt-2 rounded-lg border border-[var(--border)] bg-[var(--sunken)] p-2">
                              <p className="mb-1 text-xs font-semibold text-[var(--primary)]">Sugestão</p>
                              <pre className="overflow-x-auto font-mono text-xs text-[var(--text)]">{finding.suggestionMd}</pre>
                            </div>
                          ) : null}
                        </li>
                      );
                    })}
                  </ul>
                </section>
              ))}
            </div>
          )}
        </Card>

        <div className="min-w-0 space-y-4">
          <Card title="Execução">
            <dl className="space-y-1 text-sm">
              <div className="flex justify-between gap-3">
                <dt className="text-[var(--text-muted)]">Tentativas</dt>
                <dd className="text-[var(--text)]">
                  {job?.attempts ?? '—'} / {job?.maxAttempts ?? '—'}
                </dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-[var(--text-muted)]">Início</dt>
                <dd className="text-[var(--text)]">
                  {job?.startedAt ? formatRelativeTime(job.startedAt) : '—'}
                </dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-[var(--text-muted)]">Fim</dt>
                <dd className="text-[var(--text)]">
                  {job?.finishedAt ? formatRelativeTime(job.finishedAt) : '—'}
                </dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-[var(--text-muted)]">Turnos</dt>
                <dd className="text-[var(--text)]">{usage?.turns ?? '—'}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-[var(--text-muted)]">Chamadas GitHub</dt>
                <dd className="text-[var(--text)]">
                  {usage?.githubCalls === null || usage?.githubCalls === undefined
                    ? '—'
                    : `${usage.githubCalls} chamadas`}
                </dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-[var(--text-muted)]">Comentários</dt>
                <dd className="text-[var(--text)]">
                  {review.commentsPosted} inline · {review.commentsFallback} no corpo
                </dd>
              </div>
              {job?.errorMessage ? (
                <div className="flex justify-between gap-3">
                  <dt className="text-[var(--text-muted)]">Erro</dt>
                  <dd className="text-right text-[var(--danger)]">{job.errorMessage}</dd>
                </div>
              ) : null}
            </dl>
          </Card>

          <Card title="Perfil">
            {profile ? (
              <dl className="space-y-1 text-sm">
                <div className="flex justify-between gap-3">
                  <dt className="text-[var(--text-muted)]">Nome</dt>
                  <dd className="text-[var(--text)]">{profile.name}</dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt className="text-[var(--text-muted)]">Provedor</dt>
                  <dd className="text-[var(--text)]">{profile.provider}</dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt className="text-[var(--text-muted)]">Modelo</dt>
                  <dd className="text-[var(--text)]">{profile.model}</dd>
                </div>
              </dl>
            ) : (
              <EmptyState>Perfil indisponível.</EmptyState>
            )}
          </Card>

          <Card title="Timeline">
            {events.length === 0 ? (
              <EmptyState>Nenhum evento registrado.</EmptyState>
            ) : (
              <ul className="space-y-2 text-xs">
                {events.slice(-30).map((event) => (
                  <li key={event.id} className="flex flex-wrap items-start gap-2">
                    <span className="font-mono text-[var(--text-muted)]">
                      {new Date(event.createdAt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
                    </span>
                    <span className={`font-medium ${levelClasses[event.level] ?? 'text-[var(--text)]'}`}>
                      {event.type}
                    </span>
                    <span className="text-[var(--text)]">{event.message}</span>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card title="Transcrição">
            {transcript.length === 0 ? (
              <EmptyState>Nenhuma mensagem registrada.</EmptyState>
            ) : (
              <ul className="space-y-1 font-mono text-xs text-[var(--text-muted)]">
                {transcript.slice(-40).map((message) => (
                  <li key={message.id}>
                    #{message.seq} {message.role}
                    {message.toolName ? ` · ${message.toolName}` : ''}
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}
