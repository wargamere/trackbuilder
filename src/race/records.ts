import type { GhostLap } from './ghost.ts';
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

/**
 * Personal bests per track id, kept for the session. (Phase 5 persists them
 * through the platform storage.)
 */
export class RecordBook {
  private readonly map = new Map<string, TrackRecord>();

  get(id: string): TrackRecord {
    let r = this.map.get(id);
    if (!r) {
      r = { best: null, ghost: null, bestScore: 0 };
      this.map.set(id, r);
    }
    return r;
  }
}
