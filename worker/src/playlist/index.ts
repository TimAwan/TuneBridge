import type { Platform } from '@tunebridge/shared';
import type { PlaylistAdapter } from './adapter';
import { kugouAdapter } from './kugou';
import { kuwoAdapter } from './kuwo';
import { neteaseAdapter } from './netease';
import { qqAdapter } from './qq';

const ADAPTERS: Record<Platform, PlaylistAdapter> = {
  netease: neteaseAdapter,
  qq: qqAdapter,
  kuwo: kuwoAdapter,
  kugou: kugouAdapter,
};

export function getAdapter(platform: Platform): PlaylistAdapter {
  return ADAPTERS[platform];
}

export { PlaylistFetchError } from './adapter';
