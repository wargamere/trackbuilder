import type { PaintId } from '../config/paint.ts';
import { loadJSON, saveJSON, storage } from '../platform/storage.ts';
import { decodeGhost, encodeGhost, type GhostLap } from './ghost.ts';
import { AUTHOR_VERSION } from './medals.ts';
import type { BestLap } from './session.ts';

/** Personal bests for one track. */
export interface TrackRecord {
  best: BestLap | null;
  ghost: GhostLap | null;
  bestScore: number;
  /** The bot's flying lap (medal targets), once measured; null if it couldn't finish. */
  author: number | null | undefined;
}

/** One car in a race's finishing order. */
export interface Standing {
  name: string;
  you: boolean;
  paint: number;
  /** Race time from GO (s); an estimate if it was still racing when you finished. */
  time: number;
  estimated: boolean;
  /** Retired (broken down): no time. */
  dnf?: boolean;
  /** Laps it finished behind the winner (flagged a lap or more down), and laps completed. */
  lapsDown?: number;
  laps?: number;
  /** Its best clean lap of the race (null: none). */
  best?: number | null;
  /** Who it is in a championship (a driver id). */
  id?: string;
}

/** What the results screen shows about a finished run. */
export interface RunResult {
  trackId: string;
  trackName: string;
  laps: number[];
  /** Per lap: false if it broke track limits (its time doesn't count). */
  lapValid: boolean[];
  total: number;
  /** Fastest clean lap of the run, or null if every lap broke track limits. */
  bestLap: number | null;
  /** Best lap of all time on this track (may be from an earlier run), if any. */
  recordLap: number | null;
  newRecord: boolean;
  avgSpeedKmh: number;
  score: number;
  bestScore: number;
  newBestScore: boolean;
  /** Where the car ended up, for the results camera. */
  carX: number;
  carZ: number;
  /** Paints this run unlocked. */
  unlockedPaints: PaintId[];
  /** The bot's lap on this track (medal targets), if known. */
  author: number | null;
  /** Your car broke down: you didn't finish. */
  dnf: boolean;
  /** Finishing order and your place in it, in a race with AI cars (else null; no place if you didn't finish). */
  standings: Standing[] | null;
  position: number | null;
}

/** Score: average speed on your best clean lap (km/h) × 10. */
export function scoreFor(trackLength: number, bestLap: number): { avg: number; score: number } {
  const avg = (trackLength / bestLap) * 3.6;
  return { avg, score: Math.round(avg * 10) };
}

interface StoredRecord {
  scoreV?: number;
  best: BestLap | null;
  bestScore: number;
  ghost: string | null;
  author?: number | null;
  authorV?: number;
}

const storedAuthor = (s: StoredRecord | null): number | null | undefined =>
  s && s.authorV === AUTHOR_VERSION && (typeof s.author === 'number' || s.author === null) ? s.author : undefined;

/** Records for this many tracks are kept; the least recently raced are dropped. */
const MAX_TRACKS = 40;
/**
 * Ghosts kept in all (characters of their codes): beyond this the least
 * recently raced tracks lose their ghost (their best times stay). Everything
 * the game saves has to fit the CrazyGames data module's 1 MB, and ghosts are
 * most of it (about 11 KB for a 45 s lap).
 */
export const GHOST_BUDGET = 450_000;
const INDEX_KEY = 'records.index';
const key = (id: string) => `records.${id}`;

/**
 * Personal bests and ghosts per track id, saved through the platform storage
 * (localStorage on the web, the SDK data module on CrazyGames).
 */
export class RecordBook {
  private readonly cache = new Map<string, TrackRecord>();

  get(id: string): TrackRecord {
    let r = this.cache.get(id);
    if (r) return r;
    const s = loadJSON<StoredRecord | null>(key(id), null);
    r = {
      best: s?.best && typeof s.best.time === 'number' ? s.best : null,
      bestScore: s?.scoreV === 2 && typeof s.bestScore === 'number' ? s.bestScore : 0,
      ghost: s?.ghost ? decodeGhost(s.ghost) : null,
      author: storedAuthor(s),
    };
    this.cache.set(id, r);
    return r;
  }

  /** Best lap, score and author time without decoding the ghost (for lists). */
  summary(id: string): { best: BestLap | null; bestScore: number; author: number | null | undefined } {
    const r = this.cache.get(id);
    if (r) return { best: r.best, bestScore: r.bestScore, author: r.author };
    const s = loadJSON<StoredRecord | null>(key(id), null);
    return {
      best: s?.best && typeof s.best.time === 'number' ? s.best : null,
      bestScore: s?.scoreV === 2 && typeof s.bestScore === 'number' ? s.bestScore : 0,
      author: storedAuthor(s),
    };
  }

  /** Writes a track's record after it changed. */
  save(id: string): void {
    const r = this.get(id);
    const stored: StoredRecord = { scoreV: 2, best: r.best, bestScore: r.bestScore, ghost: r.ghost ? encodeGhost(r.ghost) : null };
    if (r.author !== undefined) {
      stored.author = r.author;
      stored.authorV = AUTHOR_VERSION;
    }
    saveJSON(key(id), stored);
    const index = loadJSON<string[]>(INDEX_KEY, []).filter((x) => x !== id);
    index.push(id);
    while (index.length > MAX_TRACKS) {
      const old = index.shift();
      if (old !== undefined) {
        storage.removeItem(key(old));
        this.cache.delete(old);
      }
    }
    saveJSON(INDEX_KEY, index);
    this.trimGhosts(index, id);
  }

  /** Drops ghosts from the least recently raced tracks (never `keep`'s) until they fit GHOST_BUDGET. */
  private trimGhosts(index: string[], keep: string): void {
    const sizes = index.map((x) => loadJSON<StoredRecord | null>(key(x), null)?.ghost?.length ?? 0);
    let total = sizes.reduce((a, b) => a + b, 0);
    for (let k = 0; k < index.length && total > GHOST_BUDGET; k++) {
      const x = index[k];
      if (x === keep || !sizes[k]) continue;
      const s = loadJSON<StoredRecord | null>(key(x), null);
      if (!s) continue;
      saveJSON(key(x), { ...s, ghost: null });
      const cached = this.cache.get(x);
      if (cached) cached.ghost = null;
      total -= sizes[k];
    }
  }

  /** Forgets everything about a track (when it is deleted from the library). */
  forget(id: string): void {
    this.cache.delete(id);
    storage.removeItem(key(id));
    saveJSON(
      INDEX_KEY,
      loadJSON<string[]>(INDEX_KEY, []).filter((x) => x !== id),
    );
  }
}
