import { describe, expect, it } from 'vitest';
import type { AppleSong, JobEvent, MatchResult, ParsedPlaylist, Platform, SourceTrack } from '@tunebridge/shared';
import { PlaylistFetchError, type PlaylistAdapter } from '../playlist/adapter';
import { AppleApiError, type AppleFetchers } from '../apple/client';
import type { QueueCore } from './core';
import { runJob, type JobDeps } from './runner';

function track(over: Partial<SourceTrack> = {}): SourceTrack {
  return {
    order: 1,
    title: 'Love Drop',
    aliases: [],
    artistRaw: 'Aoi',
    artists: ['Aoi'],
    album: 'Blue',
    durationMs: 200000,
    ...over,
  };
}

function song(over: Partial<AppleSong> = {}): AppleSong {
  return {
    id: '100',
    title: 'Love Drop',
    artists: ['Aoi'],
    album: 'Blue',
    durationMs: 200000,
    isrc: 'ISO-1',
    storefront: 'CN',
    artworkUrl: 'https://x/1.jpg',
    versionHints: [],
    ...over,
  };
}

function playlist(tracks: SourceTrack[]): ParsedPlaylist {
  return { platform: 'netease', playlistId: '1', name: 'n', coverUrl: 'c', creator: 'u', tracks };
}

function makeDeps(parsed: ParsedPlaylist, fetchers: AppleFetchers, opts: { failFetch?: boolean } = {}) {
  const calls: string[] = [];
  const events: JobEvent[] = [];
  let failed: string | null = null;
  let results: MatchResult[] | null = null;
  const deps: JobDeps = {
    queue: {
      markParsing: (id: string) => { calls.push(`markParsing:${id}`); },
      markMatching: (id: string) => { calls.push(`markMatching:${id}`); },
      setParsed: (id: string, p: ParsedPlaylist) => { calls.push(`setParsed:${p.tracks.length}`); },
      setResults: (id: string, r: MatchResult[]) => { calls.push('setResults'); results = r; },
      fail: (id: string, msg: string) => { calls.push('fail'); failed = msg; },
    } as unknown as JobDeps['queue'],
    fetchers,
    loadAdapter: () => ({
      platform: 'netease' as Platform,
      adapter: {
        platform: 'netease' as Platform,
        extractId: () => '1',
        fetchPlaylist: async () => {
          if (opts.failFetch) throw new PlaylistFetchError('歌单不存在或非公开');
          return parsed;
        },
      } satisfies PlaylistAdapter,
    }),
    emit: (_id, event) => { events.push(event); },
  };
  return { calls, events, deps, getFailed: () => failed, getResults: () => results };
}

describe('runJob 管线', () => {
  it('walks latin/kana tracks through direct, native and batched isrc phases', async () => {
    const latin = track({ order: 1 });
    const kanaA = track({ order: 2, title: 'ガンダム', artistRaw: '桑原清隆', artists: ['桑原清隆'], album: '赤い彗星' });
    const kanaB = track({ order: 3, title: '宇宙の子', artistRaw: '桑原清隆', artists: ['桑原清隆'], album: '赤い彗星' });

    const searchCalls: Array<{ term: string; storefront: string }> = [];
    const isrcCalls: Array<{ isrcs: string[]; storefront: string }> = [];
    const fetchers: AppleFetchers = {
      async search(term, storefront) {
        searchCalls.push({ term, storefront });
        if (storefront === 'CN' && (term.includes('ガンダム') || term.includes('宇宙の子'))) return [];
        if (storefront === 'JP') {
          return [song({ id: 'jp-1', title: term.split(' ')[0], artists: ['桑原清隆'], album: '赤い彗星', isrc: term.includes('ガンダム') ? 'ISO-A' : 'ISO-B', storefront: 'JP' })];
        }
        return [song({ id: 'cn-1' })];
      },
      async findByIsrc(isrcs, storefront) {
        isrcCalls.push({ isrcs, storefront });
        return isrcs.map((code) =>
          song({
            id: `cn-${code}`,
            isrc: code,
            title: code === 'ISO-A' ? 'ガンダム' : '宇宙の子',
            artists: ['桑原清隆'],
          }),
        );
      },
    };

    const { calls, events, deps, getResults } = makeDeps(playlist([latin, kanaA, kanaB]), fetchers);
    await runJob('job-1', 'https://music.163.com/playlist?id=1', 'CN', deps);

    const states = events.filter((e) => e.type === 'state').map((e) => (e as { state: string }).state);
    expect(states).toEqual(['parsing', 'matching', 'awaiting_confirmation']);
    expect(calls).toEqual(['markParsing:job-1', 'setParsed:3', 'markMatching:job-1', 'setResults']);

    expect(searchCalls.some((c) => c.storefront === 'JP' && c.term.includes('ガンダム'))).toBe(true);
    expect(isrcCalls).toHaveLength(1);
    expect(isrcCalls[0].storefront).toBe('CN');
    expect([...isrcCalls[0].isrcs].sort()).toEqual(['ISO-A', 'ISO-B']);

    const matchResults = events.filter((e) => e.type === 'match_result');
    expect(matchResults.length).toBeGreaterThanOrEqual(3);
    const progresses = events.filter((e) => e.type === 'progress' && e.phase === 'matching');
    expect(progresses.map((p) => (p as { done: number }).done)).toEqual([1, 2, 3]);

    const results = getResults() ?? [];
    expect(results).toHaveLength(3);
    expect(results[0].tier).toBe('auto');
    expect(results[1].tier).toBe('auto');
    expect(results[1].chosen?.isrc).toBe('ISO-A');
    expect(results[2].chosen?.isrc).toBe('ISO-B');
  });

  it('tolerates tracks with missing artist', async () => {
    const missing = track({ order: 1, artistRaw: '', artists: [] });
    const fetchers: AppleFetchers = {
      async search() { return [song()]; },
      async findByIsrc() { return []; },
    };
    const ctx = makeDeps(playlist([missing]), fetchers);
    await runJob('job-1', 'u', 'CN', ctx.deps);
    const results = ctx.getResults() ?? [];
    expect(results[0].tier).toBe('auto');
  });

  it('merges native candidates into confirm tier when native match is not auto', async () => {
    const kana = track({ order: 1, title: 'ガンダム', artistRaw: '桑原清隆', artists: ['桑原清隆'] });
    const fetchers: AppleFetchers = {
      async search(_term, storefront) {
        if (storefront === 'CN') return [];
        return [song({ id: 'jp-x', title: '全然違う曲', storefront: 'JP', isrc: undefined })];
      },
      async findByIsrc() { return []; },
    };
    const ctx = makeDeps(playlist([kana]), fetchers);
    await runJob('job-1', 'u', 'CN', ctx.deps);
    const results = ctx.getResults() ?? [];
    expect(results[0].tier).toBe('confirm');
    expect(results[0].candidates.some((c) => c.id === 'jp-x')).toBe(true);
  });

  it('fails the job with a chinese message after 10 consecutive upstream errors', async () => {
    const tracks = Array.from({ length: 4 }, (_, i) => track({ order: i + 1 }));
    const fetchers: AppleFetchers = {
      async search() { throw new AppleApiError('Apple Music 接口错误(429)', 429); },
      async findByIsrc() { return []; },
    };
    const ctx = makeDeps(playlist(tracks), fetchers);
    await runJob('job-1', 'u', 'CN', ctx.deps);
    expect(ctx.getFailed()).toContain('连续失败');
    expect(ctx.events.some((e) => e.type === 'error')).toBe(true);
  });

  it('propagates playlist fetch failures', async () => {
    const fetchers: AppleFetchers = {
      async search() { return []; },
      async findByIsrc() { return []; },
    };
    const ctx = makeDeps(playlist([]), fetchers, { failFetch: true });
    await runJob('job-1', 'u', 'CN', ctx.deps);
    expect(ctx.getFailed()).toBe('歌单不存在或非公开');
  });
});
