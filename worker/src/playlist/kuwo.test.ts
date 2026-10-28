import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { PlaylistFetchError } from './adapter';
import { kuwoAdapter, parseKuwo } from './kuwo';

const fixtureDir = join(fileURLToPath(new URL('.', import.meta.url)), 'fixtures');
const raw = JSON.parse(readFileSync(join(fixtureDir, 'kuwo.json'), 'utf8')) as unknown;

describe('parseKuwo', () => {
  it('maps playlist metadata', () => {
    const parsed = parseKuwo(raw);
    expect(parsed.platform).toBe('kuwo');
    expect(parsed.playlistId).toBe('3704293915');
    expect(parsed.name).toBe('国乐无双｜以乐寄情 声声皆不凡');
    expect(parsed.creator).toBe('kw8851199084');
    expect(parsed.coverUrl).toMatch(/^http/);
  });

  it('maps tracks with seconds duration and bracket aliases', () => {
    const { tracks } = parseKuwo(raw);
    expect(tracks).toHaveLength(8);
    expect(tracks[0]).toMatchObject({
      title: '一半一半 (Live)',
      artists: ['宋亚轩'],
      album: '国乐无双 第12期',
      durationMs: 251000,
    });
    expect(tracks[0].aliases).toContain('Live');
  });

  it('tolerates missing fields without throwing', () => {
    const { tracks } = parseKuwo(raw);
    expect(tracks[7].artists).toEqual([]);
    expect(tracks[7].durationMs).toBe(0);
    expect(tracks[7].aliases).toContain('Live');
  });
});

describe('kuwoAdapter.extractId', () => {
  it('reads id from play_list path', () => {
    expect(kuwoAdapter.extractId('https://www.kuwo.cn/play_list/3704293915')).toBe('3704293915');
  });

  it('reads id from playlist_detail path', () => {
    expect(kuwoAdapter.extractId('https://www.kuwo.cn/playlist_detail/3704293915')).toBe('3704293915');
  });

  it('returns null for other hosts', () => {
    expect(kuwoAdapter.extractId('https://music.163.com/playlist?id=1')).toBeNull();
  });
});

describe('kuwoAdapter.fetchPlaylist', () => {
  it('fetches and parses', async () => {
    const fetchFn = (() =>
      Promise.resolve(new Response(JSON.stringify(raw), { status: 200 }))) as typeof fetch;
    const parsed = await kuwoAdapter.fetchPlaylist('3704293915', fetchFn);
    expect(parsed.playlistId).toBe('3704293915');
  });

  it('throws PlaylistFetchError when result is not ok', async () => {
    const fetchFn = (() =>
      Promise.resolve(new Response(JSON.stringify({ result: 'fail' }), { status: 200 }))) as typeof fetch;
    await expect(kuwoAdapter.fetchPlaylist('1', fetchFn)).rejects.toBeInstanceOf(PlaylistFetchError);
  });
});
