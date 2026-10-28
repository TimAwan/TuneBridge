import { describe, expect, it } from 'vitest';
import type { Platform } from '@tunebridge/shared';
import { getAdapter } from './index';

describe('getAdapter', () => {
  const cases: Array<[Platform, string]> = [
    ['netease', 'netease'],
    ['qq', 'qq'],
    ['kuwo', 'kuwo'],
    ['kugou', 'kugou'],
  ];

  it.each(cases)('returns the %s adapter', (platform) => {
    const adapter = getAdapter(platform);
    expect(adapter.platform).toBe(platform);
    expect(adapter.extractId).toBeTypeOf('function');
    expect(adapter.fetchPlaylist).toBeTypeOf('function');
  });
});
