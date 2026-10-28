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

async function addChunk(
  playlistId: string,
  chunk: string[],
  mut: string,
  devToken: string,
  fetchFn: FetchLike,
): Promise<{ ok: string[]; failed: string[] }> {
  const res = await fetchFn(`${API_BASE}/v1/me/playlists/${playlistId}/tracks`, {
    method: 'POST',
    headers: headers(mut, devToken),
    body: JSON.stringify({ data: chunk.map((id) => ({ id, type: 'songs' })) }),
  });
  if (res.ok) return { ok: chunk, failed: [] };
  // 整批失败(常见于混入跨区目录 ID):降级逐曲添加,把坏 ID 隔离出来
  const ok: string[] = [];
  const failed: string[] = [];
  for (const id of chunk) {
    const single = await fetchFn(`${API_BASE}/v1/me/playlists/${playlistId}/tracks`, {
      method: 'POST',
      headers: headers(mut, devToken),
      body: JSON.stringify({ data: [{ id, type: 'songs' }] }),
    });
    if (single.ok) ok.push(id);
    else failed.push(id);
  }
  return { ok, failed };
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

  let playlistId = '';
  let added: string[] = [];
  const failed: string[] = [];

  const createRes = await fetchFn(`${API_BASE}/v1/me/playlists`, {
    method: 'POST',
    headers: headers(mut, devToken),
    body: JSON.stringify({
      attributes: { name },
      relationships: { tracks: { data: trackData(trackIds.slice(0, BATCH_SIZE)) } },
    }),
  });
  if (createRes.ok) {
    const created = (await createRes.json()) as { data?: Array<{ id?: string }> };
    playlistId = created.data?.[0]?.id ?? '';
    added = [...trackIds.slice(0, BATCH_SIZE)];
  } else {
    // 创建即失败(可能因首批含跨区 ID):退回"空创建 + 逐曲添加"
    const emptyRes = await fetchFn(`${API_BASE}/v1/me/playlists`, {
      method: 'POST',
      headers: headers(mut, devToken),
      body: JSON.stringify({ attributes: { name } }),
    });
    if (!emptyRes.ok) {
      const detail = (await emptyRes.text().catch(() => '')).slice(0, 200);
      throw new Error(`创建歌单失败(${emptyRes.status})${detail ? `:${detail}` : ''}`);
    }
    const created = (await emptyRes.json()) as { data?: Array<{ id?: string }> };
    playlistId = created.data?.[0]?.id ?? '';
    if (!playlistId) throw new Error('创建歌单失败:未返回歌单 ID');
    const outcome = await addChunk(playlistId, trackIds.slice(0, BATCH_SIZE), mut, devToken, fetchFn);
    added = outcome.ok;
    failed.push(...outcome.failed);
    onProgress?.(added.length + failed.length, total);
  }
  if (!playlistId) throw new Error('创建歌单失败:未返回歌单 ID');

  for (let i = BATCH_SIZE; i < total; i += BATCH_SIZE) {
    const chunk = trackIds.slice(i, i + BATCH_SIZE);
    const outcome = await addChunk(playlistId, chunk, mut, devToken, fetchFn);
    added.push(...outcome.ok);
    failed.push(...outcome.failed);
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
