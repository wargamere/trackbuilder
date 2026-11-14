import assert from 'node:assert/strict';
import { test } from 'node:test';
import { areaPhysics, areaShape, CAR_AREAS, developRivals, initialShape, overall, seatAreas, teamAreas } from '../src/career/carAreas.ts';
import { carOrder, carPerformance, carRating, cleanCareer, ensureSeasonStart, newCareer, nextSeason, performanceIndex, recordRound, team, teamStandings } from '../src/career/career.ts';
import { circuitDemand, partLapGain, plannedLap, projectedOrder } from '../src/career/circuitPace.ts';
import { driverContracts } from '../src/career/contracts.ts';
import { assignUpgrade, engineering, PARTS } from '../src/career/engineering.ts';
import { takeOwnership } from '../src/career/owner.ts';
import { settleDynastyRound } from '../src/career/dynasty.ts';
import { CAREER } from '../src/config/career.ts';
import { DEVELOPMENT } from '../src/config/development.ts';
import { builtInTrack } from '../src/editor/pipeline.ts';

const start = (seed = 7) => {
  const s = newCareer({ name: 'Owner', team: 'kestrel', difficulty: 90, length: 'short', rounds: 'standard' }, seed);
  takeOwnership(s); engineering(s); driverContracts(s); ensureSeasonStart(s);
  return s;
};
/** Records a round with the cars finishing in car order (so the standings follow the cars). */
const race = (s: ReturnType<typeof start>) => { const order = carOrder(s).flatMap((t) => team(t.id, s).drivers); recordRound(s, { order, dnf: [], fastest: order[0] }); };
const fit = (s: ReturnType<typeof start>, id: string, seats: (0 | 1)[] = [0, 1]) => {
  const e = engineering(s); if (!e.researched.includes(id)) { e.researched.push(id); e.designs[id] = 1; }
  e.stock[id] = (e.stock[id] ?? 0) + seats.length; for (const seat of seats) assert.ok(assignUpgrade(s, id, seat));
};
const track = (id: string) => builtInTrack(id)!;

test('one scale for every car: equal areas are the car as it always was, and a team’s character averages out', () => {
  for (const r of [0, 0.04, 0.55, 1, 1.3]) {
    const p = areaPhysics({ aero: r, chassis: r, powertrain: r });
    const progress = (v: number) => (v <= 1 ? v : 1 + 0.25 * (1 - Math.exp(-(v - 1) / 0.25)));
    assert.ok(Math.abs(p.grip - progress(1 - CAREER.carGrip * (1 - r))) < 1e-12);
    assert.ok(Math.abs(p.pull - progress(1 - CAREER.carPull * (1 - r))) < 1e-12);
    assert.ok(Math.abs(p.top - progress(1 - CAREER.carTop * (1 - r))) < 1e-12);
  }
  const s = start();
  for (const t of CAREER.teams) {
    const shape = initialShape(s, t.id);
    assert.ok(Math.abs(shape.aero + shape.chassis + shape.powertrain) < 1e-12, 'it averages zero: the overall rating is the team’s');
    for (const a of CAR_AREAS) assert.ok(Math.abs(shape[a]) <= 2 * DEVELOPMENT.character);
    assert.ok(Math.abs(overall(teamAreas(s, t.id)) - s.cars[t.id]) < 1e-12);
    assert.deepEqual(carPerformance(s, t.drivers[0]), areaPhysics(teamAreas(s, t.id)), 'a rival is its team’s areas through the one formula');
  }
  assert.notDeepEqual(initialShape(s, 'aurora'), initialShape(s, 'vento'), 'teams differ');
  assert.deepEqual(initialShape(start(), 'aurora'), initialShape(s, 'aurora'), 'and the same career gives the same character');
});

test('your parts count in the same units as a rival’s rating: the performance index and the car on track agree', () => {
  const s = start();
  const before = performanceIndex(s, s.team), hardware = carPerformance(s, 'alm');
  fit(s, 'aero-1');
  const gain = PARTS.find((p) => p.id === 'aero-1')!.effect * DEVELOPMENT.partScale;
  // On both cars: a third of the area's gain overall.
  assert.ok(Math.abs(carRating(s, s.team) - (s.cars.kestrel + gain / 3)) < 1e-12);
  assert.equal(performanceIndex(s, s.team), Math.round((s.cars.kestrel + gain / 3) * 700));
  assert.ok(performanceIndex(s, s.team) > before);
  // The physics of that car is exactly what a rival with the same areas would have.
  const areas = seatAreas(s, s.team, 'alm');
  assert.ok(Math.abs(areas.aero - (teamAreas(s, s.team).aero + gain)) < 1e-12);
  assert.ok(carPerformance(s, 'alm').grip > hardware.grip);
  assert.ok(carPerformance(s, 'alm').top > hardware.top, 'less drag: a little more top speed too');
  assert.equal(carPerformance(s, 'alm').pull, hardware.pull, 'aero doesn’t pull the car out of corners');
  // A power unit part is acceleration and top speed.
  const p0 = carPerformance(s, 'alm');
  fit(s, 'powertrain-1', [0]);
  assert.ok(carPerformance(s, 'alm').pull > p0.pull && carPerformance(s, 'alm').top > p0.top && carPerformance(s, 'alm').grip === p0.grip);
  assert.deepEqual(seatAreas(s, s.team, 'whi').powertrain, teamAreas(s, s.team).powertrain, 'only the car it’s fitted to');
});

test('rival teams develop through the season: packages on rounds of their own, mostly to their weakest area, the teams further back getting more', () => {
  const s = start(11);
  const before = { ...s.cars };
  const shapes = Object.fromEntries(CAREER.teams.map((t) => [t.id, areaShape(s, t.id)]));
  while (s.done.length < s.calendar.length) race(s);
  const packages = (s.rivalPackages ?? []).filter((p) => p.season === 1);
  const rivals = CAREER.teams.filter((t) => t.id !== s.team);
  assert.ok(packages.length >= rivals.length * 3, `${packages.length} packages`);
  assert.ok(!packages.some((p) => p.team === s.team), 'never yours: you develop your own car');
  for (const t of rivals) {
    const mine = packages.filter((p) => p.team === t.id);
    assert.equal(new Set(mine.map((p) => p.round)).size, mine.length, 'one package a round at most');
    assert.ok(s.cars[t.id] > before[t.id], `${t.id} improved`);
    const sum = mine.reduce((n, p) => n + p.gain, 0) / 3;
    assert.ok(Math.abs(s.cars[t.id] - before[t.id] - sum) < 1e-9, 'its overall rating rose by its packages, a third of each');
    const shape = areaShape(s, t.id);
    assert.ok(Math.abs(shape.aero + shape.chassis + shape.powertrain) < 1e-9);
  }
  assert.equal(s.cars.kestrel, before.kestrel);
  const weakest = packages.filter((p) => {
    const sh = shapes[p.team];
    return p.area === CAR_AREAS.reduce((a, b) => (sh[b] < sh[a] ? b : a));
  }).length;
  assert.ok(weakest / packages.length > 0.35, 'more often than not to its weakest area (at the first package, anyway)');
  assert.ok(packages.some((p) => p.flop) && packages.filter((p) => p.flop).length < packages.length / 3, 'now and then a package doesn’t work');
  // The further back in the championship, the more development time.
  const gains = rivals.map((t) => ({ id: t.id, gain: s.cars[t.id] - before[t.id] }));
  const order = teamStandings(s).map((r) => r.team.id).filter((id) => id !== s.team);
  const front = gains.filter((g) => order.indexOf(g.id) < 3), back = gains.filter((g) => order.indexOf(g.id) >= order.length - 3);
  const mean = (a: typeof gains) => a.reduce((n, g) => n + g.gain, 0) / a.length;
  assert.ok(mean(back) > mean(front), `back ${mean(back).toFixed(3)} vs front ${mean(front).toFixed(3)}`);
  // It's all saved, and comes back the same.
  const again = cleanCareer(JSON.parse(JSON.stringify(s)))!;
  assert.deepEqual(again.carAreas, s.carAreas);
  assert.deepEqual(again.rivalPackages, s.rivalPackages);
  for (const t of CAREER.teams) assert.deepEqual(carPerformance(again, t.drivers[0]), carPerformance(s, t.drivers[0]));
  // Settling a round a second time (a screen replayed, a save reloaded) develops nobody again.
  const mid = start(11);
  for (let i = 0; i < 3; i++) race(mid);
  const cars = { ...mid.cars }, areas = JSON.stringify(mid.carAreas);
  settleDynastyRound(mid, mid.done.at(-1)!, 1, null, teamStandings(mid).map((r) => r.team.id));
  assert.deepEqual(mid.cars, cars);
  assert.equal(JSON.stringify(mid.carAreas), areas);
  // And the same career develops the same way.
  const twin = start(11);
  for (let i = 0; i < 3; i++) race(twin);
  assert.deepEqual(twin.cars, mid.cars);
  assert.deepEqual(twin.rivalPackages, mid.rivalPackages);
  // At the end of the season there's no next round to bring anything to.
  assert.deepEqual(developRivals(s, []), []);
});

test('a development race: stand still and you fall back; develop flat out and you climb', () => {
  const run = (plan: 'idle' | 'max') => {
    const s = start(99);
    const begin = carOrder(s).findIndex((t) => t.id === s.team) + 1;
    for (let season = 0; season < 3; season++) {
      while (s.done.length < s.calendar.length) {
        if (plan === 'max' && s.done.length === 3) for (const area of ['aero', 'chassis', 'powertrain']) for (const p of PARTS.filter((x) => x.area === area)) fit(s, p.id);
        race(s);
      }
      nextSeason(s, s.team);
    }
    return { begin, end: carOrder(s).findIndex((t) => t.id === s.team) + 1 };
  };
  const idle = run('idle'), max = run('max');
  assert.ok(idle.end > idle.begin + 1, `idle: P${idle.begin} → P${idle.end}`);
  assert.ok(max.end < max.begin - 1, `flat out: P${max.begin} → P${max.end}`);
});

test('circuits reward the areas differently, and a part’s worth is its lap time there', () => {
  const s = start();
  const monza = circuitDemand(s, track('world-it-1922')), budapest = circuitDemand(s, track('world-hu-1986'));
  for (const d of [monza, budapest]) assert.ok(Math.abs(d.share.aero + d.share.chassis + d.share.powertrain - 1) < 1e-9);
  assert.ok(monza.share.powertrain > budapest.share.powertrain + 0.05, `Monza ${monza.share.powertrain.toFixed(2)} vs Budapest ${budapest.share.powertrain.toFixed(2)}: the straights`);
  assert.ok(budapest.share.aero > monza.share.aero, 'and the corners');
  // Every car in the projected order: one row a rival, one for each of yours; the overall order on a typical circuit.
  const t = track('world-gb-1948'), order = projectedOrder(s, t);
  assert.equal(order.length, CAREER.teams.length + 1);
  assert.deepEqual(order.filter((r) => r.team === s.team).map((r) => r.seat).sort(), [0, 1]);
  for (let i = 1; i < order.length; i++) assert.ok(order[i].lap >= order[i - 1].lap);
  assert.equal(order[0].team, 'aurora');
  // A part's gain is the difference it makes to the planned lap, and it's what fitting it then gives.
  const gain = partLapGain(s, 'aero-1', 0, t);
  assert.ok(gain > 0.01 && gain < 0.5, `${gain.toFixed(3)} s`);
  const lap = plannedLap(t, areaPhysics(seatAreas(s, s.team, 'alm')));
  fit(s, 'aero-1', [0]);
  assert.ok(Math.abs(lap - plannedLap(t, areaPhysics(seatAreas(s, s.team, 'alm'))) - gain) < 1e-9);
  assert.equal(partLapGain(s, 'durability-1', 0, t), 0);
});
