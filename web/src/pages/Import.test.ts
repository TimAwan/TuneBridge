import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { createRouter, createWebHistory } from 'vue-router';
import type { JobSnapshot } from '@tunebridge/shared';

const { authorizeMock, loadMusicKitMock, getMyStorefrontMock, createPlaylistMock } = vi.hoisted(() => {
  const authorizeMock = vi.fn(async () => {});
  const loadMusicKitMock = vi.fn(async () => ({
    authorize: authorizeMock,
    musicUserToken: () => 'mut-1',
  }));
  const getMyStorefrontMock = vi.fn(async () => 'CN');
  const createPlaylistMock = vi.fn(async (_name: string, trackIds: string[]) => ({
    playlistId: 'pl-9',
    added: [...trackIds],
    failed: [],
  }));
  return { authorizeMock, loadMusicKitMock, getMyStorefrontMock, createPlaylistMock };
});
vi.mock('../lib/musickit', () => ({ loadMusicKit: loadMusicKitMock }));
vi.mock('../lib/appleApi', () => ({
  getMyStorefront: getMyStorefrontMock,
  createPlaylistWithTracks: createPlaylistMock,
  appendTracks: vi.fn(async () => []),
}));

import Import from './Import.vue';

function snapshot(over: Partial<JobSnapshot> = {}): JobSnapshot {
  return {
    id: 'job-1',
    state: 'importing',
    createdAt: 1,
    storefront: 'CN',
    queuePosition: null,
    etaSeconds: null,
    parsed: {
      platform: 'netease',
      playlistId: '1',
      name: '热歌榜',
      coverUrl: 'c',
      creator: 'u',
      tracks: [
        { order: 1, title: '我不难过', aliases: [], artistRaw: '孙燕姿', artists: ['孙燕姿'], album: '未完成', durationMs: 320400 },
        { order: 2, title: '宝船', aliases: [], artistRaw: 'DOUDOU', artists: ['DOUDOU'], album: '宝船', durationMs: 232500 },
      ],
    },
    progress: { done: 2, total: 2 },
    results: [
      {
        order: 1,
        tier: 'auto',
        chosen: { id: 'a1', title: '我不难过', artists: ['孙燕姿'], album: '未完成', durationMs: 320000, storefront: 'CN', artworkUrl: 'u', versionHints: [] },
        candidates: [],
        reason: null,
        evidence: [],
      },
      {
        order: 2,
        tier: 'confirm',
        chosen: null,
        candidates: [{ id: 'b1', title: '宝船', artists: ['DOUDOU'], album: '宝船', durationMs: 232000, storefront: 'JP', artworkUrl: 'u', versionHints: [] }],
        reason: null,
        evidence: [],
      },
    ],
    choices: [
      { order: 1, appleId: 'a1' },
      { order: 2, appleId: 'b1' },
    ],
    error: null,
    ...over,
  };
}

const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/', component: { template: '<div/>' } },
    { path: '/job/:id', component: { template: '<div/>' } },
    { path: '/job/:id/import', component: Import },
  ],
});

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn(async () =>
    new Response(JSON.stringify(snapshot()), { status: 200, headers: { 'Content-Type': 'application/json' } }),
  );
  vi.stubGlobal('fetch', fetchMock);
  loadMusicKitMock.mockClear();
  authorizeMock.mockClear();
  createPlaylistMock.mockClear();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('Import 页面', () => {
  it('authorizes via musickit when the button is clicked', async () => {
    const wrapper = mount(Import, { props: { jobId: 'job-1' }, global: { plugins: [router] } });
    await flushPromises();
    await wrapper.find('button.authorize').trigger('click');
    await flushPromises();
    expect(loadMusicKitMock).toHaveBeenCalledTimes(1);
    expect(authorizeMock).toHaveBeenCalledTimes(1);
    expect(wrapper.text()).toContain('已授权');
  });

  it('shows cross-region panel when account storefront differs, excluding unchecked tracks', async () => {
    getMyStorefrontMock.mockResolvedValueOnce('US'); // 账号在美区,快照选的是 CN
    const wrapper = mount(Import, { props: { jobId: 'job-1' }, global: { plugins: [router] } });
    await flushPromises();
    await wrapper.find('button.authorize').trigger('click');
    await flushPromises();
    expect(wrapper.find('.cross-region').exists()).toBe(true);

    const boxes = wrapper.findAll('input[type="checkbox"]');
    expect(boxes.length).toBe(2); // a1(CN) 与 b1(JP) 对 US 账号都是跨区
    await boxes[1].setValue(false); // 取消 b1(宝船,JP 候选)
    await wrapper.find('button.import').trigger('click');
    await flushPromises();
    expect(createPlaylistMock).toHaveBeenCalledTimes(1);
    const [, trackIds] = createPlaylistMock.mock.calls[0] as unknown as [string, string[]];
    expect(trackIds).toEqual(['a1']); // b1 被排除
  });

  it('treats lowercase storefront codes as equal (apple returns cn not CN)', async () => {
    getMyStorefrontMock.mockResolvedValueOnce('cn'); // 快照所选是 CN
    const wrapper = mount(Import, { props: { jobId: 'job-1' }, global: { plugins: [router] } });
    await flushPromises();
    await wrapper.find('button.authorize').trigger('click');
    await flushPromises();
    expect(wrapper.text()).toContain('已授权');
    expect(wrapper.find('.mismatch').exists()).toBe(false);
    expect(wrapper.find('.cross-region').exists()).toBe(false);
  });

  it('imports with playlist name defaulting to source name', async () => {
    const wrapper = mount(Import, { props: { jobId: 'job-1' }, global: { plugins: [router] } });
    await flushPromises();
    await wrapper.find('button.authorize').trigger('click');
    await flushPromises();
    await wrapper.find('button.import').trigger('click');
    await flushPromises();
    const [name] = createPlaylistMock.mock.calls[0] as unknown as [string];
    expect(name).toBe('热歌榜');
    expect(wrapper.text()).toContain('成功');
  });
});
