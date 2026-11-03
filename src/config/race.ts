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
  maxOpponents: 7,
  /**
   * How hard an AI drives at difficulty 0, 25, 50, 75 and 100 %: the share of
   * the tyres' grip it uses in corners, and its top speed as a share of the
   * car's. Measured on the sample tracks against the medal (bot) lap: about
   * 1.6×, 1.25× (bronze), 1.08×, 1.0× (gold) and 0.96× its time.
   */
  pace: [
    [0.25, 0.36],
    [0.42, 0.52],
    [0.6, 0.7],
    [0.8, 1],
    [0.95, 1],
  ],
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
  /** Side step to pass, and how fast an AI changes line (m/s). */
  passOffset: 3,
  laneRate: 3,
  /** Stuck (slower than 1.5 m/s) this long: back onto the road. */
  stuckSeconds: 2.5,
  /** Speed after the finish (a cool-down lap). */
  coolDownSpeed: 16,
} as const;

/** Car-to-car contact. */
export const CONTACT = {
  /** Each car is two circles of this radius, this far ahead of and behind its centre. */
  radius: 0.95,
  offset: 1.1,
  /** Bounce (share of the closing speed). */
  restitution: 0.25,
} as const;
