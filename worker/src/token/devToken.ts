const DAY = 86400;
const TOKEN_TTL = 180 * DAY;
const CACHE_MIN_REMAINING = 7 * DAY;

interface TokenCache {
  token: string;
  expiresAt: number;
  kid: string;
}

let cache: TokenCache | null = null;

const encoder = new TextEncoder();

function base64UrlEncode(bytes: Uint8Array): string {
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function pemToDer(pem: string): Uint8Array {
  const b64 = pem.replace(/-----[^-]+-----/g, '').replace(/\s+/g, '');
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function derSignatureToRaw(sig: Uint8Array): Uint8Array {
  // Workers 的 webcrypto 返回 ASN.1/DER;较新的 Node webcrypto 已按修订规范直接返回裸 r||s。两者都接受。
  if (sig.length === 64) return sig;
  if (sig[0] !== 0x30) throw new Error('invalid ECDSA signature');
  let i = 2;
  const readInt = (): Uint8Array => {
    if (sig[i] !== 0x02) throw new Error('invalid ECDSA signature');
    const len = sig[i + 1];
    i += 2;
    let v = sig.slice(i, i + len);
    i += len;
    while (v.length > 1 && v[0] === 0) v = v.slice(1);
    const out = new Uint8Array(32);
    out.set(v, 32 - v.length);
    return out;
  };
  const r = readInt();
  const s = readInt();
  const raw = new Uint8Array(64);
  raw.set(r, 0);
  raw.set(s, 32);
  return raw;
}

export interface SignDeveloperTokenOpts {
  privateKeyPem: string;
  teamId: string;
  keyId: string;
  now?: number;
}

export interface AppleTokenEnv {
  APPLE_MUSIC_DEV_TOKEN?: string;
  APPLE_MUSIC_PRIVATE_KEY?: string;
  APPLE_MUSIC_TEAM_ID?: string;
  APPLE_MUSIC_KEY_ID?: string;
}

/** 直填 token 优先(即将到期的静态 JWT);未配置则用 .p8 三件套签发 */
export async function resolveDeveloperToken(env: AppleTokenEnv): Promise<string> {
  if (env.APPLE_MUSIC_DEV_TOKEN && env.APPLE_MUSIC_DEV_TOKEN.length > 0) {
    return env.APPLE_MUSIC_DEV_TOKEN;
  }
  if (!env.APPLE_MUSIC_PRIVATE_KEY || !env.APPLE_MUSIC_TEAM_ID || !env.APPLE_MUSIC_KEY_ID) {
    throw new Error('未配置 Apple Music 密钥(配 APPLE_MUSIC_DEV_TOKEN 或三件套)');
  }
  return signDeveloperToken({
    privateKeyPem: env.APPLE_MUSIC_PRIVATE_KEY,
    teamId: env.APPLE_MUSIC_TEAM_ID,
    keyId: env.APPLE_MUSIC_KEY_ID,
  });
}

export async function signDeveloperToken(opts: SignDeveloperTokenOpts): Promise<string> {
  const { teamId, keyId, privateKeyPem } = opts;
  const now = opts.now ?? Math.floor(Date.now() / 1000);
  if (cache && cache.kid === keyId && cache.expiresAt - now > CACHE_MIN_REMAINING) {
    return cache.token;
  }
  const key = await crypto.subtle.importKey(
    'pkcs8',
    pemToDer(privateKeyPem) as unknown as ArrayBuffer,
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['sign'],
  );
  const header = base64UrlEncode(encoder.encode(JSON.stringify({ alg: 'ES256', kid: keyId })));
  const payload = base64UrlEncode(
    encoder.encode(JSON.stringify({ iss: teamId, iat: now, exp: now + TOKEN_TTL })),
  );
  const derSig = new Uint8Array(
    await crypto.subtle.sign(
      { name: 'ECDSA', hash: 'SHA-256' },
      key,
      encoder.encode(`${header}.${payload}`),
    ),
  );
  const token = `${header}.${payload}.${base64UrlEncode(derSignatureToRaw(derSig))}`;
  cache = { token, expiresAt: now + TOKEN_TTL, kid: keyId };
  return token;
}
