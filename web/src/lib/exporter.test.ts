import { describe, expect, it } from 'vitest';
import type { JobSnapshot } from '@tunebridge/shared';
import { buildExportJson } from './exporter';

function snapshot(): JobSnapshot {
  return {
    id: 'job-1',
    state: 'awaiting_confirmation',
    createdAt: 1,
    storefront: 'CN',
    queuePosition: null,
    etaSeconds: null,
    parsed: {
      platform: 'netease',
      playlistId: '3778678',
      name: '热歌榜',
      coverUrl: 'https://c/1.jpg',
      creator: '网易云音乐',
      tracks: [
        { order: 1, title: '我不难过', aliases: [], artistRaw: '孙燕姿', artists: ['孙燕姿'], album: '未完成', durationMs: 320400 },
        { order: 2, title: '甲乙丙丁 (你我怎么两清)', aliases: ['你我怎么两清'], artistRaw: '李佳薇', artists: ['李佳薇'], album: '甲乙丙丁', durationMs: 210461 },
      ],
    },
    progress: { done: 2, total: 2 },
    results: [
      {
        order: 1,
        tier: 'auto',
        chosen: { id: 'a1', title: '我不难过', artists: ['孙燕姿'], album: '未完成', durationMs: 320000, isrc: 'X', storefront: 'CN', artworkUrl: 'u', versionHints: [] },
        candidates: [],
        reason: null,
        evidence: ['title:匹配'],
      },
      { order: 2, tier: 'confirm', chosen: null, candidates: [], reason: 'artist', evidence: [] },
    ],
    choices: [
      { order: 1, appleId: 'a1' },
      { order: 2, appleId: null },
    ],
    error: null,
  };
}

describe('buildExportJson', () => {
  it('maps snapshot and choices into ExportJson', () => {
    const choices = new Map<number, string | null>([
      [1, 'a1'],
      [2, null],
    ]);
    const data = buildExportJson(snapshot(), choices);
    expect(data.source).toBe('netease');
    expect(data.playlist).toEqual({ id: '3778678', name: '热歌榜', creator: '网易云音乐', coverUrl: 'https://c/1.jpg' });
    expect(data.tracks).toHaveLength(2);
    expect(data.tracks[0].source.title).toBe('我不难过');
    expect(data.tracks[0].match).toEqual({ tier: 'auto', reason: null, appleId: 'a1', storefront: 'CN' });
    expect(data.tracks[1].source.aliases).toContain('你我怎么两清');
    expect(data.tracks[1].match).toEqual({ tier: 'confirm', reason: 'artist', appleId: undefined, storefront: undefined });
  });
});
