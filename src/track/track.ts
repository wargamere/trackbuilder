import { DEFAULT_OPTIONS, INK, TRACK, type TrackOptions } from '../config/track.ts';
import type { Dot } from '../core/math.ts';
import { hashString } from '../core/random.ts';
import { findCorners, type Corner } from './corners.ts';
import { inkStats, type InkStats } from './ink.ts';
import { buildCenterline, type Centerline } from './spline.ts';

/**
 * The canonical, storable description of a track: a closed loop of dots
 * (position + height) and a few options. Everything else is rebuilt from it
 * deterministically, so this is what the library saves and a share code encodes.
 */
export interface TrackDef {
  id: string;
  name: string;
  control: Dot[];
  /** Missing fields use DEFAULT_OPTIONS. */
  options?: Partial<TrackOptions>;
  /** True for the built-in tracks (the game's own and the real-world circuits). */
  builtIn?: boolean;
  /** Where a real-world circuit is (its country). */
  place?: string;
}

/** A track ready to race: definition plus all derived geometry. */
export interface Track {
  def: TrackDef;
  options: TrackOptions;
  center: Centerline;
  /** Corners tight enough to count for the ink bonus. */
  tightCorners: Corner[];
  /** Corners that get red/white kerbs on their outside edge. */
  kerbs: Corner[];
  ink: InkStats;
}

export const trackOptions = (def: Pick<TrackDef, 'options'>): TrackOptions => ({ ...DEFAULT_OPTIONS, ...def.options });

export function buildTrack(def: TrackDef): Track {
  const options = trackOptions(def);
  const center = buildCenterline(def.control, options.banking, undefined, options.width);
  const tightCorners = findCorners(center, INK.cornerRadius, INK.cornerMinTurn);
  const kerbs = findCorners(center, TRACK.kerbRadius, TRACK.kerbMinTurn);
  return { def, options, center, tightCorners, kerbs, ink: inkStats(center.length, tightCorners) };
}

/** Short random id for user-drawn tracks. */
export function newTrackId(): string {
  return Math.random().toString(36).slice(2, 10);
}

/**
 * Id derived from the track itself, so the same layout always gets the same id
 * (best laps and ghosts follow the track, and editing it gives a new id).
 * Heights and options are only part of the hash when they differ from the
 * defaults, so flat default tracks keep the ids they had before elevation existed.
 */
export function contentId(control: readonly Dot[], options?: Partial<TrackOptions>): string {
  // Heights and bank overrides only appear when set, so older tracks keep their ids.
  const dots = control.map((p) => (p.h ? `${p.x},${p.y},${p.h}` : `${p.x},${p.y}`) + (p.b !== undefined ? `/${p.b}` : '')).join(';');
  const o = { ...DEFAULT_OPTIONS, ...options };
  const extra = (Object.keys(DEFAULT_OPTIONS) as (keyof TrackOptions)[])
    .filter((k) => o[k] !== DEFAULT_OPTIONS[k])
    .map((k) => `${k}=${o[k]}`)
    .join('&');
  return 't' + hashString(extra ? `${dots}|${extra}` : dots).toString(36);
}
