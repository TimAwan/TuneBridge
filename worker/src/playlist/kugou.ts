import type { ParsedPlaylist, SourceTrack } from '@tunebridge/shared';
import { parseAliases, splitArtists } from '../text/normalize';
import { type PlaylistAdapter, PlaylistFetchError } from './adapter';

interface KugouSong {
  filename?: string;
  duration?: number;
}

interface KugouFixture {
  info: {
    specialid?: number;
    specialname?: string;
    nickname?: string;
    imgurl?: string;
  };
  songs: { status?: number; data?: { info?: KugouSong[] } };
}

interface KugouApiEnvelope<T> {
  status?: number;
  data?: T;
}

const SONGS_URL = 'http://mobilecdn.kugou.com/api/v3/special/song';
const INFO_URL = 'http://mobilecdn.kugou.com/api/v3/special/info';
const HEADERS: Record<string, string> = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36',
};

export function parseKugou(raw: unknown): ParsedPlaylist {
  const { info, songs } = raw as KugouFixture;
  if (!info || songs?.status !== 1 || !Array.isArray(songs.data?.info)) {
    throw new PlaylistFetchError('歌单不存在或非公开');
  }
  const tracks: SourceTrack[] = songs.data.info.map((s, i) => {
    const filename = s.filename ?? '';
    const sep = filename.lastIndexOf(' - ');
    const artistRaw = sep >= 0 ? filename.slice(0, sep).trim() : '';
    const title = sep >= 0 ? filename.slice(sep + 3).trim() : filename;
    return {
      order: i + 1,
      title,
      aliases: parseAliases(title).slice(1),
      artistRaw,
      artists: artistRaw ? splitArtists(artistRaw) : [],
      album: '',
      durationMs: (s.duration ?? 0) * 1000,
    };
  });
  return {
    platform: 'kugou',
    playlistId: String(info.specialid ?? ''),
    name: info.specialname ?? '',
    coverUrl: (info.imgurl ?? '').replace('{size}', '480'),
    creator: info.nickname ?? '',
    tracks,
  };
}

export const kugouAdapter: PlaylistAdapter = {
  platform: 'kugou',
  extractId(url) {
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      return null;
    }
    if (!/(^|\.)kugou\.com$/i.test(parsed.hostname)) return null;
    const match = /special\/single\/(\d+)/.exec(parsed.pathname);
    return match ? match[1] : null;
  },
  async fetchPlaylist(playlistId, fetchFn) {
    let info: unknown;
    let songs: unknown;
    try {
      const infoRes = await fetchFn(`${INFO_URL}?specialid=${playlistId}`, { headers: HEADERS });
      info = ((await infoRes.json()) as KugouApiEnvelope<typeof info>).data ?? {};
      const songsRes = await fetchFn(
        `${SONGS_URL}?specialid=${playlistId}&page=1&pagesize=1000`,
        { headers: HEADERS },
      );
      songs = await songsRes.json();
    } catch (err) {
      if (err instanceof PlaylistFetchError) throw err;
      throw new PlaylistFetchError('无法访问酷狗音乐,请稍后重试');
    }
    return parseKugou({ info, songs });
  },
};
