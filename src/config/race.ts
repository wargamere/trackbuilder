/** Time-trial rules. */
export const RACE = {
  /** Valid laps per run before the results screen. */
  laps: 3,
  /** 3-2-1 countdown length (seconds), then GO. */
  countdown: 3,
  /** Checkpoints at every 1/count of the lap; the last one is the finish line. */
  checkpoints: 10,
  /**
   * A checkpoint only counts if the car reached it driving along the track:
   * jumps along the track bigger than this in one physics tick (cutting across
   * the grass to another stretch, or a reset) never pass a checkpoint.
   */
  maxProgressPerTick: 3,
  /** ...and only if the car is at most this far beyond the road's edge. */
  checkpointMargin: 8,
  /** Track limits: the whole car past the edge this long (s) invalidates the lap. */
  trackLimitSeconds: 0.12,
  /** Driving backwards along the track this fast for this long shows "Wrong way". */
  wrongWaySpeed: 3,
  wrongWaySeconds: 1,
  /** Ghost opacity. */
  ghostOpacity: 0.35,
  /** Seconds between crossing the line on the final lap and the results screen. */
  resultsDelay: 1.6,
} as const;

/** AI opponents (race mode only). */
export const AI = {
  /** Up to this many AI cars (12 cars with you). */
  maxOpponents: 11,
  /** Timed laps in qualifying (the best clean one sets your grid slot). */
  qualifyingLaps: 2,
  /** AI qualifying times vary by up to this share either way, so equal cars don't always line up the same. */
  qualifyingNoise: 0.005,
  /**
   * How hard an AI drives the racing line at difficulty 0, 25, 50, 75 and
   * 100 %: the share of the tyres' grip it uses in corners, its top speed as a
   * share of the car's, and the share of the brakes it uses. 100 % is the
   * limit (more grip than that and it slides off). Measured laps, against the
   * 100 % lap: about 1.65×, 1.25×, 1.12×, 1.05× and 1×.
   */
  pace: [
    [0.33, 0.4, 0.45],
    [0.53, 0.63, 0.55],
    [0.68, 0.79, 0.6],
    [0.84, 0.9, 0.75],
    [1, 1, 0.9],
  ],
  /** Medal times are the lap of an AI at this difficulty (gold; silver +10 %, bronze +25 %). */
  medalDifficulty: 0.75,
  /** The field spreads out below the chosen difficulty by up to this much (0.08 = 8 points). */
  spread: 0.08,
  /** Grid: metres between slots along the track, and how far each slot is off the centre line. */
  gridGap: 6.5,
  gridLateral: 2.2,
  /** First slot's distance behind the line. */
  gridFront: 8,
  /** A car ahead closer than this (m along the track) and in the same line is traffic. */
  lookAhead: 24,
  /** Cars less than this far apart sideways are in the same line. */
  sameLine: 2.4,
  /**
   * Closing on the car in our way: the slowdown needed to match its speed before
   * we'd be closer than `followGap` to it. Lift above `liftDecel`, brake above
   * `brakeDecel` (m/s²).
   */
  followGap: 1.5,
  liftDecel: 1.5,
  brakeDecel: 4,
  /**
   * Passing: start only when catching the car ahead by this much (m/s), or after
   * it has kept us this far (m/s) below our own pace, within this gap (m), for
   * this long (s); and only where the line is gentler than this curvature (1/m)
   * for this far ahead (m). Keep to the passing side this long (s) after, and
   * while anyone is alongside.
   */
  passClosing: 2,
  heldUpBy: 2,
  heldUpGap: 14,
  heldUpSeconds: 2,
  passMaxCurvature: 1 / 120,
  passClearAhead: 60,
  passHold: 1.5,
  /** Side step to pass, and how fast an AI changes line (m/s). */
  passOffset: 3,
  laneRate: 2,
  /** Stuck (slower than 1.5 m/s) this long: back onto the road. */
  stuckSeconds: 2.5,
  /** Share of its pace after the finish (it carries on, not parked on the line). */
  afterFinishPace: 0.85,
} as const;

/** Car-to-car contact (car/contact.ts). */
export const CONTACT = {
  /** The car's body as a box: half its length and half its width (m). */
  halfLength: 2.1,
  halfWidth: 0.95,
  /** Bounce (share of the closing speed) and sliding friction between the bodies. */
  restitution: 0.2,
  friction: 0.35,
  /** Cars this far apart in height don't touch (one is on a bridge over the other). */
  heightGap: 2.5,
} as const;

/** The AI's racing line (race/racingLine.ts). */
export const RACING_LINE = {
  /** Keep the car's side this far inside the road's (or kerb's) outer edge. */
  edgeMargin: 0.25,
  /** The road's usable edge may step out or in by at most this much per sample (where kerbs start and end). */
  corridorStep: 0.25,
  /** First (coarsest) spacing of the points being placed, in samples; it halves down to 1. */
  firstStep: 64,
  /** Passes at each spacing (× √spacing). */
  iterations: 60,
} as const;

/** How the AI drives the racing line (race/driver.ts). */
export const DRIVER = {
  /** Steering aims at the line this far ahead: base + per m/s of speed (m). */
  lookBase: 3,
  lookPerSpeed: 0.2,
  /** …plus this share of the line's own curvature, read this many seconds ahead. */
  curvatureFeed: 0.6,
  curvaturePreview: 0.1,
  /** Target speed is read this many seconds ahead (so it brakes on time). */
  speedPreview: 0.25,
  /** Brake once this much too fast (m/s), harder the faster. */
  brakeDeadband: 0.25,
  brakeGain: 1.5,
  /** Speed factor while off the line (passing). */
  offLineSpeed: 0.85,
} as const;
