import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ParsedPlaylist, SourceTrack } from '@tunebridge/shared';
import { QueueCore } from './core';

function parsed(n: number): ParsedPlaylist {
  const tracks: SourceTrack[] = Array.from({ length: n }, (_, i) => ({
    order: i + 1,
    title: `t${i}`,
    aliases: [],
    artistRaw: 'a',
    artists: ['a'],
    album: 'al',
    durationMs: 1000,
  }));
  return { platform: 'netease', playlistId: '1', name: 'n', coverUrl: 'c', creator: 'u', tracks };
}

function completeJob(q: QueueCore, ip: string, at: number, finishAt: number): string {
  const { jobId } = q.submit({ url: 'u', storefront: 'CN', ip }, at);
  q.markParsing(jobId);
  q.setParsed(jobId, parsed(1));
  q.markMatching(jobId);
  q.setResults(jobId, []);
  q.applyConfirm(jobId, []);
  q.finish(jobId, finishAt);
  return jobId;
}

describe('QueueCore 准入', () => {
  it('rejects a second concurrent job from the same ip with chinese reason', () => {
    const q = new QueueCore();
    const t0 = 1_000_000;
    const { jobId } = q.submit({ url: 'https://music.163.com/playlist?id=1', storefront: 'CN', ip: '1.1.1.1' }, t0);
    q.markParsing(jobId);
    const r = q.admit('1.1.1.1', t0 + 1);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/正在|进行|排队/);
    expect(q.admit('2.2.2.2', t0 + 1).ok).toBe(true);
  });

  it('rejects the 6th job of the day for an ip', () => {
    const q = new QueueCore();
    const t0 = 1_000_000;
    for (let i = 0; i < 5; i++) {
      completeJob(q, '9.9.9.9', t0 + i, t0 + 100 + i);
    }
    const r = q.admit('9.9.9.9', t0 + 1000);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/今日|每天|上限/);
  });

  it('refunds daily quota when a job fails', () => {
    const q = new QueueCore();
    const t0 = 1_000_000;
    for (let i = 0; i < 4; i++) {
      completeJob(q, '9.9.9.9', t0 + i, t0 + 100 + i);
    }
    const fifth = q.submit({ url: 'u', storefront: 'CN', ip: '9.9.9.9' }, t0 + 10);
    q.markParsing(fifth.jobId);
    q.fail(fifth.jobId, '解析失败', t0 + 50);
    expect(q.admit('9.9.9.9', t0 + 1000).ok).toBe(true);
  });
});

describe('QueueCore 状态机', () => {
  it('rejects illegal transitions', () => {
    const q = new QueueCore();
    const { jobId } = q.submit({ url: 'u', storefront: 'CN', ip: '1.1.1.1' }, 1);
    q.markParsing(jobId);
    q.markMatching(jobId);
    q.setResults(jobId, []);
    q.applyConfirm(jobId, []);
    q.finish(jobId, 2);
    expect(() => q.markMatching(jobId)).toThrow();
  });

  it('fails jobs exceeding the track cap with a chinese message', () => {
    const q = new QueueCore();
    const { jobId } = q.submit({ url: 'u', storefront: 'CN', ip: '1.1.1.1' }, 1);
    q.markParsing(jobId);
    q.setParsed(jobId, parsed(1001));
    const snap = q.get(jobId);
    expect(snap?.state).toBe('failed');
    expect(snap?.error).toContain('1000');
  });

  it('accepts playlists at the cap', () => {
    const q = new QueueCore();
    const { jobId } = q.submit({ url: 'u', storefront: 'CN', ip: '1.1.1.1' }, 1);
    q.markParsing(jobId);
    q.setParsed(jobId, parsed(1000));
    expect(q.get(jobId)?.state).toBe('parsing');
    expect(q.get(jobId)?.parsed?.tracks).toHaveLength(1000);
  });
});

describe('QueueCore 排队与 ETA', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('reports position and eta from recent finished jobs', () => {
    const q = new QueueCore();
    const T = 1_700_000_000_000;
    vi.setSystemTime(T);
    // 两个历史任务各耗时 60s,为 ETA 提供样本
    for (let i = 0; i < 2; i++) {
      vi.setSystemTime(T);
      const { jobId } = q.submit({ url: 'u', storefront: 'CN', ip: `ip${i}` }, Date.now());
      q.markParsing(jobId);
      vi.setSystemTime(T + 60_000);
      q.setParsed(jobId, parsed(1));
      q.markMatching(jobId);
      q.setResults(jobId, []);
      q.applyConfirm(jobId, []);
      q.finish(jobId, Date.now());
    }
    vi.setSystemTime(T);
    // 一个正在跑 + 两个排队
    const running = q.submit({ url: 'u', storefront: 'CN', ip: 'run' }, Date.now());
    q.markParsing(running.jobId);
    const a = q.submit({ url: 'u', storefront: 'CN', ip: 'a' }, Date.now());
    const b = q.submit({ url: 'u', storefront: 'CN', ip: 'b' }, Date.now());
    expect(q.positionOf(a.jobId)).toBe(1);
    expect(q.positionOf(b.jobId)).toBe(2);
    expect(q.etaSeconds(a.jobId)).toBe(60);
    expect(q.etaSeconds(b.jobId)).toBe(120);
    expect(q.next(Date.now())).toBe(a.jobId);
  });
});

describe('QueueCore 保留与清理', () => {
  it('cleans all jobs after 24h including abandoned awaiting_confirmation', () => {
    const q = new QueueCore();
    const t0 = 1_000_000;
    const doneId = completeJob(q, '1', t0, t0 + 100);

    const failed = q.submit({ url: 'u', storefront: 'CN', ip: '2' }, t0);
    q.markParsing(failed.jobId);
    q.fail(failed.jobId, 'x', t0 + 100);

    const waiting = q.submit({ url: 'u', storefront: 'CN', ip: '3' }, t0);
    q.markParsing(waiting.jobId);
    q.markMatching(waiting.jobId);
    q.setResults(waiting.jobId, []);

    const removed = q.cleanup(t0 + 24 * 3600 * 1000 + 1);
    expect(removed).toContain(doneId);
    expect(removed).toContain(failed.jobId);
    expect(removed).toContain(waiting.jobId);
    expect(q.get(doneId)).toBeNull();
    expect(q.get(waiting.jobId)).toBeNull();
  });

  it('generates unguessable job ids', () => {
    const q = new QueueCore();
    const { jobId } = q.submit({ url: 'u', storefront: 'CN', ip: '1' }, 1);
    expect(jobId).toMatch(/^job-1-[0-9a-f]{8,}$/);
  });
});

describe('QueueCore 快照', () => {
  it('exposes full job snapshot fields', () => {
    const q = new QueueCore();
    const t0 = 1_000_000;
    const { jobId } = q.submit({ url: 'https://y.qq.com/n/ryqq/playlist/1', storefront: 'US', ip: '5.5.5.5' }, t0);
    const snap = q.get(jobId);
    expect(snap).toMatchObject({
      id: jobId,
      state: 'queued',
      storefront: 'US',
      queuePosition: 1,
      etaSeconds: null,
      parsed: null,
      progress: null,
      results: null,
      error: null,
    });
    expect(snap?.createdAt).toBe(t0);
    q.markParsing(jobId);
    q.setParsed(jobId, parsed(3));
    q.markMatching(jobId);
    const snap2 = q.get(jobId);
    expect(snap2?.parsed?.name).toBe('n');
    expect(snap2?.progress).toEqual({ done: 0, total: 3 });
  });
});
