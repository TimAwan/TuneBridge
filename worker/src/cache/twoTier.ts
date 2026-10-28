import type { AppleSong } from '@tunebridge/shared';
import { Semaphore, type AppleFetchers } from '../apple/client';
import { isrcKey, MemoryLruCache, searchKey } from './memory';
import type { CachedRow, PersistentStore } from './store';

const HIT_TTL_MS = 6 * 3600 * 1000;
const EMPTY_TTL_MS = 5 * 60 * 1000;
const DEFAULT_WAIT_BUDGET_MS = 1000;
const DEFAULT_MAX_PENDING = 40;
const DEFAULT_COOLDOWN_MS = 60_000;

function withTimeout<T>(p: Promise<T>, ms: number): Promise<{ ok: true; value: T } | { ok: false }> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<{ ok: false }>((resolve) => {
    timer = setTimeout(() => resolve({ ok: false }), ms);
  });
  return Promise.race([p.then((value) => ({ ok: true as const, value })), timeout]).finally(
    () => clearTimeout(timer),
  );
}

export interface TwoTierCacheOpts {
  upstream: AppleFetchers;
  persistent: PersistentStore | null;
  waitBudgetMs?: number;
  maxPending?: number;
  cooldownMs?: number;
  memory?: MemoryLruCache;
  now?: () => number;
}

export class TwoTierCache implements AppleFetchers {
  private readonly upstream: AppleFetchers;
  private readonly persistent: PersistentStore | null;
  private readonly waitBudgetMs: number;
  private readonly cooldownMs: number;
  private readonly memory: MemoryLruCache;
  private readonly now: () => number;
  private readonly inflight = new Map<string, Promise<AppleSong[]>>();
  private readonly slots: Semaphore;
  private brokenUntil = 0;

  constructor(opts: TwoTierCacheOpts) {
    this.upstream = opts.upstream;
    this.persistent = opts.persistent;
    this.waitBudgetMs = opts.waitBudgetMs ?? DEFAULT_WAIT_BUDGET_MS;
    this.cooldownMs = opts.cooldownMs ?? DEFAULT_COOLDOWN_MS;
    this.memory = opts.memory ?? new MemoryLruCache();
    this.now = opts.now ?? (() => Date.now());
    this.slots = new Semaphore(opts.maxPending ?? DEFAULT_MAX_PENDING);
  }

  search(term: string, storefront: string): Promise<AppleSong[]> {
    return this.run(searchKey(storefront, term), () => this.upstream.search(term, storefront));
  }

  findByIsrc(isrcs: string[], storefront: string): Promise<AppleSong[]> {
    return this.run(isrcKey(storefront, isrcs), () => this.upstream.findByIsrc(isrcs, storefront));
  }

  private run(key: string, upstreamFn: () => Promise<AppleSong[]>): Promise<AppleSong[]> {
    const existing = this.inflight.get(key);
    if (existing) return existing;
    const task = this.slots.run(async () => {
      const memHit = this.memory.getAt(key, this.now());
      if (memHit) return memHit.value;

      const row = await this.readPersistent(key);
      if (row && row.expiresAt > this.now()) {
        this.memory.restore(key, row.value, row.expiresAt);
        return row.value;
      }

      const songs = await upstreamFn();
      const t = this.now();
      this.memory.set(key, songs, { empty: songs.length === 0 }, t);
      this.writePersistent({
        key,
        value: songs,
        empty: songs.length === 0,
        storedAt: t,
        expiresAt: t + (songs.length > 0 ? HIT_TTL_MS : EMPTY_TTL_MS),
      });
      return songs;
    });
    const tracked = task.finally(() => {
      this.inflight.delete(key);
    });
    this.inflight.set(key, tracked);
    return tracked;
  }

  private async readPersistent(key: string): Promise<CachedRow | null> {
    if (!this.persistent || this.now() < this.brokenUntil) return null;
    try {
      const raced = await withTimeout(this.persistent.get(key), this.waitBudgetMs);
      return raced.ok ? raced.value : null;
    } catch {
      this.brokenUntil = this.now() + this.cooldownMs;
      return null;
    }
  }

  private writePersistent(row: CachedRow): void {
    if (!this.persistent || this.now() < this.brokenUntil) return;
    void withTimeout(this.persistent.put(row), this.waitBudgetMs).then(undefined, () => {
      this.brokenUntil = this.now() + this.cooldownMs;
    });
  }
}
