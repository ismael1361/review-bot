import { createDb, type Db } from '../../src/db/client';
import { runMigrations } from '../../src/db/migrate';

export function createTestDb(): Db {
  const { db } = createDb(':memory:');
  runMigrations(db, 'drizzle');
  return db;
}
