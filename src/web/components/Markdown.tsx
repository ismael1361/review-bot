import { Fragment, type ReactNode } from 'react';

function renderInline(text: string, keyPrefix: string): ReactNode[] {
  const parts = text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g).filter((part) => part.length > 0);
  return parts.map((part, index) => {
    const key = `${keyPrefix}-${index}`;
    if (part.startsWith('**') && part.endsWith('**')) {
      return <strong key={key}>{part.slice(2, -2)}</strong>;
    }
    if (part.startsWith('`') && part.endsWith('`')) {
      return (
        <code key={key} className="rounded bg-[var(--sunken)] px-1 py-0.5 font-mono text-[0.85em] text-[var(--text)]">
          {part.slice(1, -1)}
        </code>
      );
    }
    return <Fragment key={key}>{part}</Fragment>;
  });
}

export function Markdown({ source }: { source: string }) {
  const blocks: ReactNode[] = [];
  let paragraph: string[] = [];
  let bullets: string[] = [];
  let code: string[] | null = null;

  const flushParagraph = () => {
    if (paragraph.length > 0) {
      blocks.push(
        <p key={`p-${blocks.length}`} className="mb-2 text-sm leading-relaxed text-[var(--text)]">
          {renderInline(paragraph.join(' '), `p-${blocks.length}`)}
        </p>,
      );
      paragraph = [];
    }
  };

  const flushBullets = () => {
    if (bullets.length > 0) {
      blocks.push(
        <ul key={`ul-${blocks.length}`} className="mb-2 list-disc space-y-1 pl-5 text-sm text-[var(--text)]">
          {bullets.map((item, index) => (
            <li key={`li-${blocks.length}-${index}`}>{renderInline(item, `li-${blocks.length}-${index}`)}</li>
          ))}
        </ul>,
      );
      bullets = [];
    }
  };

  const flushCode = () => {
    if (code !== null) {
      blocks.push(
        <pre
          key={`pre-${blocks.length}`}
          className="mb-2 overflow-x-auto rounded-lg border border-[var(--border)] bg-[var(--sunken)] p-3 font-mono text-xs text-[var(--text)]"
        >
          <code>{code.join('\n')}</code>
        </pre>,
      );
      code = null;
    }
  };

  const lines = source.replace(/\r\n?/g, '\n').split('\n');
  for (const raw of lines) {
    const line = raw.trimEnd();
    if (line.trimStart().startsWith('```')) {
      if (code === null) {
        flushParagraph();
        flushBullets();
        code = [];
      } else {
        flushCode();
      }
      continue;
    }
    if (code !== null) {
      code.push(raw);
      continue;
    }
    if (line.trim() === '') {
      flushParagraph();
      flushBullets();
      continue;
    }
    const heading = line.match(/^(#{1,3})\s+(.*)$/);
    if (heading?.[1] && heading[2] !== undefined) {
      flushParagraph();
      flushBullets();
      const level = heading[1].length;
      const className =
        level === 1
          ? 'mb-3 text-lg font-bold text-[var(--text)]'
          : level === 2
            ? 'mb-2 text-base font-semibold text-[var(--text)]'
            : 'mb-1 text-sm font-semibold text-[var(--text)]';
      const Tag = level === 1 ? 'h1' : level === 2 ? 'h2' : 'h3';
      blocks.push(
        <Tag key={`h-${blocks.length}`} className={className}>
          {renderInline(heading[2], `h-${blocks.length}`)}
        </Tag>,
      );
      continue;
    }
    const bullet = line.match(/^[-*]\s+(.*)$/);
    if (bullet?.[1] !== undefined) {
      flushParagraph();
      bullets.push(bullet[1]);
      continue;
    }
    paragraph.push(line.trim());
  }

  flushParagraph();
  flushBullets();
  flushCode();

  return <div>{blocks}</div>;
}
