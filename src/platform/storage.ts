import { crazyGamesData } from './crazygames.ts';
import { PLATFORM } from './platform.ts';

/**
 * A small synchronous key-value store with the same get/set shape on every
 * platform:
 *  - web: localStorage,
 *  - crazygames: the CrazyGames SDK `data` module, falling back to localStorage
 *    when the SDK isn't available (blocked, local testing, environment disabled).
 * If storage itself is unavailable (private mode, blocked third-party storage),
 * values live in memory for the session instead, so the game never breaks.
 */
export interface KeyValueStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

const PREFIX = 'inkcircuit.';

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

  constructor(primary: () => KeyValueStore | null) {
    this.primary = primary;
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
  }
}

const local = browserStore();

/**
 * CrazyGames: mirror every write to both the SDK data module and localStorage,
 * and read from the SDK only when it answers synchronously with a string.
 * That works whether the SDK is present, blocked or behaves asynchronously.
 */
class MirroredStore implements KeyValueStore {
  getItem(key: string): string | null {
    const sdk = crazyGamesData();
    if (sdk) {
      try {
        const v: unknown = sdk.getItem(key);
        if (typeof v === 'string') return v;
      } catch {
        /* fall through to localStorage */
      }
    }
    return local?.getItem(key) ?? null;
  }
  setItem(key: string, value: string): void {
    try {
      crazyGamesData()?.setItem(key, value);
    } catch {
      /* SDK refused: localStorage still has it */
    }
    local?.setItem(key, value);
  }
  removeItem(key: string): void {
    try {
      crazyGamesData()?.removeItem(key);
    } catch {
      /* ignore */
    }
    local?.removeItem(key);
  }
}

const mirrored = new MirroredStore();

/** The game's store for this platform. */
export const storage: KeyValueStore = new SafeStore(PLATFORM === 'crazygames' ? () => mirrored : () => local);

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
