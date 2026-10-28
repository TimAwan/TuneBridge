import type { JobSnapshot } from '@tunebridge/shared';

async function readError(res: Response): Promise<string> {
  try {
    const body = (await res.json()) as { error?: string };
    return body.error ?? `请求失败(${res.status})`;
  } catch {
    return `请求失败(${res.status})`;
  }
}

export async function createJob(url: string, storefront: string): Promise<string> {
  const res = await fetch('/api/jobs', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url, storefront }),
  });
  if (!res.ok) throw new Error(await readError(res));
  const body = (await res.json()) as { jobId: string };
  return body.jobId;
}

export async function getJob(jobId: string): Promise<JobSnapshot | null> {
  const res = await fetch(`/api/jobs/${jobId}`);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(await readError(res));
  return (await res.json()) as JobSnapshot;
}

export async function confirmJob(
  jobId: string,
  choices: Array<{ order: number; appleId: string | null }>,
): Promise<JobSnapshot> {
  const res = await fetch(`/api/jobs/${jobId}/confirm`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ choices }),
  });
  if (!res.ok) throw new Error(await readError(res));
  return (await res.json()) as JobSnapshot;
}

export async function getConfig(): Promise<{ developerToken: string }> {
  const res = await fetch('/api/config');
  if (!res.ok) throw new Error(await readError(res));
  return (await res.json()) as { developerToken: string };
}
