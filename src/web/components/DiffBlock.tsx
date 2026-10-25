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
          {targetLine !== undefined ? <span>linha {targetLine}</span> : null}
        </div>
      ) : null}
      <div role="list">
        {lines.map((line, index) => {
          const isTarget = targetLine !== undefined && line.newLine === targetLine;
          return (
            <div
              key={index}
              role="listitem"
              data-target={isTarget ? 'true' : undefined}
              aria-label={`Linha ${line.newLine ?? line.oldLine ?? '?'} ${TYPE_LABELS[line.type]}`}
              className={`flex gap-2 px-3 py-0.5 ${isTarget ? 'bg-[var(--surface)]' : ''}`}
            >
              <span
                className={`w-9 shrink-0 text-right ${isTarget ? 'text-[var(--link)]' : 'text-[var(--text-muted)]'}`}
              >
                {line.newLine ?? line.oldLine ?? ''}
              </span>
              <span
                className={`w-3 shrink-0 whitespace-pre text-center ${
                  line.type === 'add'
                    ? 'text-[var(--primary)]'
                    : line.type === 'del'
                      ? 'text-[var(--tertiary)]'
                      : 'text-[var(--text-muted)]'
                }`}
              >
                {MARKERS[line.type]}
              </span>
              <span
                className={`whitespace-pre ${
                  line.type === 'add'
                    ? 'text-[var(--primary)]'
                    : line.type === 'del'
                      ? 'text-[var(--tertiary)]'
                      : 'text-[var(--text)]'
                }`}
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
