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
  /** Finishing order and your place in it, in a race with AI cars (else null). */
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
