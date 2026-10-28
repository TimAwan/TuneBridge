import type { Platform } from '@tunebridge/shared';

const HOST_PATTERNS: Array<{ pattern: RegExp; platform: Platform }> = [
  { pattern: /(^|\.)music\.163\.com$/i, platform: 'netease' },
  { pattern: /(^|\.)163cn\.tv$/i, platform: 'netease' },
  { pattern: /(^|\.)y\.qq\.com$/i, platform: 'qq' },
  { pattern: /(^|\.)kuwo\.cn$/i, platform: 'kuwo' },
  { pattern: /(^|\.)kugou\.com$/i, platform: 'kugou' },
];

export function detectPlatform(url: string): Platform | null {
  if (!url.trim()) return null;
  let parsed: URL;
  try {
    parsed = new URL(url.trim());
  } catch {
    return null;
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
  const host = parsed.hostname.toLowerCase();
  for (const { pattern, platform } of HOST_PATTERNS) {
    if (pattern.test(host)) return platform;
  }
  return null;
}
