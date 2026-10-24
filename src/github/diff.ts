export type DiffLine = {
  type: 'context' | 'add' | 'del';
  oldLine: number | null;
  newLine: number | null;
  text: string;
};

export type DiffHunk = {
  header: string;
  oldStart: number;
  newStart: number;
  lines: DiffLine[];
};

const HUNK_HEADER = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/;

export function parseFilePatch(patch: string): DiffHunk[] {
  const hunks: DiffHunk[] = [];
  let current: DiffHunk | undefined;
  let oldLine = 0;
  let newLine = 0;
  for (const raw of patch.replace(/\r\n/g, '\n').split('\n')) {
    if (raw.length === 0) {
      continue;
    }
    const header = raw.match(HUNK_HEADER);
    if (header) {
      oldLine = Number(header[1]);
      newLine = Number(header[2]);
      current = { header: raw, oldStart: oldLine, newStart: newLine, lines: [] };
      hunks.push(current);
      continue;
    }
    if (!current || raw.startsWith('\\')) {
      continue;
    }
    const marker = raw[0];
    const text = raw.slice(1);
    if (marker === '+') {
      current.lines.push({ type: 'add', oldLine: null, newLine, text });
      newLine += 1;
    } else if (marker === '-') {
      current.lines.push({ type: 'del', oldLine, newLine: null, text });
      oldLine += 1;
    } else if (marker === ' ') {
      current.lines.push({ type: 'context', oldLine, newLine, text });
      oldLine += 1;
      newLine += 1;
    }
  }
  return hunks;
}

export function validRightLines(hunks: DiffHunk[]): Set<number> {
  const lines = new Set<number>();
  for (const hunk of hunks) {
    for (const line of hunk.lines) {
      if (line.type !== 'del' && line.newLine !== null) {
        lines.add(line.newLine);
      }
    }
  }
  return lines;
}

export function targetHunk(hunks: DiffHunk[], line: number): DiffHunk | undefined {
  return hunks.find((hunk) => hunk.lines.some((item) => item.newLine === line));
}

export function renderDiffSnippet(
  hunks: DiffHunk[],
  line: number,
  context = 3,
): { lines: DiffLine[]; targetLine: number } | undefined {
  const hunk = targetHunk(hunks, line);
  if (!hunk) {
    return undefined;
  }
  const index = hunk.lines.findIndex((item) => item.newLine === line);
  const span = Math.max(0, Math.trunc(context));
  const start = Math.max(0, index - span);
  const end = Math.min(hunk.lines.length, index + span + 1);
  return { lines: hunk.lines.slice(start, end), targetLine: line };
}
