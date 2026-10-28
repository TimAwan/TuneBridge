import type { SourceTrack } from '@tunebridge/shared';
import { isDescriptorAlias, parseAliases } from '../text/normalize';

export type Script = 'ja' | 'ko' | 'ru' | 'zh' | 'latin';

export interface QueryPlan {
  /** 目标地区主搜索词,最多 3 个 */
  direct: string[];
  /** 可用别名(已过滤影视描述)生成的备用搜索词 */
  aliasTerms: string[];
  /** 原语言地区辅助检索 */
  native: { storefront: string; terms: string[] } | null;
  /** native 命中后是否以 ISRC 回目标地区反查 */
  isrcFollowUp: boolean;
}

const KANA = /[぀-ゟ゠-ヿｦ-ﾟ]/;
const HANGUL = /[가-힯ᄀ-ᇿ㄰-㆏]/;
const CYRILLIC = /[Ѐ-ӿ]/;
const HAN = /[㐀-䶿一-鿿豈-﫿]/;

export function detectScripts(track: SourceTrack): Script[] {
  const text = [track.title, ...track.aliases, track.artistRaw, ...track.artists, track.album].join(' ');
  const scripts = new Set<Script>();
  if (KANA.test(text)) scripts.add('ja');
  if (HANGUL.test(text)) scripts.add('ko');
  if (CYRILLIC.test(text)) scripts.add('ru');
  if (HAN.test(text)) scripts.add('zh');
  if (scripts.size === 0) scripts.add('latin');
  return [...scripts];
}

function uniq(items: string[]): string[] {
  return [...new Set(items)];
}

function primaryTerms(track: SourceTrack): string[] {
  const cleanTitle = parseAliases(track.title)[0];
  const primary = track.artists[0] ?? '';
  return uniq(
    [
      primary ? `${cleanTitle} ${primary}` : '',
      cleanTitle,
      track.album ? `${cleanTitle} ${track.album}` : '',
    ].filter((s) => s.length > 0),
  );
}

export function planQueries(track: SourceTrack, targetStorefront: string): QueryPlan {
  const scripts = detectScripts(track);
  const terms = primaryTerms(track);

  let nativeStorefront: string | null = null;
  const order: Script[] = ['ja', 'ko', 'ru', 'zh'];
  for (const script of order) {
    if (!scripts.includes(script)) continue;
    const sf =
      script === 'zh' ? (targetStorefront !== 'CN' ? 'CN' : 'JP') : script === 'ja' ? 'JP' : script === 'ko' ? 'KR' : 'RU';
    if (sf !== targetStorefront) {
      nativeStorefront = sf;
      break;
    }
  }

  const primary = track.artists[0] ?? '';
  const aliasTerms = track.aliases
    .filter((a) => !isDescriptorAlias(a))
    .map((a) => (primary ? `${a} ${primary}` : a));

  return {
    direct: terms.slice(0, 3),
    aliasTerms,
    native: nativeStorefront ? { storefront: nativeStorefront, terms: terms.slice(0, 2) } : null,
    isrcFollowUp: nativeStorefront !== null,
  };
}
