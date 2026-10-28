import type { JobEvent } from '@tunebridge/shared';
import type { QueueService } from './routes';

const POLL_MS = 1000;
const HEARTBEAT_MS = 15_000;

export function createEventStream(
  service: QueueService,
  jobId: string,
  opts: { pollMs?: number; heartbeatMs?: number } = {},
): ReadableStream<Uint8Array> {
  const pollMs = opts.pollMs ?? POLL_MS;
  const heartbeatMs = opts.heartbeatMs ?? HEARTBEAT_MS;
  const encoder = new TextEncoder();
  let cancelled = false;

  return new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (chunk: string): void => {
        if (!cancelled) controller.enqueue(encoder.encode(chunk));
      };
      let sinceSeq = 0;
      let lastBeat = Date.now();

      const drain = async (): Promise<void> => {
        for (;;) {
          const batch = await service.events(jobId, sinceSeq);
          if (batch.length === 0) return;
          for (const { seq, event } of batch) {
            sinceSeq = Math.max(sinceSeq, seq);
            send(`data: ${JSON.stringify(event)}\n\n`);
          }
        }
      };

      while (!cancelled) {
        await drain();
        const snapshot = await service.snapshot(jobId);
        if (snapshot && (snapshot.state === 'done' || snapshot.state === 'failed')) {
          await drain();
          break;
        }
        const now = Date.now();
        if (now - lastBeat >= heartbeatMs) {
          send(': ping\n\n');
          lastBeat = now;
        }
        await new Promise((resolve) => setTimeout(resolve, pollMs));
      }
      controller.close();
    },
    cancel() {
      cancelled = true;
    },
  });
}
