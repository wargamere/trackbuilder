import assert from 'node:assert/strict';
import { test } from 'node:test';
import { aiDifficulty, cleanCareer, lineup, newCareer, nextSeason, recordRound, setGrid, team, teamStandings } from '../src/career/career.ts';
import { takeOwnership, selectDriver } from '../src/career/owner.ts';
import { createCustomCareer, hireDriver, recruitmentOpen, updateTeamIdentity } from '../src/career/teamManagement.ts';
import { driverFee, FOUNDING_BUDGET, teamsFor } from '../src/career/roster.ts';
import { GP_DRIVERS, GP_TEAMS } from '../src/config/grandPrix.ts';
import { AI } from '../src/config/race.ts';

const options = () => ({ principal: 'Oskar', name: 'Nova Racing', paint: 0x7657ed, secondary: 0x61e2be, drivers: ['gp-verstallen', 'gp-norrin'] as [string, string], difficulty: 60, length: 'short' as const, rounds: 'short' as const });
const start = () => { const s = createCustomCareer(options(), 1234); assert.ok(s); return s; };
const finish = (s: ReturnType<typeof start>) => recordRound(s, { order: [...s.entry!.drivers, ...lineup(s).map((e) => e.id).filter((id) => !s.entry!.drivers.includes(id))], dnf: [], fastest: s.entry!.drivers[0] });

test('founding a custom team adds a complete twelfth entry and charges both signing fees', () => {
  const s = start();
  assert.equal(s.team, 'privateer');
  assert.equal(teamsFor(s).length, 12);
  assert.equal(lineup(s).length, 24);
  assert.equal(new Set(lineup(s).map((e) => e.id)).size, 24);
  assert.equal(s.owner!.cash, FOUNDING_BUDGET - driverFee('gp-verstallen') - driverFee('gp-norrin'));
  assert.equal(s.owner!.spent, driverFee('gp-verstallen') + driverFee('gp-norrin'));
  assert.equal(s.owner!.ledger!.length, 2);
  assert.equal(team(s.team, s).name, 'Nova Racing');
  assert.equal(s.owner!.target, 10);
  assert.equal(AI.maxField >= lineup(s).length - 1, true);
});

test('poaching both drivers from one rival fills both vacancies with unique reserves', () => {
  const s = createCustomCareer({ ...options(), drivers: ['gp-roussel', 'gp-antonel'] })!;
  const field = lineup(s);
  const rival = teamsFor(s).find((t) => t.id === 'gp-mersedes')!;
  assert.ok(rival.drivers.every((id) => id.startsWith('reserve-')));
  assert.equal(new Set(field.map((e) => e.id)).size, 24);
  assert.ok(field.filter((e) => e.team.id === 'privateer').every((e) => ['gp-roussel', 'gp-antonel'].includes(e.id)));
  assert.equal(createCustomCareer({ ...options(), drivers: ['gp-norrin', 'gp-norrin'] }), null);
  assert.equal(createCustomCareer({ ...options(), name: '  ' }), null);
  assert.equal(createCustomCareer({ ...options(), drivers: ['bad', 'gp-norrin'] }), null);
});

test('selected hires use the custom team car rating and both score for its constructor', () => {
  const s = start();
  const before = aiDifficulty(s, 0, 'gp-verstallen');
  s.cars.privateer = .95;
  assert.ok(aiDifficulty(s, 0, 'gp-verstallen') > before);
  finish(s);
  assert.equal(teamStandings(s).find((t) => t.yours)!.points, 43);
  const points = s.done[0].order.slice();
  assert.ok(selectDriver(s, 'gp-verstallen'));
  assert.deepEqual(s.done[0].order, points);
});

test('identity and all twenty-four driver results survive save reload and next season', () => {
  const s = start(); finish(s);
  setGrid(s, lineup(s).map((e) => e.id));
  assert.ok(updateTeamIdentity(s, 'Nova Works', 0x123456, 0xabcdef));
  const copy = cleanCareer(JSON.parse(JSON.stringify(s)))!;
  assert.deepEqual(copy, s);
  assert.equal(copy.grid!.length, 24);
  assert.deepEqual([team(copy.team, copy).paint, team(copy.team, copy).secondary], [0x123456, 0xabcdef]);
  while (copy.done.length < copy.calendar.length) finish(copy);
  nextSeason(copy, 'aurora');
  assert.equal(copy.team, 'privateer');
  assert.equal(team(copy.team, copy).name, 'Nova Works');
  assert.equal(lineup(copy).length, 24);
  assert.deepEqual(copy.entry!.drivers, options().drivers);
});

test('recruitment changes a seat and pays once, but cannot mutate a qualified or scored season', () => {
  const s = start();
  const before = s.owner!.cash;
  const old = s.owner!.selected;
  assert.ok(hireDriver(s, 1, 'gp-piastra'));
  assert.equal(s.owner!.cash, before - driverFee('gp-piastra'));
  assert.notEqual(s.owner!.selected, old);
  assert.equal(s.owner!.selected, 'gp-piastra');
  assert.equal(hireDriver(s, 0, 'gp-piastra'), false);
  const cash = s.owner!.cash;
  setGrid(s, lineup(s).map((e) => e.id));
  assert.equal(recruitmentOpen(s), false);
  assert.equal(hireDriver(s, 0, 'gp-behrman'), false);
  assert.equal(s.owner!.cash, cash);
  finish(s);
  assert.equal(hireDriver(s, 0, 'gp-behrman'), false);
});

test('existing team customisation preserves legacy standings and its twenty-car grid', () => {
  const s = newCareer({ name: 'Owner', team: 'kestrel', difficulty: 50, length: 'short', rounds: 'short' }); takeOwnership(s);
  recordRound(s, { order: ['alm', 'whi'], dnf: [], fastest: 'alm' });
  const before = teamStandings(s).find((t) => t.yours)!.points;
  assert.ok(updateTeamIdentity(s, 'My Works', 0xff0055, 0x44ffcc));
  assert.equal(teamStandings(s).find((t) => t.yours)!.points, before);
  assert.equal(lineup(s).length, 20);
  assert.deepEqual(cleanCareer(JSON.parse(JSON.stringify(s))), s);
});

test('invalid custom entries fail safely, colours are bounded and GP driver ids are unique', () => {
  const s = start();
  assert.equal(cleanCareer({ ...s, entry: { ...s.entry, drivers: ['x', 'x'] } }), null);
  const bounded = cleanCareer({ ...s, entry: { ...s.entry, name: ' A '.repeat(100), paint: -5, secondary: Infinity } })!;
  assert.ok(bounded.entry!.name.length <= 28);
  assert.equal(bounded.entry!.paint, 0);
  assert.equal(bounded.entry!.secondary, 0x61e2be);
  assert.equal(new Set(GP_DRIVERS.map((d) => d.id)).size, 22);
  assert.equal(GP_TEAMS.length, 11);
});
