// Track Builder 3D: cloud saves for CrazyGames players (a Supabase Edge Function).
//
//   GET  /functions/v1/cg-save   -> { data, updated_at } | null   the player's save
//   PUT  /functions/v1/cg-save   { data } -> { updated_at }        saves it
//
// The player is whoever the x-cg-token header says, once the token is checked
// against CrazyGames' public key; their row is 'cg:<CrazyGames userId>'. Set
// the CG_GAME_ID secret to the game's CrazyGames id to accept tokens for this
// game only.
//
// One self-contained file, so it can be pasted into the Supabase dashboard
// (Edge Functions -> Deploy a new function -> Via Editor, named cg-save) as
// well as deployed with the CLI. Either way, switch off "Verify JWT" for it
// (CLI: --no-verify-jwt): it checks the CrazyGames token itself, and the game
// calls it with the project's publishable key, which isn't a JWT. See
// supabase/README.md.

// ------------------------------------------------------------ CrazyGames token

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

// ---------------------------------------------------------------- the function

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-cg-token',
  'Access-Control-Allow-Methods': 'GET, PUT, OPTIONS',
};
const MAX_BYTES = 2_000_000;

const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });

/** What the function needs from its surroundings (the Edge runtime, or a test). */
export interface Deps {
  env: (name: string) => string | undefined;
  fetch: typeof fetch;
  /** CrazyGames' public key; `fresh` asks for it again (it may have changed). */
  key: (fresh: boolean) => Promise<CryptoKey>;
}

/**
 * The project's admin key, which can reach the CrazyGames players' rows: the
 * default secret key (sb_secret_…), or the legacy service_role key on older
 * projects. Both are given to Edge Functions by Supabase.
 */
export function adminKey(env: Deps['env']): string {
  try {
    const keys = JSON.parse(env('SUPABASE_SECRET_KEYS') ?? '{}') as Record<string, string>;
    const key = keys.default ?? Object.values(keys)[0];
    if (key) return key;
  } catch {
    /* not set: the legacy key */
  }
  const legacy = env('SUPABASE_SERVICE_ROLE_KEY');
  if (!legacy) throw new Error('no admin key');
  return legacy;
}

/** Headers for the REST API with `key`: on `apikey` (a legacy JWT key also as the bearer token; a new key there would be rejected as a bad JWT). */
export const keyHeaders = (key: string): Record<string, string> => (key.startsWith('eyJ') ? { apikey: key, Authorization: `Bearer ${key}` } : { apikey: key });

/** One request. */
export async function handle(req: Request, deps: Deps): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  const token = req.headers.get('x-cg-token');
  if (!token) return reply({ error: 'missing x-cg-token' }, 401);
  const gameId = deps.env('CG_GAME_ID') || undefined;
  let id: string;
  try {
    let user: CrazyGamesUser;
    try {
      user = await verifyCrazyGamesToken(token, { key: await deps.key(false), gameId });
    } catch {
      user = await verifyCrazyGamesToken(token, { key: await deps.key(true), gameId });
    }
    id = `cg:${user.userId}`;
  } catch {
    return reply({ error: 'invalid CrazyGames token' }, 401);
  }
  const url = deps.env('SUPABASE_URL');
  if (!url) return reply({ error: 'no SUPABASE_URL' }, 500);
  let key: string;
  try {
    key = adminKey(deps.env);
  } catch {
    return reply({ error: 'no admin key' }, 500);
  }
  const headers = { ...keyHeaders(key), 'Content-Type': 'application/json' };
  const rows = async (res: Response) => {
    if (!res.ok) throw new Error(`database: HTTP ${res.status} ${await res.text()}`);
    return (await res.json()) as Record<string, unknown>[];
  };
  try {
    if (req.method === 'GET') {
      const found = await rows(await deps.fetch(`${url}/rest/v1/saves?player=eq.${encodeURIComponent(id)}&select=data,updated_at`, { headers }));
      return reply(found[0] ?? null);
    }
    if (req.method === 'PUT') {
      const text = await req.text();
      if (text.length > MAX_BYTES) return reply({ error: 'save too big' }, 413);
      let body: { data?: unknown };
      try {
        body = JSON.parse(text);
      } catch {
        return reply({ error: 'bad JSON' }, 400);
      }
      if (!body.data || typeof body.data !== 'object' || Array.isArray(body.data)) return reply({ error: 'data must be an object' }, 400);
      const saved = await rows(
        await deps.fetch(`${url}/rest/v1/saves?on_conflict=player&select=updated_at`, {
          method: 'POST',
          headers: { ...headers, Prefer: 'resolution=merge-duplicates,return=representation' },
          body: JSON.stringify({ player: id, data: body.data }),
        }),
      );
      return reply(saved[0]);
    }
  } catch (e) {
    return reply({ error: e instanceof Error ? e.message : 'database error' }, 500);
  }
  return reply({ error: 'method not allowed' }, 405);
}

// In the Edge runtime: serve. (The tests load this file in Node, where there's no Deno.)
const runtime = (globalThis as { Deno?: { env: { get(name: string): string | undefined }; serve(handler: (req: Request) => Promise<Response>): unknown } }).Deno;
if (runtime) {
  let cached: CryptoKey | null = null;
  const deps: Deps = {
    env: (name) => runtime.env.get(name),
    fetch: (input, init) => fetch(input, init),
    key: async (fresh) => (cached = !fresh && cached ? cached : await crazyGamesKey()),
  };
  runtime.serve((req) => handle(req, deps));
}
