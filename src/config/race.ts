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
  /** ...and only if the car is at most this far beyond the road's edge (well out on the run-off still counts). */
  checkpointMargin: 25,
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

/**
 * Race conditions (chosen in the race setup): rain, tyre wear and pit stops.
 * Each is on or off for the whole field.
 */
export const CONDITIONS = {
  /** Rain: the share of the tyres' grip and of the brakes left on a wet track (with tyre wear on, see TYRES.compounds). */
  rainGrip: 0.8,
  rainBrake: 0.78,
  /** The pit box: this long (m) and wide (m), at the road's edge, this far (m) in from it. */
  boxLength: 11,
  boxWidth: 2.8,
  boxInset: 0.35,
  /** Stopped in it (slower than stopSpeed m/s), new tyres take this long (s). */
  stopSpeed: 1.2,
  service: 3,
  /** With no pit building, the box is this far past the start line (m). */
  boxDefaultS: 30,
  /** Time a stop costs beyond the service itself (s): braking into the box and getting going again (for the timing tower's "pit now" estimate). */
  pitLossExtra: 3.5,
  /**
   * AI cars stop for tyres when theirs would go off before the box comes
   * round again, give or take pitEarly laps (one each, by grid slot, so not
   * all on the same lap). No stop with fewer than pitMinLaps laps to go, or
   * when the tyres would last to the finish (going off at most pitEndSlack
   * laps before it). They pull over to the box over pitApproach m and brake
   * to stop in it at pitDecel m/s², then rejoin the line over pitExit m.
   */
  pitEarly: [0.3, 0, -0.25],
  pitMinLaps: 1,
  pitEndSlack: 0.3,
  pitApproach: 180,
  pitDecel: 7,
  pitExit: 90,
} as const;

/**
 * Damage (Conditions → Damage): hits on the barriers or other cars harder
 * than `from` m/s damage the car, `perSpeed` per m/s over it, the front wing
 * taking `wingShare` of it and the bodywork the rest. A fully broken wing
 * costs `wingGrip` of the cornering grip, fully damaged bodywork `bodyDrag`
 * more drag (a lower top speed). The pit crew mends it all in a stop, which
 * takes `repairTime` s longer per unit of damage. AI cars pit for repairs
 * above `aiPitAt`. The HUD warns as it passes each of `warnAt`.
 * At `breakAt` (100 %) the car breaks down on the spot: no drive, it stops
 * where it is, and in a race it has retired (DNF). A retired AI car stands
 * where it stopped for `recoverAfter` s (yellow flags, and the safety car if
 * it's on), then the marshals take it away.
 */
export const DAMAGE = {
  from: 5,
  perSpeed: 0.035,
  wingShare: 0.6,
  wingGrip: 0.15,
  bodyDrag: 0.35,
  repairTime: 8,
  aiPitAt: 0.45,
  warnAt: [0.15, 0.5],
  breakAt: 1,
  recoverAfter: 9,
  /** After you break down in a race, the results come up this long (s) after. */
  resultsDelay: 3.5,
} as const;

/**
 * Race control (race/raceControl.ts): yellow flags and the safety car.
 * A car slower than `stoppedSpeed` m/s for `stoppedTime` s on the track in a
 * race (not in its pit stop), or hit harder than `crashSpeed` m/s, is an
 * incident: yellow flags from `yellowBefore` m before it to `yellowAfter` m
 * past it, until `yellowHold` s after it's gone. AI cars ease to `yellowPace`
 * there. With the safety car on, a car stranded on the track (slower than
 * `strandedSpeed` m/s for `safetyCarAfter` s: long enough for an AI that's
 * spun or been knocked to set off again by itself) brings it out. It runs at `scSpeed` m/s; cars may close up to `scGap` m behind the
 * car ahead (catching up at `scCatchUp` m/s more per metre of gap, up to
 * `scMaxCatch` m/s). It stays out at least `scMin` s, then comes in at the
 * end of that lap. No safety car in the last `scLastLaps` laps.
 */
export const FLAGS = {
  stoppedSpeed: 3,
  stoppedTime: 1.2,
  crashSpeed: 14,
  yellowBefore: 160,
  yellowAfter: 30,
  yellowHold: 6,
  yellowPace: 0.85,
  strandedSpeed: 1.5,
  safetyCarAfter: 6,
  scSpeed: 24,
  scGap: 16,
  scCatchUp: 0.2,
  scMaxCatch: 14,
  scMin: 25,
  scLastLaps: 1,
} as const;

/**
 * The pit lane (track/pitLane.ts), on tracks with pits and room for it: it
 * turns off the track over a `ramp` m long ramp before the garages, runs
 * behind a pit wall past them and rejoins over another ramp after. The wall
 * starts `wallAt` of the way along the entry ramp and ends as far from the
 * end of the exit one. Between the ends of the wall there's a speed limit of
 * `limit` m/s (60 km/h): the limiter holds you to it from the line. Each car
 * has a box (`boxLength` × `boxWidth` m) in front of a garage, cars sharing
 * a garage when there are more cars than garages. The AI aims to be down to
 * the limit `brakeMargin` m before the line.
 */
export const PIT_LANE = {
  ramp: 45,
  wallAt: 0.6,
  /** The pit wall's thickness (m): the lane starts this far beyond the barrier line. */
  wallThick: 0.6,
  limit: 60 / 3.6,
  boxLength: 6,
  boxWidth: 3.6,
  brakeMargin: 6,
  /** The lane's own line: in the fast lane this far (m) beyond the wall, the boxes' middle this far. */
  fast: 1.9,
  box: 5.6,
} as const;

/**
 * Changing weather (race/weather.ts): rain that comes and goes during a race,
 * and a road that gets wet in it and dries out after, the racing line first.
 */
export const WEATHER = {
  /** Time constants (s): the road getting wet in the rain, and drying out on the racing line (where the cars run) and off it. */
  wetting: 40,
  dryingLine: 75,
  dryingOff: 240,
  /** Rain comes in, or eases off, over this long (s). */
  rainRamp: 20,
  /** The racing line dries across this far (m) either side of it, blending into the rest of the road over `lineBlend` m. */
  lineHalf: 1.2,
  lineBlend: 2.5,
  /**
   * In a race it starts dry. Rain comes at between rainFrom and rainTo of
   * the way through it, and (with stopChance) stops again between stopFrom
   * and stopTo. In practice it changes every practiceMin…practiceMax s.
   */
  rainFrom: 0.2,
  rainTo: 0.5,
  stopChance: 0.65,
  stopFrom: 0.55,
  stopTo: 0.8,
  practiceMin: 150,
  practiceMax: 300,
  /** The HUD forecasts a change this long (s) before it comes. */
  forecast: 90,
  /**
   * AI cars change to wets once the road on the line is this wet, and back
   * to slicks once it's dried to this, by grid slot (some gamble early, some
   * late; the gap stops them flip-flopping).
   */
  aiToWets: [0.28, 0.34, 0.42],
  aiToSlicks: [0.3, 0.24, 0.18],
} as const;

/** The car's setup (see SETUP). */
export type WingLevel = 'low' | 'medium' | 'high';
export type GearSet = 'short' | 'medium' | 'long';
export type BrakeBalance = 'front' | 'balanced' | 'rear';
export interface CarSetup {
  wing: WingLevel;
  gears: GearSet;
  brakes: BrakeBalance;
}
export const DEFAULT_SETUP: CarSetup = { wing: 'medium', gears: 'medium', brakes: 'balanced' };

/**
 * Car setups (car/physics.ts). The middle of each is the car as it always
 * was, so a car on the default setup drives exactly as before.
 */
export const SETUP = {
  /**
   * Wing: drag (× the car's) and downforce: grip in the bends grows by
   * `downforce` × (speed / downforceSpeed)², so it matters most in fast
   * bends. Low wing is quicker on the straights, high wing through fast bends.
   * Balanced so each is the quickest on about a third of the built-in tracks
   * (Monza and Las Vegas low, Budapest high), by a few tenths a lap.
   */
  wing: {
    low: { drag: 0.82, downforce: -0.05 },
    medium: { drag: 1, downforce: 0 },
    high: { drag: 1.18, downforce: 0.05 },
  },
  downforceSpeed: 40,
  /**
   * Gears: every gear's top speed × `ratio` (the revs and the limiter), the
   * engine's pull × `pull`, and the speed it stops pulling at × `top`. Short
   * gears get going quicker but top out lower; long gears the other way.
   */
  gears: {
    short: { ratio: 0.9, pull: 1.05, top: 0.97 },
    medium: { ratio: 1, pull: 1, top: 1 },
    long: { ratio: 1.1, pull: 0.95, top: 1.03 },
  },
  /**
   * Brake balance: the brakes' bite (×), and under braking how much more
   * readily the car turns in (`turn`: + rear, − front) and lets its tail
   * slide (`slide`).
   */
  brakes: {
    front: { bite: 0.97, turn: -0.25, slide: 0 },
    balanced: { bite: 1, turn: 0, slide: 0 },
    rear: { bite: 1.02, turn: 0.35, slide: 0.25 },
  },
} as const;

/** A kind of tyre (see TYRES.compounds). */
export type Compound = 'soft' | 'medium' | 'hard' | 'wet';

/**
 * Tyres, with tyre wear on (`car/tyres.ts`). Wear is counted in laps driven
 * (sliding counts extra: 1 + slideWear per m/s over slideFrom). Medium tyres
 * last lifeEasy laps on the easiest tracks and lifeHard on the hardest, by
 * how hard a lap works them (workEasy … workHard: the speed turned through
 * in the bends plus the speed shed under braking, on the racing line; Monza
 * is about 420, Sakhir 830, Shanghai 970). Until then they lose fadeLoss of
 * their grip, steadily; then they go off, falling to deadGrip over `cliff`
 * of their life (heavily slower, not blown up).
 */
export const TYRES = {
  lifeEasy: 6,
  lifeHard: 4,
  workEasy: 450,
  workHard: 950,
  fadeLoss: 0.07,
  cliff: 0.25,
  deadGrip: 0.6,
  slideFrom: 1,
  slideWear: 0.35,
  /** The HUD calls them worn past this share of their life. */
  wornAt: 0.8,
  /**
   * Each kind: its grip (a share of the road's) in the dry and on a soaked
   * road (between the two, by how wet it is), its brakes on a soaked road,
   * and its life (× the medium's) in the dry and in the rain. Softs are
   * quicker and go off sooner, hards are slower and last. Slicks lose 40 % of
   * their grip on a soaked road. Wets are the tyres for the rain, slow in the
   * dry and wearing out fast there: they're quicker once the road is about a
   * third wet. On Sunday Loop at 90 % wet, fresh wets beat worn softs by about
   * 5 s a lap (tests/conditions.test.ts).
   */
  compounds: {
    soft: { grip: 1.05, rainGrip: 0.63, rainBrake: 0.65, life: 0.65, rainLife: 0.65 },
    medium: { grip: 1, rainGrip: 0.6, rainBrake: 0.65, life: 1, rainLife: 1 },
    hard: { grip: 0.95, rainGrip: 0.57, rainBrake: 0.65, life: 1.6, rainLife: 1.6 },
    wet: { grip: 0.86, rainGrip: 0.95, rainBrake: 0.9, life: 0.4, rainLife: 1.3 },
  },
  /** Quickest first (in the dry). */
  order: ['soft', 'medium', 'hard', 'wet'],
} as const;

/** AI opponents (race mode only). */
/**
 * Driving assists: braking, steering and the racing line's colours all follow
 * the racing line at this share of the tyres' grip and the brakes, a little
 * short of the gold medal pace (driven like that, a lap is about 1.5 % slower
 * than gold). The braking and steering assists only help towards it (see
 * below): they don't drive.
 */
export const ASSISTS = {
  grip: 0.8,
  brake: 0.66,
  /** Below this speed (m/s) the braking and steering assists leave the car alone. */
  minSpeed: 3,
  /**
   * They help, they don't drive. Braking: never lifts your throttle; coming
   * in too fast without braking it adds only this much brake (not enough to
   * make the corner), and while you brake it tops you up by at most this
   * much more. Steering: while you're not steering it makes the racing line's
   * small corrections, but never steers more than this share of the lock
   * (less the more you steer, none at full lock).
   */
  brakeTouch: 0.18,
  brakeTopUp: 0.35,
  steerShare: 0.2,
  /** Steering assist's pull towards the line (steer per metre off it) and against heading away from it (steer per radian): gentle and well damped, so it settles onto the line instead of swinging across it. */
  steerPerMetre: 0.05,
  steerPerRadian: 1.6,
  /** The racing line: drawn this far ahead (m), this wide (m), this far above the road (m). */
  lineAhead: 170,
  lineWidth: 0.9,
  lineLift: 0.06,
  /** Line colours: red where your speed now is over the limit there (brake), yellow within this share of it (lift), green otherwise. */
  liftShare: 0.92,
} as const;

export const AI = {
  maxDifficulty: 110,
  /** Extra challenge above 100%; the original 1–100 pace curve is unchanged.
   * At 110 the AI receives these hardware bonuses and uses the full brakes. */
  expert: { grip: .08, pull: .1, top: .04, brake: .1 },
  /** Up to this many AI cars in a single race (12 cars with you). */
  maxOpponents: 11,
  /** Eleven GP-inspired rivals and a custom team: up to 24 cars with you. */
  maxField: 23,
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
  /**
   * What each difficulty above means on any track: its lap as a multiple of
   * the 100 % lap there, at 0, 25, 50, 75 and 100 %. On each track the pace
   * is set to hit this, whatever the mix of bends (where grip counts) and
   * straights (where it doesn't), so 75 % is as far off the limit on a fast
   * banked oval as on a twisty street circuit.
   */
  lapRatio: [1.7, 1.27, 1.14, 1.06, 1],
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
  /** For the first this many metres of a race, each grid slot back drives this much slower (a share). */
  startStretch: 500,
  startSpread: 0.005,
  /** Share of its pace after the finish (it carries on, not parked on the line). */
  afterFinishPace: 0.85,
  /** More than this far (m) off the lane it means to drive, it takes the lane to be (about) where it is. */
  laneSync: 1,
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
  /** Paths beside the line keep inside a smoothed road edge: the narrowest within this many samples either side, averaged as far… */
  envelope: 8,
  /** …and this much further in from it (m). */
  laneInset: 0.6,
  /** First (coarsest) spacing of the points being placed, in samples; it halves down to 1. */
  firstStep: 64,
  /** Passes at each spacing (× √spacing). */
  iterations: 60,
} as const;

/** How the AI drives the racing line (race/driver.ts). */
export const DRIVER = {
  /**
   * Running wide: at full lock, more than `wideFrom` m off its path and
   * drifting further off at more than `wideDrift` m/s, the car is too fast to
   * make the turn (the lock shrinks as the car speeds up). It lifts, and
   * brakes `lockBrake` per m/s of drift over that (at most `lockBrakeMax`):
   * flooring it would only widen the arc into the barrier. Not at a crawl
   * (`lockCrawl` m/s), where it has to roll to turn at all.
   */
  wideFrom: 0.5,
  wideDrift: 2,
  lockCrawl: 5,
  lockBrake: 0.12,
  lockBrakeMax: 0.5,
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
  /** A path's bends are measured on it smoothed over this far either side (m): about how far ahead the steering looks. */
  pathSmooth: 5,
  /** On a path of its own (covering the inside of a bend): this share of its grip in the bends, and of the speed that gives. */
  routeGrip: 0.98,
  routeSpeed: 1,
  /** On tyres with less grip than this share of what it planned for (gone off), it takes this much more care per share below (they slide): 0.4 → 8 % slower at 0.6. */
  lowGrip: 0.8,
  lowGripCare: 0.4,
  /** Fighting for a place (see TRAFFIC.fightAhead): it brakes with this much more of the brakes (a share), up to this much. */
  lateBrake: 0.2,
  lateBrakeMax: 1,
} as const;

/** Racing in traffic (race/traffic.ts). */
export const TRAFFIC = {
  /** How often an AI re-picks its lane (s). */
  planEvery: 1 / 30,
  /** Cars this far ahead / behind along the track (m) are considered. */
  ahead: 70,
  behind: 25,
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
  /** In a car's slipstream (strength 0..1) it reckons on going up to this share quicker than its plan. */
  towGain: 0.08,
  /** Within this far along (m) and across (m) of another car, it eases off by this share. */
  crowdAlong: 15,
  crowdSide: 4,
  crowdEase: 0.015,
  /** In a bend it wants this much more room across the road per 1/m of curvature (m) (tails swing out). */
  bendMargin: 30,
  /**
   * With a car beside it (overlapping along the track: up to keepReach m
   * beyond its nose ahead, keepBehind m back behind), it keeps at least keepGap (m) between their sides (plus the extra for
   * a bend), or no less than there is now, whatever the line does.
   */
  keepGap: 0.9,
  keepReach: 1,
  /** …and a car behind counts as beside it once less than this far back (m, centre to centre: its nose past our rear wheels), plus this many seconds of the speed it's closing at. */
  keepBehind: 3,
  keepClosing: 0.6,
  /** Counter a developing sideways drift before the car reaches its neighbour. */
  keepDriftTime: .25,
  keepDriftMax: 1.5,
  /**
   * Passing a slower car that isn't an AI (you) within passAhead m: from
   * passClose m back it keeps this much (m) between the sides (plus the extra
   * for a bend), moving over at most passStep m ahead of where it is at a time.
   */
  passAhead: 40,
  passClose: 30,
  passGap: 0.8,
  passStep: 1.5,
  /** …and counts as clear of it (not following it any more) this much (m) short of that room. */
  passSlack: 0.3,
  passAdvantage: 1.25,
  /**
   * Push to pass (a help for overtaking you): held up (below pushBelow of its
   * plan, with a slower car that isn't an AI within pushWithin m ahead) for
   * pushAfter s, it gets the pace of a tow this strong (see
   * HANDLING.slipstream*) for up to pushTime s, then waits pushRest s.
   */
  pushWithin: 30,
  pushBelow: 0.95,
  pushAfter: 2,
  pushTow: 1,
  pushTime: 6,
  pushRest: 10,
  /** Room it keeps around another car's body: along the track and across it (m). */
  marginAlong: 1,
  marginSide: 1.2,
  /** Drawing alongside a car it's closing on faster than 2 m/s in a bend (tighter than closingBend, 1/m), it wants this much more room across the road per m/s (m), up to this much. */
  closingMargin: 0.1,
  closingMarginMax: 0.6,
  closingBend: 1 / 60,
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
  letByGap: 25,
  letByAfter: 1.5,
  letByOffset: 3.5,
  letByHold: 8,
  letByEase: 0.85,
  letByThrottle: 0.5,
  /** Only this far (m) into the race, and not while queued behind someone itself. The quicker car is put off passing on the side it's moved to by this (s). */
  letByFrom: 200,
  letByWrongSide: 0.5,
  /** A lane's cost counts the time it loses against the line over this far ahead (m) (about what a pass takes; also how its pace is judged)… */
  laneLook: 80,
  /** …and being stuck behind a slower car it can't get past, what it loses over this long (s). */
  stuckFor: 8,
  /** Race position has value even when passing costs some lap time. */
  playerPositionCost: 2.5,
  /** Only switch lane for a gain of at least this much (s); for a while after a real change of lane (a pass), only for this much. */
  switchGain: 0.08,
  commitTime: 1.5,
  commitGain: 0.5,
  /**
   * Side by side with no room for both: overlapped by more than half a car,
   * the car on the outside of the next bend (within insideLook m) backs out;
   * otherwise the one behind (on a straight: by more than yieldLead m), for
   * up to yieldTime s.
   */
  insideLook: 60,
  yieldLead: 0.5,
  /** …dropping to this much (m/s) below the other car's speed (unless that car is slower than yieldMinSpeed m/s, or behind). */
  yieldDrop: 2,
  yieldMinSpeed: 6,
  yieldTime: 1,
  /** Sliding sideways faster than this (m/s): at most this much throttle, for this long (s) after. */
  recoverSlip: 3,
  /** At speed, allow the normal slip angle of a fast direction change. Recover
   * immediately if the car is also straying this far from its intended path. */
  recoverSlipRatio: 0.16,
  recoverOffLine: 2.5,
  recoverTime: 0.4,
  recoverThrottle: 0.35,
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
  /** A player cutting across an existing overlap: close the longitudinal gap only after its rear clears us. */
  cutAcrossSpeed: 0.8,
  cutAcrossMinTime: 0.15,
  cutAcrossLook: 0.6,
  /** Rejoin the road only when no car is coming within this far behind (m). */
  rejoinClear: 60,
  /**
   * Defending against a car that isn't an AI (you): with it close behind
   * (bumper to bumper within defendWithin m, and set to be within defendGap m
   * by the braking point, at the rate it's closing), it moves over to the
   * inside of the bend coming up (one that slows the line by at least
   * cornerDrop m/s, within defendLook m) and holds it to the apex. One move
   * per bend, made between defendLead and defendLatest s before the braking
   * point (not under braking), and only if it can get across in time with at
   * most defendAccel m/s² of sideways pull. It gives up once the car has
   * dropped defendDrop m back.
   */
  defendWithin: 30,
  defendGap: 18,
  /** (…× this if you're already pulling out to the inside.) Not if the line already has it within this much (m) of the inside at the braking point. */
  defendPulling: 1.6,
  defendMin: 1.5,
  /** …and only into a bend that slows the line to this share of its speed at the braking point, unless you're already pulling out to the inside. */
  defendSlow: 0.9,
  /** Covering the inside it keeps this much (m) further in from the edge than a lane would (not quite on the kerb: no room for a car, either way), and eases back onto the line over defendPast m after the apex. */
  coverGap: 0.4,
  defendPast: 25,
  defendLook: 220,
  cornerDrop: 6,
  defendLead: 5,
  defendLatest: 1,
  defendAccel: 7,
  /** …on a run to the braking point no more curved than this (1/m), with the car sliding no more than this (m/s). */
  defendStraight: 1 / 70,
  defendSlip: 1.5,
  defendDrop: 30,
  /**
   * Hard but fair with you alongside: it leaves you a car's width and this
   * much (m) (and the extra for a bend), not the wider berth (keepGap) it
   * gives another AI.
   */
  keepGapHuman: 0.7,
  /** …and isn't shy of you: it follows you closer, this many seconds behind (in your tow, ready to pounce), instead of gapTime. */
  gapTimeHuman: 0.15,
  /**
   * Fighting you for a place into a bend: alongside (or with you up to
   * fightAhead m ahead, centre to centre, and it on the inside of the bend,
   * clear of you across the road by fightSide m), it goes later on the brakes
   * (see DRIVER.lateBrake).
   */
  fightAhead: 9,
  fightSide: 0.3,
} as const;

/** Committed wheel-to-wheel tactics. Distances are metres; decisions still obey the ordinary path limits. */
export const RACECRAFT = {
  minSpeed: 8,
  maxSlip: 2.5,
  maxSlipRatio: .14,
  lookahead: 180,
  minCornerDistance: 25,
  minEntryDistance: 8,
  rearRange: 10,
  attackRange: 28,
  switchbackRange: 12,
  overlapMargin: 1,
  sideGap: 0.7,
  edgeMargin: 0.7,
  attackOffset: 6,
  exitOffset: 1.2,
  minBlend: 18,
  attackLead: 2.5,
  setupLead: 4.5,
  setupTime: 1.2,
  setupOffset: 3.5,
  maxAttackLoss: .5,
  attackCurve: 1 / 70,
  attackSlip: 1,
  speedTolerance: 3,
  cutbackBefore: 30,
  cutbackAfter: 12,
  cutbackGap: 18,
  crossBehind: 1,
  outwardDrift: 0.3,
  insideOccupied: 0.5,
  cutbackLength: 28,
  lateApex: 8,
  releaseFrom: 8,
  cutbackRelease: 22,
  exitBlend: 40,
  wonBy: 8,
  dropDistance: 38,
  thirdCarRange: 12,
  sameCorner: 35,
  retryAfter: 1,
} as const;

/**
 * Slipstream (car/slipstream.ts). Its strength falls with the time gap to the
 * car ahead (bumper to bumper): exp(−gap / speed / timeScale), at least
 * minSpeed counted, out to `range` m. The wake is `width` m to either side
 * right behind the car, widening by `spread` m per metre back. Leaving it, a
 * car keeps the tow for a moment, fading over `carry` s (the slingshot). What
 * it does to the car is HANDLING.slipstream*.
 */
export const SLIPSTREAM = {
  timeScale: 0.35,
  minSpeed: 10,
  range: 60,
  width: 1.6,
  spread: 0.07,
  carry: 0.4,
  /** The HUD shows "Slipstream" above this much of it. */
  show: 0.15,
} as const;

