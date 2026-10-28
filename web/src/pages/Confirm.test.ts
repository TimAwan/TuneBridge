import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { createRouter, createWebHistory } from 'vue-router';
import type { AppleSong, JobSnapshot, MatchResult } from '@tunebridge/shared';
import Confirm from './Confirm.vue';

const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/', component: { template: '<div/>' } },
    { path: '/job/:id', component: { template: '<div/>' } },
    { path: '/job/:id/confirm', component: Confirm },
  ],
});

function song(id: string, over: Partial<AppleSong> = {}): AppleSong {
  return {
    id,
    title: `歌曲${id}`,
    artists: ['歌手A'],
    album: '专辑',
    durationMs: 200000,
    storefront: 'CN',
    artworkUrl: `https://x/${id}.jpg`,
    versionHints: [],
    ...over,
  };
}

function results(): MatchResult[] {
  return [
    { order: 1, tier: 'auto', chosen: song('100'), candidates: [], reason: null, evidence: [] },
    {
      order: 2,
      tier: 'confirm',
      chosen: null,
      reason: 'artist',
      evidence: [],
      candidates: [song('201'), song('202', { versionHints: ['live'] })],
    },
    {
      order: 3,
      tier: 'confirm',
      chosen: null,
      reason: null,
      evidence: [],
      candidates: [song('301'), song('302')],
    },
    { order: 4, tier: 'none', chosen: null, candidates: [], reason: 'title', evidence: [] },
    { order: 5, tier: 'none', chosen: null, candidates: [], reason: 'not_found', evidence: [] },
  ];
}

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
      playlistId: '1',
      name: '歌单甲',
      coverUrl: 'c',
      creator: 'u',
      tracks: [],
    },
    progress: { done: 5, total: 5 },
    results: results(),
    choices: null,
    error: null,
  };
}

let calls: Array<{ url: string; init?: RequestInit }>;

beforeEach(() => {
  calls = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      if (String(url).includes('/confirm')) {
        return new Response(JSON.stringify({ ...snapshot(), state: 'importing' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response(JSON.stringify(snapshot()), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('Confirm 页面', () => {
  it('renders three groups with correct counts and chinese reasons', async () => {
    const wrapper = mount(Confirm, { props: { jobId: 'job-1' }, global: { plugins: [router] } });
    await flushPromises();
    const headers = wrapper.findAll('h3').map((h) => h.text());
    expect(headers.some((t) => t.includes('自动加入') && t.includes('1'))).toBe(true);
    expect(headers.some((t) => t.includes('待确认') && t.includes('2'))).toBe(true);
    expect(headers.some((t) => t.includes('未匹配') && t.includes('2'))).toBe(true);
    const text = wrapper.text();
    expect(text).toContain('歌名不一致');
    expect(text).toContain('未找到候选');
  });

  it('defaults to nothing selected and submits nulls for unconfirmed', async () => {
    const wrapper = mount(Confirm, { props: { jobId: 'job-1' }, global: { plugins: [router] } });
    await flushPromises();
    await wrapper.find('button.primary').trigger('click');
    await flushPromises();
    const confirmCall = calls.find((c) => c.url.includes('/confirm'));
    expect(confirmCall).toBeDefined();
    const body = JSON.parse(String(confirmCall?.init?.body)) as {
      choices: Array<{ order: number; appleId: string | null }>;
    };
    const byOrder = new Map(body.choices.map((c) => [c.order, c.appleId]));
    expect(byOrder.get(1)).toBe('100'); // auto 原样携带
    expect(byOrder.get(2)).toBeNull(); // 默认未选
    expect(byOrder.get(3)).toBeNull();
    expect(byOrder.has(4)).toBe(false); // none 不提交
  });

  it('supports selecting, switching and clearing a candidate', async () => {
    const wrapper = mount(Confirm, { props: { jobId: 'job-1' }, global: { plugins: [router] } });
    await flushPromises();
    const cards = wrapper.findAll('.candidate');
    expect(cards.length).toBe(4); // 2 组待确认 × 2 候选
    await cards[0].trigger('click'); // order2 选择 201
    await cards[1].trigger('click'); // order2 换选 202
    await cards[1].trigger('click'); // 再点取消
    await cards[1].trigger('click'); // 重新选 202
    await wrapper.find('button.primary').trigger('click');
    await flushPromises();
    const confirmCall = calls.find((c) => c.url.includes('/confirm'));
    const body = JSON.parse(String(confirmCall?.init?.body)) as {
      choices: Array<{ order: number; appleId: string | null }>;
    };
    const byOrder = new Map(body.choices.map((c) => [c.order, c.appleId]));
    expect(byOrder.get(2)).toBe('202');
  });

  it('marks version candidates with a badge', async () => {
    const wrapper = mount(Confirm, { props: { jobId: 'job-1' }, global: { plugins: [router] } });
    await flushPromises();
    expect(wrapper.text()).toContain('非原版');
  });
});
