import { v7 as uuidv7 } from 'uuid';
import type { Db } from '../db/client';
import { auditLog } from '../db/schema';

export type AuditEntry = {
  userId?: string;
  action: string;
  targetType?: string;
  targetId?: string;
  data?: unknown;
  ip?: string;
};

export function audit(db: Db, entry: AuditEntry): void {
  db.insert(auditLog)
    .values({
      id: uuidv7(),
      userId: entry.userId ?? null,
      action: entry.action,
      targetType: entry.targetType ?? null,
      targetId: entry.targetId ?? null,
      dataJson: entry.data === undefined ? null : JSON.stringify(entry.data),
      ip: entry.ip ?? null,
      createdAt: Date.now(),
    })
    .run();
}
