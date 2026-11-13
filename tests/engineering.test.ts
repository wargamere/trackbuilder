import assert from 'node:assert/strict';
import { test } from 'node:test';
import { aiDifficulty, carRating, cleanCareer, lineup, newCareer, nextSeason, playerCar, recordRound, setGrid, teamStandings } from '../src/career/career.ts';
import { takeOwnership, selectDriver } from '../src/career/owner.ts';
import { advanceToWeekend, announceRegulations, assignUpgrade, awardPractice, buildQuote, capSpent, carDevelopment, cleanEngineering, costCap, engineering, engineeringCapacity, improveEngineering, manufacture, PARTS, researchPrice, resourceIncome, setWorkforce, startResearch, adaptPart } from '../src/career/engineering.ts';
import { driverProgress, failureChance, hireStaff, operatingCosts } from '../src/career/dynasty.ts';
import { createCustomCareer, hireDriver } from '../src/career/teamManagement.ts';

const start = (seed = 1234) => { const s = newCareer({ name: 'Owner', team: 'kestrel', difficulty: 60, length: 'short', rounds: 'short' }, seed); takeOwnership(s); engineering(s); return s; };
const race = (s: ReturnType<typeof start>) => recordRound(s, { order: ['alm', 'whi', ...lineup(s).map((d) => d.id)], dnf: [], fastest: 'alm' });
const design = (s: ReturnType<typeof start>, id = 'aero-1') => { const e = engineering(s); if (!e.researched.includes(id)) e.researched.push(id); e.designs[id] = 1; };
const close = (a: number, b: number) => assert.ok(Math.abs(a - b) < 1e-9, `${a} ≈ ${b}`);

test('research spends RP, leaves cash and car performance unchanged, and unlocks a design after time advances', () => {
  const s = start(), e = engineering(s), cash = s.owner!.cash, car = playerCar(s);
  assert.ok(startResearch(s, 'aero-1')); assert.equal(e.rp, 400); assert.equal(s.owner!.cash, cash);
  assert.deepEqual(playerCar(s), car); assert.equal(startResearch(s, 'aero-1'), false);
  assert.equal(startResearch(s, 'aero-2'), false); assert.equal(startResearch(s, 'chassis-1'), false, 'one initial research slot');
  assert.ok(advanceToWeekend(s)); assert.ok(e.researched.includes('aero-1')); assert.deepEqual(playerCar(s), car);
  const rp = e.rp, day = e.day; assert.equal(advanceToWeekend(s), false); assert.equal(e.rp, rp); assert.equal(e.day, day);
});

test('manufacturing needs a researched design; two copies cost less per car and take longer; rush trades money and reliability for time', () => {
  const s = start(); assert.equal(manufacture(s, 'aero-1', 1), false); design(s);
  const one = buildQuote(s, 'aero-1', 1), two = buildQuote(s, 'aero-1', 2), rush = buildQuote(s, 'aero-1', 2, true);
  assert.ok(two.cost < one.cost * 2); assert.ok(two.days > one.days); assert.ok(rush.days < two.days); assert.ok(rush.cost > two.cost); assert.ok(rush.risk > two.risk);
  const cash = s.owner!.cash; assert.ok(manufacture(s, 'aero-1', 2)); assert.equal(s.owner!.cash, cash - two.cost);
  assert.equal(manufacture(s, 'aero-1', 1), false); assert.equal(assignUpgrade(s, 'aero-1', 0), false);
});

test('delivered copies stay in stock until fitted and only improve the assigned car', () => {
  const s = start(), e = engineering(s); design(s); const base = playerCar(s), pace = aiDifficulty(s, 0, 'alm'), otherPace = aiDifficulty(s, 0, 'whi');
  assert.ok(manufacture(s, 'aero-1', 1)); e.production[0].risk = 0; advanceToWeekend(s);
  assert.equal(e.stock['aero-1'], 1); assert.deepEqual(playerCar(s), base);
  assert.ok(assignUpgrade(s, 'aero-1', 0)); assert.equal(e.stock['aero-1'], 0);
  assert.ok(aiDifficulty(s, 0, 'alm') > pace); assert.equal(carDevelopment(s, 'whi').aero, 0); assert.ok(aiDifficulty(s, 0, 'whi') < otherPace, 'the unfavoured driver only receives a morale penalty');
  assert.deepEqual(playerCar(s), base, 'car 2 is selected'); assert.equal(assignUpgrade(s, 'aero-1', 0), false);
  selectDriver(s, 'alm'); assert.ok(playerCar(s).grip > base.grip);
  assert.equal(driverProgress(s, 'whi').morale, 62); assert.equal(driverProgress(s, 'alm').morale, 66);
  close(carRating(s, s.team), s.cars.kestrel + .006);
});

test('balanced allocation restores the second driver and physical car upgrades survive driver replacement', () => {
  const s = start(), e = engineering(s); design(s); e.stock['aero-1'] = 2;
  assignUpgrade(s, 'aero-1', 0); assignUpgrade(s, 'aero-1', 1);
  assert.equal(driverProgress(s, 'whi').morale, 65); assert.deepEqual(e.fitted, [['aero-1'], ['aero-1']]);
  assert.equal(manufacture(s, 'aero-1', 1), false);
  assert.ok(hireDriver(s, 0, 'lin')); assert.equal(carDevelopment(s, 'lin').aero, .012); assert.equal(carDevelopment(s, 'alm').aero, 0);
});

test('each installed category affects its intended physics and durability affects AI reliability', () => {
  const s = start(), e = engineering(s); selectDriver(s, 'alm'); const base = playerCar(s), failure = failureChance(s, 'alm');
  for (const id of ['powertrain-1', 'chassis-1', 'durability-1']) { design(s, id); e.stock[id] = 1; assert.ok(assignUpgrade(s, id, 0)); }
  assert.ok(playerCar(s).pull > base.pull); assert.ok(playerCar(s).top > base.top); assert.ok(playerCar(s).grip > base.grip); assert.ok(failureChance(s, 'alm') < failure);
});

test('manufacturing outcomes are deterministic across reload and failed copies can be reordered without researching again', () => {
  const s = start(0), e = engineering(s); design(s); manufacture(s, 'aero-1', 2); e.production[0].days = 1; e.production[0].risk = .3;
  const restored = cleanCareer(JSON.parse(JSON.stringify(s)))!; assert.deepEqual(restored, s);
  advanceToWeekend(s); advanceToWeekend(restored); assert.deepEqual(restored, s);
  assert.equal(e.stock['aero-1'], 1, 'one copy failed quality control'); assert.equal(e.production.length, 0); assert.ok(e.researched.includes('aero-1'));
  assert.ok(manufacture(s, 'aero-1', 1), 'only the failed copy needs reordering');
});

test('prerequisites apply to research and fitting, and production can run alongside independent research', () => {
  const s = start(), e = engineering(s); assert.equal(startResearch(s, 'aero-2'), false); design(s); design(s, 'aero-2'); e.stock['aero-2'] = 1;
  assert.equal(assignUpgrade(s, 'aero-2', 0), false); e.stock['aero-1'] = 1; assignUpgrade(s, 'aero-1', 0); assert.ok(assignUpgrade(s, 'aero-2', 0));
  assert.ok(manufacture(s, 'aero-1', 1)); assert.ok(startResearch(s, 'chassis-1'));
});

test('workforce and facility investments affect duration, capacity, risk, RP and real race payroll', () => {
  const s = start(), e = engineering(s); s.owner!.cash = 100_000_000;
  const before = buildQuote(s, 'powertrain-4', 2), income = resourceIncome(s);
  assert.ok(setWorkforce(s, 50)); assert.ok(resourceIncome(s) > income); assert.equal(operatingCosts(s), 225_000);
  assert.ok(improveEngineering(s, 'research')); assert.ok(improveEngineering(s, 'research')); assert.equal(engineeringCapacity(s, 'research'), 2);
  assert.ok(improveEngineering(s, 'quality')); assert.ok(buildQuote(s, 'powertrain-4', 2).risk < before.risk);
  assert.ok(buildQuote(s, 'powertrain-4', 2).days < before.days); const cash = s.owner!.cash;
  race(s); assert.equal(s.owner!.cash, cash + 1_000_000 + 43 * 35_000 - 225_000); assert.equal(e.day, 14);
});

test('technical staff reduce research RP and freeze improved design quality at research start', () => {
  const s = start(), e = engineering(s); hireStaff(s, 'hart'); assert.equal(researchPrice(s, 'aero-1'), 414);
  startResearch(s, 'aero-1'); delete s.owner!.world!.staff.technical; advanceToWeekend(s);
  close(e.designs['aero-1'], 1.06);
});

test('practice rewards require valid timing data, pay once per programme, persist and reset for the next race', () => {
  const s = start(), e = engineering(s), rp = e.rp;
  assert.equal(awardPractice(s, NaN, 60), 0); assert.equal(awardPractice(s, -1, 60), 0);
  assert.equal(awardPractice(s, 75, 60), 100); assert.equal(awardPractice(s, 65, 60), 150); assert.equal(awardPractice(s, 66, 60), 200);
  const restored = cleanCareer(JSON.parse(JSON.stringify(s)))!; assert.equal(awardPractice(restored, 60, 60), 0); assert.equal(e.rp, rp + 450);
  setGrid(s, []); assert.equal(awardPractice(s, 60, 60), 0); assert.equal(advanceToWeekend(s), false);
  race(s); assert.equal(awardPractice(s, 60, 60), 250);
});

test('research income follows constructors points and countback, giving lower placed teams more', () => {
  const s = start(); const before = resourceIncome(s); race(s);
  assert.equal(teamStandings(s)[0].team.id, s.team); assert.ok(resourceIncome(s) < before);
});

test('cost cap blocks unaffordable engineering orders without charging cash or RP', () => {
  const s = start(); design(s); s.owner!.cash = 1e9; s.owner!.spent += costCap(s) - 100_000;
  const cash = s.owner!.cash; assert.ok(capSpent(s) > 0); assert.equal(manufacture(s, 'aero-1', 1), false); assert.equal(improveEngineering(s, 'quality'), false); assert.equal(s.owner!.cash, cash);
  assert.ok(startResearch(s, 'aero-1') === false, 'already researched');
});

test('regulation adaptation preserves protected upgrades and removes unadapted ones at season change without doubling performance', () => {
  const s = start(), e = engineering(s); s.owner!.cash = 1e8; e.rp = 10_000;
  while (s.done.length < s.calendar.length - 3) race(s); announceRegulations(s);
  e.regulation!.area = 'aero'; const id = 'aero-1'; design(s, id); e.stock[id] = 2; assignUpgrade(s, id, 0); assignUpgrade(s, id, 1);
  const lost = cleanCareer(JSON.parse(JSON.stringify(s)))!; assert.ok(adaptPart(s, id));
  while (s.done.length < s.calendar.length) race(s); while (lost.done.length < lost.calendar.length) race(lost);
  const expected = carRating(s, s.team); nextSeason(s, s.team); nextSeason(lost, lost.team);
  assert.equal(e.researched.length, 0); assert.equal(e.fitted[0].length, 0); assert.equal(e.baseline![0].aero, .012);
  assert.equal(engineering(lost).baseline![0].aero, 0); assert.ok(carRating(lost, lost.team) < carRating(s, s.team));
  close(carRating(s, s.team), expected); assert.equal(capSpent(s), 0); assert.equal(e.advanced, '');
});

test('legacy owner migration keeps money, already earned car ratings and pending paid packages', () => {
  const s = start(); delete s.owner!.engineering; s.owner!.project = true; s.owner!.research = { id: 'concept', remaining: 1 };
  const cash = s.owner!.cash, car = s.cars.kestrel; engineering(s); assert.equal(s.owner!.cash, cash); assert.equal(s.cars.kestrel, car);
  race(s); close(s.cars.kestrel, car + .065); assert.equal(s.owner!.project, false);
});

test('a custom 24-car team has independent physical upgrades and save data stays bounded', () => {
  const s = createCustomCareer({ principal: 'Owner', name: 'Nova', paint: 1, secondary: 2, drivers: ['reserve-reed', 'reserve-sato'], difficulty: 60, length: 'short', rounds: 'short' }, 9)!;
  const e = engineering(s); design(s); e.stock['aero-1'] = 2; assignUpgrade(s, 'aero-1', 1);
  assert.equal(lineup(s).length, 24); assert.equal(carDevelopment(s, 'reserve-sato').aero, .012); assert.deepEqual(cleanCareer(JSON.parse(JSON.stringify(s))), s);
  const bad = cleanEngineering({ ...e, rp: Infinity, workforce: -1, designs: { 'aero-1': 999 }, stock: { 'aero-1': 500, bad: 2 }, fitted: [['aero-1', 'aero-1', 'missing'], []], research: [null], production: [{ part: 'aero-1', id: 80, copies: 999, days: -10, total: 20 }] })!;
  assert.equal(bad.rp, 0); assert.equal(bad.workforce, 20); assert.equal(bad.designs['aero-1'], 1.4); assert.equal(bad.stock['aero-1'], 1); assert.equal(bad.stock.bad, undefined); assert.deepEqual(bad.fitted[0], ['aero-1']); assert.equal(bad.production.length, 0);
  assert.equal(PARTS.length, 16);
});
