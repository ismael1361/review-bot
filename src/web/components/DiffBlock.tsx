import type { DiffLine } from '../../github/diff';

const MARKERS: Record<DiffLine['type'], string> = { add: '+', del: '-', context: ' ' };

const TYPE_LABELS: Record<DiffLine['type'], string> = {
  add: 'adicionada',
  del: 'removida',
  context: 'de contexto',
};

export function DiffBlock({ lines, targetLine, fileName }: { lines: DiffLine[]; targetLine?: number; fileName?: string }) {
  return (
    <div className="overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--sunken)] font-mono text-xs">
      {fileName || targetLine !== undefined ? (
        <div className="flex items-center justify-between border-b border-[var(--border)] px-3 py-1.5 text-[var(--text-muted)]">
          <span>{fileName ?? 'Diff'}</span>
          {targetLine !== undefined ? <span className="text-[var(--accent)]">linha {targetLine}</span> : null}
        </div>
      ) : null}
      <div role="list">
        {lines.map((line, index) => {
          const isTarget = targetLine !== undefined && line.newLine === targetLine;
          const lineBg = isTarget
            ? 'bg-[var(--surface)]'
            : line.type === 'add'
              ? 'bg-[var(--diff-added-bg)]'
              : line.type === 'del'
                ? 'bg-[var(--diff-removed-bg)]'
                : '';
          const lineColor =
            line.type === 'add'
              ? 'text-[var(--success)]'
              : line.type === 'del'
                ? 'text-[var(--danger)]'
                : 'text-[var(--text-muted)]';
          return (
            <div
              key={index}
              role="listitem"
              data-target={isTarget ? 'true' : undefined}
              aria-label={`Linha ${line.newLine ?? line.oldLine ?? '?'} ${TYPE_LABELS[line.type]}`}
              className={`flex items-start gap-2 px-3 py-0.5 ${lineBg}`}
            >
              <span
                className={`w-9 shrink-0 text-right tabular-nums ${isTarget ? 'text-[var(--link)]' : 'text-[var(--diff-line-number)]'}`}
              >
                {line.newLine ?? line.oldLine ?? ''}
              </span>
              <span className={`w-3 shrink-0 whitespace-pre text-center ${lineColor}`}>
                {MARKERS[line.type]}
              </span>
              <span
                className={`min-w-0 flex-1 whitespace-pre-wrap break-words [overflow-wrap:anywhere] ${line.type === 'context' ? 'text-[var(--text)]' : lineColor}`}
              >
                {line.text}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
