import { HANDLING } from '../config/handling.ts';
import { clamp } from '../core/math.ts';
import { locatorFor, type TrackLocator } from '../track/locator.ts';
import { pitLayout } from '../track/pits.ts';
import { placeTrees } from '../track/placement.ts';
import { leftOf, sampleAt } from '../track/spline.ts';
import { groundPose } from '../track/ground.ts';
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
}

export const NO_INPUT: Readonly<DriveInput> = { throttle: 0, brake: 0, steer: 0, handbrake: false };

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
  private readonly track: Track;
  private readonly locator: TrackLocator;
  private readonly obstacles: ObstacleGrid;
  private readonly surf: TrackSurface;

  constructor(track: Track) {
    this.track = track;
    this.locator = locatorFor(track);
    this.surf = surfaceFor(track);
    this.obstacles = new ObstacleGrid([...placeTrees(track).map((t) => ({ x: t.x, z: t.z, r: t.radius })), ...pitObstacles(track)]);
    this.placeAt(-8);
  }

  /** Puts the car at rest on the centre line, `s` metres along the track (negative = before the start line). */
  placeAt(s: number): void {
    const { p, t } = sampleAt(this.track.center, s);
    const st = this.state;
    Object.assign(st, new CarState());
    st.x = p.x;
    st.z = p.y;
    st.heading = Math.atan2(t.y, t.x);
    const pos = this.locator.locate(p);
    st.trackIndex = pos.index;
    st.s = pos.s;
    st.lateral = pos.lateral;
    this.updateGround();
    this.prev.copyFrom(st);
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

    // --- surface: which wheels are off the road (kerbs count as road)
    const pos = this.locator.locate({ x: st.x, y: st.z }, st.trackIndex);
    st.trackIndex = pos.index;
    st.s = pos.s;
    st.lateral = pos.lateral;
    const edgeL = this.locator.edge(pos.index, 1);
    const edgeR = -this.locator.edge(pos.index, -1);
    // Off the road, the run-off surface reaches out to the barrier line; beyond it is grass.
    const runoffEdge = this.track.center.wallOffset + 1.5;
    const runoff = H[this.track.options.runoff];
    const surfaceAt = (w: number) => (w <= edgeL && w >= edgeR ? H.road : Math.abs(w) <= runoffEdge ? runoff : H.grass);
    const a = surfaceAt(pos.lateral + H.halfTrack);
    const b = surfaceAt(pos.lateral - H.halfTrack);
    // Track limits: both wheel tracks beyond the same edge, with a little grace.
    const grace = 0.25;
    st.offTrack = pos.lateral - H.halfTrack > edgeL + grace || pos.lateral + H.halfTrack < edgeR - grace;
    /** Rough-ground amount (for sound and camera shake), 0 on tarmac. */
    const grass = (a.rough + b.rough) / 2;
    const grip = (a.gripFactor + b.gripFactor) / 2;
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
    let resist = H.rollingDrag + surfDrag + H.aeroDrag * vf * vf;
    if (throttle > 0) {
      if (vf >= -0.5) drive += H.engineAccel * accelF * throttle * Math.max(0, 1 - vf / (H.maxSpeed * speedF));
      else resist += H.brakeDecel * throttle;
    }
    if (brake > 0) {
      if (vf > 0.5) resist += H.brakeDecel * brake;
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
    const latMax = Math.max(H.maxLateralAccel * grip * 0.5, H.maxLateralAccel * grip + bankAssist * H.bankGripFactor);
    let yawTarget = (vf * Math.tan(st.steer)) / H.wheelBase;
    if (inp.handbrake) yawTarget *= H.handbrakeYawBoost;
    const yawLimit = (latMax * H.yawOvershoot * (inp.handbrake ? 1.8 : 1)) / Math.max(Math.abs(vf), 2);
    yawTarget = clamp(yawTarget, -yawLimit, yawLimit);
    st.yawRate += (yawTarget - st.yawRate) * (1 - Math.exp(-H.yawResponse * grip * dt));

    // --- lateral grip: sideways sliding decays, but never faster than the tyres allow
    const gripRate = (inp.handbrake ? H.handbrakeGripRate : H.gripRate) * grip;
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
    this.updateGround();

    st.speed = vf;
    st.slip = Math.abs(vr);
    st.grass = grass;
    st.longAccel = (vf - vf0) / dt;
    st.latAccel = vf * st.yawRate;
    st.spin = (st.spin + (vf / H.wheelRadius) * dt) % (Math.PI * 2);
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
   * push it back, bounce a little off it and scrub some speed.
   */
  private collideWalls(): void {
    const H = HANDLING;
    const st = this.state;
    st.wallHit = 0;
    const pos = this.locator.locate({ x: st.x, y: st.z }, st.trackIndex, 6);
    const side = pos.lateral >= 0 ? 1 : -1;
    const flags = side > 0 ? this.surf.wallL : this.surf.wallR;
    const limit = this.track.center.wallOffset - H.halfWidth;
    const excess = Math.abs(pos.lateral) - limit;
    // Only within a sensible band: a car that is already far outside (through a gap) isn't pulled back.
    if (excess <= 0 || excess > 2.5 || !flags[pos.index]) return;
    const l = leftOf(this.track.center.tangents[pos.index]);
    const nx = l.x * side; // outward normal
    const nz = l.y * side;
    st.x -= nx * excess;
    st.z -= nz * excess;
    const vn = st.vx * nx + st.vz * nz;
    if (vn > 0) {
      st.vx -= nx * vn * (1 + H.wallBounce);
      st.vz -= nz * vn * (1 + H.wallBounce);
      const scrub = Math.max(H.wallMinKeep, 1 - H.wallScrub * vn);
      st.vx *= scrub;
      st.vz *= scrub;
      st.yawRate *= 0.6;
      st.wallHit = vn;
    }
    st.lateral = pos.lateral - side * excess;
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
