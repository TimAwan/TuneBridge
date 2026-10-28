import type { ParsedPlaylist, SourceTrack } from '@tunebridge/shared';
import { parseAliases, splitArtists } from '../text/normalize';
import { type PlaylistAdapter, PlaylistFetchError } from './adapter';

interface NeteaseRawTrack {
  name?: string;
  alia?: string[];
  ar?: Array<{ name?: string }>;
  al?: { name?: string };
  dt?: number;
}

interface NeteaseRaw {
  code?: number;
  playlist?: {
    id?: number;
    name?: string;
    coverImgUrl?: string;
    creator?: { nickname?: string };
    tracks?: NeteaseRawTrack[];
  };
}

const API_URL = 'https://music.163.com/api/v6/playlist/detail';
const HEADERS: Record<string, string> = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36',
  Referer: 'https://music.163.com/',
  Cookie: 'os=pc; appver=2.10.11',
};

export function parseNetease(raw: unknown): ParsedPlaylist {
  const data = raw as NeteaseRaw;
  const playlist = data.playlist;
  if (data.code !== 200 || !playlist) {
    throw new PlaylistFetchError('歌单不存在或非公开');
  }
  const tracks: SourceTrack[] = (playlist.tracks ?? []).map((t, i) => {
    const artistRaw = (t.ar ?? [])
      .map((a) => a.name ?? '')
      .filter((n) => n.length > 0)
      .join(' / ');
    const title = t.name ?? '';
    const platformAliases = (t.alia ?? []).filter((a) => a.length > 0);
    return {
      order: i + 1,
      title,
      aliases: [...platformAliases, ...parseAliases(title).slice(1)],
      artistRaw,
      artists: artistRaw ? splitArtists(artistRaw) : [],
      album: t.al?.name ?? '',
      durationMs: t.dt ?? 0,
    };
  });
  return {
    platform: 'netease',
    playlistId: String(playlist.id ?? ''),
    name: playlist.name ?? '',
    coverUrl: playlist.coverImgUrl ?? '',
    creator: playlist.creator?.nickname ?? '',
    tracks,
  };
}

export const neteaseAdapter: PlaylistAdapter = {
  platform: 'netease',
  extractId(url) {
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      return null;
    }
    if (!/(^|\.)music\.163\.com$/i.test(parsed.hostname)) return null;
    const match = /id=(\d+)/.exec(`${parsed.search}${parsed.hash}`);
    return match ? match[1] : null;
  },
  async fetchPlaylist(playlistId, fetchFn) {
    let data: unknown;
    try {
      const res = await fetchFn(`${API_URL}?id=${playlistId}&n=1000&s=0`, { headers: HEADERS });
      data = await res.json();
    } catch (err) {
      if (err instanceof PlaylistFetchError) throw err;
      throw new PlaylistFetchError('无法访问网易云,请稍后重试');
    }
    return parseNetease(data);
  },
};
