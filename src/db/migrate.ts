import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import type { Db } from './client';

export function runMigrations(db: Db, folder: string): void {
  migrate(db, { migrationsFolder: folder });
}
