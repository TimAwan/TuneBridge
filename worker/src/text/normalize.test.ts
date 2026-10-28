import { describe, expect, it } from 'vitest';
import { isDescriptorAlias, normalizeForSearch, parseAliases, splitArtists } from './normalize';

describe('normalizeForSearch', () => {
  it('folds fullwidth latin to halfwidth and lowercases', () => {
    expect(normalizeForSearch('Ｌｏｖｅ Ｄｒｏｐ')).toBe('love drop');
  });

  it('strips combining diacritics', () => {
    expect(normalizeForSearch('café')).toBe('cafe');
    expect(normalizeForSearch('Björk')).toBe('bjork');
  });

  it('treats halfwidth and fullwidth katakana as equal', () => {
    expect(normalizeForSearch('ｶﾞﾝﾀﾞﾑ')).toBe(normalizeForSearch('ガンダム'));
  });

  it('composes combining kana marks', () => {
    expect(normalizeForSearch('が')).toBe(normalizeForSearch('が'));
  });

  it('unifies separator characters to single spaces', () => {
    expect(normalizeForSearch('A·B')).toBe('a b');
    expect(normalizeForSearch('A – B')).toBe('a b');
    expect(normalizeForSearch('Blue–Eyed')).toBe('blue eyed');
    expect(normalizeForSearch('  x   y  ')).toBe('x y');
  });
});

describe('splitArtists', () => {
  it('splits on slash with spaces', () => {
    expect(splitArtists('周杰伦 / 费玉清')).toEqual(['周杰伦', '费玉清']);
  });

  it('splits on feat.', () => {
    expect(splitArtists('A feat. B')).toEqual(['A', 'B']);
  });

  it('splits on ft. case-insensitively', () => {
    expect(splitArtists('A FT. B')).toEqual(['A', 'B']);
  });

  it('splits on ideographic comma', () => {
    expect(splitArtists('A、B')).toEqual(['A', 'B']);
  });

  it('splits on ×', () => {
    expect(splitArtists('A × B')).toEqual(['A', 'B']);
  });

  it('splits on x only when spaced', () => {
    expect(splitArtists('A x B')).toEqual(['A', 'B']);
    expect(splitArtists('AxRx')).toEqual(['AxRx']);
  });

  it('splits on halfwidth and fullwidth commas and ampersand', () => {
    expect(splitArtists('A,B')).toEqual(['A', 'B']);
    expect(splitArtists('A，B')).toEqual(['A', 'B']);
    expect(splitArtists('A & B')).toEqual(['A', 'B']);
  });

  it('returns single artist unchanged', () => {
    expect(splitArtists('周杰伦')).toEqual(['周杰伦']);
  });

  it('returns empty array for empty input', () => {
    expect(splitArtists('')).toEqual([]);
  });
});

describe('parseAliases', () => {
  it('extracts bracket suffix and clean title', () => {
    const aliases = parseAliases('晴天 (Live)');
    expect(aliases).toContain('Live');
    expect(aliases).toContain('晴天');
  });

  it('extracts fullwidth and corner brackets', () => {
    const aliases = parseAliases('曲名（Live）');
    expect(aliases).toContain('Live');
    expect(aliases).toContain('曲名');
  });

  it('returns the title itself when no brackets', () => {
    expect(parseAliases('晴天')).toEqual(['晴天']);
  });
});

describe('isDescriptorAlias', () => {
  it('flags tv drama theme descriptors', () => {
    expect(isDescriptorAlias('电视剧《山楂树之恋》主题曲')).toBe(true);
  });

  it('flags OST variants', () => {
    expect(isDescriptorAlias('电影原声'));
    expect(isDescriptorAlias('动画插曲'));
    expect(isDescriptorAlias('片尾曲')).toBe(true);
  });

  it('does not flag version suffixes', () => {
    expect(isDescriptorAlias('Live')).toBe(false);
    expect(isDescriptorAlias('Remix')).toBe(false);
  });

  it('does not flag words merely containing ost', () => {
    expect(isDescriptorAlias('Lost')).toBe(false);
  });
});
