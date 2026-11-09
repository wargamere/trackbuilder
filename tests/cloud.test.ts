import assert from 'node:assert/strict';
import { generateKeyPairSync, sign } from 'node:crypto';
import { test } from 'node:test';
import { CloudSync, crazyGamesBackend, webBackend, type CloudBackend, type CloudSave, type SessionStore } from '../src/platform/cloud.ts';
import { onStorageWrite, storage } from '../src/platform/storage.ts';
import { importRsaPublicKey, verifyCrazyGamesToken } from '../supabase/functions/_shared/cgToken.ts';

// ------------------------------------------------------------ CrazyGames tokens

const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048, publicKeyEncoding: { type: 'pkcs1', format: 'pem' }, privateKeyEncoding: { type: 'pkcs8', format: 'pem' } });
const b64url = (b: Buffer | string) => Buffer.from(b).toString('base64url');
const jwt = (payload: object, header: object = { alg: 'RS256', typ: 'JWT' }) => {
  const head = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(payload))}`;
  return `${head}.${b64url(sign('sha256', Buffer.from(head), privateKey))}`;
};

test('a CrazyGames token is accepted only when genuine, current and for this game', async () => {
  // (CrazyGames publishes its key as an "RSA PUBLIC KEY", PKCS#1, like this one.)
  assert.match(publicKey, /BEGIN RSA PUBLIC KEY/);
  const key = await importRsaPublicKey(publicKey);
  const now = 1_800_000_000;
  const good = { userId: 'u123', gameId: 'track-builder-3d', username: 'Ada', exp: now + 3600 };
  assert.equal((await verifyCrazyGamesToken(jwt(good), { key, now, gameId: 'track-builder-3d' })).userId, 'u123');
  assert.equal((await verifyCrazyGamesToken(jwt(good), { key, now })).username, 'Ada');
  const [h, , s] = jwt(good).split('.');
  const forged = `${h}.${b64url(JSON.stringify({ ...good, userId: 'someone-else' }))}.${s}`;
  await assert.rejects(verifyCrazyGamesToken(forged, { key, now }), /signature/);
  await assert.rejects(verifyCrazyGamesToken(jwt({ ...good, exp: now - 1 }), { key, now }), /expired/);
  await assert.rejects(verifyCrazyGamesToken(jwt(good), { key, now, gameId: 'another-game' }), /another game/);
  await assert.rejects(verifyCrazyGamesToken(jwt(good, { alg: 'HS256' }), { key, now }), /algorithm/);
  await assert.rejects(verifyCrazyGamesToken(jwt({ ...good, userId: '' }), { key, now }), /user id/);
  await assert.rejects(verifyCrazyGamesToken('not.a-token', { key, now }), /JWT/);
});

// ------------------------------------------------------------------- sync

/** A store like the game's: values and the keys written. */
function memoryStore(init: Record<string, string> = {}) {
  const m = new Map(Object.entries(init));
  return {
    m,
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, v),
    removeItem: (k: string) => void m.delete(k),
    keys: () => [...m.keys()].filter((k) => !k.startsWith('sync.')),
  };
}

/** A cloud with one save, counting what's sent; `down` makes it fail. */
function fakeCloud(save: CloudSave | null) {
  const cloud = {
    save,
    sent: [] as Record<string, string>[],
    down: false,
    clock: Date.parse('2026-11-09T12:00:00Z'),
    backend: null as unknown as CloudBackend,
  };
  cloud.backend = {
    load: async () => {
      if (cloud.down) throw new Error('offline');
      return cloud.save;
    },
    save: async (data) => {
      if (cloud.down) throw new Error('offline');
      cloud.sent.push(data);
      const updatedAt = new Date((cloud.clock += 1000)).toISOString();
      cloud.save = { data, updatedAt };
      return updatedAt;
    },
  };
  return cloud;
}

/** Timers run by hand. */
function manualTimers() {
  const pending: { fn: () => void; ms: number }[] = [];
  return {
    pending,
    opts: { setTimer: (fn: () => void, ms: number) => pending.push({ fn, ms }) && pending.length, clearTimer: () => void pending.splice(0) },
    async run() {
      const due = pending.splice(0);
      for (const t of due) t.fn();
      await new Promise((r) => setTimeout(r, 0));
    },
  };
}

test('a newer cloud save replaces this device\'s at boot, keys and all', async () => {
  const store = memoryStore({ settings: '{"paint":"red"}', 'records.old': '{}', 'sync.updatedAt': '2026-11-01T00:00:00Z' });
  const cloud = fakeCloud({ data: { settings: '{"paint":"blue"}', library: '[]' }, updatedAt: '2026-11-05T00:00:00Z' });
  const sync = new CloudSync(cloud.backend, store, manualTimers().opts);
  assert.equal(await sync.restore(), true);
  assert.equal(store.getItem('settings'), '{"paint":"blue"}');
  assert.equal(store.getItem('library'), '[]');
  assert.equal(store.getItem('records.old'), null, 'what the cloud save hasn\'t got is gone');
  assert.equal(store.getItem('sync.updatedAt'), '2026-11-05T00:00:00Z');
  assert.equal(cloud.sent.length, 0, 'nothing sent back');
});

test('an older or missing cloud save gets this device\'s; changes are sent a moment later, the newest each time', async () => {
  const store = memoryStore({ settings: 'A', 'sync.updatedAt': '2026-11-06T00:00:00Z' });
  const timers = manualTimers();
  // No cloud save yet: this device's is sent.
  const cloud = fakeCloud(null);
  const sync = new CloudSync(cloud.backend, store, { ...timers.opts, delay: 5000 });
  assert.equal(await sync.restore(), false);
  assert.equal(timers.pending[0]?.ms, 5000);
  await timers.run();
  assert.deepEqual(cloud.sent, [{ settings: 'A' }]);
  assert.equal(store.getItem('sync.updatedAt'), cloud.save?.updatedAt);
  // Two quick changes: one send, with both.
  store.setItem('settings', 'B');
  sync.changed();
  store.setItem('library', 'L');
  sync.changed();
  assert.equal(timers.pending.length, 1);
  await timers.run();
  assert.deepEqual(cloud.sent[1], { settings: 'B', library: 'L' });
  // An older save in the cloud than this device last sent: nothing to take, nothing changed to send.
  const sync2 = new CloudSync(fakeCloud({ data: { settings: 'Z' }, updatedAt: '2026-01-01T00:00:00Z' }).backend, store, timers.opts);
  assert.equal(await sync2.restore(), false);
  assert.equal(store.getItem('settings'), 'B');
  assert.equal(timers.pending.length, 0);
});

test('offline: the game carries on, the change is kept and sent once the cloud is back', async () => {
  const store = memoryStore({ settings: 'A', 'sync.updatedAt': '2026-11-06T00:00:00Z' });
  const timers = manualTimers();
  const cloud = fakeCloud({ data: { settings: 'A' }, updatedAt: '2026-11-06T00:00:00Z' });
  cloud.down = true;
  const sync = new CloudSync(cloud.backend, store, { ...timers.opts, retry: 1000 });
  assert.equal(await sync.restore(50), false);
  assert.equal(sync.status, 'error');
  store.setItem('settings', 'B');
  sync.changed();
  await timers.run();
  assert.equal(store.getItem('sync.dirty'), '1', 'still to send');
  assert.equal(timers.pending[0]?.ms, 1000, 'tries again');
  cloud.down = false;
  await timers.run();
  assert.deepEqual(cloud.sent, [{ settings: 'B' }]);
  assert.equal(store.getItem('sync.dirty'), '');
  // A slow cloud never holds up the game.
  const never: CloudBackend = { load: () => new Promise(() => {}), save: () => new Promise(() => {}) };
  const t0 = Date.now();
  assert.equal(await new CloudSync(never, memoryStore(), timers.opts).restore(80), false);
  assert.ok(Date.now() - t0 < 1000);
});

test('the game\'s store tells the sync about every write and remembers every key', () => {
  const seen: string[] = [];
  onStorageWrite((k) => seen.push(k));
  storage.setItem('cloudtest.a', '1');
  storage.setItem('cloudtest.b', '2');
  storage.removeItem('cloudtest.a');
  storage.setItem('sync.updatedAt', 'x'); // bookkeeping: not a change, not a key to send
  onStorageWrite(null);
  assert.deepEqual(seen, ['cloudtest.a', 'cloudtest.b', 'cloudtest.a']);
  assert.ok(storage.keys().includes('cloudtest.b') && !storage.keys().includes('cloudtest.a') && !storage.keys().includes('sync.updatedAt'));
  storage.removeItem('cloudtest.b');
});

// --------------------------------------------------------------- backends

test('web: an anonymous sign-in once per browser, then its own row', async () => {
  const calls: { url: string; init?: RequestInit }[] = [];
  let signups = 0;
  const fakeFetch = (async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    const body = (x: unknown) => new Response(JSON.stringify(x), { status: 200 });
    if (url.endsWith('/auth/v1/signup')) {
      signups++;
      return body({ access_token: 'acc', refresh_token: 'ref', expires_in: 3600, user: { id: 'uid-1' } });
    }
    if (url.includes('/rest/v1/saves?player=')) return body([{ data: { settings: 'S' }, updated_at: '2026-11-09T10:00:00Z' }]);
    if (url.includes('/rest/v1/saves?on_conflict=player')) return body([{ updated_at: '2026-11-09T11:00:00Z' }]);
    return new Response('nope', { status: 404 });
  }) as typeof fetch;
  let kept: string | null = null;
  const sessions: SessionStore = { get: () => kept, set: (v) => (kept = v) };
  const cfg = { url: 'https://example.supabase.co', anonKey: 'anon-key' };
  const web = webBackend(cfg, sessions, fakeFetch, () => 1000);
  assert.deepEqual(await web.load(), { data: { settings: 'S' }, updatedAt: '2026-11-09T10:00:00Z' });
  assert.equal(await web.save({ settings: 'T' }), '2026-11-09T11:00:00Z');
  assert.equal(signups, 1, 'signed in once');
  const get = calls.find((c) => c.url.includes('player=eq.'));
  assert.ok(get?.url.includes(`player=eq.${encodeURIComponent('sb:uid-1')}`));
  assert.equal((get?.init?.headers as Record<string, string>).Authorization, 'Bearer acc');
  const post = calls.find((c) => c.url.includes('on_conflict'));
  assert.deepEqual(JSON.parse(String(post?.init?.body)), { player: 'sb:uid-1', data: { settings: 'T' } });
  assert.match((post?.init?.headers as Record<string, string>).Prefer, /merge-duplicates/);
  // The same browser later: the kept sign-in, no new player.
  await webBackend(cfg, sessions, fakeFetch, () => 1000).load();
  assert.equal(signups, 1);
});

test('CrazyGames: the player\'s token goes with every call; guests have no cloud save', async () => {
  const seen: Record<string, string>[] = [];
  const fakeFetch = (async (url: string, init?: RequestInit) => {
    assert.ok(url.endsWith('/functions/v1/cg-save'));
    seen.push(init?.headers as Record<string, string>);
    return new Response(JSON.stringify(init?.method === 'PUT' ? { updated_at: '2026-11-09T12:00:00Z' } : null), { status: 200 });
  }) as typeof fetch;
  const cfg = { url: 'https://example.supabase.co', anonKey: 'anon-key' };
  const cgb = crazyGamesBackend(cfg, async () => 'cg-token', fakeFetch);
  assert.equal(await cgb.load(), null);
  assert.equal(await cgb.save({ a: '1' }), '2026-11-09T12:00:00Z');
  assert.ok(seen.every((h) => h['x-cg-token'] === 'cg-token' && h.apikey === 'anon-key'));
  await assert.rejects(crazyGamesBackend(cfg, async () => null, fakeFetch).load(), /not logged in/);
});
