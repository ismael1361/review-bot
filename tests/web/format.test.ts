import { describe, expect, it } from 'vitest';
import { formatDuration, formatPercent, formatRelativeTime, formatTokens } from '../../src/web/format';

const NOW = Date.UTC(2026, 0, 15, 12, 0, 0);
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

describe('formatRelativeTime', () => {
  it('mostra agora para intervalos abaixo de um minuto e datas futuras', () => {
    expect(formatRelativeTime(NOW, NOW)).toBe('agora');
    expect(formatRelativeTime(NOW - 59_000, NOW)).toBe('agora');
    expect(formatRelativeTime(NOW + 5_000, NOW)).toBe('agora');
  });

  it('mostra minutos, horas e dias em pt-BR', () => {
    expect(formatRelativeTime(NOW - MINUTE, NOW)).toBe('há 1 min');
    expect(formatRelativeTime(NOW - 5 * MINUTE, NOW)).toBe('há 5 min');
    expect(formatRelativeTime(NOW - 3 * HOUR, NOW)).toBe('há 3 h');
    expect(formatRelativeTime(NOW - 2 * DAY, NOW)).toBe('há 2 d');
  });

  it('usa a data UTC como fallback a partir de sete dias', () => {
    expect(formatRelativeTime(NOW - 7 * DAY, NOW)).toBe('08/01/2026');
    expect(formatRelativeTime(Date.UTC(2026, 0, 1, 23, 30, 0), NOW)).toBe('01/01/2026');
  });

  it('retorna travessão para valores inválidos', () => {
    expect(formatRelativeTime(Number.NaN, NOW)).toBe('—');
    expect(formatRelativeTime(NOW, Number.POSITIVE_INFINITY)).toBe('—');
  });
});

describe('formatDuration', () => {
  it('formata segundos, minutos e horas', () => {
    expect(formatDuration(0)).toBe('0 s');
    expect(formatDuration(45)).toBe('45 s');
    expect(formatDuration(59.6)).toBe('60 s');
    expect(formatDuration(60)).toBe('1 min');
    expect(formatDuration(90)).toBe('1 min');
    expect(formatDuration(3_599)).toBe('59 min');
    expect(formatDuration(3_600)).toBe('1 h');
    expect(formatDuration(5_400)).toBe('1 h 30 min');
    expect(formatDuration(7_200)).toBe('2 h');
  });

  it('retorna travessão para durações inválidas ou negativas', () => {
    expect(formatDuration(-1)).toBe('—');
    expect(formatDuration(Number.NaN)).toBe('—');
    expect(formatDuration(Number.POSITIVE_INFINITY)).toBe('—');
  });
});

describe('formatTokens', () => {
  it('usa separador de milhar abaixo de mil', () => {
    expect(formatTokens(0)).toBe('0');
    expect(formatTokens(999)).toBe('999');
  });

  it('compacta mil, milhão e bilhão em pt-BR', () => {
    expect(formatTokens(1_000)).toBe('1 mil');
    expect(formatTokens(1_234)).toBe('1,2 mil');
    expect(formatTokens(1_000_000)).toBe('1 mi');
    expect(formatTokens(1_234_567)).toBe('1,2 mi');
    expect(formatTokens(1_500_000_000)).toBe('1,5 bi');
  });

  it('retorna travessão para valores inválidos', () => {
    expect(formatTokens(Number.NaN)).toBe('—');
    expect(formatTokens(Number.POSITIVE_INFINITY)).toBe('—');
  });
});

describe('formatPercent', () => {
  it('converte uma razão de 0 a 1 em percentual pt-BR', () => {
    expect(formatPercent(0)).toBe('0%');
    expect(formatPercent(0.5)).toBe('50%');
    expect(formatPercent(0.1234)).toBe('12,3%');
    expect(formatPercent(1)).toBe('100%');
    expect(formatPercent(1.5)).toBe('150%');
  });

  it('retorna travessão para valores inválidos', () => {
    expect(formatPercent(Number.NaN)).toBe('—');
    expect(formatPercent(Number.POSITIVE_INFINITY)).toBe('—');
  });
});
