import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import type { AppleSong } from '@tunebridge/shared';
import { InMemoryPersistentStore, type CachedRow, type PersistentStore } from './store';
import { TwoTierCache } from './twoTier';
import type { AppleFetchers } from '../apple/client';

function song(id: string): AppleSong {
  return {
    id,
    title: `t${id}`,
    artists: ['a'],
    album: 'al',
    durationMs: 1000,
    storefront: 'CN',
    artworkUrl: 'u',
    versionHints: [],
  };
}

function makeUpstream() {
  const calls: string[] = [];
  const gates: Array<(songs: AppleSong[]) => void> = [];
  const upstream: AppleFetchers = {
    async search(term) {
      calls.push(term);
      if (term.startsWith('gated')) {
        return new Promise<AppleSong[]>((resolve) => gates.push(resolve));
      }
      return [song(term)];
    },
    async findByIsrc() {
      return [];
    },
  };
  return { calls, gates, upstream };
}

const flush = () => new Promise<void>((r) => setTimeout(r, 0));

describe('TwoTierCache', () => {
  it('serves memory hits without touching persistent or upstream', async () => {
    const store = new InMemoryPersistentStore();
    const { calls, upstream } = makeUpstream();
    const cache = new TwoTierCache({ upstream, persistent: store });
    await cache.search('m1', 'CN');
    await cache.search('m1', 'CN');
    expect(calls).toEqual(['m1']);
    expect(await store.get('search:CN:m1')).not.toBeNull();
  });

  it('returns persistent hits with original expiry not extended', async () => {
    vi.useFakeTimers();
    try {
      const T0 = Date.now();
      const store = new InMemoryPersistentStore();
      const hitRow: CachedRow = {
        key: 'search:CN:p1',
        value: [song('p1')],
        empty: false,
        storedAt: T0 - 3600_000,
        expiresAt: T0 + 3600_000, // 还剩 1 小时,而不是重新计 6 小时
      };
      await store.put(hitRow);
      const { calls, upstream } = makeUpstream();
      const cache = new TwoTierCache({ upstream, persistent: store });
      const songs = await cache.search('p1', 'CN');
      expect(songs[0].id).toBe('p1');
      expect(calls).toEqual([]);
      // 原有效期之后必须失效:过期后应回源
      vi.setSystemTime(T0 + 3600_000 + 10);
      await cache.search('p1', 'CN');
      expect(calls).toEqual(['p1']);
    } finally {
      vi.useRealTimers();
    }
  });

  it('gives up waiting on a slow persistent get without blocking the result', async () => {
    vi.useFakeTimers();
    try {
      const slowStore: PersistentStore = {
        get: () => new Promise<CachedRow | null>(() => {}), // 永不完成
        put: async () => {},
        sweep: async () => {},
      };
      const { upstream } = makeUpstream();
      const cache = new TwoTierCache({ upstream, persistent: slowStore, waitBudgetMs: 1000 });
      const p = cache.search('slow', 'CN');
      vi.advanceTimersByTime(1100);
      const songs = await p;
      expect(songs[0].id).toBe('slow');
    } finally {
      vi.useRealTimers();
    }
  });

  it('cools down for 60s after a persistent failure, then recovers', async () => {
    vi.useFakeTimers();
    try {
      let failures = 0;
      let getPuts = 0;
      const flaky: PersistentStore = {
        get: async () => {
          getPuts++;
          if (failures > 0) {
            failures--;
            throw new Error('sqlite broke');
          }
          return null;
        },
        put: async () => {},
        sweep: async () => {},
      };
      const { upstream } = makeUpstream();
      const cache = new TwoTierCache({ upstream, persistent: flaky });

      failures = 1;
      await cache.search('f1', 'CN'); // 触发故障 → 进入冷却
      expect(getPuts).toBe(1);

      getPuts = 0;
      await cache.search('f2', 'CN'); // 冷却期内:跳过持久层
      expect(getPuts).toBe(0);

      vi.advanceTimersByTime(60_000 + 100);
      await cache.search('f3', 'CN'); // 冷却结束:恢复尝试
      expect(getPuts).toBe(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('caps pending operations at 40 with single-flight merging', async () => {
    const store = new InMemoryPersistentStore();
    const { calls, gates, upstream } = makeUpstream();
    const cache = new TwoTierCache({ upstream, persistent: store });

    const pending: Array<Promise<AppleSong[]>> = [];
    for (let i = 0; i < 40; i++) {
      pending.push(cache.search(`gated${i}`, 'CN'));
    }
    await flush(); // 让任务进入信号量并推进异步链
    await flush();
    expect(calls).toHaveLength(40);

    const fortyFirst = cache.search('gated40', 'CN');
    await flush();
    await flush();
    expect(calls).toHaveLength(40); // 第 41 个在等待槽位

    gates[0]([song('gated0')]);
    await flush();
    await flush();
    expect(calls).toHaveLength(41); // 释放一个槽位后进入

    gates.shift();
    for (const g of gates) g([song('done')]);
    const all = await Promise.all([...pending, fortyFirst]);
    expect(all).toHaveLength(41);
  });

  it('merges concurrent identical requests into one upstream call', async () => {
    const store = new InMemoryPersistentStore();
    const { calls, gates, upstream } = makeUpstream();
    const cache = new TwoTierCache({ upstream, persistent: store });
    const p1 = cache.search('gated-x', 'CN');
    const p2 = cache.search('gated-x', 'CN');
    await flush();
    await flush();
    expect(calls).toEqual(['gated-x']);
    gates[0]([song('x')]);
    const [a, b] = await Promise.all([p1, p2]);
    expect(a[0].id).toBe('x');
    expect(b[0].id).toBe('x');
  });
});

describe('TwoTierCache.findByIsrc passthrough', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('caches by isrc key and storefront', async () => {
    const store = new InMemoryPersistentStore();
    let calls = 0;
    const upstream: AppleFetchers = {
      search: async () => [],
      async findByIsrc(isrcs) {
        calls++;
        return isrcs.map((i) => song(i));
      },
    };
    const cache = new TwoTierCache({ upstream, persistent: store });
    await cache.findByIsrc(['B', 'A'], 'JP');
    await cache.findByIsrc(['A', 'B'], 'JP'); // 顺序无关
    expect(calls).toBe(1);
    const row = await store.get('isrc:JP:A,B');
    expect(row).not.toBeNull();
  });
});
