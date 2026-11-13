import assert from 'node:assert/strict';
import { test } from 'node:test';
import { cleanCareer, driverStandings, lineup, newCareer, nextSeason, recordRound, setGrid, teamStandings } from '../src/career/career.ts';
import { commissionDevelopment, expandFacilities, researchBlocker, selectDriver, signSponsor, takeOwnership } from '../src/career/owner.ts';

const start = () => {
  const save = newCareer({ name: 'Oskar', team: 'kestrel', difficulty: 60, length: 'short', rounds: 'short' }, 1234);
  takeOwnership(save);
  return save;
};
const result = (save: ReturnType<typeof start>) => ({ order: ['alm', 'whi', ...lineup(save).map((d) => d.id).filter((id) => id !== 'alm' && id !== 'whi')], dnf: [], fastest: 'alm' });

test('ownership migrates legacy results and grids without erasing points', () => {
  const save = newCareer({ name: 'Oskar', team: 'kestrel', difficulty: 60, length: 'short', rounds: 'short' });
  recordRound(save, { order: ['you', 'lin'], dnf: ['you'], fastest: 'you' });
  setGrid(save, ['you', 'alm']);
  const points = teamStandings(save).find((t) => t.yours)!.points;
  const owner = takeOwnership(save);
  assert.equal(owner.selected, 'whi');
  assert.equal(save.done[0].fastest, 'whi');
  assert.deepEqual(save.done[0].dnf, ['whi']);
  assert.equal(save.grid![0], 'whi');
  assert.equal(teamStandings(save).find((t) => t.yours)!.points, points);
  assert.ok(!JSON.stringify(save.done).includes('"you"'));
  assert.equal(takeOwnership(save), owner, 'reopening cannot reset the budget');
});

test('switching seats preserves twenty identities, qualifying positions and individual points', () => {
  const save = start();
  recordRound(save, result(save));
  setGrid(save, ['whi', 'alm']);
  const points = driverStandings(save).map(({ id, points }) => ({ id, points }));
  const grid = [...save.grid!];
  const ids = lineup(save).map((e) => e.id);
  assert.ok(selectDriver(save, 'alm'));
  assert.equal(lineup(save).find((e) => e.you)!.id, 'alm');
  assert.equal(lineup(save).filter((e) => e.you).length, 1);
  assert.deepEqual(driverStandings(save).map(({ id, points }) => ({ id, points })), points);
  assert.deepEqual(lineup(save).map((e) => e.id), ids);
  assert.deepEqual(save.grid, grid);
  assert.equal(selectDriver(save, 'lin'), false);
  assert.equal(save.owner!.selected, 'alm');
  assert.equal(teamStandings(save).find((t) => t.yours)!.points, 43);
});

test('development charges once and improves the shared car after a completed round', () => {
  const save = start();
  const rating = save.cars.kestrel;
  assert.ok(commissionDevelopment(save));
  assert.equal(save.owner!.cash, 6_000_000);
  assert.equal(save.owner!.spent, 2_000_000);
  assert.equal(save.cars.kestrel, rating);
  assert.equal(commissionDevelopment(save), false);
  recordRound(save, result(save));
  assert.ok(Math.abs(save.cars.kestrel - rating - .035) < 1e-9);
  assert.equal(save.owner!.development, 1);
  assert.equal(save.owner!.project, false);
  assert.equal(save.owner!.earned, 1_000_000 + 43 * 35_000);
  assert.equal(save.owner!.cash, 6_000_000 + save.owner!.earned);
});

test('facilities increase income, DNFs earn no points bonus and unaffordable spending is refused', () => {
  const save = start();
  assert.ok(expandFacilities(save));
  assert.equal(save.owner!.cash, 6_500_000);
  recordRound(save, { ...result(save), dnf: ['alm', 'whi'] });
  assert.equal(save.owner!.earned, 1_250_000);
  assert.equal(teamStandings(save).find((t) => t.yours)!.points, 0);
  save.owner!.cash = 0;
  assert.equal(expandFacilities(save), false);
  assert.equal(commissionDevelopment(save), false);
  assert.equal(save.owner!.facilities, 1);
});

test('owners keep their team and funds next season; completed seasons cannot pay again', () => {
  const save = start();
  while (save.done.length < save.calendar.length) recordRound(save, result(save));
  const funds = save.owner!.cash;
  assert.equal(recordRound(save, result(save)), null);
  assert.equal(save.owner!.cash, funds);
  assert.equal(commissionDevelopment(save), false);
  nextSeason(save, 'aurora');
  assert.equal(save.team, 'kestrel');
  assert.equal(save.owner!.cash, funds);
  assert.equal(save.owner!.selected, 'whi');
  assert.equal(save.season, 2);
  assert.equal(save.done.length, 0);
});

test('owner saves round-trip and malformed budgets and selections are bounded', () => {
  const save = start();
  selectDriver(save, 'alm'); commissionDevelopment(save); recordRound(save, result(save));
  assert.deepEqual(cleanCareer(JSON.parse(JSON.stringify(save))), save);
  const cleaned = cleanCareer({ ...save, owner: { selected: 'lin', cash: -10, earned: Infinity, spent: 'oops', development: 900, facilities: -4, project: 'yes' } })!;
  assert.deepEqual(cleaned.owner, { selected: 'whi', cash: 0, earned: 0, spent: 0, development: 5, facilities: 0, project: false });
  assert.equal(lineup(cleaned).length, 20);
});

test('multi-round research persists its remaining work and only applies its gain on delivery', () => {
  const save = start();
  const rating = save.cars.kestrel;
  assert.ok(commissionDevelopment(save, 'concept'));
  assert.equal(save.owner!.cash, 4_200_000);
  recordRound(save, result(save));
  assert.equal(save.cars.kestrel, rating);
  assert.deepEqual(save.owner!.research, { id: 'concept', remaining: 2 });
  const restored = cleanCareer(JSON.parse(JSON.stringify(save)))!;
  recordRound(restored, result(restored));
  assert.equal(restored.cars.kestrel, rating);
  recordRound(restored, result(restored));
  assert.ok(Math.abs(restored.cars.kestrel - rating - .065) < 1e-9);
  assert.equal(restored.owner!.project, false);
  assert.equal(restored.owner!.research, undefined);
  assert.equal(restored.owner!.development, 1);
  assert.equal(restored.owner!.ledger!.filter((e) => e.amount < 0).length, 1);
});

test('a long project cannot exceed the calendar, while reaching the old ceiling still leaves development available', () => {
  const save = start();
  while (save.done.length < save.calendar.length - 2) recordRound(save, result(save));
  const before = save.owner!.cash;
  assert.equal(commissionDevelopment(save, 'concept'), false);
  assert.equal(save.owner!.cash, before);
  assert.match(researchBlocker(save, 'concept')!, /Not enough rounds/);
  save.cars.kestrel = 1;
  assert.equal(commissionDevelopment(save, 'sprint'), true);
  assert.equal(save.owner!.cash, before - 1_200_000);
});

test('sponsor tradeoffs, target bonuses and contract locks affect actual race income', () => {
  const save = start();
  assert.equal(signSponsor(save, 'nobody'), false);
  assert.ok(signSponsor(save, 'vector'));
  recordRound(save, result(save));
  assert.equal(save.owner!.earned, 700_000 + 43 * 45_000 + 450_000);
  assert.equal(save.owner!.ledger![0].amount, save.owner!.earned);
  assert.equal(signSponsor(save, 'meridian'), false, 'contract locked after first race');
  const safer = start();
  signSponsor(safer, 'meridian');
  recordRound(safer, { ...result(safer), dnf: ['alm', 'whi'] });
  assert.equal(safer.owner!.earned, 1_300_000, 'guaranteed income even with no points');
  const missed = start();
  signSponsor(missed, 'vector');
  recordRound(missed, { ...result(missed), dnf: ['alm', 'whi'] });
  assert.equal(missed.owner!.earned, 700_000, 'no target bonus without the points');
});

test('new seasons reopen contracts and development; history follows the lead driver, not seat selection', () => {
  const save = start();
  signSponsor(save, 'vector');
  while (save.done.length < save.calendar.length) recordRound(save, result(save));
  save.owner!.development = 5;
  selectDriver(save, 'whi');
  nextSeason(save, save.team);
  assert.equal(save.history[0].position, 1, 'Almeida won the title even though Whitlock was selected');
  assert.equal(save.owner!.development, 0);
  assert.ok(signSponsor(save, 'meridian'));
  assert.ok(commissionDevelopment(save));
});

test('the ledger stays bounded and invalid nested save data cannot corrupt owner state', () => {
  const save = start();
  for (let i = 0; i < 3; i++) {
    while (save.done.length < save.calendar.length) recordRound(save, result(save));
    nextSeason(save, save.team);
  }
  assert.equal(save.owner!.ledger!.length, 20);
  const restored = cleanCareer({ ...save, owner: { ...save.owner, project: true, research: { id: 'concept', remaining: -900 }, ledger: [null, { label: 'bad', amount: NaN }, { label: 'Valid', amount: 100, season: Infinity, round: -99 }] } })!;
  assert.deepEqual(restored.owner!.research, { id: 'concept', remaining: 1 });
  assert.deepEqual(restored.owner!.ledger, [{ label: 'Valid', amount: 100, season: 1, round: 0 }]);
});
