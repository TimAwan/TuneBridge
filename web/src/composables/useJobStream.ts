import { onUnmounted, ref, type Ref } from 'vue';
import type { JobEvent, JobSnapshot } from '@tunebridge/shared';
import { getJob } from '../api';

const POLL_INTERVAL_MS = 3000;

export function useJobStream(jobId: Ref<string>) {
  const snapshot = ref<JobSnapshot | null>(null);
  const source = ref<'sse' | 'polling'>('sse');
  let eventSource: EventSource | null = null;
  let pollTimer: ReturnType<typeof setTimeout> | null = null;
  let stopped = false;

  async function poll(): Promise<void> {
    if (stopped) return;
    try {
      const snap = await getJob(jobId.value);
      if (snap) snapshot.value = snap;
    } catch {
      // 网络抖动:下一轮再试
    }
    if (!stopped) {
      pollTimer = setTimeout(() => void poll(), POLL_INTERVAL_MS);
    }
  }

  function refreshFullSnapshot(): void {
    void getJob(jobId.value)
      .then((snap) => {
        if (snap) snapshot.value = snap;
      })
      .catch(() => {});
  }

  function applyEvent(event: JobEvent): void {
    switch (event.type) {
      case 'state':
        if (!snapshot.value) {
          snapshot.value = {
            id: jobId.value,
            state: event.state,
            createdAt: 0,
            storefront: '',
            queuePosition: null,
            etaSeconds: null,
            parsed: null,
            progress: null,
            results: null,
            choices: null,
            error: null,
          };
        } else {
          snapshot.value = { ...snapshot.value, state: event.state };
        }
        if (event.state === 'awaiting_confirmation' || event.state === 'done' || event.state === 'failed') {
          refreshFullSnapshot();
        }
        break;
      case 'queue':
        if (snapshot.value) snapshot.value = { ...snapshot.value, queuePosition: event.position, etaSeconds: event.etaSeconds };
        break;
      case 'progress':
        if (snapshot.value) snapshot.value = { ...snapshot.value, progress: { done: event.done, total: event.total } };
        break;
      case 'error':
        if (snapshot.value) snapshot.value = { ...snapshot.value, error: event.message };
        break;
      case 'match_result':
        break;
    }
  }

  function start(): void {
    eventSource = new EventSource(`/api/jobs/${jobId.value}/events`);
    eventSource.onmessage = (ev: MessageEvent<string>) => {
      try {
        applyEvent(JSON.parse(ev.data) as JobEvent);
      } catch {
        // 忽略坏帧
      }
    };
    eventSource.onerror = () => {
      eventSource?.close();
      eventSource = null;
      source.value = 'polling';
      void poll();
    };
  }

  function stop(): void {
    stopped = true;
    eventSource?.close();
    eventSource = null;
    if (pollTimer !== null) clearTimeout(pollTimer);
  }

  start();
  refreshFullSnapshot(); // 健康 SSE 下也要有首帧(排队位置/ETA 只在快照里)
  onUnmounted(stop);

  return { snapshot, source };
}
