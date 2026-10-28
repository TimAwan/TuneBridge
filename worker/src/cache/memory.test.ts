import { describe, expect, it } from 'vitest';
import { MemoryLruCache } from './memory';
import type { AppleSong } from '@tunebridge/shared';

function song(id: string): AppleSong {
  return {
    id,
    title: `t${id}`,
    artists: ['a'],
    album: 'al',
    durationMs: 1000,
    storefront: 'CN',
    artworkUrl: 'https://x/1.jpg',
    versionHints: [],
  };
}

function bigSong(id: string, pad: number): AppleSong {
  return { ...song(id), title: 'x'.repeat(pad) };
}

describe('MemoryLruCache', () => {
  it('evicts least recently accessed at 500 entries', () => {
    const cache = new MemoryLruCache();
    for (let i = 0; i < 500; i++) cache.set(`k${i}`, [song(String(i))], { empty: false });
    expect(cache.size).toBe(500);
    // touch k0 so k1 becomes LRU
    cache.get('k0');
    cache.set('k500', [song('500')], { empty: false });
    expect(cache.size).toBe(500);
    expect(cache.get('k1')).toBeNull();
    expect(cache.get('k0')).not.toBeNull();
  });

  it('keeps hit entries for 6 hours and empty entries for 5 minutes', () => {
    const cache = new MemoryLruCache();
    const T0 = 1_000_000;
    cache.set('hit', [song('1')], { empty: false }, T0);
    cache.set('empty', [], { empty: true }, T0);

    const at = (key: string, ms: number) => cache.getAt(key, T0 + ms);
    expect(at('empty', 5 * 60 * 1000 - 1)).not.toBeNull(); // empty still valid
    expect(at('empty', 5 * 60 * 1000 + 1)).toBeNull(); // empty expired
    expect(at('hit', 6 * 3600 * 1000 - 1)).not.toBeNull(); // hit still valid
    expect(at('hit', 6 * 3600 * 1000 + 1)).toBeNull(); // hit expired
  });

  it('evicts by serialized byte budget', () => {
    const cache = new MemoryLruCache(1000, 6 * 3600 * 1000, 5 * 60 * 1000, 4 * 1024 * 1024);
    const each = 600 * 1024; // ~600KB per entry
    cache.set('a', [bigSong('a', each)], { empty: false });
    cache.set('b', [bigSong('b', each)], { empty: false });
    cache.set('c', [bigSong('c', each)], { empty: false });
    cache.set('d', [bigSong('d', each)], { empty: false });
    cache.set('e', [bigSong('e', each)], { empty: false });
    cache.set('f', [bigSong('f', each)], { empty: false });
    cache.set('g', [bigSong('g', each)], { empty: false });
    cache.set('h', [bigSong('h', each)], { empty: false });
    expect(cache.size).toBeLessThan(8);
    expect(cache.size).toBeGreaterThan(4);
    expect(cache.get('a')).toBeNull();
    expect(cache.get('h')).not.toBeNull();
    expect(cache.bytes).toBeLessThanOrEqual(4 * 1024 * 1024);
  });

  it('tracks size and bytes accurately', () => {
    const cache = new MemoryLruCache(1000);
    cache.set('k', [song('1')], { empty: false });
    expect(cache.size).toBe(1);
    expect(cache.bytes).toBeGreaterThan(0);
    const before = cache.bytes;
    cache.set('k2', [song('2')], { empty: false });
    expect(cache.bytes).toBeGreaterThan(before);
  });
});
