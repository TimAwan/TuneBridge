import { describe, expect, it } from 'vitest';
import type { SourceTrack } from '@tunebridge/shared';
import { detectScripts, planQueries } from './plan';

function track(over: Partial<SourceTrack> = {}): SourceTrack {
  return {
    order: 1,
    title: 'Love Drop',
    aliases: [],
    artistRaw: 'Aoi',
    artists: ['Aoi'],
    album: 'Blue',
    durationMs: 200000,
    ...over,
  };
}

describe('detectScripts', () => {
  it('detects latin', () => {
    expect(detectScripts(track())).toContain('latin');
  });

  it('detects kana as ja', () => {
    expect(detectScripts(track({ title: 'ガンダム', artists: ['桑原清隆'] }))).toContain('ja');
  });

  it('detects hangul as ko', () => {
    expect(detectScripts(track({ title: '사랑비', artists: ['아이유'] }))).toContain('ko');
  });

  it('detects cyrillic as ru', () => {
    expect(detectScripts(track({ title: 'Калинка', artists: ['Иван'] }))).toContain('ru');
  });

  it('detects han-only as zh', () => {
    expect(detectScripts(track({ title: '晴天', artists: ['周杰伦'] }))).toContain('zh');
    expect(detectScripts(track({ title: '晴天', artists: ['周杰伦'] }))).not.toContain('ja');
  });
});

describe('planQueries', () => {
  it('latin track targets CN: direct terms only, no native', () => {
    const plan = planQueries(track(), 'CN');
    expect(plan.direct).toEqual(['Love Drop Aoi', 'Love Drop', 'Love Drop Blue']);
    expect(plan.native).toBeNull();
    expect(plan.isrcFollowUp).toBe(false);
  });

  it('kana title targets CN: native JP with isrc follow-up', () => {
    const plan = planQueries(track({ title: 'ガンダム', artists: ['桑原清隆'] }), 'CN');
    expect(plan.native?.storefront).toBe('JP');
    expect(plan.isrcFollowUp).toBe(true);
  });

  it('hangul maps to KR and cyrillic to RU', () => {
    expect(planQueries(track({ title: '사랑비', artists: ['아이유'] }), 'CN').native?.storefront).toBe('KR');
    expect(planQueries(track({ title: 'Калинка', artists: ['Иван'] }), 'CN').native?.storefront).toBe('RU');
  });

  it('han-only title targeting US tries CN storefront', () => {
    const plan = planQueries(track({ title: '晴天', artists: ['周杰伦'], album: '叶惠美' }), 'US');
    expect(plan.native?.storefront).toBe('CN');
  });

  it('han-only title with kana album prefers JP via language hints', () => {
    const plan = planQueries(track({ title: '晴天', artists: ['周杰伦'], album: '葉惠美(ニホンバン)' }), 'US');
    expect(plan.native?.storefront).toBe('JP');
  });

  it('filters descriptor aliases from all search terms', () => {
    const plan = planQueries(
      track({ title: '宝船', aliases: ['《燕云十六声》未央城宣传曲', '热血版'] }),
      'CN',
    );
    const allTerms = [...plan.direct, ...(plan.native?.terms ?? []), ...plan.aliasTerms];
    expect(allTerms.join('|')).not.toContain('燕云十六声');
    expect(allTerms.join('|')).toContain('热血版');
  });

  it('caps direct terms at three', () => {
    const plan = planQueries(track({ title: '晴天', artists: ['周杰伦'], album: '叶惠美' }), 'CN');
    expect(plan.direct).toHaveLength(3);
    expect(plan.direct).toEqual(['晴天 周杰伦', '晴天', '晴天 叶惠美']);
  });
});
