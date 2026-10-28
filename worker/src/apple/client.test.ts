import { describe, expect, it } from 'vitest';
import type { AppleSong } from '@tunebridge/shared';
import { AppleApiError, createAppleClient } from './client';

function searchResponse(songs: unknown[]): unknown {
  return { results: { songs: { data: songs } } };
}

function rawSong(id: string, name = 'Love Drop', artist = 'Someone', album = 'Album', duration = 200000): unknown {
  return {
    id,
    type: 'songs',
    attributes: {
      name,
      artistName: artist,
      albumName: album,
      durationInMillis: duration,
      isrc: `ISRC${id}`,
      artwork: { url: 'https://x/{w}x{h}bb.jpg' },
      url: `https://music.apple.com/cn/song/${id}`,
    },
  };
}

function tokenFetch(): { getDevToken: () => Promise<string>; seenTokens: string[] } {
  const seenTokens: string[] = [];
  return { seenTokens, getDevToken: async () => { const t = 'dev-token'; seenTokens.push(t); return t; } };
}

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200 });
}

describe('createAppleClient.search', () => {
  it('maps catalog response to AppleSong', async () => {
    const { getDevToken } = tokenFetch();
    const client = createAppleClient({ fetchFn: (async () => jsonResponse(searchResponse([rawSong('1', 'Name (Live)')])) ) as typeof fetch, getDevToken });
    const songs = await client.search('name', 'CN');
    expect(songs).toHaveLength(1);
    expect(songs[0]).toMatchObject({
      id: '1',
      title: 'Name (Live)',
      artists: ['Someone'],
      album: 'Album',
      durationMs: 200000,
      isrc: 'ISRC1',
      storefront: 'CN',
    });
    expect(songs[0].artworkUrl).toBe('https://x/300x300bb.jpg');
    expect(songs[0].versionHints).toContain('live');
  });

  it('marks explicit content rating', async () => {
    const { getDevToken } = tokenFetch();
    const raw = rawSong('2') as { attributes: Record<string, unknown> };
    raw.attributes = { ...raw.attributes, contentRating: 'explicit' };
    const client = createAppleClient({ fetchFn: (async () => jsonResponse(searchResponse([raw]))) as typeof fetch, getDevToken });
    const songs = await client.search('x', 'CN');
    expect(songs[0].versionHints).toContain('explicit');
  });

  it('throws AppleApiError on 429 and does not cache the error', async () => {
    const { getDevToken } = tokenFetch();
    let calls = 0;
    const fetchFn = (async () => {
      calls++;
      if (calls === 1) return new Response('rate', { status: 429 });
      return jsonResponse(searchResponse([rawSong('9')]));
    }) as typeof fetch;
    const client = createAppleClient({ fetchFn, getDevToken, maxRetries: 0 });
    await expect(client.search('term', 'CN')).rejects.toBeInstanceOf(AppleApiError);
    expect(calls).toBe(1);
    const songs = await client.search('term', 'CN');
    expect(calls).toBe(2);
    expect(songs[0].id).toBe('9');
  });

  it('retries with doubling backoff up to the limit', async () => {
    const { getDevToken } = tokenFetch();
    const delays: number[] = [];
    let calls = 0;
    const fetchFn = (async () => {
      calls++;
      if (calls < 3) return new Response('oops', { status: 500 });
      return jsonResponse(searchResponse([rawSong('3')]));
    }) as typeof fetch;
    const client = createAppleClient({
      fetchFn,
      getDevToken,
      maxRetries: 3,
      sleep: async (ms) => { delays.push(ms); },
    });
    const songs = await client.search('retry', 'CN');
    expect(songs[0].id).toBe('3');
    expect(calls).toBe(3);
    expect(delays).toEqual([1000, 2000]);
  });

  it('coalesces concurrent identical searches into one fetch', async () => {
    const { getDevToken } = tokenFetch();
    let calls = 0;
    let release!: (v: Response) => void;
    const gate = new Promise<Response>((r) => { release = r; });
    const fetchFn = (async () => {
      calls++;
      return gate;
    }) as typeof fetch;
    const client = createAppleClient({ fetchFn, getDevToken });
    const p1 = client.search('same', 'CN');
    const p2 = client.search('same', 'CN');
    release(jsonResponse(searchResponse([rawSong('7')])));
    const [a, b] = await Promise.all([p1, p2]);
    expect(calls).toBe(1);
    expect(a[0].id).toBe('7');
    expect(b[0].id).toBe('7');
  });

  it('limits concurrent upstream requests', async () => {
    const { getDevToken } = tokenFetch();
    let inflight = 0;
    let peak = 0;
    const fetchFn = (async () => {
      inflight++;
      peak = Math.max(peak, inflight);
      await new Promise((r) => setTimeout(r, 5));
      inflight--;
      return jsonResponse(searchResponse([]));
    }) as typeof fetch;
    const client = createAppleClient({ fetchFn, getDevToken, maxInFlight: 2, maxRetries: 0 });
    await Promise.all([
      client.search('a', 'CN'),
      client.search('b', 'CN'),
      client.search('c', 'CN'),
      client.search('d', 'CN'),
    ]);
    expect(peak).toBe(2);
  });

  it('serves repeat searches from cache', async () => {
    const { getDevToken } = tokenFetch();
    let calls = 0;
    const fetchFn = (async () => {
      calls++;
      return jsonResponse(searchResponse([rawSong('5')]));
    }) as typeof fetch;
    const client = createAppleClient({ fetchFn, getDevToken });
    await client.search('cached', 'CN');
    const again = await client.search('cached', 'CN');
    expect(calls).toBe(1);
    expect(again[0].id).toBe('5');
  });

  it('scopes cache keys by storefront', async () => {
    const { getDevToken } = tokenFetch();
    let calls = 0;
    const fetchFn = (async () => {
      calls++;
      return jsonResponse(searchResponse([rawSong('5')]));
    }) as typeof fetch;
    const client = createAppleClient({ fetchFn, getDevToken });
    await client.search('cached', 'CN');
    await client.search('cached', 'JP');
    expect(calls).toBe(2);
  });
});

describe('createAppleClient.findByIsrc', () => {
  it('queries filter[isrc] and maps response', async () => {
    const { getDevToken } = tokenFetch();
    const urls: string[] = [];
    const fetchFn = (async (input: RequestInfo | URL) => {
      urls.push(String(input));
      return jsonResponse({ data: [rawSong('11')] });
    }) as typeof fetch;
    const client = createAppleClient({ fetchFn, getDevToken });
    const songs = await client.findByIsrc(['A1', 'B2'], 'JP');
    expect(songs[0].id).toBe('11');
    expect(songs[0].storefront).toBe('JP');
    expect(urls[0]).toContain('filter[isrc]=A1,B2');
    expect(urls[0]).toContain('/catalog/JP/songs');
  });

  it('caches empty isrc results with short ttl semantics (no upstream repeat within window)', async () => {
    const { getDevToken } = tokenFetch();
    let calls = 0;
    const fetchFn = (async () => {
      calls++;
      return jsonResponse({ data: [] });
    }) as typeof fetch;
    const client = createAppleClient({ fetchFn, getDevToken });
    expect(await client.findByIsrc(['X'], 'CN')).toEqual([]);
    expect(await client.findByIsrc(['X'], 'CN')).toEqual([]);
    expect(calls).toBe(1);
  });
});

describe('AppleApiError', () => {
  it('carries status', async () => {
    const { getDevToken } = tokenFetch();
    const client = createAppleClient({
      fetchFn: (async () => new Response('nope', { status: 403 })) as typeof fetch,
      getDevToken,
      maxRetries: 0,
    });
    const err = await client.search('t', 'CN').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AppleApiError);
    expect((err as AppleApiError).status).toBe(403);
  });
});
