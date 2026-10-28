import type { ParsedPlaylist, Platform } from '@tunebridge/shared';

export class PlaylistFetchError extends Error {}

export interface PlaylistAdapter {
  platform: Platform;
  extractId(url: string): string | null;
  fetchPlaylist(playlistId: string, fetchFn: typeof fetch): Promise<ParsedPlaylist>;
}
