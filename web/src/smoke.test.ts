import { describe, expect, it } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { createRouter, createWebHistory } from 'vue-router';
import * as sharedEntry from '@tunebridge/shared';
import App from './App.vue';
import Home from './pages/Home.vue';
import Job from './pages/Job.vue';

const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/', component: Home },
    { path: '/job/:id', component: Job },
  ],
});

describe('web smoke', () => {
  it('App renders the routed page (router-view is wired)', async () => {
    await router.push('/');
    const wrapper = mount(App, { global: { plugins: [router] } });
    await flushPromises();
    expect(wrapper.text()).toContain('TuneBridge');
    expect(wrapper.text()).toContain('歌单链接');
    expect(sharedEntry).toBeDefined();
  });
});
