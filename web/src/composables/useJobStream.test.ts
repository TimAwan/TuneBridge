import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ref } from 'vue';
import type { JobSnapshot } from '@tunebridge/shared';
import { useJobStream } from './useJobStream';

class FakeEventSource {
  static instances: FakeEventSource[] = [];
  onmessage: ((ev: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  constructor(public readonly url: string) {
    FakeEventSource.instances.push(this);
  }
  close(): void {}
  fireError(): void {
    this.onerror?.();
  }
}

function snapshot(over: Partial<JobSnapshot> = {}): JobSnapshot {
  return {
    id: 'job-1',
    state: 'matching',
    createdAt: 1,
    storefront: 'CN',
    queuePosition: null,
    etaSeconds: null,
    parsed: null,
    progress: { done: 2, total: 10 },
    results: null,
    error: null,
    ...over,
  };
}

describe('useJobStream', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    FakeEventSource.instances = [];
    vi.stubGlobal('EventSource', FakeEventSource as unknown as typeof EventSource);
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('subscribes over sse first', () => {
    const { source } = useJobStream(ref('job-1'));
    expect(FakeEventSource.instances).toHaveLength(1);
    expect(FakeEventSource.instances[0].url).toBe('/api/jobs/job-1/events');
    expect(source.value).toBe('sse');
  });

  it('updates snapshot from sse messages', () => {
    const { snapshot: snap } = useJobStream(ref('job-1'));
    const es = FakeEventSource.instances[0];
    es.onmessage?.({ data: JSON.stringify({ type: 'state', state: 'awaiting_confirmation' }) });
    expect(snap.value?.state).toBe('awaiting_confirmation');
  });

  it('falls back to 3s polling when sse errors', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(snapshot({ state: 'matching', progress: { done: 5, total: 10 } })), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const { snapshot: snap, source } = useJobStream(ref('job-1'));
    FakeEventSource.instances[0].fireError();
    expect(source.value).toBe('polling');
    expect(FakeEventSource.instances).toHaveLength(1); // 没有重建 SSE

    await vi.advanceTimersByTimeAsync(0);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe('/api/jobs/job-1');
    expect(snap.value?.progress).toEqual({ done: 5, total: 10 });

    await vi.advanceTimersByTimeAsync(3000);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(3000);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
});
