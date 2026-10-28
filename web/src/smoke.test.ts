import { describe, expect, it } from 'vitest';
import { mount } from '@vue/test-utils';
import * as sharedEntry from '@tunebridge/shared';
import App from './App.vue';

describe('web smoke', () => {
  it('mounts the app and can import shared package', () => {
    const wrapper = mount(App);
    expect(wrapper.text()).toContain('TuneBridge');
    expect(sharedEntry).toBeDefined();
  });
});
