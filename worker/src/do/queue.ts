import { DurableObject } from 'cloudflare:workers';
import type { JobEvent, JobSnapshot } from '@tunebridge/shared';
import { createAppleClient, type AppleFetchers } from '../apple/client';
import { durablePersistentStore } from './cache';
import type { PersistentStore } from '../cache/store';
import { TwoTierCache } from '../cache/twoTier';
import { getAdapter } from '../playlist';
import { PlaylistFetchError } from '../playlist/adapter';
import { detectPlatform } from '../playlist/detect';
import { QueueCore, type ConfirmChoice, type SerializedQueue, type SubmitInput } from '../queue/core';
import { runJob } from '../queue/runner';
import { signDeveloperToken } from '../token/devToken';

const ALARM_INTERVAL_MS = 3600 * 1000;
const EVENT_LOG_CAP = 500;

interface QueueEnv {
  CACHE: DurableObjectNamespace;
  APPLE_MUSIC_PRIVATE_KEY: string;
  APPLE_MUSIC_TEAM_ID: string;
  APPLE_MUSIC_KEY_ID: string;
}

export class QueueDO extends DurableObject {
  private core = new QueueCore();
  private eventLog = new Map<string, Array<{ seq: number; event: JobEvent }>>();
  private nextSeq = 1;
  private processing = false;
  private fetchers: AppleFetchers | null = null;
  private readonly queueEnv: QueueEnv;

  constructor(ctx: DurableObjectState, env: Record<string, unknown>) {
    super(ctx, env);
    this.queueEnv = env as unknown as QueueEnv;
    void this.ctx.blockConcurrencyWhile(async () => {
      const saved = (await this.ctx.storage.get('state')) as SerializedQueue | undefined;
      if (saved) this.core.restore(saved);
      if ((await this.ctx.storage.getAlarm()) === null) {
        await this.ctx.storage.setAlarm(Date.now() + ALARM_INTERVAL_MS);
      }
    });
  }

  private async persist(): Promise<void> {
    await this.ctx.storage.put('state', this.core.serialize());
  }

  private emit(jobId: string, event: JobEvent): void {
    let list = this.eventLog.get(jobId);
    if (!list) {
      list = [];
      this.eventLog.set(jobId, list);
    }
    list.push({ seq: this.nextSeq++, event });
    if (list.length > EVENT_LOG_CAP) list.splice(0, list.length - EVENT_LOG_CAP);
  }

  private getFetchers(): AppleFetchers {
    if (!this.fetchers) {
      const env = this.queueEnv;
      const client = createAppleClient({
        fetchFn: fetch,
        getDevToken: () =>
          signDeveloperToken({
            privateKeyPem: env.APPLE_MUSIC_PRIVATE_KEY,
            teamId: env.APPLE_MUSIC_TEAM_ID,
            keyId: env.APPLE_MUSIC_KEY_ID,
          }),
      });
      const persistent: PersistentStore | null = env.CACHE
        ? durablePersistentStore(env.CACHE)
        : null;
      this.fetchers = new TwoTierCache({ upstream: client, persistent });
    }
    return this.fetchers;
  }

  private kick(): void {
    if (this.processing) return;
    this.processing = true;
    void this.loop().finally(() => {
      this.processing = false;
    });
  }

  private async loop(): Promise<void> {
    for (;;) {
      const jobId = this.core.next(Date.now());
      if (!jobId) return;
      const input = this.core.getInput(jobId);
      if (!input) return;
      await runJob(jobId, input.url, input.storefront, {
        queue: {
          markParsing: (id: string) => {
            this.core.markParsing(id);
            void this.persist();
          },
          markMatching: (id: string) => {
            this.core.markMatching(id);
            void this.persist();
          },
          setParsed: (id: string, parsed: Parameters<QueueCore['setParsed']>[1]) => {
            this.core.setParsed(id, parsed);
            void this.persist();
          },
          setResults: (id: string, results: Parameters<QueueCore['setResults']>[1]) => {
            this.core.setResults(id, results);
            void this.persist();
          },
          fail: (id: string, message: string, now: number) => {
            this.core.fail(id, message, now);
            void this.persist();
          },
        },
        fetchers: this.getFetchers(),
        loadAdapter: (url: string) => {
          const platform = detectPlatform(url);
          if (!platform) throw new PlaylistFetchError('无法识别的歌单链接');
          return { adapter: getAdapter(platform), platform };
        },
        emit: (id, event) => this.emit(id, event),
      });
    }
  }

  admit(ip: string, now: number): { ok: true } | { ok: false; reason: string } {
    return this.core.admit(ip, now);
  }

  async submitJob(input: SubmitInput): Promise<{ jobId: string }> {
    const result = this.core.submit(input, Date.now());
    await this.persist();
    this.kick();
    return result;
  }

  async get(jobId: string): Promise<{ snapshot: JobSnapshot | null }> {
    return { snapshot: this.core.get(jobId) };
  }

  getEvents(jobId: string, sinceSeq: number): { events: Array<{ seq: number; event: JobEvent }> } {
    const list = this.eventLog.get(jobId) ?? [];
    return { events: list.filter((e) => e.seq > sinceSeq) };
  }

  async confirm(jobId: string, choices: ConfirmChoice[]): Promise<boolean> {
    const ok = this.core.applyConfirm(jobId, choices);
    if (ok) await this.persist();
    return ok;
  }

  async complete(jobId: string): Promise<boolean> {
    try {
      this.core.finish(jobId, Date.now());
    } catch {
      return false;
    }
    await this.persist();
    return true;
  }

  getChoices(jobId: string): { choices: ConfirmChoice[] | null } {
    return { choices: this.core.getChoices(jobId) };
  }

  async alarm(): Promise<void> {
    const removed = this.core.cleanup(Date.now());
    for (const id of removed) this.eventLog.delete(id);
    await this.persist();
    await this.ctx.storage.setAlarm(Date.now() + ALARM_INTERVAL_MS);
  }
}
