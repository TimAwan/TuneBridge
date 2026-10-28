import type { ParsedPlaylist, SourceTrack } from '@tunebridge/shared';
import { parseAliases, splitArtists } from '../text/normalize';
import { type PlaylistAdapter, PlaylistFetchError } from './adapter';

interface QqRawSong {
  songname?: string;
  singer?: Array<{ name?: string }>;
  albumname?: string;
  interval?: number;
}

interface QqRaw {
  code?: number;
  cdlist?: Array<{
    dissid?: string | number;
    disstid?: string | number;
    dissname?: string;
    logo?: string;
    nickname?: string;
    songlist?: QqRawSong[];
  }>;
}

const API_URL = 'https://c.y.qq.com/qzone/fcg-bin/fcg_ucc_getcdinfo_byids_cp.fcg';
const HEADERS: Record<string, string> = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36',
  Referer: 'https://y.qq.com/portal/playlist.html',
};

export function parseQq(raw: unknown): ParsedPlaylist {
  const data = raw as QqRaw;
  const cd = data.cdlist?.[0];
  if (!cd || !cd.songlist) {
    throw new PlaylistFetchError('歌单不存在或非公开');
  }
  const tracks: SourceTrack[] = cd.songlist.map((s, i) => {
    const artistRaw = (s.singer ?? [])
      .map((x) => x.name ?? '')
      .filter((n) => n.length > 0)
      .join(' / ');
    const title = s.songname ?? '';
    return {
      order: i + 1,
      title,
      aliases: parseAliases(title).slice(1),
      artistRaw,
      artists: artistRaw ? splitArtists(artistRaw) : [],
      album: s.albumname ?? '',
      durationMs: (s.interval ?? 0) * 1000,
    };
  });
  return {
    platform: 'qq',
    playlistId: String(cd.disstid ?? cd.dissid ?? ''),
    name: cd.dissname ?? '',
    coverUrl: cd.logo ?? '',
    creator: cd.nickname ?? '',
    tracks,
  };
}

export const qqAdapter: PlaylistAdapter = {
  platform: 'qq',
  extractId(url) {
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      return null;
    }
    if (!/(^|\.)y\.qq\.com$/i.test(parsed.hostname)) return null;
    const pathMatch = /playlist\/(\d+)/.exec(parsed.pathname);
    if (pathMatch) return pathMatch[1];
    const queryMatch = /[?&]id=(\d+)/.exec(parsed.search);
    return queryMatch ? queryMatch[1] : null;
  },
  async fetchPlaylist(playlistId, fetchFn) {
    let data: unknown;
    try {
      const res = await fetchFn(
        `${API_URL}?type=1&json=1&utf8=1&onlysong=0&disstid=${playlistId}&format=json&g_tk=5381&loginUin=0&hostUin=0&inCharset=utf8&outCharset=utf-8&notice=0&platform=yqq.json&needNewCode=0`,
        { headers: HEADERS },
      );
      data = await res.json();
    } catch (err) {
      if (err instanceof PlaylistFetchError) throw err;
      throw new PlaylistFetchError('无法访问QQ音乐,请稍后重试');
    }
    return parseQq(data);
  },
};
