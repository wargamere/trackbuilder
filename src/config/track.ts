/** Track geometry, editor and "limited ink" tuning. All distances are metres. */

export const WORLD = {
  /** Drawable area. The editor fits this rectangle to the screen. */
  width: 640,
  height: 360,
  /** Editor grid spacing (minor / major lines). */
  gridMinor: 20,
  gridMajor: 100,
} as const;

export const TRACK = {
  roadWidth: 12,
  /** Spacing of the final evenly sampled centreline. */
  centerSpacing: 2.5,
  /** A freehand stroke is resampled to this spacing before smoothing. */
  controlSpacing: 6,
  /** Dots are rounded to this grid so a track rebuilds identically everywhere. */
  quantize: 0.5,
  /** Corners tighter than this radius are rejected (the car can't get round). */
  minRadius: 4.5,
  /** Centres of two unrelated parts of the track must be at least this far apart. */
  minSeparation: 13,
  /** The track may cross itself (a flat crossroads) if the roads meet at least this steeply. */
  minCrossingAngle: (35 * Math.PI) / 180,
  /** ...and the start line must be at least this far (along the track) from any crossing. */
  crossingStartClearance: 30,
  /** Release this close to the start and the loop closes itself. */
  closeRadius: 42,
  /** Smallest track you may race. */
  minLength: 300,
  /** Kerbs go on the outside of corners tighter than this radius ... */
  kerbRadius: 45,
  /** ... that turn at least this much (radians). */
  kerbMinTurn: (25 * Math.PI) / 180,
  kerbWidth: 1.6,
  /** Banked corners reach their full angle at this radius or tighter. */
  bankRadius: 30,
  /** Dot heights are limited to this range (m) and rounded to `heightStep`. */
  maxHeight: 40,
  heightStep: 0.5,
  /** Steepest allowed slope (rise / run). */
  maxGrade: 0.3,
  /** Roads crossing at different heights need this much clearance to be a bridge; closer heights must be level. */
  bridgeClearance: 6,
  levelCrossingTolerance: 1,
  /** Barrier distance from the centre line, and height. */
  wallOffset: 6 + 1.6 + 1.2,
  wallHeight: 0.95,
  /** The road counts as a raised deck (bridge) when it's this far above the ground below. */
  deckClearance: 1.2,
} as const;

/** Per-track options, stored with the track. */
export type ThemeId = 'meadow' | 'desert' | 'snow';
export interface TrackOptions {
  /** 0 = flat corners, 1 = banked, 2 = steeply banked. */
  banking: 0 | 1 | 2;
  /** Concrete barriers along both edges (raised decks always get guard rails). */
  walls: boolean;
  theme: ThemeId;
}
export const DEFAULT_OPTIONS: TrackOptions = { banking: 1, walls: true, theme: 'meadow' };

/**
 * Freehand smoothing levels: how much hand jitter is filtered out (Taubin
 * iterations) and how tight a drawn corner may stay (corners tighter than
 * `radius` are opened up automatically).
 */
export const SMOOTHING = {
  sharp: { jitter: 1, radius: 6 },
  normal: { jitter: 2, radius: 10 },
  smooth: { jitter: 4, radius: 22 },
} as const;
export type SmoothingLevel = keyof typeof SMOOTHING;

/** Turning a smoothed stroke into editable dots. */
export const DOTS = {
  /** Max distance the dot outline may stray from the smoothed stroke. */
  tolerance: 1.6,
  /** Long straights still get a dot at least this often, so they stay easy to edit. */
  maxSpacing: 70,
  /** Dots-mode grid snap step. */
  snap: 10,
  /** How close (in screen pixels) a pointer must be to grab a dot. */
  grabPx: 14,
} as const;

/**
 * THE TWIST — limited ink.
 * Every track is drawn from one pot of ink. Ink you don't spend becomes a score
 * multiplier, and every tight corner adds a bonus on top. Short, twisty tracks are
 * harder to drive fast but pay out more.
 */
export const INK = {
  /** Total ink, in metres of road. */
  max: 2400,
  /** Raw stroke points closer than this are merged (keeps hand jitter from eating ink). */
  minStep: 2,
  /** Multiplier gained per fraction of unused ink: 1 + leftWeight * (inkLeft / max). */
  leftWeight: 1.5,
  /** A "tight corner" is a run of road tighter than this radius ... */
  cornerRadius: 35,
  /** ... that turns at least this much in total (radians). */
  cornerMinTurn: (50 * Math.PI) / 180,
  /** Bonus per tight corner, and the cap on the total corner bonus. */
  cornerBonus: 0.15,
  cornerBonusMax: 1.2,
} as const;
