/** Track geometry and editor tuning. All distances are metres. */

export const WORLD = {
  /** Drawable area. The editor fits this rectangle to the screen. */
  width: 640,
  height: 360,
  /** Editor grid spacing (minor / major lines). */
  gridMinor: 20,
  gridMajor: 100,
} as const;

export const TRACK = {
  /** Default road width; each track sets its own (TrackOptions.width) in this range. */
  roadWidth: 12,
  minWidth: 8,
  maxWidth: 20,
  /** Spacing of the final evenly sampled centreline. */
  centerSpacing: 2.5,
  /** Minimum spacing between freehand samples (metres). */
  strokeMinStep: 2,
  /** Corners counted in track statistics. */
  cornerRadius: 35,
  cornerMinTurn: (50 * Math.PI) / 180,
  /** A freehand stroke is resampled to this spacing before smoothing. */
  controlSpacing: 6,
  /** Dots are rounded to this grid so a track rebuilds identically everywhere. */
  quantize: 0.5,
  /** Corners tighter than this radius are rejected (the car can't get round). */
  minRadius: 4.5,
  /** Centres of two unrelated parts of the track must be at least the road width plus this apart. */
  separationMargin: 1,
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
  /** Steepest slope (rise / run); anything steeper is eased out when the track is built. */
  maxGrade: 0.45,
  /** Roads crossing at different heights need this much clearance to be a bridge; closer heights must be level. */
  bridgeClearance: 6,
  levelCrossingTolerance: 1,
  /** Barriers stand this far beyond the kerb's outer edge (so road half-width + kerb + this). */
  wallGap: 1.2,
  /** The barriers can be moved this much further out (TrackOptions.barrierGap). */
  maxBarrierGap: 30,
  wallHeight: 0.95,
  /** How wide each kerb style is (m). */
  kerbWidths: { raised: 1.6, flat: 1.6, painted: 0.9, none: 0 },
  /** The road counts as a raised deck (bridge) when it's this far above the ground below. */
  deckClearance: 1.2,
} as const;

/** Per-track options, stored with the track. */
export type ThemeId = 'meadow' | 'desert' | 'snow' | 'alpine' | 'city' | 'forest';
/** Road width (m): any value from TRACK.minWidth to TRACK.maxWidth in 0.5 m steps. */
export type RoadWidth = number;
export type KerbStyle = 'raised' | 'flat' | 'painted' | 'none';
export type RunoffId = 'grass' | 'gravel' | 'tarmac';
export type BarrierStyle = 'concrete' | 'tyres' | 'tecpro' | 'armco';
/** What the road itself is made of: it sets the grip and the brakes (HANDLING.roads). */
export type RoadSurface = 'tarmac' | 'dirt' | 'snow';
/** Where the track crosses itself at two heights: the upper road on a bridge, or the lower one in a tunnel. */
export type CrossingStyle = 'bridge' | 'tunnel';
export type TimeOfDay = 'day' | 'sunset' | 'night';
export type LapCount = 1 | 3 | 5;
export type TreeDensity = 'normal' | 'sparse' | 'dense';
export interface TrackOptions {
  /** 0 = flat corners, 1 = banked, 2 = steeply banked. */
  banking: 0 | 1 | 2;
  /** Barriers along both edges (raised decks always get guard rails). */
  walls: boolean;
  theme: ThemeId;
  /** Road width (m). */
  width: RoadWidth;
  /** Kerbs on the outside of corners: raised (a bump), flat, painted on the road, or none. */
  kerbs: KerbStyle;
  /** What's beside the road: grass, gravel traps (very slow) or tarmac run-off (no penalty). */
  runoff: RunoffId;
  /** What the barriers look like. */
  barrier: BarrierStyle;
  /** How much further out than usual the barriers stand (m, whole metres, 0..TRACK.maxBarrierGap). */
  barrierGap: number;
  /** The road's surface. */
  road: RoadSurface;
  /** How a road over a road looks. */
  crossing: CrossingStyle;
  /** Pit building and garages beside the start straight. */
  pits: boolean;
  time: TimeOfDay;
  /** Laps per race. */
  laps: LapCount;
  /** How much scenery (trees, cacti, rocks) there is. */
  trees: TreeDensity;
}
export const DEFAULT_OPTIONS: TrackOptions = {
  banking: 1,
  walls: true,
  theme: 'meadow',
  width: 12,
  kerbs: 'raised',
  runoff: 'grass',
  barrier: 'concrete',
  barrierGap: 0,
  road: 'tarmac',
  crossing: 'bridge',
  pits: true,
  time: 'day',
  laps: 3,
  trees: 'normal',
};

/** Choices for each option, in the order the track code stores them (the first is the default). */
export const OPTION_CHOICES = {
  width: [12, 10, 15],
  kerbs: ['raised', 'flat', 'none', 'painted'],
  runoff: ['grass', 'gravel', 'tarmac'],
  barrier: ['concrete', 'tyres', 'tecpro', 'armco'],
  pits: [true, false],
  time: ['day', 'sunset', 'night'],
  laps: [3, 1, 5],
  trees: ['normal', 'sparse', 'dense'],
  road: ['tarmac', 'dirt', 'snow'],
  crossing: ['bridge', 'tunnel'],
} as const;

/** The scenery themes, in the order the track code stores them. */
export const THEME_IDS: readonly ThemeId[] = ['meadow', 'desert', 'snow', 'alpine', 'city', 'forest'];

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
