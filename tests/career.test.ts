import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  aiDifficulty,
  carPerformance,
  carOrder,
  carRank,
  CareerStore,
  cleanCareer,
  cleanName,
  driverStandings,
  lineup,
  newCareer,
  nextCars,
  nextRound,
  nextSeason,
  offers,
  playerCar,
  pointsFor,
  raceLaps,
  recordRound,
  roundFailures,
  roundPoints,
  roundWeather,
  seasonCalendar,
  setGrid,
  teamStandings,
  tyreLife,
  yourSeason,
  type CareerSave,
} from '../src/career/career.ts';
import { CAREER, YOU_ID } from '../src/config/career.ts';
import { builtInTracks } from '../src/editor/pipeline.ts';
import { storage } from '../src/platform/storage.ts';

const start = (over: Partial<Parameters<typeof newCareer>[0]> = {}, seed = 12345): CareerSave =>
  newCareer({ name: 'Oskar', team: 'kestrel', difficulty: 60, length: 'medium', rounds: 'standard', ...over }, seed);

/** Everyone in the line-up's order, with `first` moved to the front (in that order). */
const orderWith = (save: CareerSave, ...first: string[]): string[] => [...first, ...lineup(save).map((e) => e.id).filter((id) => !first.includes(id))];

test('the career’s made-up field: ten teams of two with their own colours, twenty drivers with unique names and codes, a calendar of real circuits with pits', () => {
  assert.equal(CAREER.teams.length, 10);
  assert.equal(CAREER.drivers.length, CAREER.cars);
  assert.equal(new Set(CAREER.teams.map((t) => t.paint)).size, 10, 'every team its own colour');
  const seats = CAREER.teams.flatMap((t) => t.drivers);
  assert.deepEqual([...seats].sort(), CAREER.drivers.map((d) => d.id).sort(), 'every driver has exactly one seat');
  for (const key of ['id', 'name', 'code'] as const) assert.equal(new Set(CAREER.drivers.map((d) => d[key])).size, CAREER.drivers.length, `driver ${key}s are unique`);
  assert.ok(!CAREER.drivers.some((d) => d.id === YOU_ID));
  const tracks = new Map(builtInTracks().map((b) => [b.def.id, b.def]));
  assert.equal(new Set(CAREER.calendar).size, CAREER.calendar.length);
  assert.equal(CAREER.calendar.length, CAREER.rounds.full);
  for (const id of CAREER.calendar) {
    const def = tracks.get(id);
    assert.ok(def, `${id} is a built-in track`);
    assert.notEqual(def.options?.pits, false, `${id} has pits`);
  }
  assert.deepEqual(CAREER.points, [25, 18, 15, 12, 10, 8, 6, 4, 2, 1]);
});

test('a new career: season 1, round 1, you in your team’s second seat beside its first driver', () => {
  const save = start();
  assert.equal(save.season, 1);
  assert.equal(nextRound(save), 0);
  assert.equal(save.grid, null);
  const field = lineup(save);
  assert.equal(field.length, 20);
  const me = field.filter((e) => e.you);
  assert.equal(me.length, 1);
  assert.equal(me[0].id, YOU_ID);
  assert.equal(me[0].name, 'Oskar');
  assert.equal(me[0].team.id, 'kestrel');
  const mates = field.filter((e) => e.team.id === 'kestrel' && !e.you);
  assert.deepEqual(mates.map((e) => e.id), ['alm'], 'the team’s first driver stays; its second gives up the seat');
  assert.ok(!field.some((e) => e.id === 'whi'));
  for (const t of CAREER.teams) assert.equal(field.filter((e) => e.team.id === t.id).length, 2);
  // Names are tidied; an empty one is "You".
  assert.equal(cleanName('   '), 'You');
  assert.equal(cleanName('  A   very long name indeed '), 'A very long na');
  assert.equal(start({ name: '' }).name, 'You');
  assert.equal(start({ team: 'nonsense' }).team, CAREER.teams[0].id);
});

test('season lengths: 8, 16 or 24 rounds, in calendar order, no circuit twice; short seasons visit different circuits from year to year', () => {
  for (const [length, n] of [['short', 8], ['standard', 16], ['full', 24]] as const) {
    for (let season = 1; season <= 4; season++) {
      const cal = seasonCalendar(length, season);
      assert.equal(cal.length, n);
      assert.equal(new Set(cal).size, n, `${length} season ${season}: no repeats`);
      const at = cal.map((id) => CAREER.calendar.indexOf(id as (typeof CAREER.calendar)[number]));
      assert.ok(at.every((x, i) => x >= 0 && (i === 0 || x > at[i - 1])), 'in calendar order');
    }
  }
  assert.notDeepEqual(seasonCalendar('short', 1), seasonCalendar('short', 2));
  assert.deepEqual(seasonCalendar('short', 1), seasonCalendar('short', 4), 'and come round again');
  const seen = new Set([1, 2, 3].flatMap((s) => seasonCalendar('short', s)));
  assert.equal(seen.size, 24, 'three short seasons cover the whole calendar');
  assert.deepEqual(seasonCalendar('full', 1), [...CAREER.calendar]);
});

test('points: 25-18-15-12-10-8-6-4-2-1 for the top ten, nothing after, nothing for a retirement', () => {
  assert.deepEqual([1, 2, 3, 10, 11, 20].map(pointsFor), [25, 18, 15, 1, 0, 0]);
  const save = start();
  const order = orderWith(save, 'lin', YOU_ID, 'val');
  const round = recordRound(save, { order, dnf: ['val', 'tan'], fastest: 'lin' });
  assert.ok(round);
  assert.equal(round.order.length, 20);
  assert.deepEqual(round.order.slice(0, 2), ['lin', YOU_ID]);
  assert.deepEqual(round.order.slice(-2), ['val', 'tan'], 'the cars that retired are classified last');
  assert.equal(roundPoints(round, 'lin'), 25);
  assert.equal(roundPoints(round, YOU_ID), 18);
  assert.equal(roundPoints(round, 'val'), 0);
  // (With val out, the car behind it moves up to third.)
  assert.equal(roundPoints(round, round.order[2]), 15);
  const total = lineup(save).reduce((a, e) => a + roundPoints(round, e.id), 0);
  assert.equal(total, 101, 'all ten scoring places are filled');
  assert.equal(nextRound(save), 1);
});

test('standings: most points first, ties by countback (most wins, then most 2nds…), and the constructors’ are both cars together', () => {
  const save = start();
  // Round 1: lin wins, you 2nd. Round 2: you win, lin 2nd. Level on 43: one win and one 2nd each.
  recordRound(save, { order: orderWith(save, 'lin', YOU_ID, 'nak'), dnf: [], fastest: null });
  recordRound(save, { order: orderWith(save, YOU_ID, 'lin', 'nak'), dnf: [], fastest: YOU_ID });
  let rows = driverStandings(save);
  assert.equal(rows[0].points, 43);
  assert.equal(rows[1].points, 43);
  assert.deepEqual(rows.slice(0, 2).map((r) => r.id).sort(), ['lin', YOU_ID].sort());
  assert.equal(rows[2].id, 'nak');
  assert.equal(rows[2].points, 30);
  // Round 3: nak wins, you 3rd, lin 4th: you're ahead of lin on points now.
  recordRound(save, { order: orderWith(save, 'nak', 'val', YOU_ID, 'lin'), dnf: [], fastest: null });
  rows = driverStandings(save);
  assert.deepEqual(rows.slice(0, 3).map((r) => [r.id, r.points]), [[YOU_ID, 58], ['lin', 55], ['nak', 55]], 'level on 55 with a win each: lin’s 2nd place puts him ahead');
  // Countback, spelled out: two drivers level on points, one with a win.
  const tie = start();
  recordRound(tie, { order: orderWith(tie, 'har', 'vol', 'rau'), dnf: [], fastest: null }); // har 25, vol 18
  recordRound(tie, { order: orderWith(tie, 'rau', 'des', 'lef', 'vdi', 'hal', 'kow', 'vol', 'dla', 'rey', 'oha', 'har'), dnf: [], fastest: null }); // vol +6 = 24, har +0 = 25
  recordRound(tie, { order: orderWith(tie, 'des', 'lef', 'vdi', 'hal', 'kow', 'dla', 'rey', 'oha', 'tan', 'vol', 'har'), dnf: [], fastest: null }); // vol +1 = 25
  const t = driverStandings(tie);
  const har = t.findIndex((r) => r.id === 'har');
  const vol = t.findIndex((r) => r.id === 'vol');
  assert.equal(t[har].points, 25);
  assert.equal(t[vol].points, 25);
  assert.ok(har < vol, 'level on points, the driver with the win is ahead');
  assert.equal(t[har].wins, 1);
  assert.deepEqual(t[har].results, [1, 11, 11]);
  // Constructors: your points count for your team with your teammate's.
  const teams = teamStandings(save);
  const mine = teams.find((x) => x.yours);
  assert.ok(mine);
  assert.equal(mine.team.id, 'kestrel');
  const drivers = driverStandings(save);
  assert.equal(mine.points, drivers.filter((d) => d.team.id === 'kestrel').reduce((a, d) => a + d.points, 0));
  assert.deepEqual(mine.drivers.map((d) => d.id).sort(), ['alm', YOU_ID].sort());
  assert.equal(teams.reduce((a, x) => a + x.points, 0), drivers.reduce((a, d) => a + d.points, 0));
  for (let i = 1; i < teams.length; i++) assert.ok(teams[i - 1].points >= teams[i].points);
  const you = yourSeason(save);
  assert.deepEqual([you.position, you.points, you.wins, you.podiums], [1, 58, 1, 3]);
});

test('retirements, poles and fastest laps are counted', () => {
  const save = start();
  setGrid(save, ['val', YOU_ID]);
  assert.equal(save.grid?.length, 20, 'a grid is made whole: anyone left out starts at the back');
  assert.deepEqual(save.grid?.slice(0, 2), ['val', YOU_ID]);
  recordRound(save, { order: orderWith(save, 'lin', 'val'), dnf: [YOU_ID], fastest: 'val' });
  assert.equal(save.grid, null, 'the grid is used up by the race');
  assert.equal(save.done[0].pole, 'val');
  const rows = driverStandings(save);
  const me = rows.find((r) => r.you);
  assert.ok(me);
  assert.deepEqual([me.points, me.dnfs, me.results], [0, 1, [0]]);
  const val = rows.find((r) => r.id === 'val');
  assert.deepEqual([val?.poles, val?.fastest], [1, 1]);
});

test('career driver ability and physical car performance are independent; the player receives the same hardware', () => {
  const save = start({ difficulty: 80 });
  const at = (id: string) => {
    // (Averaged over a season's rounds: each weekend's form evens out.)
    let sum = 0;
    for (let r = 0; r < 16; r++) sum += aiDifficulty(save, r, id);
    return sum / 16;
  };
  assert.ok(Math.abs(at('lin') - 0.8) < CAREER.form, `the best: ${at('lin').toFixed(3)}`);
  const all = lineup(save).filter((e) => !e.you).map((e) => at(e.id));
  assert.ok(Math.min(...all) > 0.8 - CAREER.spread - CAREER.form && Math.max(...all) <= 0.8 + CAREER.form);
  assert.ok(Math.max(...all) - Math.min(...all) > CAREER.spread * 0.7, 'the field is spread out');
  // Ability is independent of hardware; stronger cars win through their physics.
  assert.ok(at('har') > at('oka'));
  assert.ok(at('lin') > at('oka'));
  const ability = aiDifficulty(save, 3, 'oka');
  const hardware = carPerformance(save, 'oka');
  save.cars.aurora = .2;
  assert.equal(aiDifficulty(save, 3, 'oka'), ability, 'hardware is not double-counted as driver skill');
  assert.ok(carPerformance(save, 'oka').pull < hardware.pull);
  // Form: the same driver is a little different from round to round, and the same when asked again.
  assert.notEqual(aiDifficulty(save, 0, 'lin'), aiDifficulty(save, 1, 'lin'));
  assert.equal(aiDifficulty(save, 3, 'nak'), aiDifficulty(save, 3, 'nak'));
  assert.ok(Math.abs(aiDifficulty(save, 0, 'lin') - aiDifficulty(save, 1, 'lin')) <= 2 * CAREER.form);
  // Never past the limit, however high the difficulty.
  const top = start({ difficulty: 100 });
  for (let r = 0; r < 24; r++) for (const e of lineup(top)) if (!e.you) assert.ok(aiDifficulty(top, r, e.id) <= 1);
  // Your car: the standard one in the best team, a little down in the worst.
  assert.deepEqual(playerCar(start({ team: 'aurora' })), { grip: 1, pull: 1, top: 1 });
  const slow = playerCar(start({ team: 'goldcrest' }));
  assert.ok(slow.grip < .8 && slow.grip > .75 && slow.pull < .73 && slow.pull > .7 && slow.top < .91 && slow.top > .9);
  const mid = playerCar(start({ team: 'kestrel' }));
  assert.ok(mid.grip > slow.grip && mid.grip < 1);
  assert.deepEqual(carPerformance(start({ team: 'goldcrest' }), 'oha'), slow);
});

test('each round’s weather and mechanical failures are the same every time they’re asked, mostly dry, and failures are rare and never yours', () => {
  const save = start({ rounds: 'full' });
  const counts = { dry: 0, changing: 0, rain: 0 };
  let failures = 0;
  let races = 0;
  for (let seed = 1; seed <= 40; seed++) {
    const s = start({ rounds: 'full' }, seed * 7919);
    for (let r = 0; r < 24; r++) {
      counts[roundWeather(s, r)]++;
      const f = roundFailures(s, r);
      assert.ok(!(YOU_ID in f));
      for (const at of Object.values(f)) assert.ok(at >= CAREER.failFrom && at <= CAREER.failTo);
      failures += Object.keys(f).length;
      races++;
    }
  }
  assert.ok(counts.dry / races > 0.8 && counts.dry / races < 0.95, `dry ${((counts.dry / races) * 100).toFixed(0)} %`);
  assert.ok(counts.rain > 0 && counts.changing > counts.rain);
  const perRace = failures / races;
  assert.ok(perRace > 0.3 && perRace < 0.9, `${perRace.toFixed(2)} failures a race`);
  assert.equal(roundWeather(save, 5), roundWeather(save, 5));
  assert.deepEqual(roundFailures(save, 5), roundFailures(save, 5));
});

test('race length: about the same time on every track, so more laps on a short one; never fewer than the minimum', () => {
  assert.equal(raceLaps('medium', 60), 8);
  assert.equal(raceLaps('medium', 96), 5);
  assert.equal(raceLaps('medium', 200), CAREER.lengths.medium.minLaps);
  assert.equal(raceLaps('short', 80), 3);
  assert.equal(raceLaps('long', 80), 12);
  assert.ok(raceLaps('long', 5) <= CAREER.maxLaps);
  // Tyres are made for the distance: in a long race they last longer than the track's own figure, never less.
  assert.equal(tyreLife(5, 5.2), 5.2);
  assert.equal(tyreLife(20, 5.2), 8);
});

/** Runs the rest of the season with `winner` winning every race and you `place`th. */
function runSeason(save: CareerSave, winner: string, place: number): void {
  while (nextRound(save) !== null) {
    const rest = lineup(save).map((e) => e.id).filter((id) => id !== winner && id !== YOU_ID);
    const order = winner === YOU_ID ? [YOU_ID, ...rest] : [winner, ...rest];
    if (winner !== YOU_ID) order.splice(place - 1, 0, YOU_ID);
    recordRound(save, { order, dnf: [], fastest: null });
  }
}

test('the end of a season: it goes in the record, the cars change a little, and the next one starts at round 1 with nothing scored', () => {
  const save = start({ rounds: 'short' });
  runSeason(save, 'lin', 12);
  assert.equal(nextRound(save), null);
  assert.equal(recordRound(save, { order: [], dnf: [], fastest: null }), null, 'no more rounds this season');
  const before = { ...save.cars };
  const cars = nextCars(save);
  assert.deepEqual(cars, nextCars(save), 'the same however often it’s asked');
  nextSeason(save, save.team);
  assert.equal(save.season, 2);
  assert.equal(nextRound(save), 0);
  assert.equal(save.done.length, 0);
  assert.equal(save.history.length, 1);
  const h = save.history[0];
  assert.deepEqual([h.season, h.team, h.position, h.points, h.wins, h.champion, h.championTeam], [1, 'kestrel', 12, 0, 0, 'Lindqvist', 'aurora']);
  assert.deepEqual(save.cars, cars);
  assert.notDeepEqual(save.cars, before);
  const values = Object.values(save.cars);
  assert.equal(values.length, 10);
  assert.ok(Math.max(...values) > 1, 'the leading car keeps earned absolute progress');
  assert.ok(Math.min(...values) >= 0 && values.every(Number.isFinite));
  for (const t of CAREER.teams) assert.ok(Math.abs(save.cars[t.id] - before[t.id]) < 0.45, `${t.id} hasn’t leapt`);
  assert.deepEqual(save.calendar, seasonCalendar('short', 2));
  assert.equal(driverStandings(save)[0].points, 0);
});

test('offers: your own team always keeps you; a champion can go anywhere, a backmarker only to the slowest cars', () => {
  const champ = start({ team: 'goldcrest', rounds: 'short' });
  runSeason(champ, YOU_ID, 1);
  assert.equal(yourSeason(champ).position, 1);
  assert.equal(offers(champ).length, 10, 'everyone wants the champion');
  const last = start({ team: 'kestrel', rounds: 'short' });
  runSeason(last, 'lin', 20);
  const few = offers(last);
  assert.ok(few.some((t) => t.id === 'kestrel'), 'your team keeps you');
  const next = { cars: nextCars(last) };
  for (const t of few) if (t.id !== 'kestrel') assert.ok(carRank(next, t.id) >= 9, `${t.id} is one of the slowest cars`);
  assert.ok(few.length <= 3);
  // Best car first.
  const ranks = offers(champ).map((t) => carRank({ cars: nextCars(champ) }, t.id));
  assert.deepEqual(ranks, [...ranks].sort((a, b) => a - b));
  assert.equal(carOrder(next).length, 10);
  // Moving: only to a team that made an offer.
  const refused = CAREER.teams.find((t) => !few.includes(t));
  assert.ok(refused);
  nextSeason(last, refused.id);
  assert.equal(last.team, 'kestrel', 'a team that didn’t ask doesn’t get you');
  nextSeason(champ, 'aurora');
  assert.equal(champ.team, 'aurora');
  assert.deepEqual(lineup(champ).filter((e) => e.team.id === 'aurora').map((e) => e.id), ['lin', YOU_ID]);
  assert.ok(lineup(champ).some((e) => e.id === 'tan'), 'the driver whose seat you had is back in it');
});

test('the career is saved as it goes and comes back the same; damaged saves are mended or refused', () => {
  storage.removeItem('career.v1');
  const store = new CareerStore();
  assert.equal(store.save, null);
  const save = start();
  recordRound(save, { order: orderWith(save, YOU_ID, 'lin'), dnf: ['tan'], fastest: YOU_ID });
  setGrid(save, orderWith(save, 'val'));
  store.start(save);
  assert.ok(storage.keys().includes('career.v1'), 'it’s one of the keys the cloud save carries');
  const back = new CareerStore().save;
  assert.deepEqual(back, save);
  // A change is there next time.
  if (back) {
    back.difficulty = 77;
    const again = new CareerStore();
    assert.equal(again.save?.difficulty, 60);
    store.save!.difficulty = 77;
    store.write();
    assert.equal(new CareerStore().save?.difficulty, 77);
  }
  // Damaged data.
  assert.equal(cleanCareer(null), null);
  assert.equal(cleanCareer('career'), null);
  assert.equal(cleanCareer({ v: 2, team: 'kestrel' }), null);
  assert.equal(cleanCareer({ v: 1, team: 'nobody' }), null);
  const mended = cleanCareer({ v: 1, team: 'vento', name: 42, difficulty: 900, length: 'endless', done: [{ order: ['lin', 'lin', 'ghost', YOU_ID], dnf: ['ghost', 'lin'] }, 'junk'], grid: ['zzz'], history: [{ team: 'nope' }, { team: 'vento', position: 3 }] });
  assert.ok(mended);
  assert.equal(mended.name, 'You');
  assert.equal(mended.difficulty, 110);
  assert.equal(mended.length, 'medium');
  assert.equal(mended.calendar.length, 16);
  assert.equal(mended.done.length, 1);
  assert.equal(mended.done[0].order.length, 20);
  assert.deepEqual(mended.done[0].order.slice(0, 2), ['lin', YOU_ID]);
  assert.deepEqual(mended.done[0].dnf, ['lin']);
  assert.equal(mended.grid?.length, 20);
  assert.equal(mended.history.length, 1);
  assert.equal(mended.history[0].position, 3);
  assert.ok(driverStandings(mended).length === 20);
  store.clear();
  assert.equal(new CareerStore().save, null);
});
