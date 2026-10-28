import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { signDeveloperToken } from './devToken';

const DAY = 86400;

function abToPem(buffer: ArrayBuffer): string {
  const b64 = Buffer.from(buffer).toString('base64');
  const lines = b64.match(/.{1,64}/g) ?? [];
  return `-----BEGIN PRIVATE KEY-----\n${lines.join('\n')}\n-----END PRIVATE KEY-----\n`;
}

async function makeKeyPem(): Promise<{ pem: string; publicKey: CryptoKey }> {
  const kp = (await crypto.subtle.generateKey(
    { name: 'ECDSA', namedCurve: 'P-256' },
    true,
    ['sign', 'verify'],
  )) as CryptoKeyPair;
  const pkcs8 = await crypto.subtle.exportKey('pkcs8', kp.privateKey);
  return { pem: abToPem(pkcs8), publicKey: kp.publicKey };
}

describe('signDeveloperToken', () => {
  it('produces a verifiable ES256 jwt with correct claims', async () => {
    const { pem, publicKey } = await makeKeyPem();
    const now = 1_700_000_000;
    const token = await signDeveloperToken({ privateKeyPem: pem, teamId: 'TEAM123', keyId: 'KEY456', now });

    const parts = token.split('.');
    expect(parts).toHaveLength(3);

    const header = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8'));
    expect(header).toEqual({ alg: 'ES256', kid: 'KEY456' });

    const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
    expect(payload.iss).toBe('TEAM123');
    expect(payload.iat).toBe(now);
    expect(payload.exp).toBe(now + 180 * DAY);

    const sigBytes = new Uint8Array(Buffer.from(parts[2], 'base64url'));
    expect(sigBytes).toHaveLength(64);
    const data = new TextEncoder().encode(`${parts[0]}.${parts[1]}`);
    const ok = await crypto.subtle.verify(
      { name: 'ECDSA', hash: 'SHA-256' },
      publicKey,
      sigBytes as unknown as ArrayBuffer,
      data,
    );
    expect(ok).toBe(true);
  });

  it('does not produce padding characters in base64url segments', async () => {
    const fixturePem = readFileSync(
      join(fileURLToPath(new URL('.', import.meta.url)), 'fixtures', 'key.pem'),
      'utf8',
    );
    const token = await signDeveloperToken({
      privateKeyPem: fixturePem,
      teamId: 'T'.repeat(10),
      keyId: 'K'.repeat(10),
      now: 100,
    });
    for (const part of token.split('.')) {
      expect(part).not.toMatch(/[=+/]/);
    }
  });

  it('caches the signed token per key', async () => {
    const { pem } = await makeKeyPem();
    const a = await signDeveloperToken({ privateKeyPem: pem, teamId: 'TEAMX', keyId: 'KEYX', now: 200 });
    const b = await signDeveloperToken({ privateKeyPem: pem, teamId: 'TEAMX', keyId: 'KEYX', now: 300 });
    expect(a).toBe(b);
  });
});
