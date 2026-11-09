/**
 * Checks a CrazyGames user token: the JWT the CrazyGames SDK gives a logged-in
 * player (SDK.user.getUserToken()), signed RS256 with the key at
 * PUBLIC_KEY_URL (https://docs.crazygames.com/sdk/user/). Uses only Web Crypto
 * and fetch, so it runs in Supabase Edge Functions (Deno) and in Node's tests.
 */

export interface CrazyGamesUser {
  userId: string;
  gameId?: string;
  username?: string;
  profilePictureUrl?: string;
}

export const PUBLIC_KEY_URL = 'https://sdk.crazygames.com/publicKey.json';

const b64ToBytes = (b64: string): Uint8Array<ArrayBuffer> => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
const b64urlToBytes = (s: string): Uint8Array<ArrayBuffer> => b64ToBytes(s.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(s.length / 4) * 4, '='));
const b64urlToText = (s: string): string => new TextDecoder().decode(b64urlToBytes(s));

/** A DER length. */
function derLength(n: number): number[] {
  if (n < 0x80) return [n];
  const out: number[] = [];
  for (let v = n; v > 0; v >>= 8) out.unshift(v & 0xff);
  return [0x80 | out.length, ...out];
}

/** An "RSA PUBLIC KEY" (PKCS#1, as CrazyGames publishes it) wrapped as the SubjectPublicKeyInfo Web Crypto imports. */
export function pkcs1ToSpki(pkcs1: Uint8Array): Uint8Array<ArrayBuffer> {
  // SEQUENCE { SEQUENCE { OID rsaEncryption, NULL }, BIT STRING { 0 unused bits, the key } }
  const algorithm = [0x30, 0x0d, 0x06, 0x09, 0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x01, 0x01, 0x05, 0x00];
  const bits = [0x03, ...derLength(pkcs1.length + 1), 0x00, ...pkcs1];
  const body = [...algorithm, ...bits];
  return Uint8Array.from([0x30, ...derLength(body.length), ...body]);
}

/** A PEM public key ("RSA PUBLIC KEY" or "PUBLIC KEY") as a Web Crypto key for RS256. */
export function importRsaPublicKey(pem: string): Promise<CryptoKey> {
  const der = b64ToBytes(pem.replace(/-----[^-]+-----/g, '').replace(/\s+/g, ''));
  const spki = /BEGIN RSA PUBLIC KEY/.test(pem) ? pkcs1ToSpki(der) : der;
  return crypto.subtle.importKey('spki', spki, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
}

/** CrazyGames' current public key. */
export async function crazyGamesKey(doFetch: typeof fetch = fetch): Promise<CryptoKey> {
  const res = await doFetch(PUBLIC_KEY_URL);
  if (!res.ok) throw new Error(`public key: HTTP ${res.status}`);
  const { publicKey } = (await res.json()) as { publicKey: string };
  return importRsaPublicKey(publicKey);
}

/**
 * The player in a token, if it's genuine: signed by `key` (RS256), not
 * expired, with a user id, and (with `gameId`) for this game. Throws otherwise.
 */
export async function verifyCrazyGamesToken(token: string, opts: { key: CryptoKey; gameId?: string; now?: number }): Promise<CrazyGamesUser> {
  const parts = token.split('.');
  if (parts.length !== 3) throw new Error('not a JWT');
  const header = JSON.parse(b64urlToText(parts[0])) as { alg?: string };
  if (header.alg !== 'RS256') throw new Error('unexpected algorithm');
  const signed = new TextEncoder().encode(`${parts[0]}.${parts[1]}`);
  const ok = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', opts.key, b64urlToBytes(parts[2]), signed);
  if (!ok) throw new Error('bad signature');
  const payload = JSON.parse(b64urlToText(parts[1])) as CrazyGamesUser & { exp?: number };
  const now = opts.now ?? Date.now() / 1000;
  if (typeof payload.exp === 'number' && payload.exp < now) throw new Error('expired');
  if (typeof payload.userId !== 'string' || !payload.userId) throw new Error('no user id');
  if (opts.gameId && payload.gameId !== opts.gameId) throw new Error('another game');
  return payload;
}
