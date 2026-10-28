import { describe, expect, it } from 'vitest';
import type { AppleSong, SourceTrack } from '@tunebridge/shared';
import { decideMatch } from './decide';

function track(over: Partial<SourceTrack> = {}): SourceTrack {
  return {
    order: 1,
    title: '晴天',
    aliases: [],
    artistRaw: '周杰伦',
    artists: ['周杰伦'],
    album: '叶惠美',
    durationMs: 269000,
    ...over,
  };
}

function song(over: Partial<AppleSong> = {}): AppleSong {
  return {
    id: '100',
    title: '晴天',
    artists: ['周杰伦'],
    album: '叶惠美',
    durationMs: 269000,
    isrc: 'ISRC-A',
    storefront: 'CN',
    artworkUrl: 'https://x/1.jpg',
    versionHints: [],
    ...over,
  };
}

describe('decideMatch 自动档', () => {
  it('auto-adds when title, artist match and duration within 3s', () => {
    const result = decideMatch(track(), [song({ durationMs: 270000 })]);
    expect(result.tier).toBe('auto');
    expect(result.chosen?.id).toBe('100');
    expect(result.evidence.join(' ')).toContain('duration:+1s');
  });

  it('auto-adds with isrc match up to 10s even without album', () => {
    const result = decideMatch(
      track({ album: '未知专辑' }),
      [song({ durationMs: 274000, album: '别的专辑' })],
      'ISRC-A',
    );
    expect(result.tier).toBe('auto');
  });

  it('normalizes fullwidth and case before comparing', () => {
    const result = decideMatch(
      track({ title: 'Ｌｏｖｅ Ｄｒｏｐ', artists: ['Aoi'] }),
      [song({ title: 'love drop', artists: ['AOI'], album: '别的专辑', isrc: 'ISRC-B' })],
    );
    expect(result.tier).toBe('auto');
  });
});

describe('decideMatch 人工确认档', () => {
  it('blocks isrc match beyond 10s with reason duration', () => {
    const result = decideMatch(
      track({ album: '未知专辑' }),
      [song({ durationMs: 284000, album: '别的专辑' })],
      'ISRC-A',
    );
    expect(result.tier).toBe('confirm');
    expect(result.reason).toBe('duration');
    expect(result.candidates.map((c) => c.id)).toContain('100');
  });

  it('requires corroboration between 3s and 10s', () => {
    const result = decideMatch(
      track({ album: '未知专辑' }),
      [song({ durationMs: 274000, album: '别的专辑', isrc: 'ISRC-X' })],
    );
    expect(result.tier).toBe('confirm');
    expect(result.reason).toBe('duration');
  });

  it('never auto-picks a dj version when source has no version markers', () => {
    const result = decideMatch(track(), [song({ versionHints: ['dj'] })]);
    expect(result.tier).toBe('confirm');
    expect(result.reason).toBe('version');
  });

  it('auto-allows version candidate when source carries the same marker', () => {
    const result = decideMatch(
      track({ title: '晴天 (Live)' }),
      [song({ title: '晴天 (Live)', versionHints: ['live'] })],
    );
    expect(result.tier).toBe('auto');
  });

  it('confirms when artists do not line up', () => {
    const result = decideMatch(track(), [song({ artists: ['别人'] })]);
    expect(result.tier).toBe('confirm');
    expect(result.reason).toBe('artist');
    expect(result.evidence.join(' ')).toContain('artist');
  });

  it('confirms multi-credit when secondary artist missing', () => {
    const result = decideMatch(
      track({ artists: ['周杰伦', '费玉清'], artistRaw: '周杰伦 / 费玉清' }),
      [song({ artists: ['周杰伦'] })],
    );
    expect(result.tier).toBe('confirm');
    expect(result.reason).toBe('artist');
  });

  it('confirms when title only partially matches', () => {
    const result = decideMatch(track(), [song({ title: '晴天 (钢琴版)' })]);
    expect(result.tier).toBe('confirm');
    expect(result.reason).toBe('title');
  });

  it('sorts candidates by evidence strength', () => {
    const result = decideMatch(track(), [
      song({ id: 'weak', album: '别的', versionHints: ['dj'] }),
      song({ id: 'strong', versionHints: ['dj'] }),
    ]);
    expect(result.tier).toBe('confirm');
    expect(result.candidates[0].id).toBe('strong');
    expect(result.candidates[1].id).toBe('weak');
  });
});

describe('decideMatch 未匹配档', () => {
  it('returns none/not_found for empty candidates', () => {
    const result = decideMatch(track(), []);
    expect(result.tier).toBe('none');
    expect(result.reason).toBe('not_found');
    expect(result.chosen).toBeNull();
  });
});

describe('decideMatch 缺失字段降级', () => {
  it('does not throw with empty artists', () => {
    const result = decideMatch(track({ artists: [], artistRaw: '' }), [song()]);
    expect(result.tier).toBe('auto');
  });

  it('does not convict on missing duration alone', () => {
    const result = decideMatch(track({ durationMs: 0 }), [song()]);
    expect(result.tier).toBe('auto');
    const reverse = decideMatch(track(), [song({ durationMs: 0 })]);
    expect(reverse.tier).toBe('auto');
  });

  it('treats unknown duration as neutral (no block, no corroboration)', () => {
    // 时长缺失不单独定罪:标题+歌手吻合即允许自动,但缺失的时长也不能在 3-10s 区间当佐证用
    const result = decideMatch(track({ durationMs: 0 }), [song({ durationMs: 500000, album: '别的', isrc: 'ISRC-Z' })]);
    expect(result.tier).toBe('auto');
  });
});
