import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { createDb } from '../src/db/client';
import { runMigrations } from '../src/db/migrate';
import { agentMessages, events, jobs, repositories, reviewFindings, reviews } from '../src/db/schema';

const dataDir = process.env.DATA_DIR ?? './data';
const dbPath = join(dataDir, 'review-bot.db');
mkdirSync(dataDir, { recursive: true });

const { sqlite, db } = createDb(dbPath);
runMigrations(db, join(process.cwd(), 'drizzle'));
const now = Date.now();
const queuedAt = now - 12 * 60 * 1000;
const startedAt = now - 11 * 60 * 1000;
const finishedAt = now - 10 * 60 * 1000;

const reviewBody = [
  '<!-- pr-reviewer:job:demo-job -->',
  '## Resumo',
  '',
  'O PR adiciona um cache em memória para sessões. A ideia reduz consultas ao banco, mas há um problema crítico de isolamento entre usuários e dois pontos de manutenção que merecem atenção.',
  '',
  '### Achados',
  '',
  '- **Crítico:** a chave do cache não inclui o usuário, então uma sessão pode ser servida para outra conta.',
  '- **Médio:** o TTL fixo ignora `Cache-Control` e mantém sessões revogadas por até uma hora.',
  '- **Sugestão:** extraia a montagem da chave para uma função testável.',
  '',
  'Nenhuma aprovação ou solicitação de alterações foi enviada por este bot.',
].join('\n');

const snippetCritical = JSON.stringify({
  targetLine: 14,
  lines: [
    { type: 'context', oldLine: 11, newLine: 11, text: 'export function getSession(sessionId: string) {' },
    { type: 'add', oldLine: null, newLine: 12, text: '  const cached = cache.get(sessionId);' },
    { type: 'add', oldLine: null, newLine: 13, text: '  if (cached) return cached;' },
    { type: 'add', oldLine: null, newLine: 14, text: '  const session = loadSession(sessionId);' },
    { type: 'context', oldLine: 12, newLine: 15, text: '  return session;' },
    { type: 'context', oldLine: 13, newLine: 16, text: '}' },
  ],
});

const snippetMedium = JSON.stringify({
  targetLine: 27,
  lines: [
    { type: 'context', oldLine: 25, newLine: 25, text: 'const cache = new Map<string, Session>();' },
    { type: 'add', oldLine: null, newLine: 26, text: 'const TTL_MS = 60 * 60 * 1000;' },
    { type: 'add', oldLine: null, newLine: 27, text: 'setInterval(() => cache.clear(), TTL_MS);' },
    { type: 'context', oldLine: 26, newLine: 28, text: 'export const sessionCache = cache;' },
  ],
});

const snippetSuggestion = JSON.stringify({
  targetLine: 40,
  lines: [
    { type: 'context', oldLine: 38, newLine: 38, text: 'export function remember(session: Session) {' },
    { type: 'add', oldLine: null, newLine: 39, text: '  cache.set(`${session.userId}:${session.id}`, session);' },
    { type: 'context', oldLine: 39, newLine: 40, text: '  return session;' },
    { type: 'context', oldLine: 40, newLine: 41, text: '}' },
  ],
});

try {
  db.transaction((tx) => {
    tx.insert(repositories)
      .values({
        id: 'demo-repo',
        githubId: 'demo-github-repo',
        owner: 'acme',
        name: 'demo',
        fullName: 'acme/demo',
        private: false,
        archived: false,
        enabled: true,
        discoveredAt: now - 7 * 24 * 60 * 60 * 1000,
        updatedAt: now - 10 * 60 * 1000,
      })
      .onConflictDoNothing()
      .run();

    tx.insert(jobs)
      .values({
        id: 'demo-job',
        repositoryId: 'demo-repo',
        prNumber: 42,
        prTitle: 'Adiciona cache de sessões',
        prUrl: 'https://github.com/acme/demo/pull/42',
        authorLogin: 'ana-dev',
        headSha: '3f9c2b1d4e5a6b7c8d9e0f1a2b3c4d5e6f7a8b9c',
        baseSha: '1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b',
        headRepo: 'acme/demo',
        runSeq: 1,
        status: 'succeeded',
        priority: 0,
        attempts: 1,
        maxAttempts: 3,
        profileId: null,
        profileSnapshotJson: JSON.stringify({
          id: 'demo-profile',
          name: 'Demo OpenAI',
          provider: 'openai_compatible',
          model: 'gpt-demo',
        }),
        queuedAt,
        startedAt,
        finishedAt,
        heartbeatAt: finishedAt,
        lockedBy: null,
        errorCode: null,
        errorMessage: null,
        usageJson: JSON.stringify({ input: 18500, output: 2400, turns: 6, githubCalls: 12 }),
        summaryMd: 'Cache de sessões sem isolamento por usuário e TTL fixo.',
        nextAttemptAt: null,
      })
      .onConflictDoNothing()
      .run();

    tx.insert(reviews)
      .values({
        id: 'demo-review',
        jobId: 'demo-job',
        githubReviewId: '123456789',
        url: 'https://github.com/acme/demo/pull/42#pullrequestreview-123456789',
        body: reviewBody,
        event: 'COMMENT',
        commentsPosted: 3,
        commentsFallback: 0,
        status: 'posted',
        postedAt: finishedAt,
      })
      .onConflictDoNothing()
      .run();

    tx.insert(reviewFindings)
      .values([
        {
          id: 'demo-finding-1',
          jobId: 'demo-job',
          reviewId: 'demo-review',
          path: 'src/demo.ts',
          startLine: 12,
          endLine: 14,
          side: 'RIGHT',
          severity: 'critical',
          title: 'Cache de sessão não isola usuários',
          bodyMd:
            'A chave do cache usa apenas `sessionId`. Como o identificador não é globalmente único entre contas, uma sessão pode ser devolvida para outro usuário.',
          suggestionMd: 'const key = `${userId}:${sessionId}`;',
          snippetJson: snippetCritical,
          status: 'posted',
          githubCommentId: '987654321',
          createdAt: finishedAt,
        },
        {
          id: 'demo-finding-2',
          jobId: 'demo-job',
          reviewId: 'demo-review',
          path: 'src/demo.ts',
          startLine: 27,
          endLine: 27,
          side: 'RIGHT',
          severity: 'medium',
          title: 'TTL fixo mantém sessões revogadas',
          bodyMd:
            'O cache é limpo por inteiro a cada hora. Sessões revogadas continuam válidas até a próxima limpeza; respeite a expiração individual de cada sessão.',
          suggestionMd: 'cache.set(key, session, { ttl: session.idleExpiresAt - Date.now() });',
          snippetJson: snippetMedium,
          status: 'posted',
          githubCommentId: '987654322',
          createdAt: finishedAt,
        },
        {
          id: 'demo-finding-3',
          jobId: 'demo-job',
          reviewId: 'demo-review',
          path: 'src/demo.ts',
          startLine: 39,
          endLine: 39,
          side: 'RIGHT',
          severity: 'suggestion',
          title: 'Extraia a chave do cache para uma função',
          bodyMd:
            'A montagem da chave aparece em mais de um ponto. Uma função `sessionCacheKey(userId, sessionId)` evita divergências e facilita o teste.',
          suggestionMd: 'export function sessionCacheKey(userId: string, sessionId: string) { return `${userId}:${sessionId}`; }',
          snippetJson: snippetSuggestion,
          status: 'posted',
          githubCommentId: '987654323',
          createdAt: finishedAt,
        },
      ])
      .onConflictDoNothing()
      .run();

    tx.insert(events)
      .values([
        {
          id: 'demo-event-1',
          jobId: 'demo-job',
          level: 'info',
          type: 'job.created',
          message: 'Job criado para acme/demo#42',
          dataJson: JSON.stringify({ prNumber: 42 }),
          createdAt: queuedAt,
        },
        {
          id: 'demo-event-2',
          jobId: 'demo-job',
          level: 'info',
          type: 'job.started',
          message: 'Worker w1 iniciou a execução',
          dataJson: JSON.stringify({ worker: 'w1' }),
          createdAt: startedAt,
        },
        {
          id: 'demo-event-3',
          jobId: 'demo-job',
          level: 'info',
          type: 'job.progress',
          message: 'Diff carregado: 1 arquivo e 186 linhas',
          dataJson: JSON.stringify({ files: 1, lines: 186 }),
          createdAt: startedAt + 20_000,
        },
        {
          id: 'demo-event-4',
          jobId: 'demo-job',
          level: 'info',
          type: 'job.progress',
          message: 'Agente registrou 3 achados e concluiu o review',
          dataJson: JSON.stringify({ findings: 3 }),
          createdAt: startedAt + 40_000,
        },
        {
          id: 'demo-event-5',
          jobId: 'demo-job',
          level: 'info',
          type: 'review.published',
          message: 'Review publicada como COMMENT',
          dataJson: JSON.stringify({ comments: 3 }),
          createdAt: finishedAt,
        },
        {
          id: 'demo-event-6',
          jobId: 'demo-job',
          level: 'info',
          type: 'job.finished',
          message: 'Job concluído com sucesso',
          dataJson: JSON.stringify({ status: 'succeeded' }),
          createdAt: finishedAt,
        },
        {
          id: 'demo-event-poll',
          jobId: null,
          level: 'info',
          type: 'poll.updated',
          message: 'Polling concluído: 1 PR com review solicitado',
          dataJson: JSON.stringify({ prs: 1 }),
          createdAt: finishedAt,
        },
      ])
      .onConflictDoNothing()
      .run();

    tx.insert(agentMessages)
      .values([
        {
          id: 'demo-message-1',
          jobId: 'demo-job',
          seq: 1,
          role: 'system',
          contentJson: JSON.stringify({ text: 'Você revisa pull requests e registra achados verificáveis.' }),
          toolName: null,
          tokensIn: 1800,
          tokensOut: 0,
          createdAt: startedAt,
        },
        {
          id: 'demo-message-2',
          jobId: 'demo-job',
          seq: 2,
          role: 'assistant',
          contentJson: JSON.stringify({ tool: 'get_pr_files', arguments: { owner: 'acme', repo: 'demo', pull_number: 42 } }),
          toolName: 'get_pr_files',
          tokensIn: 2200,
          tokensOut: 180,
          createdAt: startedAt + 10_000,
        },
        {
          id: 'demo-message-3',
          jobId: 'demo-job',
          seq: 3,
          role: 'tool',
          contentJson: JSON.stringify({ files: 1, patchLines: 186 }),
          toolName: 'get_pr_files',
          tokensIn: 0,
          tokensOut: 0,
          createdAt: startedAt + 12_000,
        },
        {
          id: 'demo-message-4',
          jobId: 'demo-job',
          seq: 4,
          role: 'assistant',
          contentJson: JSON.stringify({ text: 'Encontrei um problema crítico de isolamento e dois pontos menores.' }),
          toolName: 'submit_review',
          tokensIn: 2400,
          tokensOut: 640,
          createdAt: startedAt + 45_000,
        },
      ])
      .onConflictDoNothing()
      .run();
  });
  console.log(dbPath);
} finally {
  sqlite.close();
}
