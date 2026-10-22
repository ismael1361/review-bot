import Database from 'better-sqlite3';
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import * as schema from './schema';

export type Db = BetterSQLite3Database<typeof schema>;

export function createDb(path: string): { sqlite: Database.Database; db: Db } {
  const sqlite = new Database(path);
  sqlite.pragma('foreign_keys = ON');
  sqlite.pragma('busy_timeout = 5000');
  if (path !== ':memory:') {
    sqlite.pragma('journal_mode = WAL');
  }
  const db = drizzle(sqlite, { schema });
  return { sqlite, db };
}
