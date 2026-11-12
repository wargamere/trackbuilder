import assert from 'node:assert/strict';
import { test } from 'node:test';
import { aiDifficulty, cleanCareer, lineup, newCareer, nextSeason, playerCar, recordRound, roundFailures, setGrid } from '../src/career/career.ts';
import { commissionDevelopment, developmentCost, developmentGain, developmentRounds, takeOwnership } from '../src/career/owner.ts';
import { cleanDynasty, currentDecision, driverProgress, driverRating, dynasty, failureChance, hireStaff, managementOpen, operatingCosts, releaseStaff, resolveDecision, selectApproach, settleDynastyRound, trainDriver, upgradeDepartment, weekendApproach } from '../src/career/dynasty.ts';
import { driverDef, teamsFor } from '../src/career/roster.ts';
import { createCustomCareer } from '../src/career/teamManagement.ts';
import { CAREER } from '../src/config/career.ts';

const start = () => {
  const save = newCareer({ name: 'Principal', team: 'kestrel', difficulty: 60, length: 'short', rounds: 'short' }, 1234);
  takeOwnership(save); return save;
};
const podium = (save: ReturnType<typeof start>) => ({ order: ['alm', 'whi', ...lineup(save).map((d) => d.id).filter((id) => id !== 'alm' && id !== 'whi')], dnf: [] as string[], fastest: 'alm' });
const close = (actual: number, expected: number) => assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} ≈ ${expected}`);

test('an inbox decision charges once, saves its consequences and rejects stale replies', () => {
  const save = start(), w = dynasty(save), d = currentDecision(save)!;
  assert.equal(d.id, 'vision');
  assert.equal(resolveDecision(save, 'stale', 0), false);
  assert.equal(resolveDecision(save, d.key, -1), false);
  assert.ok(resolveDecision(save, d.key, 0));
  assert.equal(save.owner!.cash, 7_550_000); assert.equal(w.confidence, 71); assert.equal(w.morale, 69); assert.equal(w.insight, 1);
  assert.equal(driverProgress(save, 'alm').morale, 69);
  assert.equal(currentDecision(save), null); assert.equal(resolveDecision(save, d.key, 0), false);
  assert.equal(save.owner!.ledger!.filter((e) => e.amount < 0).length, 1);
  assert.deepEqual(cleanCareer(JSON.parse(JSON.stringify(save))), save);
});

test('decisions respect money and qualifying, then a result produces a new seeded situation', () => {
  const save = start(), d = currentDecision(save)!;
  save.owner!.cash = 0;
  assert.equal(resolveDecision(save, d.key, 0), false);
  setGrid(save, []); assert.equal(resolveDecision(save, d.key, 2), false);
  recordRound(save, { ...podium(save), dnf: ['whi'] });
  assert.equal(currentDecision(save)!.id, 'reliability');
  save.owner!.cash = 1_000_000;
  assert.ok(resolveDecision(save, currentDecision(save)!.key, 0));
  assert.equal(driverProgress(save, 'alm').consistency, 1);
  assert.equal(driverProgress(save, 'whi').consistency, 1);
});

test('staff contracts require reputation and a salary reserve, and can be released without extra fees', () => {
  const save = start();
  assert.equal(hireStaff(save, 'mercer'), false);
  save.owner!.cash = 650_000;
  assert.equal(hireStaff(save, 'hart'), false);
  save.owner!.cash = 8_000_000;
  assert.ok(hireStaff(save, 'hart')); assert.equal(hireStaff(save, 'hart'), false);
  assert.equal(save.owner!.cash, 7_350_000); assert.equal(operatingCosts(save), 90_000);
  assert.ok(releaseStaff(save, 'technical')); assert.equal(operatingCosts(save), 0); assert.equal(save.owner!.cash, 7_350_000);
  assert.equal(releaseStaff(save, 'technical'), false);
  dynasty(save).reputation = 40; assert.ok(hireStaff(save, 'mercer'));
  assert.equal(operatingCosts(save), 160_000);
});

test('research uses staff, laboratory and insight, freezing the quoted gain when commissioned', () => {
  const save = start();
  assert.ok(hireStaff(save, 'hart')); assert.ok(upgradeDepartment(save, 'laboratory'));
  assert.ok(resolveDecision(save, currentDecision(save)!.key, 0));
  assert.equal(developmentCost(save), 1_780_000);
  close(developmentGain(save), .035 * 1.12);
  const before = save.cars.kestrel;
  assert.ok(commissionDevelopment(save)); assert.equal(dynasty(save).insight, 0);
  assert.ok(releaseStaff(save, 'technical'));
  const restored = cleanCareer(JSON.parse(JSON.stringify(save)))!;
  recordRound(restored, podium(restored));
  close(restored.cars.kestrel, before + .035 * 1.12);
  assert.equal(restored.owner!.development, 1);
});

test('a maximum laboratory shortens long research and development weekends advance two rounds of work', () => {
  const save = start(); save.owner!.cash = 100_000_000;
  for (let i = 0; i < 3; i++) assert.ok(upgradeDepartment(save, 'laboratory'));
  assert.equal(upgradeDepartment(save, 'laboratory'), false);
  assert.equal(developmentRounds(save, 'concept'), 2);
  assert.ok(commissionDevelopment(save, 'concept')); assert.ok(selectApproach(save, 'development'));
  recordRound(save, podium(save));
  assert.equal(save.owner!.project, false); assert.equal(save.owner!.development, 1);
  assert.equal(driverProgress(save, 'alm').xp, 20);
});

test('training delivers only after a race, benefits from specialists and is isolated to the chosen driver', () => {
  const save = start(), base = driverDef('alm')!.skill;
  assert.ok(hireStaff(save, 'soren')); assert.ok(upgradeDepartment(save, 'simulator'));
  assert.ok(trainDriver(save, 'alm', 'pace')); assert.equal(trainDriver(save, 'alm', 'racecraft'), false);
  assert.equal(trainDriver(save, 'lin', 'pace'), false);
  close(driverRating(save, 'alm'), base);
  const restored = cleanCareer(JSON.parse(JSON.stringify(save)))!;
  recordRound(restored, podium(restored));
  assert.equal(driverProgress(restored, 'alm').xp, 47);
  assert.equal(driverProgress(restored, 'alm').pace, 1);
  assert.equal(driverProgress(restored, 'whi').xp, 8);
  assert.equal(driverProgress(restored, 'alm').training, undefined);
  assert.ok(driverRating(restored, 'alm') > base);
  assert.equal(driverDef('alm')!.skill, base, 'the shared roster is immutable');
  assert.ok(trainDriver(restored, 'alm', 'racecraft'));
});

test('experience affects the controlled car and unlocks a persistent level-three milestone', () => {
  const save = start(); const baseline = playerCar(save).grip;
  driverProgress(save, 'whi').xp = 199;
  recordRound(save, podium(save));
  assert.ok(dynasty(save).achievements.includes('developed-driver'));
  assert.ok(playerCar(save).grip > baseline);
  assert.equal(driverProgress(start(), 'whi').xp, 0, 'a different career has independent drivers');
});

test('weekend approach changes both cars and mechanical risk without changing rival pace', () => {
  const save = start(), pace = aiDifficulty(save, 0, 'alm'), rival = aiDifficulty(save, 0, 'lin'), pull = playerCar(save).pull;
  assert.ok(selectApproach(save, 'attack'));
  close(aiDifficulty(save, 0, 'alm') - pace, .006); close(playerCar(save).pull - pull, .004);
  close(aiDifficulty(save, 0, 'lin'), rival); close(failureChance(save, 'alm'), CAREER.failure + .012);
  close(failureChance(save, 'alm', 1), CAREER.failure);
  assert.ok(hireStaff(save, 'vale')); close(failureChance(save, 'alm'), CAREER.failure + .006);
  driverProgress(save, 'alm').consistency = 8;
  assert.ok(failureChance(save, 'alm') < CAREER.failure + .006);
  assert.ok(!Object.hasOwn(roundFailures(save, 0), save.owner!.selected), 'the controlled car is never scripted to retire');
  setGrid(save, []); assert.equal(selectApproach(save, 'balanced'), false);
  assert.equal(hireStaff(save, 'soren'), false); assert.equal(trainDriver(save, 'alm', 'pace'), false); assert.equal(upgradeDepartment(save, 'commercial'), false);
  recordRound(save, podium(save)); assert.equal(weekendApproach(save).id, 'balanced'); assert.ok(managementOpen(save));
});

test('operations, commercial income and sponsor money reconcile once with the cash ledger', () => {
  const save = start(); assert.ok(hireStaff(save, 'hart')); assert.ok(upgradeDepartment(save, 'commercial'));
  const cash = save.owner!.cash;
  const result = recordRound(save, podium(save))!;
  assert.equal(save.owner!.cash, cash + 1_000_000 + 43 * 35_000 + 75_000 - 115_000);
  assert.equal(dynasty(save).rival.won, 1);
  assert.equal(dynasty(save).fans, 2000 + Math.round((200 + 43 * 50) * 1.1));
  const serialized = JSON.stringify(save);
  settleDynastyRound(save, result, 1, 'alm');
  assert.equal(JSON.stringify(save), serialized, 'reopening a debrief cannot charge payroll or award achievements twice');
});

test('rival packages change the actual grid, deterministically, every third round', () => {
  const a = start(), b = start(), before = { ...a.cars }, own = a.cars.kestrel;
  for (let i = 0; i < 3; i++) { recordRound(a, podium(a)); recordRound(b, podium(b)); }
  assert.deepEqual(a.cars, b.cars); assert.equal(a.cars.kestrel, own);
  assert.ok(Object.keys(a.cars).some((id) => id !== a.team && a.cars[id] > before[id]));
  assert.ok(dynasty(a).news.some((n) => n.title === 'The grid keeps moving.'));
});

test('a full season awards titles and a board bonus once, carrying people and progress forward', () => {
  const save = start(); hireStaff(save, 'soren'); upgradeDepartment(save, 'simulator'); trainDriver(save, 'alm', 'racecraft');
  while (save.done.length < save.calendar.length) recordRound(save, podium(save));
  const w = dynasty(save), funds = save.owner!.cash, xp = driverProgress(save, 'alm').xp;
  for (const id of ['first-points', 'first-podium', 'first-win', 'drivers-title', 'constructors-title', 'rivalry-win']) assert.ok(w.achievements.includes(id), id);
  assert.equal(save.owner!.ledger!.filter((e) => e.label === 'Board objective bonus').length, 1);
  assert.equal(recordRound(save, podium(save)), null); assert.equal(save.owner!.cash, funds);
  nextSeason(save, 'aurora');
  assert.equal(save.team, 'kestrel'); assert.equal(save.owner!.cash, funds); assert.equal(w.staff.coach, 'soren'); assert.equal(w.departments.simulator, 1);
  assert.equal(driverProgress(save, 'alm').xp, xp); assert.equal(w.rival.won, 0); assert.equal(weekendApproach(save).id, 'balanced');
  assert.ok(w.achievements.includes('constructors-title')); assert.ok(currentDecision(save));
});

test('existing saves recognize prior results without replaying cash, development or XP rewards', () => {
  const save = start(); recordRound(save, podium(save)); delete save.owner!.world;
  const cash = save.owner!.cash, done = JSON.stringify(save.done), cars = { ...save.cars };
  const w = dynasty(save);
  assert.ok(w.achievements.includes('first-win')); assert.equal(w.rival.won, 1); assert.equal(driverProgress(save, 'alm').xp, 8);
  assert.equal(save.owner!.cash, cash); assert.equal(JSON.stringify(save.done), done); assert.deepEqual(save.cars, cars);
  recordRound(save, podium(save)); assert.equal(driverProgress(save, 'alm').xp, 16);
});

test('custom two-driver teams use their own roster for training, rivalry and milestone results', () => {
  const save = createCustomCareer({ principal: 'Owner', name: 'Nova Works', paint: 0x6699ff, secondary: 0xffaa22, drivers: ['reserve-reed', 'reserve-sato'], difficulty: 60, length: 'short', rounds: 'short' }, 44);
  assert.ok(save);
  const mine = teamsFor(save).find((t) => t.id === save.team)!;
  assert.notEqual(dynasty(save).rival.id, save.team);
  assert.ok(trainDriver(save, mine.drivers[0], 'pace'));
  recordRound(save, { order: [...mine.drivers], dnf: [], fastest: mine.drivers[0] });
  assert.equal(driverProgress(save, mine.drivers[0]).pace, 1); assert.ok(dynasty(save).achievements.includes('first-win'));
  assert.equal(lineup(save).length, 24);
});

test('malformed campaign saves clamp numbers and reject unknown staff, drivers and milestones', () => {
  const save = start();
  const w = cleanDynasty({ ...dynasty(save), confidence: Infinity, reputation: -99, fans: NaN, insight: 99, staff: { technical: 'tan', coach: 'soren', engineer: 'missing' }, departments: { laboratory: 99, simulator: -8 }, achievements: ['first-win', 'first-win', 'invented'], drivers: { alm: { xp: 1e20, morale: -1, pace: 999, consistency: Infinity }, absent: {} }, decisions: [null, { template: '__proto__', choice: 0 }] })!;
  assert.equal(w.confidence, 65); assert.equal(w.reputation, 0); assert.equal(w.fans, 2000); assert.equal(w.insight, 3);
  assert.deepEqual(w.staff, { coach: 'soren' }); assert.deepEqual(w.departments, { laboratory: 3, simulator: 0, commercial: 0 });
  assert.deepEqual(w.achievements, ['first-win']); assert.equal(w.drivers.alm.xp, 500); assert.equal(w.drivers.alm.morale, 0); assert.equal(w.drivers.alm.pace, 8); assert.equal(w.drivers.alm.consistency, 0);
  assert.equal(w.drivers.absent, undefined); assert.equal(w.decisions.length, 0);
  assert.equal(cleanDynasty({ v: 99 }), undefined);
  const cleaned = cleanCareer({ ...save, owner: { ...save.owner, world: { ...w, rival: { id: 'missing' } } } })!;
  assert.ok(teamsFor(cleaned).some((t) => t.id === dynasty(cleaned).rival.id && t.id !== cleaned.team));
});
