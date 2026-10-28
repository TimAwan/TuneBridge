import { Hono } from 'hono';
import type { JobEvent, JobSnapshot } from '@tunebridge/shared';
import { detectPlatform } from '../playlist/detect';
import { createEventStream } from './sse';

export interface QueueService {
  admit(ip: string): Promise<{ ok: true } | { ok: false; reason: string }>;
  submit(input: { url: string; storefront: string; ip: string }): Promise<{ jobId: string }>;
  snapshot(jobId: string): Promise<JobSnapshot | null>;
  events(jobId: string, sinceSeq: number): Promise<Array<{ seq: number; event: JobEvent }>>;
  confirm(jobId: string, choices: Array<{ order: number; appleId: string | null }>): Promise<boolean>;
}

export interface ApiOpts {
  getDeveloperToken?: () => Promise<string>;
}

export function createApi(service: QueueService, opts: ApiOpts = {}): Hono {
  const app = new Hono();

  app.post('/api/jobs', async (c) => {
    const body = (await c.req.json().catch(() => null)) as
      | { url?: string; storefront?: string }
      | null;
    const url = body?.url ?? '';
    if (!detectPlatform(url)) {
      return c.json({ error: '无法识别的歌单链接' }, 400);
    }
    const storefront = /^[A-Z]{2}$/.test(body?.storefront ?? '') ? (body?.storefront as string) : 'CN';
    const ip = c.req.header('CF-Connecting-IP') ?? '0.0.0.0';
    const admitted = await service.admit(ip);
    if (!admitted.ok) {
      return c.json({ error: admitted.reason }, 429);
    }
    const { jobId } = await service.submit({ url, storefront, ip });
    return c.json({ jobId }, 202);
  });

  app.get('/api/jobs/:id', async (c) => {
    const snapshot = await service.snapshot(c.req.param('id'));
    if (!snapshot) return c.json({ error: '任务不存在' }, 404);
    return c.json(snapshot);
  });

  app.get('/api/jobs/:id/events', (c) => {
    const jobId = c.req.param('id');
    const stream = createEventStream(service, jobId);
    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      },
    });
  });

  app.post('/api/jobs/:id/confirm', async (c) => {
    const jobId = c.req.param('id');
    const body = (await c.req.json().catch(() => null)) as
      | { choices?: Array<{ order: number; appleId: string | null }> }
      | null;
    const ok = await service.confirm(jobId, body?.choices ?? []);
    if (!ok) return c.json({ error: '当前状态不可确认' }, 409);
    const snapshot = await service.snapshot(jobId);
    if (!snapshot) return c.json({ error: '任务不存在' }, 404);
    return c.json(snapshot);
  });

  app.get('/api/config', async (c) => {
    if (!opts.getDeveloperToken) {
      return c.json({ error: '未配置 Apple Music 密钥' }, 503);
    }
    return c.json({ developerToken: await opts.getDeveloperToken() });
  });

  return app;
}
