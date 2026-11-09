import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { Window } from 'happy-dom';
import { CarPhysics, type DriveInput } from '../src/car/physics.ts';
import { compoundBrake, compoundGrip, compoundLife, standardGrip, tyreCurve } from '../src/car/tyres.ts';
import { HANDLING } from '../src/config/handling.ts';
import { CONDITIONS, TYRES, type Compound } from '../src/config/race.ts';
import { builtInTracks, getSampleTrack } from '../src/editor/pipeline.ts';
import { AiDriver, aiPace } from '../src/race/ai.ts';
import { RacingDriver } from '../src/race/driver.ts';
import { AuthorLap } from '../src/race/medals.ts';
import { inBox, PitCrew, pitBox } from '../src/race/pitStop.ts';
import { pickCompound, trackTyreLife } from '../src/race/strategy.ts';
import type { Progress } from '../src/race/session.ts';
import { edgeOffsets } from '../src/track/spline.ts';
import type { Track } from '../src/track/track.ts';
import { conditionsSummary, timeFor, type Conditions } from '../src/ui/conditionsPanel.ts';

const DT = 1 / HANDLING.tickRate;

test('tyres fade steadily, then go off: heavily slower, never blown up', () => {
  const T = TYRES;
  assert.equal(tyreCurve(0), 1);
  assert.ok(Math.abs(tyreCurve(1) - (1 - T.fadeLoss)) < 1e-9, 'a steady fade over their life');
  assert.ok(tyreCurve(0.5) > tyreCurve(1) && tyreCurve(1) > tyreCurve(1 + T.cliff / 2));
  assert.ok(Math.abs(tyreCurve(1 + T.cliff) - T.deadGrip) < 1e-9, 'then off the cliff');
  assert.equal(tyreCurve(50), T.deadGrip, 'and no further');
  // Off, they never wear, and every car is on a standard set.
  const car = new CarPhysics(getSampleTrack(0));
  car.tyreUse = 99;
  assert.equal(car.gripScale, 1, 'tyre wear off: as new');
  assert.equal(car.tyreLeft, 1);
  car.wet = true;
  assert.equal(car.gripScale, CONDITIONS.rainGrip);
  assert.equal(car.brakeScale, CONDITIONS.rainBrake);
  car.wet = false;
  car.wear = true;
  car.mediumLife = 5;
  car.newTyres('medium');
  assert.equal(car.tyreLife, 5);
  car.tyreUse = 0.5;
  assert.equal(car.tyreLeft, 0.5);
  car.tyreUse = 1.4;
  assert.equal(car.tyreLeft, 0);
  assert.equal(car.gripScale, T.deadGrip);
  car.newTyres();
  assert.equal(car.gripScale, 1);
});

test('the kinds of tyre: softs grip more and go off soonest, hards the other way, wets for the rain', () => {
  const life = (c: Compound, wet = false) => compoundLife(c, wet ? 1 : 0, 5);
  assert.ok(compoundGrip('soft', 0) > compoundGrip('medium', 0) && compoundGrip('medium', 0) > compoundGrip('hard', 0));
  assert.ok(life('soft') < life('medium') && life('medium') < life('hard'));
  assert.equal(compoundGrip('medium', 1), CONDITIONS.rainGrip, 'mediums in the rain are the standard set');
  for (const c of ['soft', 'medium', 'hard'] as const) {
    assert.ok(compoundGrip('wet', 1) > compoundGrip(c, 1), `in the rain wets beat ${c}s`);
    assert.ok(compoundGrip('wet', 0) < compoundGrip(c, 0), `in the dry ${c}s beat wets`);
    assert.ok(compoundBrake('wet', 1) > compoundBrake(c, 1));
  }
  assert.ok(life('wet', false) < life('soft'), 'wets wear out fast in the dry');
  assert.ok(life('wet', true) > life('medium', true), 'and last in the rain');
});

test('medium tyres last 4 to 6 laps, depending on how hard the track works them', () => {
  const lives = new Map(builtInTracks().map((b) => [b.def.name, trackTyreLife(b.track())] as const));
  for (const [name, life] of lives) assert.ok(life >= TYRES.lifeHard && life <= TYRES.lifeEasy, `${name}: ${life.toFixed(2)} laps`);
  const at = (n: string) => lives.get(n) ?? NaN;
  assert.ok(at('Monza') > 5.8, `Monza (fast, few bends) is easy on them: ${at('Monza').toFixed(2)}`);
  assert.ok(at('Sakhir') > 4.2 && at('Sakhir') < 5, `Sakhir: ${at('Sakhir').toFixed(2)}`);
  assert.ok(at('Shanghai') < 4.5, `Shanghai is hard on them: ${at('Shanghai').toFixed(2)}`);
});

/** Drives `driver` round `track` for one lap from a standing start: the car, the ticks it took and the ticks it spent past the track limits. */
function oneLap(track: Track, driver: RacingDriver, setup: (car: CarPhysics) => void, opts: (car: CarPhysics) => { grip?: number } = () => ({})): { car: CarPhysics; ticks: number; off: number } {
  const car = new CarPhysics(track);
  setup(car);
  const L = track.center.length;
  let travelled = 0;
  let prev = car.state.s;
  let off = 0;
  for (let tick = 0; tick < 200 * HANDLING.tickRate; tick++) {
    car.step(driver.drive(car.state, 0, undefined, opts(car)));
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
  const worn = car.tyreUse * car.tyreLife;
  assert.ok(Math.abs(car.tyreAge - 1) < 0.05, `one lap on them: ${car.tyreAge.toFixed(2)}`);
  assert.ok(worn > 0.95 && worn < 1.3, `one lap: ${worn.toFixed(2)} laps of their life used`);
  // Sideways at 5 m/s: wear runs faster than distance alone.
  const slide = new CarPhysics(t);
  slide.wear = true;
  slide.placeAt(100);
  const st = slide.state;
  const h = st.heading + 0.6;
  st.vx = Math.cos(h) * 20;
  st.vz = Math.sin(h) * 20;
  slide.step({ throttle: 0, brake: 0, steer: 0, handbrake: false });
  const perMetre = (slide.tyreUse * slide.tyreLife) / (Math.abs(st.speed) * DT / t.center.length);
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

test('the AI on tyres that have gone off is heavily slower and stays on the road; on softs it is quicker', () => {
  for (let k = 0; k < 3; k++) {
    const t = getSampleTrack(k);
    const d = new RacingDriver(t, aiPace(1, t));
    const on = (c: Compound, age: number) =>
      oneLap(
        t,
        d,
        (car) => {
          car.wear = true;
          car.mediumLife = trackTyreLife(t);
          car.newTyres(c);
          car.tyreUse = age;
        },
        (car) => {
          car.tyreUse = age; // (held: the whole lap on tyres this worn)
          return { grip: car.gripScale / standardGrip(0) };
        },
      );
    const fresh = on('medium', 0);
    const dead = on('medium', 99);
    const soft = on('soft', 0);
    assert.ok(dead.ticks > fresh.ticks * 1.1, `${t.def.name}: gone off, ${(dead.ticks / fresh.ticks).toFixed(3)}× the lap`);
    assert.ok(soft.ticks < fresh.ticks, `${t.def.name}: softs ${(soft.ticks / fresh.ticks).toFixed(4)}× the lap`);
    for (const [what, lap] of [['gone off', dead], ['softs', soft]] as const) assert.equal(lap.off, 0, `${t.def.name}: ${what}, within the track limits all the way`);
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

test('a pit stop: stop in the box and the crew fits the tyres asked for in the service time; driving through or starting in it does nothing', () => {
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
  car.tyreUse = 1.2;
  car.placeAt(box.s - 30, box.lateral);
  crew.reset(car.state);
  car.placeAt(box.s, box.lateral);
  assert.equal(crew.step(car, DT), 'start');
  assert.equal(crew.busy, true);
  let ticks = 0;
  let ev = null;
  while ((ev = crew.step(car, DT, 'soft')) === null && ticks < 10 * HANDLING.tickRate) ticks++;
  assert.equal(ev, 'done');
  assert.ok(Math.abs((ticks + 1) * DT - CONDITIONS.service) < 2 * DT, `service ${((ticks + 1) * DT).toFixed(2)} s`);
  assert.equal(car.tyreLeft, 1, 'new tyres');
  assert.equal(car.compound, 'soft', 'of the kind asked for');
  assert.equal(crew.stops, 1);
  // Still standing there: no second stop.
  for (let i = 0; i < HANDLING.tickRate; i++) assert.equal(crew.step(car, DT), null);
});

const progressOf = (car: CarPhysics, track: Track): Progress => {
  const st = car.state;
  const tg = track.center.tangents[Math.max(0, st.trackIndex)];
  return { s: st.s, lateral: st.lateral, along: st.vx * tg.x + st.vz * tg.y, offTrack: st.offTrack };
};

/** An AI alone in a race of `laps` laps with tyre wear: the tyres it was on, and how long it drove on tyres that had gone off. */
function soloRace(track: Track, laps: number, wet = false) {
  const ai = new AiDriver(track, { name: 'a', paint: 0, difficulty: 0.75, laps, slot: 0, wet, tyreWear: true });
  const compounds: Compound[] = [ai.car.compound];
  let late = 0;
  let minLeft = 1;
  const L = track.center.length;
  for (let tick = 0; tick < (laps * 80 + 30) * HANDLING.tickRate && ai.session.phase !== 'finished'; tick++) {
    const prev = progressOf(ai.car, track);
    const before = ai.car.tyreAge;
    ai.car.step(ai.drive([ai.car.state], DT));
    if (ai.car.tyreAge < before) compounds.push(ai.car.compound);
    else if (ai.car.tyreLeft <= 0 && ai.session.phase === 'racing') late += Math.abs(ai.car.state.speed) * DT;
    minLeft = Math.min(minLeft, ai.car.tyreLeft);
    ai.session.step(prev, progressOf(ai.car, track), []);
  }
  return { ai, compounds, lateLaps: late / L, minLeft };
}

test('AI strategy: the quickest tyres that last the race, else a stop before they go off, choosing for the laps left', () => {
  // Mediums last 5 laps here: softs 3.25, hards 8.
  assert.equal(pickCompound(3, 5, 0, 'medium'), 'soft');
  assert.equal(pickCompound(5, 5, 0, 'soft'), 'medium');
  assert.equal(pickCompound(8, 5, 0, 'soft'), 'hard');
  assert.equal(pickCompound(20, 5, 0, 'soft'), 'soft', 'there will be stops anyway: its own choice');
  assert.equal(pickCompound(20, 5, 1, 'soft'), 'wet', 'wets in the rain');
  // A short race on a track: no stop (the tyres they start on last it).
  const t = getSampleTrack(2);
  const short = soloRace(t, 3);
  assert.equal(short.ai.session.phase, 'finished');
  assert.equal(short.ai.crew?.stops, 0, 'tyres that last a short race');
  assert.equal(short.compounds[0], 'soft', 'softs for 3 laps');
  // A long one: a stop before they go off (never more than a moment past it), and new tyres for the rest.
  const long = soloRace(t, 12);
  assert.equal(long.ai.session.phase, 'finished');
  assert.equal(long.ai.crew?.stops, 1, `stops: ${long.ai.crew?.stops} (${long.compounds.join(' ')})`);
  assert.ok(long.minLeft > -1e-9 && long.lateLaps < 0.35, `ran ${long.lateLaps.toFixed(2)} laps on tyres that had gone off`);
  assert.equal(long.compounds[long.compounds.length - 1], 'hard', `${long.compounds.join(' ')}: hards to the finish`);
});

test('race setup conditions: the summary line and the time of day (the track’s own unless chosen)', () => {
  assert.equal(timeFor({ time: 'track' }, 'sunset'), 'sunset');
  assert.equal(timeFor({ time: 'night' }, 'sunset'), 'night');
  const off = { damage: false, safetyCar: false };
  assert.equal(conditionsSummary({ weather: 'dry', time: 'track', tyreWear: false, tyres: 'soft', ...off }, 'day'), 'Dry · day · no tyre wear');
  assert.equal(conditionsSummary({ weather: 'rain', time: 'night', tyreWear: true, tyres: 'wet', ...off }, 'day'), 'Rain · night · tyre wear, wet tyres');
  assert.equal(conditionsSummary({ weather: 'dry', time: 'day', tyreWear: false, tyres: 'soft', damage: true, safetyCar: true }, 'day'), 'Dry · day · no tyre wear · damage · safety car');
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
  const draft: Conditions = { weather: 'dry', time: 'track', tyreWear: false, tyres: 'soft', damage: false, safetyCar: false };
  let closed = false;
  const panel = new ConditionsPanel();
  panel.open(host as unknown as HTMLElement, { get: () => draft, change: (p) => Object.assign(draft, p), trackTime: 'sunset', mediumLife: 5, onClose: () => (closed = true) });
  const startField = () => [...host.querySelectorAll('.field')].find((e) => e.textContent?.includes('Starting tyres')) as unknown as HTMLElement;
  const btn = (field: string, label: string) => {
    const f = [...host.querySelectorAll('.field')].find((e) => e.textContent?.includes(field));
    return [...(f?.querySelectorAll('button') ?? [])].find((b) => b.textContent?.includes(label)) as unknown as HTMLButtonElement;
  };
  assert.match(host.textContent ?? '', /track’s own is sunset/);
  assert.equal(startField().hidden, true, 'no tyre choice with tyre wear off');
  btn('Weather', 'Rain').click();
  btn('Time of day', 'Night').click();
  btn('Tyre wear', 'On').click();
  assert.deepEqual(draft, { weather: 'rain', time: 'night', tyreWear: true, tyres: 'wet', damage: false, safetyCar: false }, 'rain puts wets on');
  btn('Damage', 'On').click();
  btn('Safety car', 'On').click();
  assert.equal(draft.damage, true);
  assert.equal(draft.safetyCar, true);
  assert.equal(btn('Safety car', 'On').getAttribute('aria-pressed'), 'true');
  btn('Damage', 'Off').click();
  assert.equal(draft.damage, false);
  assert.equal(startField().hidden, false);
  assert.match(startField().textContent ?? '', /\(rain\): Soft ≈ 3\.3 · Medium ≈ 5\.0 · Hard ≈ 8\.0 · Wet ≈ 6\.5/);
  btn('Starting tyres', 'Hard').click();
  assert.equal(draft.tyres, 'hard');
  assert.equal(btn('Starting tyres', 'Hard').getAttribute('aria-pressed'), 'true');
  btn('Weather', 'Dry').click();
  assert.equal(draft.tyres, 'hard', 'slicks stay on in the dry');
  btn('Weather', 'Rain').click();
  btn('Weather', 'Dry').click();
  assert.equal(draft.tyres, 'medium', 'wets come off in the dry');
  assert.equal(btn('Weather', 'Dry').getAttribute('aria-pressed'), 'true');
  assert.equal(btn('Weather', 'Rain').getAttribute('aria-pressed'), 'false');
  assert.equal(btn('Time of day', 'Night').getAttribute('aria-pressed'), 'true');
  const done = [...host.querySelectorAll('button')].find((b) => b.textContent?.includes('Done')) as unknown as HTMLButtonElement;
  done.click();
  assert.equal(panel.isOpen, false);
  assert.equal(closed, true);
});
