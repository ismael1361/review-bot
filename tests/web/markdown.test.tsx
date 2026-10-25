// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Markdown } from '../../src/web/components/Markdown';

describe('Markdown', () => {
  it('renderiza títulos, negrito, código inline, listas e bloco de código', () => {
    render(
      <Markdown
        source={'# Título um\n\n## Título\n\nTexto com **negrito** e `código`.\n\n- item um\n- item dois\n\n```ts\nconst a = 1;\n```'}
      />,
    );
    expect(screen.getByRole('heading', { level: 1, name: 'Título um' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2, name: 'Título' })).toBeInTheDocument();
    expect(screen.getByText('negrito').tagName).toBe('STRONG');
    expect(screen.getByText('código').tagName).toBe('CODE');
    expect(screen.getAllByRole('listitem')).toHaveLength(2);
    expect(screen.getByText('const a = 1;')).toBeInTheDocument();
    expect(screen.queryByText('ts')).not.toBeInTheDocument();
  });

  it('escapa HTML bruto', () => {
    render(<Markdown source={'<script>alert(1)</script>'} />);
    expect(screen.getByText('<script>alert(1)</script>')).toBeInTheDocument();
  });

  it('renderiza um bloco de código não terminado', () => {
    render(<Markdown source={'```ts\nconst a = 1;\nconst b = 2;'} />);
    expect(
      screen.getByText(
        (_, element) => element?.tagName === 'CODE' && element.textContent === 'const a = 1;\nconst b = 2;',
      ),
    ).toBeInTheDocument();
  });
});
