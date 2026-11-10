import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CarPhysics } from '../src/car/physics.ts';
import { HANDLING } from '../src/config/handling.ts';
import type { TrackOptions } from '../src/config/track.ts';
import type { Dot } from '../src/core/math.ts';
import { builtInTracks, trackFromCode } from '../src/editor/pipeline.ts';
import { decodeTrack, encodeTrack } from '../src/track/code.ts';
import {
  bumpFor,
  chicaneCorners,
  paintCode,
  paintCorner,
  paintDab,
  paintGrid,
  placedClear,
  placedObstacles,
  placedOn,
  runoffLayout,
  type Placed,
  type TrackExtras,
} from '../src/track/extras.ts';
import { TrackLibrary } from '../src/track/library.ts';
import { buildTrack, contentId, type Track } from '../src/track/track.ts';

/** Stadium: two straights (±`half` m) joined by half circles of radius `gap`; the start straight runs east along y = -gap. */
function stadium(options: Partial<TrackOptions> = {}, extras?: TrackExtras, gap = 120, half = 200): Track {
  const control: Dot[] = [];
  for (let x = -half; x <= half; x += 50) control.push({ x, y: -gap });
  for (let a = 1; a < 12; a++) control.push({ x: half + gap * Math.sin((a / 12) * Math.PI), y: -gap * Math.cos((a / 12) * Math.PI) });
  for (let x = half; x >= -half; x -= 50) control.push({ x, y: gap });
  for (let a = 1; a < 12; a++) control.push({ x: -half - gap * Math.sin((a / 12) * Math.PI), y: gap * Math.cos((a / 12) * Math.PI) });
  return buildTrack({ id: `st-${JSON.stringify(options)}-${JSON.stringify(extras ?? {})}`, name: 's', control, options, ...(extras ? { extras } : {}) });
}

const monza = () => {
  const b = builtInTracks().find((x) => x.def.name === 'Monza');
  assert.ok(b);
  return b.track();
};

test('the run-off paint grid survives its run-length code', () => {
  const g = paintGrid(undefined);
  assert.equal(paintCode(g), undefined, 'nothing painted, nothing stored');
  paintDab(g, 10, 20, 8, 2);
  paintDab(g, -100, 50, 4, 3);
  const code = paintCode(g);
  assert.ok(code && code.length < 80, `short: ${code?.length}`);
  assert.deepEqual([...paintGrid(code)], [...g]);
});

test('placed scenery, bump kerbs and painted run-off survive a track code, the library and change the id', () => {
  const t = stadium();
  const g = paintGrid(undefined);
  paintCorner(g, t, 0, 2);
  const extras: TrackExtras = {
    placed: [
      { kind: 'grandstand', x: 0, y: -150, rot: 0 },
      { kind: 'brakeboards', x: 120, y: -131.5, rot: Math.PI / 32 },
    ],
    paint: paintCode(g),
  };
  const code = encodeTrack('Extras', t.def.control, t.def.options, extras);
  const d = decodeTrack(code);
  assert.ok(d.ok);
  if (!d.ok) return;
  assert.deepEqual(d.extras?.placed, extras.placed);
  assert.deepEqual(d.extras?.paint, extras.paint);
  assert.notEqual(contentId(t.def.control, t.def.options, extras), contentId(t.def.control, t.def.options), 'scenery and run-off are part of the track');
  // Without extras the code is as before (no extra blocks).
  assert.equal(decodeTrack(encodeTrack('E', t.def.control, t.def.options)).ok, true);
  const lib = new TrackLibrary();
  lib.clear();
  lib.save({ id: 'x', name: 'Extras', control: t.def.control, options: t.def.options, extras });
  assert.deepEqual(lib.list()[0].def.extras?.placed, extras.placed);
  lib.clear();
  const res = trackFromCode(code);
  assert.ok(res.ok && res.track.def.extras?.placed?.length === 2);
});

test('placed things must keep off the road; ones the road is moved onto are left out', () => {
  const t = stadium();
  const onRoad: Placed = { kind: 'grandstand', x: 0, y: -120, rot: 0 };
  const clear: Placed = { kind: 'grandstand', x: 0, y: -150, rot: 0 };
  assert.equal(placedClear(t, onRoad), false);
  assert.equal(placedClear(t, clear), true);
  const built = stadium({}, { placed: [onRoad, clear] });
  assert.deepEqual(placedOn(built), [clear]);
  assert.ok(placedObstacles(built).length >= 3, 'a grandstand is a row of obstacles');
});

test('a grandstand stops the car; a bump kerb costs speed and kicks it sideways', () => {
  // A car driving north from the start straight into a grandstand behind the barrier... with no barriers.
  const stand: Placed = { kind: 'grandstand', x: 0, y: -150, rot: 0 };
  const t = stadium({ walls: false }, { placed: [stand] });
  const car = new CarPhysics(t);
  Object.assign(car.state, { x: 0, z: -125, heading: -Math.PI / 2, vx: 0, vz: -10, trackIndex: -1 });
  for (let k = 0; k < HANDLING.tickRate * 3; k++) car.step({ throttle: 1, brake: 0, steer: 0, handbrake: false });
  assert.ok(car.state.z > -150 + 5 + HANDLING.carRadius - 0.6, `stopped at the grandstand: z ${car.state.z.toFixed(1)}`);

  // Two cars down the start straight, one over a bump kerb just off the road edge.
  const run = (bump: boolean) => {
    const b: Placed = { kind: 'bump', x: 0, y: -120 - 7, rot: 0 };
    const track = stadium({}, bump ? { placed: [b] } : undefined);
    assert.equal(placedOn(track).length, bump ? 1 : 0);
    const c = new CarPhysics(track);
    Object.assign(c.state, { x: -60, z: -126.5, heading: 0, vx: 30, vz: 0, trackIndex: -1 });
    let yaw = 0;
    for (let k = 0; k < HANDLING.tickRate * 2.5; k++) {
      c.step({ throttle: 0, brake: 0, steer: 0, handbrake: false });
      yaw = Math.max(yaw, Math.abs(c.state.yawRate));
    }
    return { speed: c.state.speed, yaw };
  };
  const plain = run(false);
  const bumped = run(true);
  assert.ok(bumped.speed < plain.speed - 1, `slower over the bump: ${bumped.speed.toFixed(1)} vs ${plain.speed.toFixed(1)} m/s`);
  assert.ok(bumped.yaw > plain.yaw + 0.2, 'and kicked sideways');
});

test('run-off per corner and painted: gravel there slows the car, the rest keeps the track\'s', () => {
  // (Ends of 40 m radius: tight enough to be numbered corners.)
  const base = stadium({ runoff: 'tarmac' }, undefined, 40);
  assert.ok(base.kerbs.length >= 2);
  const g = paintGrid(undefined);
  paintCorner(g, base, 0, 2); // the first corner: gravel
  const t = stadium({ runoff: 'tarmac' }, { paint: paintCode(g) }, 40);
  const lay = runoffLayout(t);
  const k = t.kerbs[0];
  assert.equal(lay.left[k.apex], 1, 'gravel at the corner');
  assert.equal(lay.right[k.apex], 1);
  const far = (k.apex + Math.floor(t.center.points.length / 2)) % t.center.points.length;
  assert.equal(lay.left[far], 2, 'tarmac elsewhere');
  // A car with a wheel in the run-off at the apex (the kerb counts as road) slows more than one on the far side.
  const side = k.sign > 0 ? 1 : -1;
  const coast = (i: number) => {
    const c = t.center;
    const l = { x: -c.tangents[i].y * side, y: c.tangents[i].x * side };
    const lat = c.width / 2 + 1.6;
    const car = new CarPhysics(t);
    const p = { x: c.points[i].x + l.x * lat, z: c.points[i].y + l.y * lat };
    const h = Math.atan2(c.tangents[i].y, c.tangents[i].x);
    Object.assign(car.state, { ...p, heading: h, vx: 20 * Math.cos(h), vz: 20 * Math.sin(h), trackIndex: -1 });
    for (let s = 0; s < HANDLING.tickRate * 0.5; s++) car.step({ throttle: 0, brake: 0, steer: 0, handbrake: false });
    return car.state.speed;
  };
  assert.ok(coast(k.apex) < coast(far) - 1, `${coast(k.apex).toFixed(1)} vs ${coast(far).toFixed(1)} m/s`);
});

test('bump kerbs go on the inside of chicanes, just past the kerb', () => {
  const t = monza();
  const ch = chicaneCorners(t);
  assert.ok(ch.length >= 4, `Monza has chicanes: ${ch.join(',')}`);
  const spots = ch.map((i) => bumpFor(t, i)).filter((b): b is Placed => !!b);
  assert.ok(spots.length >= 2);
  for (const b of spots) assert.ok(placedClear(t, b), 'off the road, inside the barriers');
});
