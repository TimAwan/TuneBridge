export type Platform = 'netease' | 'qq' | 'kuwo' | 'kugou';

export interface SourceTrack {
  /** 1 起,源歌单顺序 */
  order: number;
  /** 原始歌名 */
  title: string;
  /** 括号/方头括号后缀与平台别名 */
  aliases: string[];
  /** 原始歌手串 */
  artistRaw: string;
  /** 拆分后歌手列表,主歌手在前 */
  artists: string[];
  album: string;
  /** 0 表示缺失 */
  durationMs: number;
}

export interface ParsedPlaylist {
  platform: Platform;
  playlistId: string;
  name: string;
  coverUrl: string;
  creator: string;
  tracks: SourceTrack[];
}

export interface AppleSong {
  /** catalog song id */
  id: string;
  title: string;
  artists: string[];
  album: string;
  durationMs: number;
  isrc?: string;
  /** 'CN' 等 */
  storefront: string;
  artworkUrl: string;
  /** 'live'|'remix'|'dj'|'clean'|'explicit'… */
  versionHints: string[];
}

export type MatchTier = 'auto' | 'confirm' | 'none';

export type MismatchReason = 'not_found' | 'title' | 'artist' | 'duration' | 'version';

export interface MatchResult {
  order: number;
  tier: MatchTier;
  /** auto 档唯一选中 */
  chosen: AppleSong | null;
  /** confirm 档候选,按评分降序 */
  candidates: AppleSong[];
  /** tier='none' 时必填 */
  reason: MismatchReason | null;
  /** 证据描述,如 ['isrc:JPU901600785','duration:+1.2s'] */
  evidence: string[];
}

export type JobState =
  | 'queued'
  | 'parsing'
  | 'matching'
  | 'awaiting_confirmation'
  | 'importing'
  | 'done'
  | 'failed';

export interface JobProgress {
  done: number;
  total: number;
}

export interface JobSnapshot {
  id: string;
  state: JobState;
  createdAt: number;
  /** 用户所选目标地区 */
  storefront: string;
  queuePosition: number | null;
  etaSeconds: number | null;
  parsed: ParsedPlaylist | null;
  /** 解析与匹配共用 */
  progress: JobProgress | null;
  results: MatchResult[] | null;
  error: string | null;
}

export type JobEvent =
  | { type: 'state'; state: JobState }
  | { type: 'queue'; position: number; etaSeconds: number | null }
  | { type: 'progress'; phase: 'parsing' | 'matching'; done: number; total: number }
  | { type: 'match_result'; result: MatchResult }
  | { type: 'error'; message: string };

export interface ExportJson {
  source: Platform;
  playlist: { id: string; name: string; creator: string; coverUrl: string };
  tracks: Array<{
    order: number;
    source: SourceTrack;
    match: {
      tier: MatchTier;
      reason: MismatchReason | null;
      appleId?: string;
      storefront?: string;
    };
  }>;
}
