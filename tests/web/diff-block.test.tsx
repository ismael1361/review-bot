// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { DiffBlock } from '../../src/web/components/DiffBlock';
import type { DiffLine } from '../../src/github/diff';

const lines: DiffLine[] = [
  { type: 'context', oldLine: 40, newLine: 40, text: 'const row = x;' },
  { type: 'add', oldLine: null, newLine: 41, text: 'const now = Date.now();' },
];

describe('DiffBlock', () => {
  it('mostra números de linha e destaca a linha-alvo', () => {
    render(<DiffBlock lines={lines} targetLine={41} fileName="src/a.ts" />);
    expect(screen.getByText('40')).toBeInTheDocument();
    expect(screen.getByText('src/a.ts')).toBeInTheDocument();
    expect(screen.getByText('linha 41')).toBeInTheDocument();
    expect(screen.getByText('const now = Date.now();')).toBeInTheDocument();
    const target = screen.getByText('const now = Date.now();').closest('[data-target="true"]');
    expect(target).not.toBeNull();
  });

  it('mostra os marcadores de adição, remoção e contexto', () => {
    const markerLines: DiffLine[] = [
      { type: 'del', oldLine: 7, newLine: null, text: 'linha antiga' },
      { type: 'add', oldLine: null, newLine: 8, text: 'linha nova' },
      { type: 'context', oldLine: 8, newLine: 9, text: 'linha comum' },
    ];
    render(<DiffBlock lines={markerLines} />);

    expect(screen.getByText('-')).toBeInTheDocument();
    expect(screen.getByText('+')).toBeInTheDocument();
    expect(screen.getByText('7')).toBeInTheDocument();
    expect(screen.getByText('8')).toBeInTheDocument();
    expect(screen.getByText('linha antiga')).toBeInTheDocument();
    expect(screen.getByText('linha nova')).toBeInTheDocument();
  });
});
