const PEM_BEGIN = /-----BEGIN [A-Z ]*PRIVATE KEY-----/g;
const PEM_END = /-----END [A-Z ]*PRIVATE KEY-----/g;

const PATTERNS: RegExp[] = [
  /(?<![A-Za-z0-9])gh[opsur]_[A-Za-z0-9]{36,}(?![A-Za-z0-9])/g,
  /(?<![A-Za-z0-9])github_pat_[A-Za-z0-9_]{22,}(?![A-Za-z0-9])/g,
  /(?<![A-Za-z0-9])A(?:KIA|SIA)[0-9A-Z]{16,}(?![A-Za-z0-9])/g,
  /(?<![A-Za-z0-9])xox[baprs]-[A-Za-z0-9-]{10,}(?![A-Za-z0-9])/g,
  /(?<![A-Za-z0-9])AIza[0-9A-Za-z_-]{35,}(?![A-Za-z0-9])/g,
  /(?<![A-Za-z0-9])sk-(?:[A-Za-z0-9]{20,}|(?:proj|ant|svcacct|admin)-[A-Za-z0-9_-]{20,})(?![A-Za-z0-9])/g,
];

function redactPemBlocks(text: string): { text: string; redacted: boolean } {
  let result = '';
  let cursor = 0;
  let redacted = false;
  PEM_BEGIN.lastIndex = 0;
  let begin = PEM_BEGIN.exec(text);
  while (begin) {
    result += text.slice(cursor, begin.index);
    PEM_END.lastIndex = PEM_BEGIN.lastIndex;
    const end = PEM_END.exec(text);
    cursor = end ? PEM_END.lastIndex : text.length;
    result += '[REDACTED]';
    redacted = true;
    PEM_BEGIN.lastIndex = cursor;
    begin = end ? PEM_BEGIN.exec(text) : null;
  }
  return redacted ? { text: result + text.slice(cursor), redacted } : { text, redacted: false };
}

export function redactSecrets(text: string): { text: string; redacted: boolean } {
  const pem = redactPemBlocks(text);
  let result = pem.text;
  let redacted = pem.redacted;
  for (const pattern of PATTERNS) {
    result = result.replace(pattern, () => {
      redacted = true;
      return '[REDACTED]';
    });
  }
  return { text: result, redacted };
}
