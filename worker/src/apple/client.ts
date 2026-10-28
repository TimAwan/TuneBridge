import type { AppleSong } from '@tunebridge/shared';
import { isrcKey, MemoryLruCache, searchKey } from '../cache/memory';
import { splitArtists } from '../text/normalize';

export class AppleApiError extends Error {
  constructor(message: string, public readonly status: number) {
    super(message);
  }
}

export interface AppleFetchers {
  search(term: string, storefront: string): Promise<AppleSong[]>;
  findByIsrc(isrcs: string[], storefront: string): Promise<AppleSong[]>;
}

interface RawAppleSong {
  id?: string | number;
  attributes?: {
    name?: string;
    artistName?: string;
    albumName?: string;
    durationInMillis?: number;
    isrc?: string;
    artwork?: { url?: string };
    contentRating?: string;
  };
}

const API_BASE = 'https://api.music.apple.com/v1/catalog';

const DEFAULT_SLEEP = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export class Semaphore {
  private active = 0;
  private waiters: Array<() => void> = [];
  constructor(private readonly limit: number) {}
  async run<T>(fn: () => Promise<T>): Promise<T> {
    if (this.active >= this.limit) {
      await new Promise<void>((resolve) => this.waiters.push(resolve));
    }
    this.active++;
    try {
      return await fn();
    } finally {
      this.active--;
      this.waiters.shift()?.();
    }
  }
}

function mapSong(raw: RawAppleSong, storefront: string): AppleSong {
  const a = raw.attributes ?? {};
  const name = a.name ?? '';
  const hints: string[] = [];
  if (/\blive\b/i.test(name)) hints.push('live');
  if (/\bremix\b/i.test(name)) hints.push('remix');
  if (/\bclean\b/i.test(name)) hints.push('clean');
  if (/\bdj\b|\bdj版\b/i.test(name)) hints.push('dj');
  if (a.contentRating === 'explicit') hints.push('explicit');
  return {
    id: String(raw.id ?? ''),
    title: name,
    artists: a.artistName ? splitArtists(a.artistName) : [],
    album: a.albumName ?? '',
    durationMs: a.durationInMillis ?? 0,
    isrc: a.isrc,
    storefront,
    artworkUrl: (a.artwork?.url ?? '').replace('{w}x{h}', '300x300'),
    versionHints: hints,
  };
}

export interface CreateAppleClientOpts {
  fetchFn: typeof fetch;
  getDevToken: () => Promise<string>;
  maxInFlight?: number;
  maxRetries?: number;
  sleep?: (ms: number) => Promise<void>;
  cache?: MemoryLruCache;
  now?: () => number;
}

export function createAppleClient(opts: CreateAppleClientOpts): AppleFetchers {
  const {
    fetchFn,
    getDevToken,
    maxInFlight = 8,
    maxRetries = 3,
    sleep = DEFAULT_SLEEP,
    cache = new MemoryLruCache(),
    now = () => Date.now(),
  } = opts;
  const semaphore = new Semaphore(maxInFlight);
  const inflight = new Map<string, Promise<AppleSong[]>>();

  async function fetchWithRetry(url: string): Promise<unknown> {
    let attempt = 0;
    for (;;) {
      let res: Response;
      try {
        const token = await getDevToken();
        res = await fetchFn(url, { headers: { Authorization: `Bearer ${token}` } });
      } catch (err) {
        if (attempt < maxRetries) {
          await sleep(1000 * 2 ** attempt);
          attempt++;
          continue;
        }
        throw new AppleApiError('无法访问 Apple Music,请稍后重试', 0);
      }
      if (res.ok) return res.json();
      const retryable = res.status === 429 || res.status >= 500;
      if (retryable && attempt < maxRetries) {
        await sleep(1000 * 2 ** attempt);
        attempt++;
        continue;
      }
      throw new AppleApiError(`Apple Music 接口错误(${res.status})`, res.status);
    }
  }

  function run(key: string, urlFactory: () => string): Promise<AppleSong[]> {
    const hit = cache.getAt(key, now());
    if (hit) return Promise.resolve(hit.value);
    const existing = inflight.get(key);
    if (existing) return existing;
    const task = semaphore
      .run(async () => {
        const body = await fetchWithRetry(urlFactory());
        return body;
      })
      .then((body): AppleSong[] => {
        const storefront = key.split(':')[1];
        if (key.startsWith('search:')) {
          const results = (body as { results?: { songs?: { data?: RawAppleSong[] } } }).results;
          return (results?.songs?.data ?? []).map((s) => mapSong(s, storefront));
        }
        return ((body as { data?: RawAppleSong[] }).data ?? []).map((s) => mapSong(s, storefront));
      })
      .then((songs) => {
        cache.set(key, songs, { empty: songs.length === 0 }, now());
        inflight.delete(key);
        return songs;
      });
    inflight.set(
      key,
      task.catch((err: unknown) => {
        inflight.delete(key);
        throw err;
      }),
    );
    return inflight.get(key) as Promise<AppleSong[]>;
  }

  return {
    search(term, storefront) {
      return run(searchKey(storefront, term), () => `${API_BASE}/${storefront}/search?term=${encodeURIComponent(term)}&types=songs&limit=10`);
    },
    findByIsrc(isrcs, storefront) {
      return run(isrcKey(storefront, isrcs), () => `${API_BASE}/${storefront}/songs?filter[isrc]=${isrcs.join(',')}`);
    },
  };
}
