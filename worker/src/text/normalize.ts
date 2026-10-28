const COMBINING_MARKS = /[̀-ͯ]/g;
const SEPARATORS = /[\s·・\-–—'’]/g;

export function normalizeForSearch(s: string): string {
  return s
    .normalize('NFKC')
    .toLowerCase()
    .normalize('NFD')
    .replace(COMBINING_MARKS, '')
    .replace(SEPARATORS, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const ARTIST_SPLIT = /\s*(?:[/、,，&]|\bfeat\.|\bft\.)\s*|\s+[×x]\s+/gi;

export function splitArtists(raw: string): string[] {
  return raw
    .split(ARTIST_SPLIT)
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
}

const BRACKETS = /[\(（[「【]([^\)）」\]】]*)[\)）」\]】]/g;

export function parseAliases(title: string): string[] {
  const contents: string[] = [];
  for (const match of title.matchAll(BRACKETS)) {
    const inner = match[1].trim();
    if (inner) contents.push(inner);
  }
  const clean = title.replace(BRACKETS, ' ').replace(/\s+/g, ' ').trim();
  return [clean, ...contents].filter((part) => part.length > 0);
}

const DESCRIPTOR_PATTERNS = [
  '主题曲',
  '片尾曲',
  '片头曲',
  '插曲',
  '原声',
  '电视剧',
  '电影',
  '动画',
];
const DESCRIPTOR_OST = /\bost\b/i;

export function isDescriptorAlias(alias: string): boolean {
  return DESCRIPTOR_PATTERNS.some((p) => alias.includes(p)) || DESCRIPTOR_OST.test(alias);
}
