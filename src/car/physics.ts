import { HANDLING } from '../config/handling.ts';
import { DAMAGE, DEFAULT_SETUP, SETUP, TYRES, type CarSetup, type Compound } from '../config/race.ts';
import { clamp } from '../core/math.ts';
import { locatorFor, type TrackLocator } from '../track/locator.ts';
import { pitLayout } from '../track/pits.ts';
import { inPitLane, onLane, outerAt, pitLane, pitWallAt, type PitLane } from '../track/pitLane.ts';
import { placeTrees } from '../track/placement.ts';
import { axes, placedObstacles, placedOn, runoffLayout, type Placed, type RunoffLayout } from '../track/extras.ts';
import { leftOf, sampleAt } from '../track/spline.ts';
import { groundPose } from '../track/ground.ts';
import { enginePull, stepGearbox, type GearboxMode } from './gearbox.ts';
import { compoundBrake, compoundGrip, compoundLife, standardBrake, standardGrip, tyreCurve } from './tyres.ts';
import { surfaceFor, terrainHeight, type TrackSurface } from '../track/surface.ts';
import type { Track } from '../track/track.ts';

const G = 9.81;

/** Driver input for one physics tick. */
export interface DriveInput {
  /** 0..1 */
  throttle: number;
  /** 0..1; holding it at a standstill reverses. */
  brake: number;
  /** -1 (left) .. +1 (right) */
  steer: number;
  handbrake: boolean;
  /** A gear change asked for this tick (manual gearbox): +1 up, -1 down. */
  shift?: number;
}

export const NO_INPUT: Readonly<DriveInput> = { throttle: 0, brake: 0, steer: 0, handbrake: false };
/** The standard car: all of its grip, engine pull and top speed (see CarPhysics.tune). */
export const STANDARD_CAR: Readonly<{ grip: number; pull: number; top: number }> = { grip: 1, pull: 1, top: 1 };
/** A broken-down car: no drive, and it's brought to a stop where it is (the brakes while it rolls, then held). */
const BROKEN_ROLLING: Readonly<DriveInput> = { throttle: 0, brake: 1, steer: 0, handbrake: true };
const BROKEN_STOPPED: Readonly<DriveInput> = { throttle: 0, brake: 0, steer: 0, handbrake: true };

/** The run-off kinds, by index (OPTION_CHOICES.runoff order). */
const RUNOFFS = ['grass', 'gravel', 'tarmac'] as const;
/** A bump kerb: the share of speed kept, the sideways kick (rad/s) and how rough it feels. */
const BUMP = { keep: 0.93, kick: 0.45, rough: 1.3 } as const;

/**
 * Full car state. Heading 0 points east (+x) and increases clockwise seen from
 * above, i.e. towards +z (south), so a positive yaw rate is a right turn.
 */
export class CarState {
  x = 0;
  z = 0;
  heading = 0;
  vx = 0;
  vz = 0;
  yawRate = 0;
  /** Front-wheel angle, + = right. */
  steer = 0;
  /** Wheel rotation for rendering. */
  spin = 0;
  /** Signed forward speed, m/s. */
  speed = 0;
  /** Sideways sliding speed, m/s. */
  slip = 0;
  /** How rough the ground under the wheels is: 0 on the road, 0.5 one side on grass, 1 all on grass (more on gravel). */
  grass = 0;
  /** The whole car is past the track edge (kerbs count as track): a track-limits breach. */
  offTrack = false;
  longAccel = 0;
  latAccel = 0;
  /** Nearest centre-line segment and position along / across the track. */
  trackIndex = -1;
  s = 0;
  lateral = 0;
  /** Height of the ground under the car, and its nose-up pitch / left-up roll (rad), for rendering. */
  y = 0;
  pitch = 0;
  roll = 0;
  /** Speed into the barrier on the last tick it was hit (0 = no hit), for sound and camera shake. */
  wallHit = 0;
  /** In the pit lane proper: past the pit wall, on the garages' side (see track/pitLane.ts). */
  inPits = false;
  /** Gear (1..6), engine revs (share of the rev limit) and seconds left of a gear change. */
  gear = 1;
  rpm = 0;
  shift = 0;

  copyFrom(o: CarState): this {
    Object.assign(this, o);
    return this;
  }
}

/** Shortest signed difference between two angles. */
export function angleDelta(a: number, b: number): number {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
}

/** Interpolates the parts of the state that rendering needs. */
export function lerpState(a: CarState, b: CarState, t: number, out: CarState): CarState {
  out.copyFrom(b);
  out.x = a.x + (b.x - a.x) * t;
  out.z = a.z + (b.z - a.z) * t;
  out.heading = a.heading + angleDelta(a.heading, b.heading) * t;
  out.steer = a.steer + (b.steer - a.steer) * t;
  out.spin = a.spin + (b.spin - a.spin) * t;
  out.speed = a.speed + (b.speed - a.speed) * t;
  out.y = a.y + (b.y - a.y) * t;
  out.pitch = a.pitch + (b.pitch - a.pitch) * t;
  out.roll = a.roll + (b.roll - a.roll) * t;
  return out;
}

/** The pit building as a row of round obstacles (only reachable where there are no barriers). */
function pitObstacles(track: Track): { x: number; z: number; r: number }[] {
  const pits = pitLayout(track);
  if (!pits) return [];
  const c = track.center;
  const out: { x: number; z: number; r: number }[] = [];
  const mid = (pits.building[0] + pits.building[1]) / 2;
  const r = (pits.building[1] - pits.building[0]) / 2;
  for (let s = pits.from + r / 2; s <= pits.to - r / 2 + 0.01; s += r * 0.8) {
    const { p, t } = sampleAt(c, s);
    const l = leftOf(t);
    out.push({ x: p.x + l.x * mid * pits.side, z: p.y + l.y * mid * pits.side, r });
  }
  return out;
}

/** Tree trunks bucketed on a grid for cheap collision checks. */
class ObstacleGrid {
  private readonly cell = 16;
  private readonly cells = new Map<number, number[]>();
  private readonly xs: Float32Array;
  private readonly zs: Float32Array;
  private readonly rs: Float32Array;

  constructor(items: { x: number; z: number; r: number }[]) {
    this.xs = new Float32Array(items.map((o) => o.x));
    this.zs = new Float32Array(items.map((o) => o.z));
    this.rs = new Float32Array(items.map((o) => o.r));
    items.forEach((o, i) => {
      const k = this.key(Math.floor(o.x / this.cell), Math.floor(o.z / this.cell));
      const list = this.cells.get(k);
      if (list) list.push(i);
      else this.cells.set(k, [i]);
    });
  }

  private key(cx: number, cz: number): number {
    return (cx + 512) * 4096 + (cz + 512);
  }

  /** Calls fn for every obstacle near (x, z). */
  near(x: number, z: number, fn: (ox: number, oz: number, r: number) => void): void {
    const cx = Math.floor(x / this.cell);
    const cz = Math.floor(z / this.cell);
    for (let i = -1; i <= 1; i++) {
      for (let j = -1; j <= 1; j++) {
        const list = this.cells.get(this.key(cx + i, cz + j));
        if (list) for (const k of list) fn(this.xs[k], this.zs[k], this.rs[k]);
      }
    }
  }
}

/**
 * Hand-written arcade car physics, stepped at a fixed rate (HANDLING.tickRate).
 * Nothing here reads the clock or the frame time, so the same inputs always
 * give the same result, whatever the display refresh rate.
 */
export class CarPhysics {
  readonly dt = 1 / HANDLING.tickRate;
  readonly state = new CarState();
  /** State before the last step, for render interpolation. */
  readonly prev = new CarState();
  /** How much of the slipstream of a car ahead this car is in, 0..1 (set before each step; see slipstream.ts). */
  draft = 0;
  /** Who changes gear (see gearbox.ts): AI cars and the medal bot shift perfectly; the player shifts by hand or with the automatic. */
  gearbox: GearboxMode = 'ideal';
  /**
   * How wet the road under the car is: 0 dry … 1 soaked (the weather sets it,
   * race/weather.ts). Less grip and weaker brakes (CONDITIONS.rainGrip,
   * rainBrake; with tyre wear, the tyres' own).
   */
  wetness = 0;
  /** Tyre wear on: the tyres fade as they wear and go off at the end of their life (car/tyres.ts). */
  wear = false;
  /** The kind of tyres on (with tyre wear on; with it off every car is on a standard medium set). */
  compound: Compound = 'medium';
  /** Laps medium tyres last on this track (see trackTyreLife()); the race sets it. */
  mediumLife = 5;
  /** Laps driven on these tyres, and the share of their life used (sliding uses it faster; 1 = they've gone off). */
  tyreAge = 0;
  tyreUse = 0;
  /** Wing, gears and brake balance (see SETUP); the default is the car as it always was. */
  setup: CarSetup = DEFAULT_SETUP;
  /** Damage (Conditions → Damage) on, and how damaged the front wing and the bodywork are (0..1). */
  damageOn = false;
  wingDamage = 0;
  bodyDamage = 0;
  /** This car against the standard one: the share of its grip, engine pull and top speed it has (a championship team's car). */
  tune: Readonly<{ grip: number; pull: number; top: number }> = STANDARD_CAR;
  /** Something in the car has failed (a championship's mechanical failures): broken down, whatever the damage. */
  failed = false;
  private readonly track: Track;
  private readonly locator: TrackLocator;
  private readonly obstacles: ObstacleGrid;
  private readonly surf: TrackSurface;
  /** Painted or per-corner run-off beside each stretch of road. */
  private readonly runoffs: RunoffLayout;
  /** Bump kerbs, and the one the car is on (-1: none). */
  private readonly bumps: Placed[];
  private onBump = -1;
  /** The track's pit lane, if it has one. */
  readonly pitLane: PitLane | null;
  /** The road as a surface: tarmac, or dirt or snow (slower to pull away on, rougher). */
  private readonly roadSurface: { speedFactor: number; accelFactor: number; drag: number; gripFactor: number; rough: number };

  constructor(track: Track) {
    this.track = track;
    const kind = HANDLING.roads[track.options.road];
    this.roadSurface = { ...HANDLING.road, accelFactor: kind.accel, rough: kind.rough };
    this.locator = locatorFor(track);
    this.surf = surfaceFor(track);
    this.pitLane = pitLane(track);
    this.obstacles = new ObstacleGrid([...placeTrees(track).map((t) => ({ x: t.x, z: t.z, r: t.radius })), ...pitObstacles(track), ...placedObstacles(track)]);
    this.runoffs = runoffLayout(track);
    this.bumps = placedOn(track).filter((p) => p.kind === 'bump');
    this.placeAt(-8);
  }

  /**
   * Puts the car at rest facing along the track, `s` metres along it (negative
   * = before the start line) and `lateral` metres left of the centre line.
   */
  placeAt(s: number, lateral = 0): void {
    const { p, t } = sampleAt(this.track.center, s);
    const l = leftOf(t);
    const st = this.state;
    Object.assign(st, new CarState());
    st.x = p.x + l.x * lateral;
    st.z = p.y + l.y * lateral;
    st.heading = Math.atan2(t.y, t.x);
    const pos = this.locator.locate({ x: st.x, y: st.z });
    st.trackIndex = pos.index;
    st.s = pos.s;
    st.lateral = pos.lateral;
    this.updateGround();
    this.prev.copyFrom(st);
  }

  /** A wet road (more than half wet); setting it makes the road soaked or dry. */
  get wet(): boolean {
    return this.wetness >= 0.5;
  }

  set wet(on: boolean) {
    this.wetness = on ? 1 : 0;
  }

  /** Laps these tyres would last, new, on the road as it is now. */
  get tyreLife(): number {
    return compoundLife(this.compound, this.wetness, this.mediumLife);
  }

  /** Share of their life the tyres have left: 1 new, 0 once they've gone off (1 with wear off). */
  get tyreLeft(): number {
    return this.wear ? Math.max(0, 1 - this.tyreUse) : 1;
  }

  /** Laps the tyres have left before they go off, on the road as it is now. */
  get tyreLapsLeft(): number {
    return this.tyreLeft * this.tyreLife;
  }

  /** The tyres' grip now, as a share of the road's: their kind, how wet the road is, and their wear. */
  get gripScale(): number {
    if (!this.wear) return standardGrip(this.wetness);
    return compoundGrip(this.compound, this.wetness) * tyreCurve(this.tyreUse);
  }

  /** Share of the brakes' bite the tyres give (less on a wet road). */
  get brakeScale(): number {
    return this.wear ? compoundBrake(this.compound, this.wetness) : standardBrake(this.wetness);
  }

  /** How damaged the car is overall (0..1). */
  get damage(): number {
    return Math.max(this.wingDamage, this.bodyDamage);
  }

  /** Broken down: damaged all the way (DAMAGE.breakAt). The engine's dead and the car stops where it is. */
  get broken(): boolean {
    return this.failed || (this.damageOn && this.damage >= DAMAGE.breakAt);
  }

  /** The share of cornering grip a damaged front wing leaves. */
  get damageGrip(): number {
    return 1 - DAMAGE.wingGrip * this.wingDamage;
  }

  /** A hit at `speed` m/s (into a barrier or another car): damage, with damage on. Returns how much. */
  addDamage(speed: number): number {
    if (!this.damageOn) return 0;
    const d = Math.max(0, speed - DAMAGE.from) * DAMAGE.perSpeed;
    if (d <= 0) return 0;
    this.wingDamage = Math.min(1, this.wingDamage + d * DAMAGE.wingShare);
    this.bodyDamage = Math.min(1, this.bodyDamage + d * (1 - DAMAGE.wingShare));
    return d;
  }

  /** The pit crew mends it all. */
  repair(): void {
    this.wingDamage = 0;
    this.bodyDamage = 0;
  }

  /** A fresh set of tyres (a pit stop, or a new run), of `compound` (the same kind by default). */
  newTyres(compound: Compound = this.compound): void {
    this.compound = compound;
    this.tyreAge = 0;
    this.tyreUse = 0;
  }

  /** "R": back onto the road at the nearest point, facing the right way. */
  resetToRoad(): void {
    const s = this.locator.locate({ x: this.state.x, y: this.state.z }, this.state.trackIndex).s;
    this.placeAt(s);
  }

  step(inp: DriveInput): void {
    const H = HANDLING;
    const dt = this.dt;
    const st = this.state;
    this.prev.copyFrom(st);

    const cos = Math.cos(st.heading);
    const sin = Math.sin(st.heading);
    let vf = st.vx * cos + st.vz * sin; // forward
    let vr = -st.vx * sin + st.vz * cos; // sideways, + = sliding right
    const vf0 = vf;
    // Broken down: whatever the driver does, it rolls to a stop and stays there.
    if (this.broken) inp = vf > 0.5 ? BROKEN_ROLLING : BROKEN_STOPPED;

    // --- surface: which wheels are off the road (kerbs count as road)
    const pos = this.locator.locate({ x: st.x, y: st.z }, st.trackIndex);
    st.trackIndex = pos.index;
    st.s = pos.s;
    st.lateral = pos.lateral;
    const edgeL = this.locator.edge(pos.index, 1);
    const edgeR = -this.locator.edge(pos.index, -1);
    // Off the road, the run-off surface reaches out to the barrier line; beyond it is grass.
    const runoffEdge = this.track.center.wallOffset + 1.5;
    const runoffL = H[RUNOFFS[this.runoffs.left[pos.index]] ?? this.track.options.runoff];
    const runoffR = H[RUNOFFS[this.runoffs.right[pos.index]] ?? this.track.options.runoff];
    const onTheRoad = (w: number) => w <= edgeL && w >= edgeR;
    const road = this.roadSurface;
    // The pit lane and its ramps are tarmac, whatever the road is.
    const lane = this.pitLane && outerAt(this.pitLane, pos.s) !== null ? this.pitLane : null;
    const onPitLane = (w: number) => lane !== null && onLane(lane, pos.s, w);
    const surfaceAt = (w: number) => (onTheRoad(w) ? road : onPitLane(w) ? H.road : Math.abs(w) <= runoffEdge ? (w > 0 ? runoffL : runoffR) : H.grass);
    const a = surfaceAt(pos.lateral + H.halfTrack);
    const b = surfaceAt(pos.lateral - H.halfTrack);
    // Dirt or snow: less grip in corners and less bite from the brakes, on the share of the car on it.
    const share = ((a === road ? 1 : 0) + (b === road ? 1 : 0)) / 2;
    const kind = H.roads[this.track.options.road];
    const roadGrip = 1 + (kind.grip - 1) * share;
    const roadBite = 1 + (kind.brake - 1) * share;
    // Track limits: both wheel tracks beyond the same edge, with a little grace.
    const grace = 0.25;
    st.offTrack = (pos.lateral - H.halfTrack > edgeL + grace || pos.lateral + H.halfTrack < edgeR - grace) && !onPitLane(pos.lateral);
    /** Rough-ground amount (for sound and camera shake), 0 on tarmac. */
    const grass = (a.rough + b.rough) / 2;
    // The rain and worn tyres take some of it away: how hard the car can corner (not how
    // quickly it answers the wheel, which is the surface's).
    const surfaceGrip = (a.gripFactor + b.gripFactor) / 2;
    const grip = surfaceGrip * this.gripScale * roadGrip * this.damageGrip * this.tune.grip;
    const wing = SETUP.wing[this.setup.wing];
    const gears = SETUP.gears[this.setup.gears];
    const balance = SETUP.brakes[this.setup.brakes];
    const brakeDecel = H.brakeDecel * this.brakeScale * balance.bite * roadBite;
    const speedF = (a.speedFactor + b.speedFactor) / 2;
    const accelF = (a.accelFactor + b.accelFactor) / 2;
    const surfDrag = (a.drag + b.drag) / 2;

    // --- steering: lock shrinks with speed; wheels turn at a limited rate
    const throttle = clamp(inp.throttle, 0, 1);
    const brake = clamp(inp.brake, 0, 1);
    const lock = H.maxSteerAngle / (1 + Math.abs(vf) / H.steerFalloff);
    const target = clamp(inp.steer, -1, 1) * lock;
    const returning = Math.abs(target) < Math.abs(st.steer) || target * st.steer < 0;
    const rate = (returning ? H.steerReturnRate : H.steerRate) * dt;
    st.steer = clamp(st.steer + clamp(target - st.steer, -rate, rate), -lock, lock);

    // --- longitudinal: driving force, then resistances that can only slow the car
    let drive = 0;
    stepGearbox(st, this.gearbox, inp.shift ?? 0, vf, dt, gears.ratio);
    // (Shorter gears pull harder but top out lower, longer ones the other way.)
    const pull = enginePull(st, vf, gears.ratio) * gears.pull;
    // In another car's slipstream the air resistance drops and the tow pulls the car along,
    // past its usual top speed: enough to draw alongside on a straight.
    const tow = this.draft;
    let resist = H.rollingDrag + surfDrag + H.aeroDrag * wing.drag * (1 + DAMAGE.bodyDrag * this.bodyDamage) * (1 - H.slipstreamDragCut * tow) * vf * vf;
    if (throttle > 0) {
      const fade = Math.max(0, 1 - vf / (H.maxSpeed * this.tune.top * gears.top * speedF * (1 + H.slipstreamTopSpeed * tow)));
      if (vf >= -0.5) drive += (H.engineAccel * this.tune.pull * accelF * pull + H.slipstreamPush * tow) * throttle * fade;
      else resist += brakeDecel * throttle;
    }
    if (brake > 0) {
      if (vf > 0.5) resist += brakeDecel * brake;
      else if (throttle === 0 && vf > -H.reverseMaxSpeed) drive -= H.reverseAccel * accelF * brake;
    }
    if (throttle === 0 && brake === 0) resist += H.engineBraking;
    if (inp.handbrake) resist += H.handbrakeDecel;
    // Gravity along the slope: uphill slows the car, downhill speeds it up.
    drive -= G * H.slopeFactor * this.slopeAhead(cos, sin, pos.index, pos.lateral);
    vf += drive * dt;
    const r = resist * dt;
    vf = Math.abs(vf) <= r ? 0 : vf - Math.sign(vf) * r;

    // --- yaw: follow the bicycle-model turn rate, limited by what the tyres can hold.
    // Turning into a banked corner adds grip; turning against the bank takes some away.
    const c = this.track.center;
    const t = c.tangents[pos.index];
    const along = Math.sign(cos * t.x + sin * t.y) || 1;
    const onRoad = Math.abs(pos.lateral) <= this.track.center.wallOffset;
    const bank = onRoad ? c.bank[pos.index] * along : 0;
    const bankAssist = G * Math.sin(Math.abs(bank)) * (Math.sign(bank) === Math.sign(st.yawRate) ? 1 : -0.5);
    // Downforce (the wing): more grip the faster the car goes.
    const downforce = 1 + wing.downforce * (vf / SETUP.downforceSpeed) ** 2;
    const latMax = Math.max(H.maxLateralAccel * grip * 0.5, H.maxLateralAccel * grip + bankAssist * H.bankGripFactor) * downforce;
    let yawTarget = (vf * Math.tan(st.steer)) / H.wheelBase;
    if (inp.handbrake) yawTarget *= H.handbrakeYawBoost;
    const yawLimit = (latMax * H.yawOvershoot * (inp.handbrake ? 1.8 : 1)) / Math.max(Math.abs(vf), 2);
    yawTarget = clamp(yawTarget, -yawLimit, yawLimit);
    // Brake balance: under braking a rearward balance turns the car in more readily (and lets the
    // tail slide), a forward one less.
    const braking = vf > 3 ? brake : 0;
    st.yawRate += (yawTarget - st.yawRate) * (1 - Math.exp(-H.yawResponse * surfaceGrip * (1 + balance.turn * braking) * dt));

    // --- lateral grip: sideways sliding decays, but never faster than the tyres allow
    const gripRate = (inp.handbrake ? H.handbrakeGripRate : H.gripRate) * surfaceGrip * (1 - balance.slide * braking);
    const dvr = clamp(vr * (Math.exp(-gripRate * dt) - 1), -latMax * dt, latMax * dt);
    vr += dvr;

    // --- integrate. Velocity stays in world space while the body rotates, which is what makes it slide.
    st.vx = vf * cos - vr * sin;
    st.vz = vf * sin + vr * cos;
    st.heading += st.yawRate * dt;
    if (st.heading > Math.PI) st.heading -= Math.PI * 2;
    else if (st.heading < -Math.PI) st.heading += Math.PI * 2;
    st.x += st.vx * dt;
    st.z += st.vz * dt;

    this.collide();
    this.collideWalls();
    if (st.wallHit > 0) this.addDamage(st.wallHit);
    const bumped = this.bumpKerbs();
    this.updateGround();

    st.speed = vf;
    st.slip = Math.abs(vr);
    st.grass = bumped ? Math.max(grass, BUMP.rough) : grass;
    st.longAccel = (vf - vf0) / dt;
    st.latAccel = vf * st.yawRate;
    st.spin = (st.spin + (vf / H.wheelRadius) * dt) % (Math.PI * 2);
    // Tyre wear: a lap per lap driven, faster while sliding.
    if (this.wear) {
      const T = TYRES;
      const laps = (Math.abs(vf) * dt) / this.track.center.length;
      this.tyreAge += laps;
      this.tyreUse += (laps * (1 + T.slideWear * Math.max(0, st.slip - T.slideFrom))) / this.tyreLife;
    }
  }

  /** Slope along the car's heading at its position (road grade on the road, terrain elsewhere). */
  private slopeAhead(cos: number, sin: number, i: number, lateral: number): number {
    const c = this.track.center;
    if (Math.abs(lateral) <= this.track.center.wallOffset) {
      const t = c.tangents[i];
      return c.grade[i] * (cos * t.x + sin * t.y);
    }
    const st = this.state;
    const tr = this.surf.terrain;
    return (terrainHeight(tr, st.x + cos, st.z + sin) - terrainHeight(tr, st.x - cos, st.z - sin)) / 2;
  }

  /** Ground height under the car and the car's pitch and roll (for rendering and the camera). */
  private updateGround(): void {
    const st = this.state;
    groundPose(this.track, this.surf, st.x, st.z, st.heading, { index: Math.max(0, st.trackIndex), s: st.s, lateral: st.lateral }, st);
  }

  /**
   * Barriers: if the car's side passes the barrier line where there is one,
   * push it back, bounce a little off it and scrub some speed. Beside the pit
   * lane, on its side, the lane's outer edge and the pit wall instead (the car
   * kept on whichever side of the wall its middle is).
   */
  private collideWalls(): void {
    const st = this.state;
    st.wallHit = 0;
    const pos = this.locator.locate({ x: st.x, y: st.z }, st.trackIndex, 6);
    const lane = this.pitLane;
    const side = pos.lateral >= 0 ? 1 : -1;
    const W = this.track.center.wallOffset;
    let lateral = pos.lateral;
    const outer = lane ? outerAt(lane, pos.s) : null;
    if (lane && outer !== null && side === lane.side) {
      const m = lateral * side;
      if (pitWallAt(lane, pos.s) && m > lane.wall - 2.5 && m < lane.inner + 2.5) {
        lateral = m < (lane.wall + lane.inner) / 2 ? this.pushOff(pos.index, lateral, W * side, side) : this.pushOff(pos.index, lateral, lane.inner * side, side > 0 ? -1 : 1);
      }
      lateral = this.pushOff(pos.index, lateral, outer * side, side);
    } else if ((side > 0 ? this.surf.wallL : this.surf.wallR)[pos.index]) {
      lateral = this.pushOff(pos.index, lateral, W * side, side);
    }
    // (Only a push moves it across: otherwise the step's own reading stands.)
    if (lateral !== pos.lateral) st.lateral = lateral;
    st.inPits = lane !== null && inPitLane(lane, pos.s, lateral);
  }

  /**
   * A wall along the track `wall` m left of the centre line: keeps the car on
   * its right (`dir` = 1) or its left (-1). Only within a sensible band: a car
   * already far beyond it (through a gap) isn't pulled back. Returns the car's
   * lateral after.
   */
  private pushOff(index: number, lateral: number, wall: number, dir: 1 | -1): number {
    const H = HANDLING;
    const st = this.state;
    const excess = dir * (lateral - wall) + H.halfWidth;
    if (excess <= 0 || excess > 2.5) return lateral;
    const l = leftOf(this.track.center.tangents[index]);
    const nx = l.x * dir; // into the wall
    const nz = l.y * dir;
    st.x -= nx * excess;
    st.z -= nz * excess;
    const vn = st.vx * nx + st.vz * nz;
    if (vn > 0) {
      st.vx -= nx * vn * (1 + H.wallBounce);
      st.vz -= nz * vn * (1 + H.wallBounce);
      const scrub = Math.max(H.wallMinKeep, 1 - H.wallScrub * vn);
      st.vx *= scrub;
      st.vz *= scrub;
      // A real knock checks the car's rotation. A scrape checks only a turn into the barrier: a car
      // leaning on it can always turn its nose away (else it could never drive off).
      const into = st.yawRate * (-Math.sin(st.heading) * nx + Math.cos(st.heading) * nz);
      if (vn > H.wallKnock || into > 0) st.yawRate *= 0.6;
      st.wallHit = Math.max(st.wallHit, vn);
    }
    return lateral - dir * excess;
  }

  /**
   * Bump kerbs: running over one (either wheel) costs some speed and kicks the
   * car sideways, once per bump.
   */
  private bumpKerbs(): boolean {
    if (!this.bumps.length) return false;
    const st = this.state;
    const H = HANDLING;
    let on = -1;
    let across = 0;
    for (let k = 0; k < this.bumps.length; k++) {
      const b = this.bumps[k];
      const dx = st.x - b.x;
      const dz = st.z - b.y;
      if (dx * dx + dz * dz > 25) continue;
      const { ax, ay, nx, ny } = axes(b);
      const u = dx * ax + dz * ay;
      const v = dx * nx + dz * ny;
      if (Math.abs(u) < 1.5 + 1.6 && Math.abs(v) < 0.3 + H.halfWidth) {
        on = k;
        across = v;
        break;
      }
    }
    const fresh = on >= 0 && on !== this.onBump;
    this.onBump = on;
    if (!fresh) return on >= 0;
    st.vx *= BUMP.keep;
    st.vz *= BUMP.keep;
    st.yawRate += BUMP.kick * (across >= 0 ? 1 : -1);
    return true;
  }

  /** Tree trunks and the edge of the world. */
  private collide(): void {
    const H = HANDLING;
    const st = this.state;
    this.obstacles.near(st.x, st.z, (ox, oz, r) => {
      const dx = st.x - ox;
      const dz = st.z - oz;
      const min = H.carRadius + r;
      const d2 = dx * dx + dz * dz;
      if (d2 >= min * min || d2 < 1e-8) return;
      const d = Math.sqrt(d2);
      const nx = dx / d;
      const nz = dz / d;
      st.x = ox + nx * min;
      st.z = oz + nz * min;
      const vn = st.vx * nx + st.vz * nz;
      if (vn < 0) {
        // Remove the inward velocity with a small bounce, and scrub some speed.
        st.vx = (st.vx - nx * vn * 1.3) * 0.6;
        st.vz = (st.vz - nz * vn * 1.3) * 0.6;
        st.yawRate *= 0.5;
      }
    });
    const lim = H.worldLimit;
    if (Math.abs(st.x) > lim) {
      st.x = Math.sign(st.x) * lim;
      st.vx = 0;
    }
    if (Math.abs(st.z) > lim) {
      st.z = Math.sign(st.z) * lim;
      st.vz = 0;
    }
  }
}
