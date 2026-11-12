import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CarPhysics, STANDARD_CAR } from '../src/car/physics.ts';
import { carPerformance, newCareer, playerCar } from '../src/career/career.ts';
import { takeOwnership, selectDriver } from '../src/career/owner.ts';
import { assignUpgrade, engineering } from '../src/career/engineering.ts';
import { builtInTracks } from '../src/editor/pipeline.ts';
import { AiDriver, aiPace } from '../src/race/ai.ts';
import { assistDriver } from '../src/race/assists.ts';
import { AuthorLap } from '../src/race/medals.ts';
import { carPace, planLapTime, racingLine, roadPace, speedProfile } from '../src/race/racingLine.ts';
import { suggestedSetup } from '../src/race/strategy.ts';

const start = () => newCareer({ name: 'Owner', team: 'kestrel', difficulty: 90, length: 'short', rounds: 'short' }, 1234);
const track = (id: string) => builtInTracks().find(t => t.def.id === id)!.track();

test('team performance changes actual launch acceleration and driven qualifying laps', () => {
  const s = start(), weak = carPerformance(s, 'oha');
  const t = track('world-it-1922'), setup = suggestedSetup(t);
  const launch = (tune: typeof weak) => {
    const car = new CarPhysics(t); car.tune = tune; car.placeAt(0);
    for (let i = 0; i < 120; i++) car.step({ throttle: 1, brake: 0, steer: 0, handbrake: false });
    return car.state.speed;
  };
  assert.ok(launch(weak) < launch(STANDARD_CAR) * .8, 'a weak engine loses acceleration under identical inputs');
  for (const id of ['world-it-1922', 'world-au-1953']) {
    const circuit = track(id), setup = suggestedSetup(circuit);
    const fast = new AuthorLap(circuit, .9, false, false, setup, STANDARD_CAR).finish()!;
    const slow = new AuthorLap(circuit, .9, false, false, setup, weak).finish()!;
    assert.ok(fast > 0 && slow > fast * 1.04, `${id}: weak ${slow.toFixed(3)} vs fast ${fast.toFixed(3)}`);
  }
  const ai = new AiDriver(t, { name: 'Rival', paint: 0, difficulty: .9, laps: 3, slot: 0, tune: weak });
  assert.deepEqual(ai.car.tune, weak);
  const line = racingLine(t), base = aiPace(.9, t);
  const planned = (tune: typeof weak) => planLapTime(line, speedProfile(t, line, roadPace(carPace(base, setup, tune), t)));
  assert.ok(planned(weak) > planned(STANDARD_CAR) * 1.04, 'planning respects the engine as well as the tyres');
});

test('fitting an upgrade improves the same seat in player control, AI racing and qualifying', () => {
  const s = start(); takeOwnership(s); const e = engineering(s); selectDriver(s, 'alm');
  const before = playerCar(s), other = carPerformance(s, 'whi');
  for (const id of ['aero-1', 'powertrain-1']) { e.researched.push(id); e.designs[id] = 1; e.stock[id] = 1; assert.ok(assignUpgrade(s, id, 0)); }
  const after = playerCar(s);
  assert.deepEqual(after, carPerformance(s, 'alm'));
  assert.deepEqual(carPerformance(s, 'whi'), other, 'manufacturing for one car does not upgrade its teammate');
  const t = track('world-au-1953'), setup = suggestedSetup(t);
  const lap = (tune: typeof before) => new AuthorLap(t, .9, false, false, setup, tune).finish()!;
  assert.ok(lap(after) < lap(before) - .05, 'installed hardware produces a measurable gain on the actual driving simulation');
  assert.deepEqual(new AiDriver(t, { name: 'Teammate', paint: 0, difficulty: .9, laps: 3, slot: 0, tune: after }).car.tune, after);
});

test('braking advice and the coloured racing line use the selected car and setup', () => {
  const t = track('world-au-1953'), weak = carPerformance(start(), 'oha'), setup = suggestedSetup(t);
  const normal = assistDriver(t, false, STANDARD_CAR, setup), slow = assistDriver(t, false, weak, setup);
  assert.notEqual(normal, slow);
  assert.equal(assistDriver(t, false, { ...weak }, { ...setup }), slow, 'identical hardware reuses its plan');
  assert.ok(slow.limit.some((v, i) => v < normal.limit[i] * .95), 'the slower car is told to brake for its lower grip');
});
