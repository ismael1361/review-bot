const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;
const WEEK_MS = 7 * DAY_MS;

const compactNumber = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 1 });

export function formatRelativeTime(epochMs: number, now = Date.now()): string {
  if (!Number.isFinite(epochMs) || !Number.isFinite(now)) {
    return '—';
  }
  const diff = now - epochMs;
  if (diff < MINUTE_MS) {
    return 'agora';
  }
  if (diff < HOUR_MS) {
    return `há ${Math.floor(diff / MINUTE_MS)} min`;
  }
  if (diff < DAY_MS) {
    return `há ${Math.floor(diff / HOUR_MS)} h`;
  }
  if (diff < WEEK_MS) {
    return `há ${Math.floor(diff / DAY_MS)} d`;
  }
  return new Date(epochMs).toLocaleDateString('pt-BR', { timeZone: 'UTC' });
}

export function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) {
    return '—';
  }
  if (seconds < 60) {
    return `${Math.round(seconds)} s`;
  }
  const totalMinutes = Math.floor(seconds / 60);
  if (totalMinutes < 60) {
    return `${totalMinutes} min`;
  }
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return minutes === 0 ? `${hours} h` : `${hours} h ${minutes} min`;
}

export function formatTokens(value: number): string {
  if (!Number.isFinite(value)) {
    return '—';
  }
  const sign = value < 0 ? '-' : '';
  const abs = Math.abs(value);
  if (abs < 1_000) {
    return `${sign}${Math.round(abs).toLocaleString('pt-BR')}`;
  }
  if (abs < 1_000_000) {
    return `${sign}${compactNumber.format(abs / 1_000)} mil`;
  }
  if (abs < 1_000_000_000) {
    return `${sign}${compactNumber.format(abs / 1_000_000)} mi`;
  }
  return `${sign}${compactNumber.format(abs / 1_000_000_000)} bi`;
}

export function formatPercent(value: number): string {
  if (!Number.isFinite(value)) {
    return '—';
  }
  return `${compactNumber.format(value * 100)}%`;
}
