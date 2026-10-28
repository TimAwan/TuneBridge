import { DurableObject } from 'cloudflare:workers';
import {
  QueueCore,
  type ConfirmChoice,
  type SerializedQueue,
  type SubmitInput,
} from '../queue/core';

const ALARM_INTERVAL_MS = 3600 * 1000;

export class QueueDO extends DurableObject {
  private core = new QueueCore();

  constructor(ctx: DurableObjectState, env: Record<string, unknown>) {
    super(ctx, env);
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

  admit(ip: string, now: number): { ok: true } | { ok: false; reason: string } {
    return this.core.admit(ip, now);
  }

  async submit(input: SubmitInput, now: number): Promise<{ jobId: string }> {
    const result = this.core.submit(input, now);
    await this.persist();
    return result;
  }

  get(jobId: string): { snapshot: unknown } {
    return { snapshot: this.core.get(jobId) };
  }

  next(now: number): { jobId: string | null } {
    return { jobId: this.core.next(now) };
  }

  async markParsing(jobId: string): Promise<void> {
    this.core.markParsing(jobId);
    await this.persist();
  }

  async markMatching(jobId: string): Promise<void> {
    this.core.markMatching(jobId);
    await this.persist();
  }

  async setParsed(jobId: string, parsed: unknown): Promise<void> {
    this.core.setParsed(jobId, parsed as Parameters<QueueCore['setParsed']>[1]);
    await this.persist();
  }

  async setResults(jobId: string, results: unknown): Promise<void> {
    this.core.setResults(jobId, results as Parameters<QueueCore['setResults']>[1]);
    await this.persist();
  }

  async applyConfirm(jobId: string, choices: ConfirmChoice[]): Promise<boolean> {
    const ok = this.core.applyConfirm(jobId, choices);
    await this.persist();
    return ok;
  }

  getChoices(jobId: string): { choices: ConfirmChoice[] | null } {
    return { choices: this.core.getChoices(jobId) };
  }

  async fail(jobId: string, message: string, now: number): Promise<void> {
    this.core.fail(jobId, message, now);
    await this.persist();
  }

  async finish(jobId: string, now: number): Promise<void> {
    this.core.finish(jobId, now);
    await this.persist();
  }

  async alarm(): Promise<void> {
    this.core.cleanup(Date.now());
    await this.persist();
    await this.ctx.storage.setAlarm(Date.now() + ALARM_INTERVAL_MS);
  }
}
