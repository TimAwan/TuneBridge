import type { JobState, JobSnapshot, MatchResult, ParsedPlaylist } from '@tunebridge/shared';

export const TRACK_CAP_DEFAULT = 1000;
const DAILY_LIMIT = 5;
const RETENTION_MS = 24 * 3600 * 1000;
const RUNNING_STATES: JobState[] = ['parsing', 'matching'];
const ACTIVE_STATES: JobState[] = ['queued', ...RUNNING_STATES];
const ETA_SAMPLE_LIMIT = 10;

export interface SubmitInput {
  url: string;
  storefront: string;
  ip: string;
  trackCap?: number;
}

export interface ConfirmChoice {
  order: number;
  appleId: string | null;
}

interface JobRecord {
  id: string;
  url: string;
  storefront: string;
  ip: string;
  state: JobState;
  createdAt: number;
  startedAt: number | null;
  parsed: ParsedPlaylist | null;
  progress: { done: number; total: number } | null;
  results: MatchResult[] | null;
  choices: ConfirmChoice[] | null;
  error: string | null;
}

export interface SerializedQueue {
  jobs: JobRecord[];
  daily: Array<{ ip: string; day: number; count: number }>;
  durations: number[];
  nextId: number;
}

function illegal(from: JobState, to: JobState): never {
  throw new Error(`非法状态迁移:${from} → ${to}`);
}

export class QueueCore {
  private jobs = new Map<string, JobRecord>();
  private order: string[] = [];
  private daily = new Map<string, { day: number; count: number }>();
  private durations: number[] = [];
  private nextId = 1;
  private readonly trackCap: number;

  constructor(trackCap: number = TRACK_CAP_DEFAULT) {
    this.trackCap = trackCap;
  }

  serialize(): SerializedQueue {
    return {
      jobs: [...this.jobs.values()],
      daily: [...this.daily.entries()].map(([ip, v]) => ({ ip, ...v })),
      durations: [...this.durations],
      nextId: this.nextId,
    };
  }

  restore(data: SerializedQueue): void {
    this.jobs = new Map(data.jobs.map((j) => [j.id, j]));
    this.order = data.jobs.map((j) => j.id);
    this.daily = new Map(data.daily.map((d) => [d.ip, { day: d.day, count: d.count }]));
    this.durations = [...data.durations];
    this.nextId = data.nextId;
  }

  admit(ip: string, now: number): { ok: true } | { ok: false; reason: string } {
    const running = [...this.jobs.values()].some(
      (j) => j.ip === ip && RUNNING_STATES.includes(j.state),
    );
    if (running) return { ok: false, reason: '已有任务正在进行,请等待完成后再提交' };
    const day = Math.floor(now / 86_400_000);
    const used = this.daily.get(ip);
    if (used && used.day === day && used.count >= DAILY_LIMIT) {
      return { ok: false, reason: '今日提交次数已达上限(5 次)' };
    }
    return { ok: true };
  }

  submit(input: SubmitInput, now: number): { jobId: string } {
    const random = crypto.randomUUID().replace(/-/g, '').slice(0, 8);
    const id = `job-${this.nextId++}-${random}`;
    const record: JobRecord = {
      id,
      url: input.url,
      storefront: input.storefront,
      ip: input.ip,
      state: 'queued',
      createdAt: now,
      startedAt: null,
      parsed: null,
      progress: null,
      results: null,
      choices: null,
      error: null,
    };
    this.jobs.set(id, record);
    this.order.push(id);
    const day = Math.floor(now / 86_400_000);
    const used = this.daily.get(input.ip);
    if (used && used.day === day) used.count++;
    else this.daily.set(input.ip, { day, count: 1 });
    return { jobId: id };
  }

  get(jobId: string): JobSnapshot | null {
    const job = this.jobs.get(jobId);
    if (!job) return null;
    return {
      id: job.id,
      state: job.state,
      createdAt: job.createdAt,
      storefront: job.storefront,
      queuePosition: this.positionOf(jobId),
      etaSeconds: this.etaSeconds(jobId),
      parsed: job.parsed,
      progress: job.progress,
      results: job.results,
      choices: job.choices,
      error: job.error,
    };
  }

  listRunning(): string[] {
    return [...this.jobs.values()].filter((j) => RUNNING_STATES.includes(j.state)).map((j) => j.id);
  }

  next(now: number): string | null {
    for (const id of this.order) {
      const job = this.jobs.get(id);
      if (!job || job.state !== 'queued') continue;
      const busyIps = new Set(
        [...this.jobs.values()].filter((j) => RUNNING_STATES.includes(j.state)).map((j) => j.ip),
      );
      if (!busyIps.has(job.ip)) return id;
    }
    return null;
  }

  positionOf(jobId: string): number | null {
    const job = this.jobs.get(jobId);
    if (!job || job.state !== 'queued') return null;
    let position = 0;
    for (const id of this.order) {
      const j = this.jobs.get(id);
      if (!j || j.state !== 'queued') continue;
      position++;
      if (id === jobId) return position;
    }
    return null;
  }

  etaSeconds(jobId: string): number | null {
    const position = this.positionOf(jobId);
    if (position === null || this.durations.length === 0) return null;
    const running = [...this.jobs.values()].filter((j) => RUNNING_STATES.includes(j.state)).length;
    const ahead = running + position - 1;
    const avg =
      this.durations.slice(-ETA_SAMPLE_LIMIT).reduce((a, b) => a + b, 0) /
      Math.min(this.durations.length, ETA_SAMPLE_LIMIT);
    return Math.round((ahead * avg) / 1000);
  }

  private transition(jobId: string, to: JobState, from: JobState[]): JobRecord {
    const job = this.jobs.get(jobId);
    if (!job) throw new Error(`任务不存在:${jobId}`);
    if (!from.includes(job.state)) illegal(job.state, to);
    job.state = to;
    return job;
  }

  markParsing(jobId: string): void {
    const job = this.transition(jobId, 'parsing', ['queued']);
    job.startedAt = Date.now();
  }

  markMatching(jobId: string): void {
    this.transition(jobId, 'matching', ['parsing']);
  }

  /** 超过曲目上限时任务转 failed 并返回 false,调用方须立即停止处理 */
  setParsed(jobId: string, parsed: ParsedPlaylist): boolean {
    const job = this.jobs.get(jobId);
    if (!job) throw new Error(`任务不存在:${jobId}`);
    if (job.state !== 'parsing') throw new Error(`非法状态迁移:${job.state} → setParsed`);
    if (parsed.tracks.length > this.trackCap) {
      this.fail(jobId, `歌单曲目数超过上限(${this.trackCap} 首),已拒绝处理`, Date.now());
      return false;
    }
    job.parsed = parsed;
    job.progress = { done: 0, total: parsed.tracks.length };
    return true;
  }

  setResults(jobId: string, results: MatchResult[]): void {
    const job = this.transition(jobId, 'awaiting_confirmation', ['matching']);
    job.results = results;
  }

  applyConfirm(jobId: string, choices: ConfirmChoice[]): boolean {
    const job = this.jobs.get(jobId);
    if (!job || job.state !== 'awaiting_confirmation') return false;
    job.choices = choices;
    job.state = 'importing';
    return true;
  }

  getChoices(jobId: string): ConfirmChoice[] | null {
    return this.jobs.get(jobId)?.choices ?? null;
  }

  getInput(jobId: string): { url: string; storefront: string } | null {
    const job = this.jobs.get(jobId);
    return job ? { url: job.url, storefront: job.storefront } : null;
  }

  /** 服务重启后,把悬在 parsing/matching 的中断任务置为失败并退还配额,避免准入被永久卡死 */
  recoverInterrupted(now: number): string[] {
    const recovered: string[] = [];
    for (const job of [...this.jobs.values()]) {
      if (RUNNING_STATES.includes(job.state)) {
        this.fail(job.id, '服务重启,任务已中断,请重新提交', now);
        recovered.push(job.id);
      }
    }
    return recovered;
  }

  finish(jobId: string, now: number): void {
    const job = this.transition(jobId, 'done', ['awaiting_confirmation', 'importing']);
    if (job.startedAt !== null) {
      this.durations.push(now - job.startedAt);
    }
  }

  fail(jobId: string, message: string, now: number): void {
    const job = this.jobs.get(jobId);
    if (!job) throw new Error(`任务不存在:${jobId}`);
    if (!ACTIVE_STATES.includes(job.state) && job.state !== 'awaiting_confirmation' && job.state !== 'importing') {
      illegal(job.state, 'failed');
    }
    job.state = 'failed';
    job.error = message;
    // 失败退还当日配额
    const day = Math.floor(now / 86_400_000);
    const used = this.daily.get(job.ip);
    if (used && used.day === day && used.count > 0) used.count--;
  }

  cleanup(now: number): string[] {
    const removed: string[] = [];
    for (const [id, job] of this.jobs) {
      if (now - job.createdAt > RETENTION_MS) {
        this.jobs.delete(id);
        this.order = this.order.filter((x) => x !== id);
        removed.push(id);
      }
    }
    return removed;
  }
}
