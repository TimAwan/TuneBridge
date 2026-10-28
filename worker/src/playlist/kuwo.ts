import type { ParsedPlaylist, SourceTrack } from '@tunebridge/shared';
import { parseAliases, splitArtists } from '../text/normalize';
import { type PlaylistAdapter, PlaylistFetchError } from './adapter';

interface KuwoRawSong {
  name?: string;
  artist?: string;
  album?: string;
  duration?: string | number;
}

interface KuwoRaw {
  result?: string;
  id?: number;
  title?: string;
  pic?: string;
  uname?: string;
  musiclist?: KuwoRawSong[];
}

const API_URL = 'https://nplserver.kuwo.cn/pl.svc';
const HEADERS: Record<string, string> = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36',
};

export function parseKuwo(raw: unknown): ParsedPlaylist {
  const data = raw as KuwoRaw;
  if (data.result !== 'ok' || !Array.isArray(data.musiclist)) {
    throw new PlaylistFetchError('歌单不存在或非公开');
  }
  const tracks: SourceTrack[] = data.musiclist.map((m, i) => {
    const title = m.name ?? '';
    const artistRaw = m.artist ?? '';
    return {
      order: i + 1,
      title,
      aliases: parseAliases(title).slice(1),
      artistRaw,
      artists: artistRaw ? splitArtists(artistRaw) : [],
      album: m.album ?? '',
      durationMs: Math.round(Number(m.duration ?? 0)) * 1000,
    };
  });
  return {
    platform: 'kuwo',
    playlistId: String(data.id ?? ''),
    name: data.title ?? '',
    coverUrl: data.pic ?? '',
    creator: data.uname ?? '',
    tracks,
  };
}

export const kuwoAdapter: PlaylistAdapter = {
  platform: 'kuwo',
  extractId(url) {
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      return null;
    }
    if (!/(^|\.)kuwo\.cn$/i.test(parsed.hostname)) return null;
    const match = /(?:play_list|playlist_detail)\/(\d+)/.exec(parsed.pathname);
    return match ? match[1] : null;
  },
  async fetchPlaylist(playlistId, fetchFn) {
    let data: unknown;
    try {
      const res = await fetchFn(
        `${API_URL}?op=getlistinfo&pid=${playlistId}&pn=0&rn=1000&encode=utf8&keyset=pl2012&identity=kuwo&pcmp4=1&vipver=12&newver=1`,
        { headers: HEADERS },
      );
      data = await res.json();
    } catch (err) {
      if (err instanceof PlaylistFetchError) throw err;
      throw new PlaylistFetchError('无法访问酷我音乐,请稍后重试');
    }
    return parseKuwo(data);
  },
};
