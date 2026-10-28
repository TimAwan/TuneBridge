import type { AppleSong, JobEvent, MatchResult, Platform, ParsedPlaylist, SourceTrack } from '@tunebridge/shared';
import type { AppleFetchers } from '../apple/client';
import { PlaylistFetchError, type PlaylistAdapter } from '../playlist/adapter';
import { decideMatch } from '../matcher/decide';
import { planQueries } from '../matcher/plan';
import type { QueueCore } from './core';

export const BREAKER_LIMIT = 10;
const BREAKER_MESSAGE = '上游接口连续失败,已中止任务,请稍后重试';
const DEFAULT_ISRC_BATCH = 25;

const TIER_RANK: Record<MatchResult['tier'], number> = { auto: 2, confirm: 1, none: 0 };

class BreakerError extends Error {}

export interface JobDeps {
  queue: Pick<QueueCore, 'markParsing' | 'markMatching' | 'setResults' | 'fail'> & {
    setParsed(jobId: string, parsed: ParsedPlaylist): boolean;
  };
  fetchers: AppleFetchers;
  loadAdapter(url: string): { adapter: PlaylistAdapter; platform: Platform };
  emit(jobId: string, event: JobEvent): void;
  isrcBatchSize?: number;
}

function dedupeSongs(songs: AppleSong[]): AppleSong[] {
  const seen = new Set<string>();
  const out: AppleSong[] = [];
  for (const s of songs) {
    const key = `${s.storefront}:${s.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(s);
  }
  return out;
}

export async function runJob(
  jobId: string,
  url: string,
  storefront: string,
  deps: JobDeps,
): Promise<void> {
  const { queue, fetchers, emit, loadAdapter } = deps;
  const isrcBatchSize = deps.isrcBatchSize ?? DEFAULT_ISRC_BATCH;
  let consecutiveFailures = 0;

  const failJob = (message: string): void => {
    queue.fail(jobId, message, Date.now());
    emit(jobId, { type: 'error', message });
  };

  const search = async (term: string, sf: string): Promise<AppleSong[]> => {
    try {
      const songs = await fetchers.search(term, sf);
      consecutiveFailures = 0;
      return songs;
    } catch (err) {
      if (++consecutiveFailures >= BREAKER_LIMIT) {
        throw new BreakerError(BREAKER_MESSAGE);
      }
      void err;
      return [];
    }
  };

  // —— 解析 ——
  emit(jobId, { type: 'state', state: 'parsing' });
  queue.markParsing(jobId);
  let parsed: ParsedPlaylist;
  try {
    const { adapter } = loadAdapter(url);
    const playlistId = adapter.extractId(url);
    if (!playlistId) throw new PlaylistFetchError('无法识别的歌单链接');
    parsed = await adapter.fetchPlaylist(playlistId, fetch);
  } catch (err) {
    failJob(err instanceof PlaylistFetchError ? err.message : '解析歌单失败,请稍后重试');
    return;
  }
  if (!queue.setParsed(jobId, parsed)) {
    // 超过曲目上限:队列已将任务置为 failed,立即停止,不得再进入 matching
    emit(jobId, { type: 'error', message: '歌单曲目数超过上限,已拒绝处理' });
    return;
  }
  emit(jobId, { type: 'progress', phase: 'parsing', done: parsed.tracks.length, total: parsed.tracks.length });

  // —— 匹配 ——
  emit(jobId, { type: 'state', state: 'matching' });
  queue.markMatching(jobId);

  const results: MatchResult[] = [];
  const pendingIsrc: Array<{ track: SourceTrack; isrc: string; index: number }> = [];

  for (const track of parsed.tracks) {
    const plan = planQueries(track, storefront);
    let candidates: AppleSong[] = [];
    try {
      for (const term of [...plan.direct, ...plan.aliasTerms]) {
        candidates = await search(term, storefront);
        if (candidates.length > 0) break;
      }
    } catch (err) {
      if (err instanceof BreakerError) {
        failJob(BREAKER_MESSAGE);
        return;
      }
      throw err;
    }
    let result = decideMatch(track, candidates);

    if (result.tier !== 'auto' && plan.native) {
      let nativeCandidates: AppleSong[] = [];
      try {
        for (const term of plan.native.terms) {
          nativeCandidates = await search(term, plan.native.storefront);
          if (nativeCandidates.length > 0) break;
        }
      } catch (err) {
        if (err instanceof BreakerError) {
          failJob(BREAKER_MESSAGE);
          return;
        }
        throw err;
      }
      const nativeResult = decideMatch(track, nativeCandidates);
      if (nativeResult.tier === 'auto' && nativeResult.chosen?.isrc && plan.isrcFollowUp) {
        pendingIsrc.push({ track, isrc: nativeResult.chosen.isrc, index: results.length });
      } else if (nativeCandidates.length > 0) {
        // 原语言地区候选并入人工确认列表(功能 17:地区候选)
        const merged = dedupeSongs([...result.candidates, ...nativeCandidates]);
        result = {
          ...result,
          tier: result.tier === 'none' ? 'confirm' : result.tier,
          reason: result.tier === 'none' ? null : result.reason,
          candidates: merged,
        };
      }
    }

    results.push(result);
    emit(jobId, { type: 'match_result', result });
    emit(jobId, { type: 'progress', phase: 'matching', done: results.length, total: parsed.tracks.length });
  }

  // —— ISRC 批量反查(同地区排队合并经缓存单飞实现;同一任务内凑批发送)——
  for (let i = 0; i < pendingIsrc.length; i += isrcBatchSize) {
    const batch = pendingIsrc.slice(i, i + isrcBatchSize);
    let found: AppleSong[];
    try {
      found = await fetchers.findByIsrc(batch.map((b) => b.isrc), storefront);
    } catch (err) {
      if (++consecutiveFailures >= BREAKER_LIMIT) {
        failJob(BREAKER_MESSAGE);
        return;
      }
      void err;
      continue;
    }
    consecutiveFailures = 0;
    for (const item of batch) {
      const targetCandidates = found.filter((s) => s.isrc === item.isrc);
      const updated = decideMatch(item.track, targetCandidates, item.isrc);
      if (TIER_RANK[updated.tier] > TIER_RANK[results[item.index].tier]) {
        results[item.index] = updated;
        emit(jobId, { type: 'match_result', result: updated });
      }
    }
  }

  queue.setResults(jobId, results);
  emit(jobId, { type: 'state', state: 'awaiting_confirmation' });
}
