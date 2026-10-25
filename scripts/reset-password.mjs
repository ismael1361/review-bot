import Database from 'better-sqlite3';
import { hash } from '@node-rs/argon2';
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { createInterface } from 'node:readline/promises';

const username = process.argv[2];

if (!username) {
  console.error('Uso: node scripts/reset-password.mjs <username>');
  process.exit(1);
}

const dataDir = process.env.DATA_DIR ?? './data';
const source = join(dataDir, 'review-bot.db');

if (!existsSync(source)) {
  console.error(`Banco de dados não encontrado: ${source}`);
  process.exit(1);
}

const db = new Database(source);
const user = db.prepare('SELECT id FROM users WHERE username = ?').get(username.toLowerCase());

if (!user) {
  db.close();
  console.error('Usuário não encontrado');
  process.exit(1);
}

const rl = createInterface({ input: process.stdin, output: process.stdout });
const password = await rl.question('Nova senha (mínimo 12 caracteres): ');
rl.close();

if (password.length < 12) {
  db.close();
  console.error('Senha curta: mínimo de 12 caracteres');
  process.exit(1);
}

const passwordHash = await hash(password, { memoryCost: 65536, timeCost: 3, parallelism: 1 });
const now = Date.now();
db.transaction(() => {
  db.prepare('UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?').run(passwordHash, now, user.id);
  db.prepare('DELETE FROM sessions WHERE user_id = ?').run(user.id);
  db.prepare('INSERT INTO audit_log (id, user_id, action, target_type, target_id, data_json, ip, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(
    randomUUID(),
    user.id,
    'user.password_reset',
    'user',
    user.id,
    JSON.stringify({ username: username.toLowerCase(), source: 'reset-password-script' }),
    null,
    now,
  );
})();
db.close();
console.log('Senha redefinida e sessões revogadas.');
