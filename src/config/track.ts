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
  /** Spacing of the smoothed control points the spline runs through. */
  controlSpacing: 10,
  /** Control points are rounded to this grid so a track rebuilds identically everywhere. */
  quantize: 0.5,
  /** Tighter corners than this are relaxed automatically (inner road edge would fold). */
  minRadius: 10,
  /** Centres of two unrelated parts of the track must be at least this far apart. */
  minSeparation: 14,
  /** Release this close to the start and the loop closes itself. */
  closeRadius: 42,
  /** Smallest track you may race. */
  minLength: 400,
  /** Kerbs go on the outside of corners tighter than this radius ... */
  kerbRadius: 45,
  /** ... that turn at least this much (radians). */
  kerbMinTurn: (25 * Math.PI) / 180,
  kerbWidth: 1.6,
} as const;

/**
 * THE TWIST — limited ink.
 * Every track is drawn from one pot of ink. Ink you don't spend becomes a score
 * multiplier, and every tight corner adds a bonus on top. Short, twisty tracks are
 * harder to drive fast but pay out more.
 */
export const INK = {
  /** Total ink, in metres of road. */
  max: 1600,
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
