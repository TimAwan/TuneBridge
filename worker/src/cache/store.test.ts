import { describe, expect, it } from 'vitest';
import type { AppleSong } from '@tunebridge/shared';
import { InMemoryPersistentStore, type CachedRow } from './store';

function song(id: string, pad = 0): AppleSong {
  return {
    id,
    title: 'x'.repeat(pad) || `t${id}`,
    artists: ['a'],
    album: 'al',
    durationMs: 1000,
    storefront: 'CN',
    artworkUrl: 'u',
    versionHints: [],
  };
}

function row(key: string, storedAt: number, pad = 0, expiresAt = storedAt + 6 * 3600 * 1000): CachedRow {
  return { key, value: [song(key, pad)], empty: false, storedAt, expiresAt };
}

describe('InMemoryPersistentStore', () => {
  it('sweeps expired rows', async () => {
    const store = new InMemoryPersistentStore();
    await store.put(row('a', 1000));
    await store.put(row('b', 1000, 0, 2000)); // expires at 2000
    await store.sweep(1999);
    expect(await store.get('a')).not.toBeNull();
    expect(await store.get('b')).not.toBeNull();
    await store.sweep(2001);
    expect(await store.get('b')).toBeNull();
    expect(await store.get('a')).not.toBeNull();
  });

  it('never lets an older write overwrite a newer one', async () => {
    const store = new InMemoryPersistentStore();
    await store.put(row('k', 5000));
    await store.put(row('k', 4000)); // older — must be ignored
    const got = await store.get('k');
    expect(got?.storedAt).toBe(5000);
    await store.put(row('k', 6000)); // newer — overwrites
    expect((await store.get('k'))?.storedAt).toBe(6000);
  });

  it('evicts oldest rows above the row cap', async () => {
    const store = new InMemoryPersistentStore(10);
    for (let i = 0; i < 12; i++) {
      await store.put(row(`k${i}`, 1000 + i));
    }
    expect(await store.get('k0')).toBeNull();
    expect(await store.get('k1')).toBeNull();
    expect(await store.get('k2')).not.toBeNull();
    expect(await store.get('k11')).not.toBeNull();
  });

  it('evicts oldest rows above the byte cap', async () => {
    const each = 1024 * 1024; // 1 MiB per row
    const store = new InMemoryPersistentStore(1000, 3 * each);
    for (let i = 0; i < 5; i++) {
      await store.put(row(`k${i}`, 1000 + i, each));
    }
    expect(await store.get('k0')).toBeNull();
    expect(await store.get('k4')).not.toBeNull();
    const size = await store.size();
    expect(size).toBeLessThanOrEqual(3);
  });
});
