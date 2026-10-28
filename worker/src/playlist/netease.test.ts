import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { PlaylistFetchError } from './adapter';
import { neteaseAdapter, parseNetease } from './netease';

const fixtureDir = join(fileURLToPath(new URL('.', import.meta.url)), 'fixtures');
const raw = JSON.parse(readFileSync(join(fixtureDir, 'netease.json'), 'utf8')) as unknown;
const edgeRaw = JSON.parse(readFileSync(join(fixtureDir, 'netease.edge.json'), 'utf8')) as unknown;

describe('parseNetease', () => {
  it('maps playlist metadata', () => {
    const parsed = parseNetease(raw);
    expect(parsed.platform).toBe('netease');
    expect(parsed.playlistId).toBe('3778678');
    expect(parsed.name).toBe('热歌榜');
    expect(parsed.creator).toBe('网易云音乐');
    expect(parsed.coverUrl).toMatch(/^https:\/\//);
  });

  it('keeps source order and maps track fields', () => {
    const { tracks } = parseNetease(raw);
    expect(tracks).toHaveLength(8);
    expect(tracks.map((t) => t.order)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(tracks[0]).toMatchObject({
      title: '我不难过',
      artists: ['孙燕姿'],
      artistRaw: '孙燕姿',
      album: '未完成',
      durationMs: 320400,
    });
    expect(tracks[0].aliases).toEqual([]);
  });

  it('keeps platform-provided aliases', () => {
    const { tracks } = parseNetease(raw);
    expect(tracks[1].aliases).toContain('求你别离开我');
  });

  it('splits multi-artist credits', () => {
    const { tracks } = parseNetease(raw);
    expect(tracks[3].artists).toEqual(['DOUDOU', '燕云十六声']);
    expect(tracks[3].artistRaw).toBe('DOUDOU / 燕云十六声');
  });

  it('extracts bracket suffixes as aliases', () => {
    const { tracks } = parseNetease(raw);
    expect(tracks[7].title).toBe('甲乙丙丁 (你我怎么两清)');
    expect(tracks[7].aliases).toContain('你我怎么两清');
  });

  it('tolerates missing fields without throwing', () => {
    const { tracks } = parseNetease(edgeRaw);
    expect(tracks).toHaveLength(2);
    expect(tracks[1].artists).toEqual([]);
    expect(tracks[1].artistRaw).toBe('');
    expect(tracks[1].durationMs).toBe(0);
    expect(tracks[1].aliases).toContain('Live');
  });
});

describe('neteaseAdapter.extractId', () => {
  it('reads id from hash-style url', () => {
    expect(neteaseAdapter.extractId('https://music.163.com/#/playlist?id=2829896383')).toBe('2829896383');
  });

  it('reads id from path-style url', () => {
    expect(neteaseAdapter.extractId('https://music.163.com/playlist?id=123')).toBe('123');
  });

  it('does not guess an id from short links', () => {
    expect(neteaseAdapter.extractId('https://163cn.tv/xyz')).toBeNull();
  });
});

describe('neteaseAdapter.fetchPlaylist', () => {
  it('fetches and parses', async () => {
    const fetchFn = (() =>
      Promise.resolve(new Response(JSON.stringify(raw), { status: 200 }))) as typeof fetch;
    const parsed = await neteaseAdapter.fetchPlaylist('3778678', fetchFn);
    expect(parsed.name).toBe('热歌榜');
  });

  it('wraps api-level rejection in PlaylistFetchError', async () => {
    const fetchFn = (() =>
      Promise.resolve(new Response(JSON.stringify({ code: 20001, msg: '' }), { status: 200 }))) as typeof fetch;
    await expect(neteaseAdapter.fetchPlaylist('1', fetchFn)).rejects.toBeInstanceOf(PlaylistFetchError);
  });

  it('wraps network failure in PlaylistFetchError with chinese message', async () => {
    const fetchFn = (() => Promise.reject(new Error('network down'))) as typeof fetch;
    await expect(neteaseAdapter.fetchPlaylist('1', fetchFn)).rejects.toThrow('无法访问网易云');
  });
});
