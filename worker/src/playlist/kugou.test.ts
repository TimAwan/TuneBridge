import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { PlaylistFetchError } from './adapter';
import { kugouAdapter, parseKugou } from './kugou';

const fixtureDir = join(fileURLToPath(new URL('.', import.meta.url)), 'fixtures');
const raw = JSON.parse(readFileSync(join(fixtureDir, 'kugou.json'), 'utf8')) as unknown;

describe('parseKugou', () => {
  it('maps playlist metadata and resolves cover size placeholder', () => {
    const parsed = parseKugou(raw);
    expect(parsed.platform).toBe('kugou');
    expect(parsed.playlistId).toBe('2966690');
    expect(parsed.name).toBe('抖音最火：你一定听过的国风歌曲');
    expect(parsed.creator).toBe('口喜口合');
    expect(parsed.coverUrl).toMatch(/^http/);
    expect(parsed.coverUrl).not.toContain('{size}');
  });

  it('splits filename into artist and title', () => {
    const { tracks } = parseKugou(raw);
    expect(tracks).toHaveLength(8);
    expect(tracks[0]).toMatchObject({
      title: '旧梦一场',
      artists: ['阿悠悠'],
      artistRaw: '阿悠悠',
      durationMs: 174000,
    });
  });

  it('keeps parentheses inside artist names', () => {
    const { tracks } = parseKugou(raw);
    expect(tracks[1].artists).toEqual(['邓寓君(等什么君)']);
    expect(tracks[1].title).toBe('辞九门回忆');
  });

  it('reports missing album and tolerates duration 0', () => {
    const { tracks } = parseKugou(raw);
    expect(tracks[0].album).toBe('');
    expect(tracks[7].durationMs).toBe(0);
    expect(tracks[7].aliases).toContain('Live');
  });
});

describe('kugouAdapter.extractId', () => {
  it('reads numeric id from special single page', () => {
    expect(kugouAdapter.extractId('https://www.kugou.com/yy/special/single/2966690.html')).toBe('2966690');
  });

  it('does not guess numeric id from share codes', () => {
    expect(kugouAdapter.extractId('https://www.kugou.com/songlist/so-8qL8b6bcb/')).toBeNull();
  });
});

describe('kugouAdapter.fetchPlaylist', () => {
  it('fetches info and songs endpoints then parses', async () => {
    const calls: string[] = [];
    const fetchFn = ((input: RequestInfo | URL) => {
      const url = String(input);
      calls.push(url);
      const body = url.includes('/special/info')
        ? { status: 1, data: (raw as { info: unknown }).info }
        : (raw as { songs: unknown }).songs;
      return Promise.resolve(new Response(JSON.stringify(body), { status: 200 }));
    }) as unknown as typeof fetch;
    const parsed = await kugouAdapter.fetchPlaylist('2966690', fetchFn);
    expect(parsed.playlistId).toBe('2966690');
    expect(calls).toHaveLength(2);
    expect(calls.every((u) => u.includes('2966690'))).toBe(true);
  });

  it('throws PlaylistFetchError when status is not 1', async () => {
    const fetchFn = (() =>
      Promise.resolve(new Response(JSON.stringify({ status: 0, error: '参数不合法' }), { status: 200 }))) as typeof fetch;
    await expect(kugouAdapter.fetchPlaylist('1', fetchFn)).rejects.toBeInstanceOf(PlaylistFetchError);
  });
});
