import type { AppleSong } from '@tunebridge/shared';

const encoder = new TextEncoder();

interface Entry {
  value: AppleSong[];
  expiresAt: number;
  bytes: number;
}

export class MemoryLruCache {
  private map = new Map<string, Entry>();
  private totalBytes = 0;

  constructor(
    private readonly maxEntries = 500,
    private readonly hitTtlMs = 6 * 3600 * 1000,
    private readonly emptyTtlMs = 5 * 60 * 1000,
    private readonly maxBytes = 4 * 1024 * 1024,
  ) {}

  get(key: string): { value: AppleSong[]; expiresAt: number } | null {
    return this.getAt(key, Date.now());
  }

  getAt(key: string, now: number): { value: AppleSong[]; expiresAt: number } | null {
    return this.readKey(key, now);
  }

  set(key: string, value: AppleSong[], opts: { empty: boolean }, now: number = Date.now()): void {
    this.writeEntry(key, value, opts.empty, now);
  }

  private readKey(key: string, now: number): { value: AppleSong[]; expiresAt: number } | null {
    const entry = this.map.get(key);
    if (!entry) return null;
    if (entry.expiresAt <= now) {
      this.drop(key, entry);
      return null;
    }
    this.map.delete(key);
    this.map.set(key, entry);
    return { value: entry.value, expiresAt: entry.expiresAt };
  }

  private writeEntry(key: string, value: AppleSong[], empty: boolean, now: number): void {
    const bytes = encoder.encode(JSON.stringify(value)).length;
    const existing = this.map.get(key);
    if (existing) this.drop(key, existing);
    const entry: Entry = { value, bytes, expiresAt: now + (empty ? this.emptyTtlMs : this.hitTtlMs) };
    this.map.set(key, entry);
    this.totalBytes += bytes;
    while (
      (this.map.size > this.maxEntries || this.totalBytes > this.maxBytes) &&
      this.map.size > 1
    ) {
      const oldest = this.map.keys().next().value as string;
      const e = this.map.get(oldest);
      if (e) this.drop(oldest, e);
    }
  }

  private drop(key: string, entry: Entry): void {
    this.map.delete(key);
    this.totalBytes -= entry.bytes;
  }

  get size(): number {
    return this.map.size;
  }

  get bytes(): number {
    return this.totalBytes;
  }
}
