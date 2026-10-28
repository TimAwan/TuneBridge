import type { JobEvent, JobSnapshot } from '@tunebridge/shared';
import { createApi, type QueueService } from './api/routes';
import { signDeveloperToken } from './token/devToken';

export { CacheDO } from './do/cache';
export { QueueDO } from './do/queue';

export interface Env {
  QUEUE: DurableObjectNamespace;
  CACHE: DurableObjectNamespace;
  APPLE_MUSIC_PRIVATE_KEY: string;
  APPLE_MUSIC_TEAM_ID: string;
  APPLE_MUSIC_KEY_ID: string;
}

interface QueueRpc {
  admit(ip: string, now: number): Promise<{ ok: true } | { ok: false; reason: string }>;
  submitJob(input: { url: string; storefront: string; ip: string }): Promise<{ jobId: string }>;
  get(jobId: string): Promise<{ snapshot: JobSnapshot | null }>;
  getEvents(jobId: string, sinceSeq: number): Promise<{ events: Array<{ seq: number; event: JobEvent }> }>;
  confirm(jobId: string, choices: Array<{ order: number; appleId: string | null }>): Promise<boolean>;
}

export default {
  fetch(req: Request, env: Env): Response | Promise<Response> {
    const stub = env.QUEUE.get(env.QUEUE.idFromName('global')) as unknown as QueueRpc;
    const service: QueueService = {
      admit: (ip) => stub.admit(ip, Date.now()),
      submit: (input) => stub.submitJob(input),
      snapshot: async (jobId) => (await stub.get(jobId)).snapshot,
      events: async (jobId, sinceSeq) => (await stub.getEvents(jobId, sinceSeq)).events,
      confirm: (jobId, choices) => stub.confirm(jobId, choices),
    };
    const app = createApi(service, {
      getDeveloperToken: () =>
        signDeveloperToken({
          privateKeyPem: env.APPLE_MUSIC_PRIVATE_KEY,
          teamId: env.APPLE_MUSIC_TEAM_ID,
          keyId: env.APPLE_MUSIC_KEY_ID,
        }),
    });
    return app.fetch(req, env, undefined as never);
  },
};
