import type { AppleSong } from '@tunebridge/shared';

const encoder = new TextEncoder();

export interface CachedRow {
  key: string;
  value: AppleSong[];
  empty: boolean;
  /** 存储时刻(ms),旧写不得覆盖新写 */
  storedAt: number;
  /** 绝对到期时间(ms);从持久层载入不重新计算 */
  expiresAt: number;
}

export interface PersistentStore {
  get(key: string): Promise<CachedRow | null>;
  /** 若已存 storedAt 不小于本行者则跳过(旧不盖新) */
  put(row: CachedRow): Promise<void>;
  /** 删过期行;超容量按最旧淘汰 */
  sweep(now: number): Promise<void>;
}

interface StoredEntry extends CachedRow {
  bytes: number;
}

export class InMemoryPersistentStore implements PersistentStore {
  private map = new Map<string, StoredEntry>();
  private totalBytes = 0;

  constructor(
    private readonly maxRows = 10000,
    private readonly maxBytes = 32 * 1024 * 1024,
  ) {}

  async get(key: string): Promise<CachedRow | null> {
    const entry = this.map.get(key) ?? null;
    if (!entry) return null;
    return { key, value: entry.value, empty: entry.empty, storedAt: entry.storedAt, expiresAt: entry.expiresAt };
  }

  async put(row: CachedRow): Promise<void> {
    const existing = this.map.get(row.key);
    if (existing && existing.storedAt >= row.storedAt) return;
    const bytes = encoder.encode(JSON.stringify(row.value)).length;
    if (existing) {
      this.map.delete(row.key);
      this.totalBytes -= existing.bytes;
    }
    this.map.set(row.key, { ...row, bytes });
    this.totalBytes += bytes;
    while ((this.map.size > this.maxRows || this.totalBytes > this.maxBytes) && this.map.size > 1) {
      const oldest = this.map.keys().next().value as string;
      const e = this.map.get(oldest);
      if (!e) break;
      this.map.delete(oldest);
      this.totalBytes -= e.bytes;
    }
  }

  async sweep(now: number): Promise<void> {
    for (const [key, entry] of this.map) {
      if (entry.expiresAt <= now) {
        this.map.delete(key);
        this.totalBytes -= entry.bytes;
      }
    }
  }

  async size(): Promise<number> {
    return this.map.size;
  }
}
