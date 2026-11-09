import { crazyGamesData } from './crazygames.ts';
import { PLATFORM } from './platform.ts';

/**
 * A small synchronous key-value store with the same get/set shape on every
 * platform:
 *  - web: localStorage,
 *  - crazygames: the CrazyGames SDK `data` module (after SDK init), falling back
 *    to localStorage when the SDK isn't available (blocked, environment disabled).
 * Nothing may be read before platform init has finished (see main.ts).
 * If storage itself is unavailable (private mode, blocked third-party storage),
 * values live in memory for the session instead, so the game never breaks.
 */
export interface KeyValueStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

// (The game's old name: kept so everyone's saves carry over.)
const PREFIX = 'inkcircuit.';
/** Keys the cloud save carries: every key the game has written (the sync.* bookkeeping excepted). */
const SYNC_KEYS = 'sync.keys';
const isSyncKey = (key: string) => key.startsWith('sync.');

/** Called after the game writes or removes a key (the cloud save marks itself out of date). */
let writeListener: ((key: string) => void) | null = null;
export function onStorageWrite(fn: ((key: string) => void) | null): void {
  writeListener = fn;
}

class MemoryStore implements KeyValueStore {
  private readonly map = new Map<string, string>();
  getItem(key: string): string | null {
    return this.map.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    this.map.set(key, value);
  }
  removeItem(key: string): void {
    this.map.delete(key);
  }
}

/** localStorage if it works (it can throw in sandboxed iframes and private mode). */
function browserStore(): KeyValueStore | null {
  try {
    const ls = globalThis.localStorage;
    if (!ls) return null;
    const probe = `${PREFIX}probe`;
    ls.setItem(probe, '1');
    ls.removeItem(probe);
    return ls;
  } catch {
    return null;
  }
}

/** Wraps a store so failures (quota, revoked access) fall back to memory instead of throwing. */
class SafeStore implements KeyValueStore {
  private readonly memory = new MemoryStore();
  private readonly primary: () => KeyValueStore | null;
  private keySet: Set<string> | null = null;

  constructor(primary: () => KeyValueStore | null) {
    this.primary = primary;
  }

  /** Every key the game has written (for the cloud save). */
  keys(): string[] {
    return [...this.tracked()];
  }

  /** Adds keys written before keys were tracked (only those that exist). */
  seedKeys(keys: readonly string[]): void {
    for (const k of keys) if (!isSyncKey(k) && this.getItem(k) !== null) this.track(k, true);
  }

  private tracked(): Set<string> {
    if (!this.keySet) {
      let list: unknown = [];
      try {
        list = JSON.parse(this.getItem(SYNC_KEYS) ?? '[]');
      } catch {
        /* a damaged list starts again */
      }
      this.keySet = new Set(Array.isArray(list) ? list.filter((k): k is string => typeof k === 'string') : []);
    }
    return this.keySet;
  }

  private track(key: string, present: boolean): void {
    const set = this.tracked();
    if (set.has(key) === present) return;
    if (present) set.add(key);
    else set.delete(key);
    this.write(SYNC_KEYS, JSON.stringify([...set]));
  }

  getItem(key: string): string | null {
    const k = PREFIX + key;
    const mem = this.memory.getItem(k);
    if (mem !== null) return mem;
    try {
      return this.primary()?.getItem(k) ?? null;
    } catch {
      return null;
    }
  }

  setItem(key: string, value: string): void {
    this.write(key, value);
    if (isSyncKey(key)) return;
    this.track(key, true);
    writeListener?.(key);
  }

  private write(key: string, value: string): void {
    const k = PREFIX + key;
    try {
      const p = this.primary();
      if (p) {
        p.setItem(k, value);
        this.memory.removeItem(k);
        return;
      }
    } catch {
      /* quota exceeded or storage blocked: keep it for this session */
    }
    this.memory.setItem(k, value);
  }

  removeItem(key: string): void {
    const k = PREFIX + key;
    this.memory.removeItem(k);
    try {
      this.primary()?.removeItem(k);
    } catch {
      /* ignore */
    }
    if (isSyncKey(key)) return;
    this.track(key, false);
    writeListener?.(key);
  }
}

const local = browserStore();

/**
 * CrazyGames: the docs ask games to rely fully on the SDK data module (it keeps
 * guest progress locally and syncs logged-in players across devices), so once
 * the SDK is initialised it is the only store. Before init, when the SDK is
 * unavailable (blocked, disabled domain), or if it reports the data module as
 * disabled for this game, localStorage is used instead.
 */
class CrazyGamesStore implements KeyValueStore {
  private moduleDisabled = false;

  private target(): KeyValueStore | null {
    if (this.moduleDisabled) return local;
    return crazyGamesData() ?? local;
  }

  getItem(key: string): string | null {
    return this.target()?.getItem(key) ?? null;
  }

  setItem(key: string, value: string): void {
    const t = this.target();
    try {
      t?.setItem(key, value);
    } catch (e) {
      const code = (e as { code?: string } | null)?.code;
      if (code === 'dataModuleDisabled' && t !== local) {
        this.moduleDisabled = true;
        local?.setItem(key, value);
        return;
      }
      throw e; // e.g. dataLimitExcedeed: SafeStore keeps it in memory for the session
    }
  }

  removeItem(key: string): void {
    this.target()?.removeItem(key);
  }
}

const crazyStore = new CrazyGamesStore();

/** The game's store for this platform. */
export const storage: KeyValueStore & { keys(): string[]; seedKeys(keys: readonly string[]): void } = new SafeStore(PLATFORM === 'crazygames' ? () => crazyStore : () => local);

/** JSON helpers; a corrupt value reads as `fallback`. */
export function loadJSON<T>(key: string, fallback: T): T {
  const raw = storage.getItem(key);
  if (raw === null) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export function saveJSON(key: string, value: unknown): void {
  storage.setItem(key, JSON.stringify(value));
}
