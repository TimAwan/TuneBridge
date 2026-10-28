import type { AppleSong, MatchResult, MismatchReason, SourceTrack } from '@tunebridge/shared';
import { normalizeForSearch } from '../text/normalize';

export const DURATION_STRONG_MS = 3000;
export const DURATION_MAX_MS = 10000;

interface CandidateVerdict {
  song: AppleSong;
  evidence: string[];
  blockers: MismatchReason[];
  autoOk: boolean;
  score: number;
}

function sourceVersionWords(track: SourceTrack): string[] {
  const haystack = [track.title, ...track.aliases].join(' ').toLowerCase();
  return haystack.match(/\b(live|remix|clean|dj|explicit|acoustic|instrumental|version|ver)\b|\bdj版\b/g) ?? [];
}

function artistContained(sourceArtist: string, candidateArtists: string[]): boolean {
  const s = normalizeForSearch(sourceArtist);
  if (!s) return false;
  return candidateArtists.some((c) => {
    const n = normalizeForSearch(c);
    return n.length > 0 && (n === s || n.includes(s) || s.includes(n));
  });
}

function formatDelta(ms: number): string {
  const sign = ms >= 0 ? '+' : '-';
  const abs = Math.abs(ms) / 1000;
  const text = Number.isInteger(abs) ? String(abs) : abs.toFixed(1);
  return `${sign}${text}s`;
}

function judge(track: SourceTrack, candidate: AppleSong, knownIsrc?: string): CandidateVerdict {
  const evidence: string[] = [];
  const blockers = new Set<MismatchReason>();

  const titleMatch = normalizeForSearch(track.title) === normalizeForSearch(candidate.title);
  if (titleMatch) evidence.push('title:匹配');

  const artistMatch =
    track.artists.length === 0 || track.artists.every((a) => artistContained(a, candidate.artists));
  if (artistMatch) {
    evidence.push('artist:匹配');
  } else {
    evidence.push('artist:不一致');
  }

  const albumMatch =
    track.album.length > 0 &&
    candidate.album.length > 0 &&
    normalizeForSearch(track.album) === normalizeForSearch(candidate.album);
  if (albumMatch) evidence.push('album:匹配');

  const isrcMatch = Boolean(knownIsrc && candidate.isrc && knownIsrc === candidate.isrc);
  if (isrcMatch) evidence.push(`isrc:${candidate.isrc}`);

  const versionConflict =
    candidate.versionHints.length > 0 &&
    !candidate.versionHints.every((h) => sourceVersionWords(track).includes(h.toLowerCase()));
  if (versionConflict) blockers.add('version');

  let durationDelta: number | null = null;
  if (track.durationMs > 0 && candidate.durationMs > 0) {
    durationDelta = candidate.durationMs - track.durationMs;
    evidence.push(`duration:${formatDelta(durationDelta)}`);
  }

  if (!titleMatch) blockers.add('title');
  if (!artistMatch) blockers.add('artist');
  if (titleMatch && artistMatch && !versionConflict && durationDelta !== null) {
    const abs = Math.abs(durationDelta);
    const corroborated = albumMatch || isrcMatch;
    if (abs > DURATION_MAX_MS || (abs > DURATION_STRONG_MS && !corroborated)) {
      blockers.add('duration');
    }
  }

  const strongDuration = durationDelta !== null && Math.abs(durationDelta) <= DURATION_STRONG_MS;
  const score = [titleMatch, artistMatch, albumMatch, isrcMatch, strongDuration].filter(Boolean).length;

  return { song: candidate, evidence, blockers: [...blockers], autoOk: blockers.size === 0, score };
}

const REASON_PRIORITY: MismatchReason[] = ['version', 'duration', 'artist', 'title'];

export function decideMatch(
  track: SourceTrack,
  candidates: AppleSong[],
  knownIsrc?: string,
): MatchResult {
  if (candidates.length === 0) {
    return {
      order: track.order,
      tier: 'none',
      chosen: null,
      candidates: [],
      reason: 'not_found',
      evidence: [],
    };
  }

  const verdicts = candidates.map((c) => judge(track, c, knownIsrc));
  const sorted = [...verdicts].sort((a, b) => b.score - a.score);
  const best = sorted.find((v) => v.autoOk);

  if (best) {
    return {
      order: track.order,
      tier: 'auto',
      chosen: best.song,
      candidates: [],
      reason: null,
      evidence: best.evidence,
    };
  }

  const reason = REASON_PRIORITY.find((r) => sorted.some((v) => v.blockers.includes(r))) ?? 'title';
  return {
    order: track.order,
    tier: 'confirm',
    chosen: null,
    candidates: sorted.map((v) => v.song),
    reason,
    evidence: sorted[0].evidence,
  };
}
