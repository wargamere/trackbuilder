import { INK, TRACK } from '../config/track.ts';
import type { Vec2 } from '../core/math.ts';
import { findCorners, type Corner } from './corners.ts';
import { inkStats, type InkStats } from './ink.ts';
import { buildCenterline, type Centerline } from './spline.ts';

/**
 * The canonical, storable description of a track: a closed loop of smoothed,
 * quantised control points. Everything else is rebuilt from it deterministically,
 * so this is what the library saves and what a share code encodes.
 */
export interface TrackDef {
  id: string;
  name: string;
  control: Vec2[];
  /** True for the built-in sample tracks. */
  builtIn?: boolean;
}

/** A track ready to race: definition plus all derived geometry. */
export interface Track {
  def: TrackDef;
  center: Centerline;
  /** Corners tight enough to count for the ink bonus. */
  tightCorners: Corner[];
  /** Corners that get red/white kerbs on their outside edge. */
  kerbs: Corner[];
  ink: InkStats;
}

export function buildTrack(def: TrackDef): Track {
  const center = buildCenterline(def.control);
  const tightCorners = findCorners(center, INK.cornerRadius, INK.cornerMinTurn);
  const kerbs = findCorners(center, TRACK.kerbRadius, TRACK.kerbMinTurn);
  return { def, center, tightCorners, kerbs, ink: inkStats(center.length, tightCorners) };
}

/** Short random id for user-drawn tracks. */
export function newTrackId(): string {
  return Math.random().toString(36).slice(2, 10);
}
