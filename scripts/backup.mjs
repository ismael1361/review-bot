import Database from 'better-sqlite3';
import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const dataDir = process.env.DATA_DIR ?? './data';
const source = join(dataDir, 'review-bot.db');

if (!existsSync(source)) {
  console.error(`Banco de dados não encontrado: ${source}`);
  process.exit(1);
}

const outDir = join(dataDir, 'backups');
mkdirSync(outDir, { recursive: true });
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const target = join(outDir, `review-bot-${stamp}.db`);
const db = new Database(source, { readonly: true });

try {
  await db.backup(target);
} finally {
  db.close();
}

console.log(target);
