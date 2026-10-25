const STYLES: Record<string, { label: string; className: string }> = {
  critical: { label: '[CRÍTICO]', className: 'bg-[var(--danger)] text-[var(--on-danger)]' },
  medium: { label: '[MÉDIO]', className: 'bg-[var(--warning)] text-[var(--on-warning)]' },
  suggestion: { label: '[SUGESTÃO]', className: 'bg-[var(--sunken)] text-[var(--text)] ring-1 ring-inset ring-[var(--border)]' },
  strength: { label: '[PONTO FORTE]', className: 'bg-[var(--success)] text-[var(--on-success)]' },
};

export function SeverityChip({ severity }: { severity: string }) {
  const style = STYLES[severity] ?? STYLES.suggestion!;
  return (
    <span className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-semibold ${style.className}`}>
      {style.label}
    </span>
  );
}
