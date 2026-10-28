import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { PlaylistFetchError } from './adapter';
import { parseQq, qqAdapter } from './qq';

const fixtureDir = join(fileURLToPath(new URL('.', import.meta.url)), 'fixtures');
const raw = JSON.parse(readFileSync(join(fixtureDir, 'qq.json'), 'utf8')) as unknown;

describe('parseQq', () => {
  it('maps playlist metadata', () => {
    const parsed = parseQq(raw);
    expect(parsed.platform).toBe('qq');
    expect(parsed.playlistId).toBe('7256914512');
    expect(parsed.name).toBe('。。。。');
    expect(parsed.creator).toBe('旅行箱和梦想');
    expect(parsed.coverUrl).toMatch(/^https:\/\//);
  });

  it('maps tracks with multi-singer credits and seconds duration', () => {
    const { tracks } = parseQq(raw);
    expect(tracks).toHaveLength(8);
    expect(tracks.map((t) => t.order)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(tracks[0]).toMatchObject({
      title: 'Something Just Like This',
      artists: ['The Chainsmokers', 'Coldplay'],
      artistRaw: 'The Chainsmokers / Coldplay',
      album: 'Memories...Do Not Open',
      durationMs: 247000,
    });
  });

  it('extracts fullwidth bracket suffixes as aliases', () => {
    const { tracks } = parseQq(raw);
    expect(tracks[1].title).toBe('你是人间的四月天（你的姑娘）');
    expect(tracks[1].aliases).toContain('你的姑娘');
  });

  it('tolerates missing fields without throwing', () => {
    const { tracks } = parseQq(raw);
    expect(tracks[7].artists).toEqual([]);
    expect(tracks[7].durationMs).toBe(0);
    expect(tracks[7].album).toBe('');
    expect(tracks[7].aliases).toContain('Live');
  });
});

describe('qqAdapter.extractId', () => {
  it('reads id from ryqq path', () => {
    expect(qqAdapter.extractId('https://y.qq.com/n/ryqq/playlist/7256914512')).toBe('7256914512');
  });

  it('reads id from portal url', () => {
    expect(qqAdapter.extractId('https://y.qq.com/portal/playlist.html?id=7256914512')).toBe('7256914512');
  });

  it('returns null for other hosts', () => {
    expect(qqAdapter.extractId('https://music.163.com/playlist?id=1')).toBeNull();
  });
});

describe('qqAdapter.fetchPlaylist', () => {
  it('fetches and parses', async () => {
    const fetchFn = (() =>
      Promise.resolve(new Response(JSON.stringify(raw), { status: 200 }))) as typeof fetch;
    const parsed = await qqAdapter.fetchPlaylist('7256914512', fetchFn);
    expect(parsed.playlistId).toBe('7256914512');
  });

  it('throws PlaylistFetchError on empty cdlist', async () => {
    const fetchFn = (() =>
      Promise.resolve(new Response(JSON.stringify({ code: 0, cdlist: [] }), { status: 200 }))) as typeof fetch;
    await expect(qqAdapter.fetchPlaylist('1', fetchFn)).rejects.toBeInstanceOf(PlaylistFetchError);
  });
});
