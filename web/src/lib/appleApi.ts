const API_BASE = 'https://api.music.apple.com';
const BATCH_SIZE = 100;

export interface ImportResult {
  playlistId: string;
  added: string[];
  failed: string[];
}

type FetchLike = typeof fetch;

function headers(mut: string, devToken: string): Record<string, string> {
  return {
    Authorization: `Bearer ${devToken}`,
    'Music-User-Token': mut,
    'Content-Type': 'application/json',
  };
}

export async function getMyStorefront(mut: string, devToken: string, fetchFn: FetchLike = fetch): Promise<string> {
  const res = await fetchFn(`${API_BASE}/v1/me/storefront`, {
    headers: headers(mut, devToken),
  });
  if (!res.ok) throw new Error(`无法获取账号地区(${res.status})`);
  const body = (await res.json()) as { data?: Array<{ id?: string }> };
  return body.data?.[0]?.id ?? '';
}

export async function createPlaylistWithTracks(
  name: string,
  trackIds: string[],
  mut: string,
  devToken: string,
  onProgress?: (done: number, total: number) => void,
  fetchFn: FetchLike = fetch,
): Promise<ImportResult> {
  const total = trackIds.length;
  const trackData = (chunk: string[]) => chunk.map((id) => ({ id, type: 'songs' }));

  const createRes = await fetchFn(`${API_BASE}/v1/me/playlists`, {
    method: 'POST',
    headers: headers(mut, devToken),
    body: JSON.stringify({
      attributes: { name },
      relationships: { tracks: { data: trackData(trackIds.slice(0, BATCH_SIZE)) } },
    }),
  });
  if (!createRes.ok) throw new Error(`创建歌单失败(${createRes.status})`);
  const created = (await createRes.json()) as { data?: Array<{ id?: string }> };
  const playlistId = created.data?.[0]?.id ?? '';
  if (!playlistId) throw new Error('创建歌单失败:未返回歌单 ID');

  const added = [...trackIds.slice(0, BATCH_SIZE)];
  const failed: string[] = [];

  for (let i = BATCH_SIZE; i < total; i += BATCH_SIZE) {
    const chunk = trackIds.slice(i, i + BATCH_SIZE);
    const res = await fetchFn(`${API_BASE}/v1/me/playlists/${playlistId}/tracks`, {
      method: 'POST',
      headers: headers(mut, devToken),
      body: JSON.stringify({ data: trackData(chunk) }),
    });
    if (res.ok) {
      added.push(...chunk);
    } else {
      failed.push(...chunk);
    }
    onProgress?.(added.length + failed.length, total);
  }

  return { playlistId, added, failed };
}

export async function appendTracks(
  playlistId: string,
  trackIds: string[],
  mut: string,
  devToken: string,
  fetchFn: FetchLike = fetch,
): Promise<string[]> {
  const failed: string[] = [];
  for (let i = 0; i < trackIds.length; i += BATCH_SIZE) {
    const chunk = trackIds.slice(i, i + BATCH_SIZE);
    const res = await fetchFn(`${API_BASE}/v1/me/playlists/${playlistId}/tracks`, {
      method: 'POST',
      headers: headers(mut, devToken),
      body: JSON.stringify({ data: chunk.map((id) => ({ id, type: 'songs' })) }),
    });
    if (!res.ok) failed.push(...chunk);
  }
  return failed;
}
