import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Window } from 'happy-dom';
import { RESOLUTION } from '../src/config/handling.ts';
import { getSampleTrack } from '../src/editor/pipeline.ts';
import { RacingDriver, type LaneSlot } from '../src/race/driver.ts';
import { aiPace } from '../src/race/ai.ts';
import { ResolutionGovernor } from '../src/render/resolution.ts';

/** Feeds the governor `seconds` of frames `dt` s apart, the game busy for `cpu` s of each; returns how often the scale changed. */
function run(g: ResolutionGovernor, seconds: number, dt: number, cpu: number): number {
  let changes = 0;
  for (let t = 0; t < seconds; t += dt) if (g.frame(dt, cpu)) changes++;
  return changes;
}

test('automatic resolution: slow frames the graphics card is to blame for step it down, one step at a time; easy frames bring it back up', () => {
  const g = new ResolutionGovernor();
  // 60 fps with plenty to spare: nothing changes.
  assert.equal(run(g, 20, 1 / 60, 0.004), 0);
  assert.equal(g.scale, 1);
  // 30 fps while the game itself needs only 5 ms a frame: the GPU can't keep up. Down a step
  // after about 1.5 s, and no further for a few seconds (each change reallocates the canvas).
  run(g, 1.4, 1 / 30, 0.005);
  assert.equal(g.scale, 1, 'not on a moment of slowness');
  run(g, 0.4, 1 / 30, 0.005);
  assert.equal(g.scale, RESOLUTION.steps[1]);
  run(g, 2, 1 / 30, 0.005);
  assert.equal(g.scale, RESOLUTION.steps[1], 'at most one change per few seconds');
  // Still slow: on down, but never past the last step.
  run(g, 60, 1 / 30, 0.005);
  assert.equal(g.scale, RESOLUTION.steps.at(-1));
  // Frames come easily again: back up a step at a time, slowly (about 8 s a step).
  run(g, 7, 1 / 60, 0.004);
  assert.equal(g.scale, RESOLUTION.steps.at(-1), 'it waits to be sure');
  run(g, 2, 1 / 60, 0.004);
  assert.equal(g.scale, RESOLUTION.steps.at(-2));
  run(g, 120, 1 / 60, 0.004);
  assert.equal(g.scale, 1);
});

test('automatic resolution leaves it alone when the game itself is the slow part, at 48-50 Hz, and over stalls', () => {
  const g = new ResolutionGovernor();
  // 30 fps because the game's own work takes 28 ms a frame: fewer pixels wouldn't help.
  assert.equal(run(g, 30, 1 / 30, 0.028), 0);
  // A 50 Hz or 48 Hz screen is smooth, not slow.
  assert.equal(run(g, 30, 1 / 50, 0.004), 0);
  assert.equal(run(g, 30, 1 / 48, 0.004), 0);
  // Tab switches and ads (long gaps between frames) are no measure of anything.
  assert.equal(run(g, 30, 0.5, 0.001), 0);
  assert.equal(g.scale, 1);
  // A reset puts it back to full resolution.
  run(g, 10, 1 / 25, 0.004);
  assert.ok(g.scale < 1);
  g.reset();
  assert.equal(g.scale, 1);
});

test('a lane looked up once and read at many points gives exactly what laneSpeedAt gives', () => {
  const t = getSampleTrack(1);
  const d = new RacingDriver(t, aiPace(0.9, t));
  const slot: LaneSlot = { a: new Float32Array(0), b: null, u: 0 };
  for (const lane of [-9, -6, -5.2, -3, -1.5, -0.3, 0, 0.29, 0.31, 1.5, 2.25, 4.5, 6, 7.5]) {
    d.laneSpeedSlot(lane, slot);
    for (let s = -50; s < t.center.length + 50; s += 7.3) assert.equal(d.laneSpeedFrom(slot, s), d.laneSpeedAt(s, lane), `lane ${lane} at ${s}`);
  }
});

test('the timing tower updates its rows in place: the same elements, only what changed', async (t) => {
  const win = new Window();
  const keys = ['document', 'window', 'HTMLElement'] as const;
  const saved = keys.map((k) => [k, Object.getOwnPropertyDescriptor(globalThis, k)] as const);
  t.after(() => {
    for (const [k, d] of saved) d ? Object.defineProperty(globalThis, k, d) : Reflect.deleteProperty(globalThis, k);
    void win.happyDOM.close();
  });
  for (const k of keys) Object.defineProperty(globalThis, k, { value: k === 'window' ? win : Reflect.get(win, k), configurable: true });
  const { TimingTower } = await import('../src/ui/timingTower.ts');
  const tower = new TimingTower();
  const row = (pos: number, name: string, extra: Partial<Parameters<typeof tower.update>[0][number]> = {}) => ({ pos, name, paint: 0x2f6fd6, you: false, gap: `+${pos}.0`, tyre: null, tyreAge: 0, tyreLeft: 1, stops: 0, pit: false, finished: false, ...extra });
  const field = Array.from({ length: 20 }, (_, i) => row(i + 1, `Car ${i + 1}`, i === 9 ? { you: true, gap: '' } : {}));
  tower.update(field, null);
  const els = Array.from(tower.root.querySelectorAll('.tower-row'));
  assert.equal(els.length, 20);
  assert.ok(tower.root.classList.contains('long'));
  assert.equal(els[9].querySelector('.tower-gap')?.textContent, 'YOU');
  assert.ok(els[9].classList.contains('you'));
  // Cars swap places, one pits, one is out, tyres appear: the same 20 elements, updated.
  const next = field.map((r) => ({ ...r }));
  [next[0], next[1]] = [{ ...next[1], pos: 1 }, { ...next[0], pos: 2 }];
  next[4] = { ...next[4], pit: true, tyre: 'soft', tyreAge: 3.7 };
  next[5] = { ...next[5], stops: 2, tyre: 'hard', tyreAge: 1, tyreLeft: 0 };
  next[19] = { ...next[19], out: true };
  tower.update(next, 'Pit now: rejoin P12, behind Car 12');
  const after = Array.from(tower.root.querySelectorAll('.tower-row'));
  assert.equal(after.length, 20);
  after.forEach((el, i) => assert.equal(el, els[i], `row ${i} reused`));
  assert.equal(after[0].querySelector('.tower-name')?.textContent, 'Car 2');
  const pit = after[4].querySelector('.tower-pit') as HTMLElement | null;
  assert.ok(pit && !pit.hidden && pit.textContent === 'PIT');
  assert.equal((after[4].querySelector('.tower-tyre') as HTMLElement).hidden, false);
  assert.equal(after[4].querySelector('.tyre-chip')?.textContent, 'S');
  assert.equal((after[4].querySelector('.tyre-chip') as HTMLElement).dataset.compound, 'soft');
  assert.equal(after[4].querySelector('.tower-age')?.textContent, '3');
  assert.equal(after[5].querySelector('.tower-stops')?.textContent, '2 stops');
  assert.ok(after[5].querySelector('.tower-tyre')?.classList.contains('gone'));
  assert.ok(after[19].classList.contains('out'));
  assert.equal(after[19].querySelector('.tower-gap')?.textContent, 'OUT');
  assert.equal((after[19].querySelector('.tower-stops') as HTMLElement).hidden, true, 'no badge for a car that is out');
  assert.equal((after[1].querySelector('.tower-tyre') as HTMLElement).hidden, true, 'no tyres without tyre wear');
  assert.equal(tower.root.querySelector('.tower-footer')?.textContent, 'Pit now: rejoin P12, behind Car 12');
  // Compact: the leaders and the cars around you, with a divider at each gap in the list.
  tower.mode = 'compact';
  tower.update(next, null);
  const compact = Array.from(tower.root.querySelectorAll('.tower-row'));
  assert.deepEqual(compact.map((el) => el.querySelector('.tower-pos')?.textContent), ['1', '2', '3', '8', '9', '10', '11', '12']);
  assert.ok(compact[3].classList.contains('after-gap'));
  assert.ok(!tower.root.classList.contains('long'));
  assert.equal((tower.root.querySelector('.tower-footer') as HTMLElement).hidden, true);
  // Off: hidden.
  tower.mode = 'off';
  tower.update(next, null);
  assert.equal(tower.root.hidden, true);
});

test('the AI cars make their first decision in the last moments of the countdown, one a tick, and their later ones on the ticks they always did', async (t) => {
  const { AiDriver } = await import('../src/race/ai.ts');
  const { TrafficPlanner } = await import('../src/race/traffic.ts');
  const { AI, TRAFFIC } = await import('../src/config/race.ts');
  const track = getSampleTrack(0);
  const drivers = Array.from({ length: 24 }, (_, slot) => new AiDriver(track, { name: String(slot), paint: 0, difficulty: 1, laps: 2, slot }));
  const slots = new Map(drivers.map((d, slot) => [Reflect.get(d, 'planner'), slot]));
  const calls: number[][] = drivers.map(() => []);
  let tick = 0;
  t.mock.method(TrafficPlanner.prototype, 'plan', function (this: object) { calls[slots.get(this)!].push(tick); return { offset: 0 }; });
  const states = drivers.map((d) => d.car.state);
  const go = Math.round(drivers[0].session.goTime * 120);
  for (; tick < go + 30; tick++) {
    for (const d of drivers) d.drive(states, d.car.dt);
    for (const d of drivers) d.session.step({ s: d.car.state.s, lateral: 0, along: 0 }, { s: d.car.state.s, lateral: 0, along: 0 }, []);
  }
  const first = calls.map((c) => c[0]);
  // During the countdown: the last AI.firstPlanSpread ticks, never two cars on one tick here (24 cars, 24 ticks), none on the tick the lights go out.
  assert.ok(first.every((f) => f < go && f >= go - AI.firstPlanSpread), `first decisions at ${first}`);
  assert.equal(new Set(first).size, 24);
  assert.ok(!calls.some((c) => c.includes(go)), 'nothing left for the start itself');
  // After the start, each car's next decision comes when it would have had the first been made at the start, then every few ticks.
  const ticks = Math.floor(TRAFFIC.planEvery / (1 / 120)) + 1;
  calls.forEach((c, slot) => {
    assert.equal(c[1], go + ticks + (slot % ticks), `car ${slot}`);
    for (let i = 2; i < c.length; i++) assert.equal(c[i] - c[i - 1], ticks);
  });
});
