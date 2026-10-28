import { describe, expect, it, vi } from 'vitest';
import { createPlaylistWithTracks, getMyStorefront } from './appleApi';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

function ids(n: number): string[] {
  return Array.from({ length: n }, (_, i) => `s${i + 1}`);
}

function callsOf(mock: ReturnType<typeof vi.fn>): Array<{ url: string; body?: unknown }> {
  return mock.mock.calls.map((args) => ({
    url: String(args[0]),
    body: args[1] ? (JSON.parse(String(args[1].body)) as unknown) : undefined,
  }));
}

describe('getMyStorefront', () => {
  it('reads data[0].id', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ data: [{ id: 'CN', type: 'storefronts' }] }));
    const sf = await getMyStorefront('mut', 'dev', fetchMock as unknown as typeof fetch);
    expect(sf).toBe('CN');
    const req = fetchMock.mock.calls[0] as unknown as Array<Record<string, unknown>>;
    const headers = (req[1]?.headers ?? {}) as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer dev');
    expect(headers['Music-User-Token']).toBe('mut');
  });

  it('throws a chinese error on failure', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({}, 403));
    await expect(getMyStorefront('mut', 'dev', fetchMock as unknown as typeof fetch)).rejects.toThrow('账号地区');
  });
});

describe('createPlaylistWithTracks', () => {
  it('creates with first 100 then appends in batches', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/playlists')) {
        return jsonResponse({ data: [{ id: 'pl-1' }] });
      }
      return jsonResponse({});
    });
    const progress: Array<{ done: number; total: number }> = [];
    const result = await createPlaylistWithTracks('我的歌单', ids(250), 'mut', 'dev', (done, total) =>
      progress.push({ done, total }),
      fetchMock as unknown as typeof fetch,
    );
    expect(result.playlistId).toBe('pl-1');
    expect(result.added).toHaveLength(250);
    expect(result.failed).toHaveLength(0);

    const calls = callsOf(fetchMock as unknown as ReturnType<typeof vi.fn>);
    expect(calls).toHaveLength(3);
    expect(calls[0].url).toContain('/v1/me/playlists');
    const createBody = calls[0].body as { attributes: { name: string }; relationships: { tracks: { data: unknown[] } } };
    expect(createBody.attributes.name).toBe('我的歌单');
    expect(createBody.relationships.tracks.data).toHaveLength(100);
    expect(calls[1].url).toContain('/v1/me/playlists/pl-1/tracks');
    expect((calls[1].body as { data: unknown[] }).data).toHaveLength(100);
    expect((calls[2].body as { data: unknown[] }).data).toHaveLength(50);
    expect(progress.map((p) => p.done)).toEqual([200, 250]);
    expect(progress.every((p) => p.total === 250)).toBe(true);
  });

  it('falls back to per-track adds when a chunk fails, isolating the bad id', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith('/playlists')) return jsonResponse({ data: [{ id: 'pl-1' }] });
      const body = JSON.parse(String(init?.body ?? '{}')) as { data: Array<{ id: string }> };
      if (body.data.length > 1 && body.data.some((d) => d.id === 's105')) return jsonResponse({}, 500);
      if (body.data.length === 1 && body.data[0].id === 's105') return jsonResponse({}, 400);
      return jsonResponse({});
    });
    const result = await createPlaylistWithTracks('n', ids(150), 'mut', 'dev', undefined, fetchMock as unknown as typeof fetch);
    expect(result.playlistId).toBe('pl-1');
    expect(result.added).toHaveLength(149);
    expect(result.failed).toEqual(['s105']);
  });

  it('falls back to empty create + per-track adds when the first create fails', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const body = JSON.parse(String(init?.body ?? '{}')) as {
        data?: Array<{ id: string }>;
        relationships?: { tracks?: { data?: Array<{ id: string }> } };
      };
      const carried = body.data ?? body.relationships?.tracks?.data ?? [];
      if (url.endsWith('/playlists') && carried.length > 0) {
        return jsonResponse({}, 400); // 带曲目的创建因跨区 ID 失败
      }
      if (url.endsWith('/playlists')) return jsonResponse({ data: [{ id: 'pl-2' }] }); // 空创建成功
      if (carried.length > 1) return jsonResponse({}, 500);
      if (carried.length === 1 && carried[0].id === 's2') return jsonResponse({}, 400);
      return jsonResponse({});
    });
    const result = await createPlaylistWithTracks('n', ids(3), 'mut', 'dev', undefined, fetchMock as unknown as typeof fetch);
    expect(result.playlistId).toBe('pl-2');
    expect(result.failed).toEqual(['s2']);
    expect(result.added).toHaveLength(2);
  });
});
