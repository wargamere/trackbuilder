// Track Builder 3D: cloud saves for CrazyGames players.
//
//   GET  /functions/v1/cg-save   -> { data, updated_at } | null   the player's save
//   PUT  /functions/v1/cg-save   { data } -> { updated_at }        saves it
//
// The player is whoever the x-cg-token header says, once the token is checked
// against CrazyGames' public key; their row is 'cg:<CrazyGames userId>'. Set
// the CG_GAME_ID secret to the game's CrazyGames id to accept tokens for this
// game only. Deploy: supabase functions deploy cg-save (see supabase/README.md).
import { createClient } from 'npm:@supabase/supabase-js@2';
import { crazyGamesKey, verifyCrazyGamesToken, type CrazyGamesUser } from '../_shared/cgToken.ts';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-cg-token',
  'Access-Control-Allow-Methods': 'GET, PUT, OPTIONS',
};
const MAX_BYTES = 2_000_000;

const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });

let key: CryptoKey | null = null;

/** The token's player; the key is fetched again once if it fails (CrazyGames may have changed it). */
async function player(token: string): Promise<CrazyGamesUser> {
  const gameId = Deno.env.get('CG_GAME_ID') || undefined;
  try {
    key ??= await crazyGamesKey();
    return await verifyCrazyGamesToken(token, { key, gameId });
  } catch {
    key = await crazyGamesKey();
    return await verifyCrazyGamesToken(token, { key, gameId });
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  const token = req.headers.get('x-cg-token');
  if (!token) return reply({ error: 'missing x-cg-token' }, 401);
  let id: string;
  try {
    id = `cg:${(await player(token)).userId}`;
  } catch {
    return reply({ error: 'invalid CrazyGames token' }, 401);
  }
  const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });

  if (req.method === 'GET') {
    const { data, error } = await db.from('saves').select('data, updated_at').eq('player', id).maybeSingle();
    if (error) return reply({ error: error.message }, 500);
    return reply(data ?? null);
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
    const { data, error } = await db.from('saves').upsert({ player: id, data: body.data }).select('updated_at').single();
    if (error) return reply({ error: error.message }, 500);
    return reply(data);
  }
  return reply({ error: 'method not allowed' }, 405);
});
