/**
 * Cloud saves in Supabase: everything the game saves, kept for each player on
 * our own server as well, so progress survives a cleared browser and follows
 * the player.
 *
 *  - On CrazyGames, a logged-in player's save is filed under their CrazyGames
 *    account: the game asks the SDK for the player's signed token, and the
 *    cg-save function (supabase/functions/cg-save) checks it with CrazyGames'
 *    public key before reading or writing their row. Guests keep what the
 *    CrazyGames data module keeps.
 *  - On the web, each browser signs in to Supabase anonymously (no sign-up),
 *    and row-level security lets it read and write its own row only.
 *
 * At boot, before the game reads anything, a newer cloud save replaces what's
 * on this device. After that, every change is sent a few seconds later (and
 * when the page is hidden). The newest save wins. Nothing here can stop the
 * game: with no network, no project set up, or any error, the game just
 * carries on with what's saved on the device.
 *
 * Set up: see supabase/README.md (the project URL and its publishable key, or
 * the legacy anon key, go in VITE_SUPABASE_URL / VITE_SUPABASE_PUBLISHABLE_KEY
 * at build time).
 */

export interface CloudSave {
  /** Every saved key and its value, as the game stores them. */
  data: Record<string, string>;
  /** When it was saved (the server's clock, ISO 8601). */
  updatedAt: string;
}

/** Where cloud saves go: one row per player. */
export interface CloudBackend {
  /** The player's save, or null if there isn't one yet. Throws when it can't tell (offline, not signed in). */
  load(): Promise<CloudSave | null>;
  /** Saves it; resolves with the server's time of the save. */
  save(data: Record<string, string>): Promise<string>;
}

export interface CloudConfig {
  url: string;
  /** The project's publishable key (sb_publishable_…), or its legacy anon key (a JWT). Public by design. */
  anonKey: string;
}

type Fetch = typeof fetch;

/** The project, from the build's environment (undefined when not set up). */
export function cloudConfig(): CloudConfig | null {
  const env = (import.meta as unknown as { env?: Record<string, string | undefined> }).env;
  const url = env?.VITE_SUPABASE_URL?.trim();
  const anonKey = (env?.VITE_SUPABASE_PUBLISHABLE_KEY || env?.VITE_SUPABASE_ANON_KEY)?.trim();
  return url && anonKey ? { url: url.replace(/\/+$/, ''), anonKey } : null;
}

async function json<T>(res: Response): Promise<T> {
  if (!res.ok) throw new Error(`cloud: HTTP ${res.status}`);
  return (await res.json()) as T;
}

// ------------------------------------------------------------------- web

interface Session {
  access: string;
  refresh: string;
  /** Seconds since 1970 when the access token runs out. */
  expires: number;
  user: string;
}

/** Where a web browser keeps its anonymous Supabase sign-in (not part of the save itself). */
export interface SessionStore {
  get(): string | null;
  set(value: string | null): void;
}

export const browserSessionStore = (key = 'trackbuilder3d.supabase.session'): SessionStore => ({
  get: () => {
    try {
      return globalThis.localStorage?.getItem(key) ?? null;
    } catch {
      return null;
    }
  },
  set: (v) => {
    try {
      if (v === null) globalThis.localStorage?.removeItem(key);
      else globalThis.localStorage?.setItem(key, v);
    } catch {
      /* no storage: a new anonymous player each visit */
    }
  },
});

/**
 * Web players: an anonymous Supabase sign-in per browser (Supabase Auth's
 * anonymous sign-ins must be switched on), then their own row of `saves`
 * through the REST API.
 */
export function webBackend(cfg: CloudConfig, sessions: SessionStore, doFetch: Fetch = fetch, now = () => Date.now() / 1000): CloudBackend {
  const base = { apikey: cfg.anonKey, 'Content-Type': 'application/json' };
  let session: Session | null = null;
  try {
    session = JSON.parse(sessions.get() ?? 'null') as Session | null;
  } catch {
    session = null;
  }
  const keep = (r: { access_token: string; refresh_token: string; expires_in?: number; expires_at?: number; user: { id: string } }): Session => {
    session = { access: r.access_token, refresh: r.refresh_token, expires: r.expires_at ?? now() + (r.expires_in ?? 3600), user: r.user.id };
    sessions.set(JSON.stringify(session));
    return session;
  };
  const signIn = async (): Promise<Session> => {
    if (session && session.expires - 60 > now()) return session;
    if (session?.refresh) {
      const res = await doFetch(`${cfg.url}/auth/v1/token?grant_type=refresh_token`, { method: 'POST', headers: base, body: JSON.stringify({ refresh_token: session.refresh }) });
      if (res.ok) return keep(await res.json());
      // (A refresh token that's no longer good: start again as a new anonymous player.)
    }
    // No email or phone: an anonymous sign-in.
    return keep(await json(await doFetch(`${cfg.url}/auth/v1/signup`, { method: 'POST', headers: base, body: JSON.stringify({ data: {} }) })));
  };
  const auth = (s: Session) => ({ ...base, Authorization: `Bearer ${s.access}` });
  return {
    async load() {
      const s = await signIn();
      const rows = await json<{ data: Record<string, string>; updated_at: string }[]>(
        await doFetch(`${cfg.url}/rest/v1/saves?player=eq.${encodeURIComponent(`sb:${s.user}`)}&select=data,updated_at`, { headers: auth(s) }),
      );
      return rows[0] ? { data: rows[0].data, updatedAt: rows[0].updated_at } : null;
    },
    async save(data) {
      const s = await signIn();
      const rows = await json<{ updated_at: string }[]>(
        await doFetch(`${cfg.url}/rest/v1/saves?on_conflict=player&select=updated_at`, {
          method: 'POST',
          headers: { ...auth(s), Prefer: 'resolution=merge-duplicates,return=representation' },
          body: JSON.stringify({ player: `sb:${s.user}`, data }),
        }),
      );
      return rows[0].updated_at;
    },
  };
}

// ------------------------------------------------------------- CrazyGames

/**
 * CrazyGames players: their save goes through the cg-save function with their
 * CrazyGames token, which it checks. `token` is null for guests (load throws:
 * there's no account to load from).
 */
export function crazyGamesBackend(cfg: CloudConfig, token: () => Promise<string | null>, doFetch: Fetch = fetch): CloudBackend {
  const call = async (init: RequestInit) => {
    const t = await token();
    if (!t) throw new Error('cloud: not logged in to CrazyGames');
    return doFetch(`${cfg.url}/functions/v1/cg-save`, {
      ...init,
      // (A publishable key goes on apikey only: as a bearer token it would be rejected as a bad JWT.
      // A legacy anon key is a JWT, and goes on both.)
      headers: { apikey: cfg.anonKey, ...(cfg.anonKey.startsWith('eyJ') ? { Authorization: `Bearer ${cfg.anonKey}` } : {}), 'Content-Type': 'application/json', 'x-cg-token': t },
    });
  };
  return {
    async load() {
      const row = await json<{ data: Record<string, string>; updated_at: string } | null>(await call({ method: 'GET' }));
      return row ? { data: row.data, updatedAt: row.updated_at } : null;
    },
    async save(data) {
      return (await json<{ updated_at: string }>(await call({ method: 'PUT', body: JSON.stringify({ data }) }))).updated_at;
    },
  };
}

// ------------------------------------------------------------------ sync

/** The game's store as the sync sees it: values, and the keys it has written. */
export interface SyncStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
  keys(): string[];
}

/** The time of the save this device last sent or took (the server's clock). */
const SYNCED_AT = 'sync.updatedAt';
/** Changed since then and not sent yet. */
const DIRTY = 'sync.dirty';
/** Bigger saves than this aren't sent (the database refuses 2 MB). */
export const CLOUD_MAX = 1_900_000;

export interface SyncOptions {
  /** How long after a change it's sent (ms). */
  delay?: number;
  /** Waiting before trying again after a failure (ms; it doubles, up to a minute). */
  retry?: number;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (t: unknown) => void;
}

export class CloudSync {
  private timer: unknown = null;
  private sending: Promise<void> | null = null;
  private failures = 0;
  /** Writes made by restoring a cloud save aren't changes to send back. */
  private applying = false;
  private readonly delay: number;
  private readonly retry: number;
  private readonly setTimer: (fn: () => void, ms: number) => unknown;
  private readonly clearTimer: (t: unknown) => void;
  /** What happened last (for the dev overlay and tests). */
  status: 'off' | 'restored' | 'sent' | 'up-to-date' | 'error' = 'off';

  private readonly backend: CloudBackend;
  private readonly store: SyncStore;

  constructor(backend: CloudBackend, store: SyncStore, opts: SyncOptions = {}) {
    this.backend = backend;
    this.store = store;
    this.delay = opts.delay ?? 5000;
    this.retry = opts.retry ?? 10000;
    this.setTimer = opts.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
    this.clearTimer = opts.clearTimer ?? ((t) => clearTimeout(t as ReturnType<typeof setTimeout>));
  }

  /**
   * At boot: takes the cloud save if it's newer than what this device last
   * synced (resolving true when it did), else sends this device's save if it
   * has changed. Gives up after `timeoutMs`: the game must never wait long.
   */
  async restore(timeoutMs = 4000): Promise<boolean> {
    let cloud: CloudSave | null;
    let giveUp: ReturnType<typeof setTimeout> | undefined;
    try {
      cloud = await Promise.race([this.backend.load(), new Promise<never>((_, no) => (giveUp = setTimeout(() => no(new Error('cloud: timed out')), timeoutMs)))]);
    } catch {
      this.status = 'error';
      return false;
    } finally {
      clearTimeout(giveUp);
    }
    const at = this.store.getItem(SYNCED_AT);
    if (cloud && (!at || Date.parse(cloud.updatedAt) > Date.parse(at))) {
      this.apply(cloud);
      this.status = 'restored';
      return true;
    }
    // Nothing newer up there: send ours if there's anything not sent yet (or nothing up there at all).
    if (!cloud ? this.store.keys().length > 0 : this.store.getItem(DIRTY) === '1') this.changed();
    else this.status = 'up-to-date';
    return false;
  }

  /** The game changed something: send it after a moment. */
  changed(): void {
    if (this.applying) return;
    if (this.store.getItem(DIRTY) !== '1') this.store.setItem(DIRTY, '1');
    this.schedule(this.delay);
  }

  /** Sends it now (the page is being hidden or closed). */
  flush(): Promise<void> {
    if (this.store.getItem(DIRTY) !== '1') return Promise.resolve();
    if (this.timer !== null) this.clearTimer(this.timer);
    this.timer = null;
    return this.send();
  }

  private schedule(ms: number): void {
    if (this.timer !== null) this.clearTimer(this.timer);
    this.timer = this.setTimer(() => {
      this.timer = null;
      void this.send();
    }, ms);
  }

  private send(): Promise<void> {
    if (this.sending) return this.sending.then(() => (this.store.getItem(DIRTY) === '1' ? this.send() : undefined));
    const data: Record<string, string> = {};
    for (const k of this.store.keys()) {
      const v = this.store.getItem(k);
      if (v !== null) data[k] = v;
    }
    // (The change flag is cleared before sending, so a change made while it's on its way is sent again.)
    this.store.setItem(DIRTY, '');
    if (JSON.stringify(data).length > CLOUD_MAX) {
      this.status = 'error';
      return Promise.resolve();
    }
    this.sending = this.backend
      .save(data)
      .then((at) => {
        this.store.setItem(SYNCED_AT, at);
        this.failures = 0;
        this.status = 'sent';
      })
      .catch(() => {
        this.store.setItem(DIRTY, '1');
        this.failures++;
        this.status = 'error';
        this.schedule(Math.min(60000, this.retry * 2 ** (this.failures - 1)));
      })
      .finally(() => {
        this.sending = null;
      });
    return this.sending;
  }

  /** Makes this device's save the cloud one: every key it has, and none it hasn't. */
  private apply(cloud: CloudSave): void {
    this.applying = true;
    try {
      for (const k of this.store.keys()) if (!(k in cloud.data)) this.store.removeItem(k);
      for (const [k, v] of Object.entries(cloud.data)) if (typeof v === 'string') this.store.setItem(k, v);
      this.store.setItem(SYNCED_AT, cloud.updatedAt);
      this.store.setItem(DIRTY, '');
    } finally {
      this.applying = false;
    }
  }
}
