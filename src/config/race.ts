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
  /** Share of a hit's turning effect that the cars feel (1 = a free rigid body; less keeps rubbing from spinning cars). */
  spin: 1,
} as const;

/** The AI's racing line (race/racingLine.ts). */
export const RACING_LINE = {
  /** Keep the car's side this far inside the road's (or kerb's) outer edge. */
  edgeMargin: 0.25,
  /** The road's usable edge may step out or in by at most this much per sample (where kerbs start and end). */
  corridorStep: 0.25,
  /** Paths beside the line keep inside a smoothed road edge: the narrowest within this many samples either side, averaged as far. */
  envelope: 8,
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
  /** More than this far off the line (m), it judges its speed by the path it's on (see pathLimit), × this. */
  offLine: 0.3,
  offLineSpeed: 0.97,
  /** Lanes beside the line (offsets, m) that get a speed plan of their own. */
  planLanes: [-6, -4.5, -3, -1.5, 1.5, 3, 4.5, 6],
  /** More than this far (m) from where it means to be, the speed comes from the path from where it is… */
  farOff: 1.5,
  /** …onto the one it wants, over this far (m)… */
  converge: 40,
  /** …using this share of its grip in the bends on it. */
  offLineGrip: 0.95,
  /** …looking this far along it (m), at points this far apart. */
  pathLook: 100,
  pathStep: 6,
} as const;

/** Racing in traffic (race/traffic.ts). */
export const TRAFFIC = {
  /** How often an AI re-picks its lane (s). */
  planEvery: 1 / 30,
  /** Cars this far ahead / behind along the track (m) are considered. */
  ahead: 70,
  behind: 12,
  /** Lanes it can pick: offsets from the racing line (m). */
  lanes: [-6, -4.5, -3, -1.5, 0, 1.5, 3, 4.5, 6],
  /** How fast it moves across the road to a new lane (m/s), how hard it may speed up or slow that move (m/s²), and how briskly it heads for the new lane (1/s²). */
  laneRate: 2.5,
  laneAccel: 3,
  laneStiff: 1.5,
  /** Cars beside and behind: it plays itself forward at the larger of its speed and this share of the speed its plan wants. */
  intent: 0.97,
  /**
   * It plays the car in front forward this far (s), in steps of this much, to
   * see whether it would run into it (and hold back for it); this far (s) to
   * see whether a pass would come off; picking up speed at up to this (m/s²).
   */
  horizon: 2.5,
  step: 0.25,
  passHorizon: 5,
  pickUp: 5,
  /** Room it keeps around another car's body: along the track and across it (m). */
  marginAlong: 1,
  marginSide: 1.2,
  /** Touching a car beside or behind within this long (s) rules a lane out. */
  sideTime: 0.75,
  /** Costs, in seconds lost: per metre off the line, per metre of lane change, for getting close to a car (held up behind it, or alongside). */
  offLineCost: 0.01,
  changeCost: 0.01,
  closeCost: 0.15,
  /** How far ahead (m) it checks there's room on a side for a lane to be worth considering. */
  roomLook: 20,
  /**
   * Letting a quicker AI by: one whose difficulty is this much higher, within
   * this far behind (m) for this long (s): keep this far to one side of the
   * racing line (m) at this share of pace and of the throttle, until it's by
   * (or for at most letByHold s).
   */
  letByPace: 0.05,
  letByGap: 15,
  letByAfter: 1.5,
  letByOffset: 3.5,
  letByHold: 8,
  letByEase: 0.85,
  letByThrottle: 0.5,
  /** …once going faster than this (m/s); and the quicker car is put off passing on the side it's moved to by this (s). */
  letByMinSpeed: 12,
  letByWrongSide: 0.5,
  /** A lane's cost counts the time it loses against the line over this far ahead (m) (about what a pass takes; also how its pace is judged)… */
  laneLook: 80,
  /** …and being stuck behind a slower car it can't get past, what it loses over this long (s). */
  stuckFor: 8,
  /** Only switch lane for a gain of at least this much (s); for a while after a real change of lane (a pass), only for this much. */
  switchGain: 0.08,
  commitTime: 1.5,
  commitGain: 0.5,
  /** Side by side with no room for both: the car more than this far behind (m) backs out, coasting for this long (s). */
  yieldLead: 0.5,
  yieldTime: 1,
  /** Sliding sideways faster than this (m/s): off the throttle, for this long (s) after. */
  recoverSlip: 3,
  recoverTime: 0.4,
  /** Another (non-AI) car's drift across the road eases off over this long (s) in the prediction. */
  driftEase: 0.8,
  /** No new lane changes in a bend tighter than this (1/m), or this close to one (m). */
  tightBend: 1 / 25,
  tightLook: 15,
  /** Following: keep this gap behind the car in our way: base (m) + seconds × speed, and close it at this rate (1/s). */
  gapBase: 1.5,
  gapTime: 0.35,
  gapGain: 0.8,
  /** Brake hard if not hitting the car in our way needs more than this (m/s²). */
  emergencyDecel: 6,
  /** Rejoin the road only when no car is coming within this far behind (m). */
  rejoinClear: 60,
} as const;

/** Slipstream (car/slipstream.ts): its reach behind a car (m) and to either side of it (m). How much it cuts the drag is HANDLING.slipstreamDragCut. */
export const SLIPSTREAM = {
  range: 28,
  width: 2.2,
  /** The HUD shows "Slipstream" above this much of it. */
  show: 0.25,
} as const;

