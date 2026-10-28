import { describe, expect, it } from 'vitest';
import type { JobEvent, JobSnapshot } from '@tunebridge/shared';
import { createApi, type QueueService } from './routes';

function snapshot(over: Partial<JobSnapshot> = {}): JobSnapshot {
  return {
    id: 'job-1',
    state: 'queued',
    createdAt: 1,
    storefront: 'CN',
    queuePosition: 1,
    etaSeconds: null,
    parsed: null,
    progress: null,
    results: null,
    choices: null,
    error: null,
    ...over,
  };
}

function makeService(over: Partial<QueueService> = {}): QueueService {
  return {
    submit: async () => ({ ok: true as const, jobId: 'job-1' }),
    snapshot: async (id: string) => (id === 'job-1' ? snapshot() : null),
    events: async () => [] as Array<{ seq: number; event: JobEvent }>,
    confirm: async () => true,
    complete: async () => false,
    ...over,
  };
}

describe('POST /api/jobs', () => {
  it('rejects unknown playlist links with 400 and chinese error', async () => {
    const app = createApi(makeService());
    const res = await app.request('/api/jobs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: 'https://open.spotify.com/playlist/x', storefront: 'CN' }),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('无法识别的歌单链接');
  });

  it('returns 202 with jobId on success', async () => {
    const app = createApi(makeService());
    const res = await app.request('/api/jobs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: 'https://music.163.com/playlist?id=1', storefront: 'CN' }),
    });
    expect(res.status).toBe(202);
    const body = (await res.json()) as { jobId: string };
    expect(body.jobId).toBe('job-1');
  });

  it('returns 429 with reason when admission denies', async () => {
    const app = createApi(
      makeService({
        submit: async () => ({ ok: false as const, reason: '今日提交次数已达上限(5 次)' }),
      }),
    );
    const res = await app.request('/api/jobs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: 'https://music.163.com/playlist?id=1', storefront: 'CN' }),
    });
    expect(res.status).toBe(429);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain('上限');
  });
});

describe('GET /api/jobs/:id', () => {
  it('returns the snapshot as json', async () => {
    const app = createApi(makeService());
    const res = await app.request('/api/jobs/job-1');
    expect(res.status).toBe(200);
    const body = (await res.json()) as JobSnapshot;
    expect(body.id).toBe('job-1');
  });

  it('returns 404 for unknown jobs', async () => {
    const app = createApi(makeService());
    const res = await app.request('/api/jobs/nope');
    expect(res.status).toBe(404);
  });
});

describe('GET /api/jobs/:id/events', () => {
  it('streams job events as sse data lines and closes on terminal state', async () => {
    let polled = 0;
    const events: JobEvent[] = [
      { type: 'state', state: 'parsing' },
      { type: 'progress', phase: 'parsing', done: 3, total: 3 },
    ];
    const app = createApi(
      makeService({
        events: async () => {
          polled++;
          return polled === 1 ? events.map((event, i) => ({ seq: i + 1, event })) : [];
        },
        snapshot: async () =>
          snapshot({ state: 'done' }),
      }),
    );
    const res = await app.request('/api/jobs/job-1/events');
    expect(res.headers.get('content-type')).toContain('text/event-stream');
    const text = await res.text();
    expect(text).toContain('data: {"type":"state","state":"parsing"}');
    expect(text).toContain('data: {"type":"progress","phase":"parsing","done":3,"total":3}');
  });
});

describe('POST /api/jobs/:id/confirm', () => {
  it('returns the snapshot after confirming', async () => {
    const app = createApi(
      makeService({ snapshot: async () => snapshot({ state: 'importing' }) }),
    );
    const res = await app.request('/api/jobs/job-1/confirm', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ choices: [{ order: 1, appleId: '100' }] }),
    });
    expect(res.status).toBe(200);
  });

  it('returns 409 when the job is not awaiting confirmation', async () => {
    const app = createApi(makeService({ confirm: async () => false }));
    const res = await app.request('/api/jobs/job-1/confirm', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ choices: [] }),
    });
    expect(res.status).toBe(409);
  });
});

describe('POST /api/jobs/:id/complete', () => {
  it('returns the finished snapshot', async () => {
    const app = createApi(
      makeService({
        complete: async () => true,
        snapshot: async () => snapshot({ state: 'done' }),
      }),
    );
    const res = await app.request('/api/jobs/job-1/complete', { method: 'POST' });
    expect(res.status).toBe(200);
    const body = (await res.json()) as JobSnapshot;
    expect(body.state).toBe('done');
  });

  it('returns 409 when the job cannot complete', async () => {
    const app = createApi(makeService({ complete: async () => false }));
    const res = await app.request('/api/jobs/job-1/complete', { method: 'POST' });
    expect(res.status).toBe(409);
  });
});

describe('GET /api/config', () => {
  it('returns the developer token', async () => {
    const app = createApi(makeService(), { getDeveloperToken: async () => 'token-x' });
    const res = await app.request('/api/config');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { developerToken: string };
    expect(body.developerToken).toBe('token-x');
  });
});
