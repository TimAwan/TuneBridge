import { describe, expect, it } from 'vitest';
import { detectPlatform } from './detect';

describe('detectPlatform', () => {
  describe('netease', () => {
    it('detects hash-style playlist url', () => {
      expect(detectPlatform('https://music.163.com/#/playlist?id=2829896383')).toBe('netease');
    });

    it('detects path-style playlist url', () => {
      expect(detectPlatform('https://music.163.com/playlist?id=2829896383')).toBe('netease');
    });

    it('detects mobile short link host', () => {
      expect(detectPlatform('https://163cn.tv/AbCdEf')).toBe('netease');
    });
  });

  describe('qq', () => {
    it('detects ryqq path form', () => {
      expect(detectPlatform('https://y.qq.com/n/ryqq/playlist/7256914512')).toBe('qq');
    });

    it('detects portal form with id param', () => {
      expect(detectPlatform('https://y.qq.com/portal/playlist.html?id=7256914512')).toBe('qq');
    });
  });

  describe('kuwo', () => {
    it('detects www play_list path', () => {
      expect(detectPlatform('https://www.kuwo.cn/play_list/1195177225')).toBe('kuwo');
    });

    it('detects m.kuwo.cn host', () => {
      expect(detectPlatform('https://m.kuwo.cn/play_list/1195177225')).toBe('kuwo');
    });
  });

  describe('kugou', () => {
    it('detects songlist path', () => {
      expect(detectPlatform('https://www.kugou.com/songlist/so-8qL8b6bcb/')).toBe('kugou');
    });

    it('detects m.kugou.com host', () => {
      expect(detectPlatform('https://m.kugou.com/songlist/so-8qL8b6bcb/')).toBe('kugou');
    });
  });

  describe('invalid inputs', () => {
    it('returns null for other platforms', () => {
      expect(detectPlatform('https://open.spotify.com/playlist/xyz')).toBeNull();
    });

    it('returns null for empty string', () => {
      expect(detectPlatform('')).toBeNull();
    });

    it('returns null for plain text', () => {
      expect(detectPlatform('就是一段普通文字')).toBeNull();
    });

    it('returns null for malformed url', () => {
      expect(detectPlatform('http://')).toBeNull();
    });
  });
});
