import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { Window } from 'happy-dom';
import { CarPhysics, tyreGripAt, type DriveInput } from '../src/car/physics.ts';
import { HANDLING } from '../src/config/handling.ts';
import { CONDITIONS } from '../src/config/race.ts';
import { getSampleTrack } from '../src/editor/pipeline.ts';
import { AiDriver, aiPace } from '../src/race/ai.ts';
import { RacingDriver } from '../src/race/driver.ts';
import { AuthorLap } from '../src/race/medals.ts';
import { inBox, PitCrew, pitBox } from '../src/race/pitStop.ts';
import type { Progress, RaceEvent } from '../src/race/session.ts';
import { edgeOffsets } from '../src/track/spline.ts';
import type { Track } from '../src/track/track.ts';
import { conditionsSummary, timeFor } from '../src/ui/conditionsPanel.ts';

const DT = 1 / HANDLING.tickRate;

test('tyres lose grip steadily, then much faster once worn out, and never below the floor', () => {
  const C = CONDITIONS;
  assert.equal(tyreGripAt(0), 1);
  const perLap = tyreGripAt(1) - tyreGripAt(2);
  assert.ok(Math.abs(perLap - C.wearPerLap) < 1e-9);
  const before = tyreGripAt(C.cliffLaps - 1) - tyreGripAt(C.cliffLaps);
  const afterCliff = tyreGripAt(C.cliffLaps) - tyreGripAt(C.cliffLaps + 1);
  assert.ok(afterCliff > before * 2, `past ${C.cliffLaps} laps they fall away (${before.toFixed(3)} → ${afterCliff.toFixed(3)} a lap)`);
  assert.equal(tyreGripAt(50), C.minGrip);
  // Off, they never wear.
  const car = new CarPhysics(getSampleTrack(0));
  car.tyreAge = 6;
  assert.equal(car.tyreGrip, 1, 'tyre wear off: as new');
  car.wear = true;
  assert.equal(car.tyreGrip, tyreGripAt(6));
  car.newTyres();
  assert.equal(car.tyreGrip, 1);
});

/** Drives `driver` round `track` for one lap from a standing start: the car, the ticks it took and the ticks it spent past the track limits. */
function oneLap(track: Track, driver: RacingDriver, setup: (car: CarPhysics) => void, opts: () => { grip?: number } = () => ({})): { car: CarPhysics; ticks: number; off: number } {
  const car = new CarPhysics(track);
  setup(car);
  const L = track.center.length;
  let travelled = 0;
  let prev = car.state.s;
  let off = 0;
  for (let tick = 0; tick < 200 * HANDLING.tickRate; tick++) {
    car.step(driver.drive(car.state, 0, undefined, opts()));
    if (car.state.offTrack) off++;
    let ds = car.state.s - prev;
    if (ds < -L / 2) ds += L;
    if (ds > L / 2) ds -= L;
    travelled += ds;
    prev = car.state.s;
    if (travelled >= L) return { car, ticks: tick, off };
  }
  throw new Error('no lap');
}

test('a lap at racing speed is about a lap of wear; sliding wears them faster', () => {
  const t = getSampleTrack(0);
  const { car } = oneLap(t, new RacingDriver(t, aiPace(0.75, t)), (c) => (c.wear = true));
  assert.ok(car.tyreAge > 0.95 && car.tyreAge < 1.3, `one lap: ${car.tyreAge.toFixed(2)} laps of wear`);
  // Sideways at 5 m/s: wear runs faster than distance alone.
  const slide = new CarPhysics(t);
  slide.wear = true;
  slide.placeAt(100);
  const st = slide.state;
  const h = st.heading + 0.6;
  st.vx = Math.cos(h) * 20;
  st.vz = Math.sin(h) * 20;
  slide.step({ throttle: 0, brake: 0, steer: 0, handbrake: false });
  const perMetre = slide.tyreAge / (Math.abs(st.speed) * DT / t.center.length);
  assert.ok(perMetre > 1.5, `sliding: ×${perMetre.toFixed(2)}`);
});

test('in the rain the car brakes later and grips less: the same AI lap is a few % slower, and still clean', () => {
  const t = getSampleTrack(0);
  const dry = new AuthorLap(t, 0.75).finish();
  const wet = new AuthorLap(t, 0.75, false, true).finish();
  assert.ok(dry !== null && wet !== null, 'both laps finish');
  const r = wet / dry;
  assert.ok(r > 1.03 && r < 1.15, `wet lap ${r.toFixed(3)}× the dry one`);
  // Braking from 40 m/s: longer on a wet road, by about the brakes lost.
  const stop = (wetRoad: boolean) => {
    const car = new CarPhysics(t);
    car.wet = wetRoad;
    car.placeAt(200);
    const st = car.state;
    st.vx = Math.cos(st.heading) * 40;
    st.vz = Math.sin(st.heading) * 40;
    st.speed = 40;
    let dist = 0;
    const brake: DriveInput = { throttle: 0, brake: 1, steer: 0, handbrake: false };
    for (let i = 0; i < 2000 && car.state.speed > 0.6; i++) {
      car.step(brake);
      dist += car.state.speed * DT;
    }
    return dist;
  };
  const ratio = stop(true) / stop(false);
  assert.ok(ratio > 1.12 && ratio < 1 / CONDITIONS.rainBrake + 0.05, `wet stopping distance ${ratio.toFixed(2)}×`);
});

test('on worn tyres the AI takes the bends slower and stays on the road, even flat out', () => {
  for (let k = 0; k < 3; k++) {
    const t = getSampleTrack(k);
    const d = new RacingDriver(t, aiPace(1, t));
    const fresh = oneLap(t, d, (c) => (c.wear = true));
    const age = 7;
    const worn = oneLap(
      t,
      d,
      (c) => {
        c.wear = true;
        c.tyreAge = age;
      },
      () => ({ grip: tyreGripAt(age) }),
    );
    assert.ok(worn.ticks > fresh.ticks * 1.03, `${t.def.name}: worn tyres ${(worn.ticks / fresh.ticks).toFixed(3)}× the lap`);
    assert.equal(worn.off, 0, `${t.def.name}: within the track limits all the way`);
  }
});

test('the pit box: at the road’s edge on the start straight, clear of the start line and the grid', () => {
  for (let k = 0; k < 3; k++) {
    const t = getSampleTrack(k);
    const box = pitBox(t);
    const c = t.center;
    assert.ok(box.s > box.length / 2 + 5 && box.s < c.length / 2, `${t.def.name}: past the line (${box.s.toFixed(1)} m)`);
    const i = Math.round(box.s / c.spacing) % c.points.length;
    const { left, right } = edgeOffsets(c);
    const edge = box.side > 0 ? left[i] : right[i];
    const outer = Math.abs(box.lateral) + box.width / 2;
    assert.ok(outer <= edge && outer > edge - 1, `${t.def.name}: against the edge (${outer.toFixed(2)} of ${edge.toFixed(2)} m)`);
    assert.equal(Math.sign(box.lateral), box.side);
    // A car parked in the middle of it is in it; one on the centre line isn't.
    const car = new CarPhysics(t);
    car.placeAt(box.s, box.lateral);
    assert.equal(inBox(box, c.length, car.state), true);
    car.placeAt(box.s, 0);
    assert.equal(inBox(box, c.length, car.state), false);
  }
});

test('a pit stop: stop in the box and the crew fits new tyres in the service time; driving through or starting in it does nothing', () => {
  const t = getSampleTrack(0);
  const box = pitBox(t);
  const L = t.center.length;
  const car = new CarPhysics(t);
  car.wear = true;
  const crew = new PitCrew(t);
  // Starting in the box (a grid slot there): no stop until the car has left it.
  car.placeAt(box.s, box.lateral);
  crew.reset(car.state);
  assert.equal(crew.step(car, DT), null);
  assert.equal(crew.busy, false);
  // Driving through it at speed: nothing.
  car.placeAt(box.s - 30, box.lateral);
  crew.reset(car.state);
  const st = car.state;
  st.vx = Math.cos(st.heading) * 15;
  st.vz = Math.sin(st.heading) * 15;
  for (let i = 0; i < 4 * HANDLING.tickRate; i++) {
    car.step({ throttle: 0.3, brake: 0, steer: 0, handbrake: false });
    assert.equal(crew.step(car, DT), null);
  }
  assert.ok(st.s > box.s + box.length / 2 || st.s < box.s - L / 2, 'it drove through');
  // Stopped in it on worn tyres: the stop.
  car.tyreAge = 5;
  car.placeAt(box.s - 30, box.lateral);
  crew.reset(car.state);
  car.placeAt(box.s, box.lateral);
  assert.equal(crew.step(car, DT), 'start');
  assert.equal(crew.busy, true);
  let ticks = 0;
  let ev = null;
  while ((ev = crew.step(car, DT)) === null && ticks < 10 * HANDLING.tickRate) ticks++;
  assert.equal(ev, 'done');
  assert.ok(Math.abs((ticks + 1) * DT - CONDITIONS.service) < 2 * DT, `service ${((ticks + 1) * DT).toFixed(2)} s`);
  assert.equal(car.tyreGrip, 1, 'new tyres');
  assert.equal(crew.stops, 1);
  // Still standing there: no second stop.
  for (let i = 0; i < HANDLING.tickRate; i++) assert.equal(crew.step(car, DT), null);
});

const progressOf = (car: CarPhysics, track: Track): Progress => {
  const st = car.state;
  const tg = track.center.tangents[Math.max(0, st.trackIndex)];
  return { s: st.s, lateral: st.lateral, along: st.vx * tg.x + st.vz * tg.y, offTrack: st.offTrack };
};

/** An AI alone in a race of `laps` laps with tyre wear: its laps and stops. */
function soloRace(track: Track, laps: number, wet = false) {
  const ai = new AiDriver(track, { name: 'a', paint: 0, difficulty: 0.75, laps, slot: 1, wet, tyreWear: true });
  const events: RaceEvent[] = [];
  const grips: number[] = [];
  for (let tick = 0; tick < (laps * 80 + 30) * HANDLING.tickRate && ai.session.phase !== 'finished'; tick++) {
    const prev = progressOf(ai.car, track);
    ai.car.step(ai.drive([ai.car.state], DT));
    events.length = 0;
    ai.session.step(prev, progressOf(ai.car, track), events);
    for (const e of events) if (e.type === 'lap') grips.push(ai.car.tyreGrip);
  }
  return { ai, laps: [...ai.session.laps], grips };
}

test('with tyre wear the AI stops for new tyres in a long race (and is quicker after it), but not in a short one', () => {
  const t = getSampleTrack(0);
  const long = soloRace(t, 7);
  assert.equal(long.ai.session.phase, 'finished');
  assert.equal(long.ai.crew?.stops, 1, `stops: ${long.ai.crew?.stops}`);
  // The lap after the stop lap is quicker than the last lap before it.
  const stopLap = long.grips.findIndex((g, i) => i > 0 && g > long.grips[i - 1]);
  assert.ok(stopLap > 1, `a fresh set after lap ${stopLap + 1} (${long.grips.map((g) => g.toFixed(2)).join(' ')})`);
  assert.ok(long.laps[stopLap + 1] < long.laps[stopLap - 1], `${long.laps.map((x) => x.toFixed(2)).join(' ')}`);
  const short = soloRace(t, 3);
  assert.equal(short.ai.session.phase, 'finished');
  assert.equal(short.ai.crew?.stops, 0, 'tyres last a short race');
});

test('race setup conditions: the summary line and the time of day (the track’s own unless chosen)', () => {
  assert.equal(timeFor({ time: 'track' }, 'sunset'), 'sunset');
  assert.equal(timeFor({ time: 'night' }, 'sunset'), 'night');
  assert.equal(conditionsSummary({ weather: 'dry', time: 'track', tyreWear: false }, 'day'), 'Dry · day · no tyre wear');
  assert.equal(conditionsSummary({ weather: 'rain', time: 'night', tyreWear: true }, 'day'), 'Rain · night · tyre wear & pit stops');
});

test('the conditions panel: each choice changes the setup and shows on its buttons; Done closes it', async () => {
  const win = new Window({ url: 'https://conditions.test/' });
  const keys = ['window', 'document', 'HTMLElement', 'HTMLButtonElement'] as const;
  const before = keys.map((k) => Object.getOwnPropertyDescriptor(globalThis, k));
  for (const k of keys) Object.defineProperty(globalThis, k, { configurable: true, value: k === 'window' ? win : Reflect.get(win, k) });
  after(() => {
    keys.forEach((k, i) => {
      const d = before[i];
      if (d) Object.defineProperty(globalThis, k, d);
      else delete (globalThis as Record<string, unknown>)[k];
    });
    win.happyDOM.abort();
  });
  const { ConditionsPanel } = await import('../src/ui/conditionsPanel.ts');
  const host = win.document.createElement('div');
  win.document.body.append(host);
  const draft = { weather: 'dry' as const, time: 'track' as const, tyreWear: false } as { weather: 'dry' | 'rain'; time: 'track' | 'day' | 'sunset' | 'night'; tyreWear: boolean };
  let closed = false;
  const panel = new ConditionsPanel();
  panel.open(host as unknown as HTMLElement, { get: () => draft, change: (p) => Object.assign(draft, p), trackTime: 'sunset', onClose: () => (closed = true) });
  const btn = (field: string, label: string) => {
    const f = [...host.querySelectorAll('.field')].find((e) => e.textContent?.includes(field));
    return [...(f?.querySelectorAll('button') ?? [])].find((b) => b.textContent?.includes(label)) as unknown as HTMLButtonElement;
  };
  assert.match(host.textContent ?? '', /track’s own is sunset/);
  btn('Weather', 'Rain').click();
  btn('Time of day', 'Night').click();
  btn('Tyre wear', 'On').click();
  assert.deepEqual(draft, { weather: 'rain', time: 'night', tyreWear: true });
  assert.equal(btn('Weather', 'Rain').getAttribute('aria-pressed'), 'true');
  assert.equal(btn('Weather', 'Dry').getAttribute('aria-pressed'), 'false');
  assert.equal(btn('Time of day', 'Night').getAttribute('aria-pressed'), 'true');
  const done = [...host.querySelectorAll('button')].find((b) => b.textContent?.includes('Done')) as unknown as HTMLButtonElement;
  done.click();
  assert.equal(panel.isOpen, false);
  assert.equal(closed, true);
});
