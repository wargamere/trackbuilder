import { loadJSON, saveJSON, storage } from '../platform/storage.ts';
import { decodeGhost, encodeGhost, type GhostLap } from './ghost.ts';
import type { BestLap } from './session.ts';

/** Personal bests for one track. */
export interface TrackRecord {
  best: BestLap | null;
  ghost: GhostLap | null;
  bestScore: number;
}

/** What the results screen shows about a finished run. */
export interface RunResult {
  trackId: string;
  trackName: string;
  laps: number[];
  total: number;
  bestLap: number;
  /** Best lap of all time on this track (may be from an earlier run). */
  recordLap: number;
  newRecord: boolean;
  avgSpeedKmh: number;
  multiplier: number;
  score: number;
  bestScore: number;
  newBestScore: boolean;
  /** Where the car ended up, for the results camera. */
  carX: number;
  carZ: number;
}

/**
 * Score: average speed on your best lap of the run (km/h) × the track's ink
 * multiplier × 10. Short, twisty tracks are slower but multiply more.
 */
export function scoreFor(trackLength: number, bestLap: number, multiplier: number): { avg: number; score: number } {
  const avg = (trackLength / bestLap) * 3.6;
  return { avg, score: Math.round(avg * multiplier * 10) };
}

interface StoredRecord {
  best: BestLap | null;
  bestScore: number;
  ghost: string | null;
}

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
      bestScore: typeof s?.bestScore === 'number' ? s.bestScore : 0,
      ghost: s?.ghost ? decodeGhost(s.ghost) : null,
    };
    this.cache.set(id, r);
    return r;
  }

  /** Best lap and score without decoding the ghost (for lists). */
  summary(id: string): { best: BestLap | null; bestScore: number } {
    const r = this.cache.get(id);
    if (r) return { best: r.best, bestScore: r.bestScore };
    const s = loadJSON<StoredRecord | null>(key(id), null);
    return {
      best: s?.best && typeof s.best.time === 'number' ? s.best : null,
      bestScore: typeof s?.bestScore === 'number' ? s.bestScore : 0,
    };
  }

  /** Writes a track's record after it changed. */
  save(id: string): void {
    const r = this.get(id);
    const stored: StoredRecord = { best: r.best, bestScore: r.bestScore, ghost: r.ghost ? encodeGhost(r.ghost) : null };
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
