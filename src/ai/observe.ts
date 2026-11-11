import type { CarPhysics, CarState, DriveInput } from '../car/physics.ts';
import { CONTACT, SETUP } from '../config/race.ts';
import { HANDLING } from '../config/handling.ts';
import { hashString } from '../core/random.ts';
import { edgeOffsets } from '../track/spline.ts';
import type { Track } from '../track/track.ts';
import { POLICY } from './config.ts';
import type { DrivingIntent } from './intents.ts';

const own = ['speed', 'forward', 'sideways', 'yawRate', 'wheelSteer', 'slip', 'longAccel', 'latAccel', 'headingSin', 'headingCos', 'lateral', 'marginLeft', 'marginRight', 'grass', 'offTrack', 'wetness', 'grip', 'brakeGrip', 'tyreLeft', 'wingDamage', 'bodyDamage', 'gear', 'rpm', 'draft', 'tuneGrip', 'tunePull', 'tuneTop', 'wing', 'previousSteer', 'previousLongitudinal', 'inPits', 'gearSetup', 'brakeBalance', 'roadGrip', 'roadAcceleration'];
const geometry = ['forward', 'left', 'tangentSin', 'tangentCos', 'curvature', 'leftWidth', 'rightWidth', 'bank', 'grade', 'height'];
const neighbour = ['mask', 'forward', 'left', 'relativeForwardSpeed', 'relativeSideSpeed', 'headingSin', 'headingCos', 'relativeProgress', 'player', 'inPits'];
const intent = ['difficulty', 'racing', 'countdown', 'finished', 'yellow', 'safetyCar', 'limited', 'speedLimit', 'pitEnter', 'pitService', 'pitExit', 'pitDistance', 'pitNow', 'pit20', 'pit50'];
export const OBSERVATION_NAMES: readonly string[] = [
  ...own.map((s) => `own.${s}`),
  ...POLICY.lookahead.flatMap((m) => geometry.map((s) => `track.${m}.${s}`)),
  ...Array.from({ length: POLICY.neighbours }, (_, i) => neighbour.map((s) => `car.${i}.${s}`)).flat(),
  ...intent.map((s) => `intent.${s}`),
];
export const OBSERVATION_SIZE = OBSERVATION_NAMES.length;
export const OBSERVATION_HASH = hashString(`raw-geometry-v1|${OBSERVATION_NAMES.join('|')}`).toString(16).padStart(8, '0');

/** Reuses its output and neighbour scratch. Imports raw geometry only, never the classic driving plan. */
export class Observer {
  readonly values = new Float32Array(OBSERVATION_SIZE);
  private readonly track: Track;
  private readonly edges: ReturnType<typeof edgeOffsets>;
  private readonly closest = new Int32Array(POLICY.neighbours);
  private readonly distances = new Float64Array(POLICY.neighbours);
  constructor(track: Track) { this.track = track; this.edges = edgeOffsets(track.center); }

  fill(car: CarPhysics, cars: readonly CarState[], previous: Readonly<DriveInput>, context: DrivingIntent, isPlayer?: ReadonlySet<CarState>): Float32Array {
    const out = this.values, st = car.state, c = this.track.center;
    const n = c.points.length, j = Math.max(0, st.trackIndex), t = c.tangents[j];
    const cos = Math.cos(st.heading), sin = Math.sin(st.heading);
    const headingSin = t.y * cos - t.x * sin, headingCos = t.x * cos + t.y * sin;
    let i = 0;
    out[i++] = st.speed / 60; out[i++] = (st.vx * cos + st.vz * sin) / 60;
    out[i++] = (st.vx * sin - st.vz * cos) / 15; out[i++] = st.yawRate / 3;
    out[i++] = st.steer; out[i++] = st.slip / 15; out[i++] = st.longAccel / 24; out[i++] = st.latAccel / 24;
    out[i++] = headingSin; out[i++] = headingCos; out[i++] = st.lateral / 10;
    out[i++] = (this.edges.left[j] - st.lateral) / 10; out[i++] = (this.edges.right[j] + st.lateral) / 10;
    out[i++] = +st.grass; out[i++] = +st.offTrack; out[i++] = car.wetness;
    out[i++] = car.gripScale * car.damageGrip; out[i++] = car.brakeScale; out[i++] = car.tyreLeft;
    out[i++] = car.wingDamage; out[i++] = car.bodyDamage; out[i++] = st.gear / 6; out[i++] = st.rpm;
    out[i++] = car.draft; out[i++] = car.tune.grip; out[i++] = car.tune.pull; out[i++] = car.tune.top;
    out[i++] = SETUP.wing[car.setup.wing].downforce * 10; out[i++] = previous.steer; out[i++] = previous.throttle - previous.brake; out[i++] = +st.inPits;
    out[i++] = SETUP.gears[car.setup.gears].ratio; out[i++] = SETUP.brakes[car.setup.brakes].turn;
    out[i++] = HANDLING.roads[this.track.options.road].grip; out[i++] = HANDLING.roads[this.track.options.road].accel;
    for (const distance of POLICY.lookahead) {
      const x = ((st.s + distance) % c.length + c.length) % c.length / c.spacing;
      const a = Math.floor(x) % n, b = (a + 1) % n, f = x - Math.floor(x);
      const px = c.points[a].x + (c.points[b].x - c.points[a].x) * f - st.x;
      const pz = c.points[a].y + (c.points[b].y - c.points[a].y) * f - st.z;
      const tx = c.tangents[a].x + (c.tangents[b].x - c.tangents[a].x) * f;
      const tz = c.tangents[a].y + (c.tangents[b].y - c.tangents[a].y) * f;
      out[i++] = (px * cos + pz * sin) / 220; out[i++] = (px * sin - pz * cos) / 50;
      out[i++] = tz * cos - tx * sin; out[i++] = tx * cos + tz * sin;
      out[i++] = (c.curvature[a] + (c.curvature[b] - c.curvature[a]) * f) * 40;
      out[i++] = this.edges.left[a] / 10; out[i++] = this.edges.right[a] / 10;
      out[i++] = c.bank[a] * 2; out[i++] = c.grade[a] * 3; out[i++] = (c.height[a] - st.y) / 20;
    }
    this.closest.fill(-1); this.distances.fill(Infinity);
    for (let k = 0; k < cars.length; k++) {
      const other = cars[k];
      if (other === st || Math.abs(other.y - st.y) > CONTACT.heightGap) continue;
      const dx = other.x - st.x, dz = other.z - st.z, d = dx * dx + dz * dz;
      if (d > POLICY.neighbourRange ** 2) continue;
      for (let slot = 0; slot < POLICY.neighbours; slot++) if (d < this.distances[slot]) {
        for (let v = POLICY.neighbours - 1; v > slot; v--) { this.closest[v] = this.closest[v - 1]; this.distances[v] = this.distances[v - 1]; }
        this.closest[slot] = k; this.distances[slot] = d; break;
      }
    }
    for (let slot = 0; slot < POLICY.neighbours; slot++) {
      const index = this.closest[slot];
      if (index < 0) { out.fill(0, i, i + neighbour.length); i += neighbour.length; continue; }
      const other = cars[index], dx = other.x - st.x, dz = other.z - st.z;
      const dvx = other.vx - st.vx, dvz = other.vz - st.vz;
      let ds = ((other.s - st.s) % c.length + c.length) % c.length;
      if (ds > c.length / 2) ds -= c.length;
      out[i++] = 1; out[i++] = (dx * cos + dz * sin) / 100; out[i++] = (dx * sin - dz * cos) / 20;
      out[i++] = (dvx * cos + dvz * sin) / 60; out[i++] = (dvx * sin - dvz * cos) / 20;
      out[i++] = Math.sin(other.heading - st.heading); out[i++] = Math.cos(other.heading - st.heading);
      out[i++] = ds / 100; out[i++] = isPlayer?.has(other) ? 1 : 0; out[i++] = +other.inPits;
    }
    out[i++] = context.difficulty; out[i++] = +context.racing; out[i++] = +context.countdown; out[i++] = +context.finished;
    out[i++] = +context.yellow; out[i++] = +context.safetyCar; out[i++] = +Number.isFinite(context.speedLimit);
    out[i++] = Number.isFinite(context.speedLimit) ? context.speedLimit / 60 : 1.5;
    out[i++] = +(context.pit === 'enter'); out[i++] = +(context.pit === 'service'); out[i++] = +(context.pit === 'exit');
    const pitting = context.pit !== 'none';
    out[i++] = pitting ? context.pitDistance / 220 : 0; out[i++] = pitting ? context.pitLateralNow / 15 : 0;
    out[i++] = pitting ? context.pitLateral20 / 15 : 0; out[i++] = pitting ? context.pitLateral50 / 15 : 0;
    if (i !== OBSERVATION_SIZE) throw new Error('Observation layout mismatch');
    for (let k = 0; k < out.length; k++) out[k] = Number.isFinite(out[k]) ? Math.max(-5, Math.min(5, out[k])) : 0;
    return out;
  }
}
