import { describe, expect, it } from 'vitest';
import * as sharedEntry from '@tunebridge/shared';

describe('worker smoke', () => {
  it('runs and can import shared package', () => {
    expect(sharedEntry).toBeDefined();
    expect(true).toBe(true);
  });
});
