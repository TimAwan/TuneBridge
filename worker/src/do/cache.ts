import { DurableObject } from 'cloudflare:workers';
import type { CachedRow, PersistentStore } from '../cache/store';

const MAX_ROWS = 10000;
const MAX_BYTES = 32 * 1024 * 1024;
const COOLDOWN_MS = 60_000;

type RowRecord = {
  key: string;
  storedAt: number;
  expiresAt: number;
  empty: number;
  payload: string;
};

export class CacheDO extends DurableObject implements PersistentStore {
  private initialized = false;
  private brokenUntil = 0;

  constructor(ctx: DurableObjectState, env: Record<string, unknown>) {
    super(ctx, env);
  }

  private ensureTable(): void {
    if (!this.initialized) {
      this.ctx.storage.sql.exec(
        'CREATE TABLE IF NOT EXISTS rows (key TEXT PRIMARY KEY, storedAt INTEGER NOT NULL, expiresAt INTEGER NOT NULL, empty INTEGER NOT NULL, payload TEXT NOT NULL)',
      );
      this.initialized = true;
    }
  }

  private available(now = Date.now()): boolean {
    return now >= this.brokenUntil;
  }

  async get(key: string): Promise<CachedRow | null> {
    if (!this.available()) return null;
    try {
      this.ensureTable();
      const rows = [...this.ctx.storage.sql.exec<RowRecord>(
        'SELECT key, storedAt, expiresAt, empty, payload FROM rows WHERE key = ?',
        key,
      )];
      const rec = rows[0];
      if (!rec) return null;
      return {
        key: rec.key,
        value: JSON.parse(rec.payload) as CachedRow['value'],
        empty: rec.empty === 1,
        storedAt: rec.storedAt,
        expiresAt: rec.expiresAt,
      };
    } catch {
      this.brokenUntil = Date.now() + COOLDOWN_MS;
      return null;
    }
  }

  async put(row: CachedRow): Promise<void> {
    if (!this.available(row.storedAt)) return;
    try {
      this.ensureTable();
      this.ctx.storage.sql.exec('BEGIN');
      const existing = [...this.ctx.storage.sql.exec<{ storedAt: number }>(
        'SELECT storedAt FROM rows WHERE key = ?',
        row.key,
      )][0];
      if (existing && existing.storedAt >= row.storedAt) {
        this.ctx.storage.sql.exec('COMMIT');
        return;
      }
      this.ctx.storage.sql.exec(
        'INSERT OR REPLACE INTO rows (key, storedAt, expiresAt, empty, payload) VALUES (?, ?, ?, ?, ?)',
        row.key,
        row.storedAt,
        row.expiresAt,
        row.empty ? 1 : 0,
        JSON.stringify(row.value),
      );
      this.enforceCaps();
      this.ctx.storage.sql.exec('COMMIT');
    } catch {
      this.brokenUntil = Date.now() + COOLDOWN_MS;
      try {
        this.ctx.storage.sql.exec('ROLLBACK');
      } catch {
        // 事务本就未开启
      }
    }
  }

  async sweep(now: number): Promise<void> {
    if (!this.available()) return;
    try {
      this.ensureTable();
      this.ctx.storage.sql.exec('DELETE FROM rows WHERE expiresAt <= ?', now);
      this.enforceCaps();
    } catch {
      this.brokenUntil = Date.now() + COOLDOWN_MS;
    }
  }

  private enforceCaps(): void {
    const count = [...this.ctx.storage.sql.exec<{ n: number }>('SELECT COUNT(*) AS n FROM rows')][0]?.n ?? 0;
    if (count > MAX_ROWS) {
      this.ctx.storage.sql.exec(
        `DELETE FROM rows WHERE key IN (SELECT key FROM rows ORDER BY storedAt ASC LIMIT ?)`,
        count - MAX_ROWS,
      );
    }
    const bytes =
      [...this.ctx.storage.sql.exec<{ n: number }>('SELECT COALESCE(SUM(LENGTH(payload)), 0) AS n FROM rows')][0]?.n ?? 0;
    if (bytes > MAX_BYTES) {
      const over = bytes - MAX_BYTES;
      this.ctx.storage.sql.exec(
        `DELETE FROM rows WHERE key IN (SELECT key FROM rows ORDER BY storedAt ASC LIMIT (SELECT COUNT(*) FROM rows) / 2)`,
      );
      void over;
    }
  }
}
