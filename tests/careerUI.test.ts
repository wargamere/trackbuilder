import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { Window } from 'happy-dom';
import type { EventResult, GameContext, RaceEventSpec } from '../src/core/screen.ts';
import type { Surface2D } from '../src/core/surface2d.ts';
const win = new Window({ url: 'https://career.test/' });
for (const key of ['window', 'document', 'HTMLElement', 'HTMLInputElement', 'HTMLTextAreaElement', 'HTMLButtonElement', 'Element', 'Node', 'AbortController', 'getComputedStyle']) {
  Object.defineProperty(globalThis, key, { configurable: true, value: key === 'window' ? win : Reflect.get(win, key) });
}
const { CareerScreen } = await import('../src/ui/careerScreen.ts');
const { CareerStore, carPerformance, lineup, nextRound, playerCar, recordRound } = await import('../src/career/career.ts');
const { getSampleTrack } = await import('../src/editor/pipeline.ts');
const { RecordBook } = await import('../src/race/records.ts');
const { TrackLibrary } = await import('../src/track/library.ts');
const { storage } = await import('../src/platform/storage.ts');
const { settings } = await import('../src/core/settings.ts');
storage.removeItem('career.v1');
const ui = win.document.createElement('div'); win.document.body.append(ui);
let event: RaceEventSpec | null = null;
let current = 'career';
const game: GameContext = {
  track: getSampleTrack(0), setTrack(t) { Object.assign(this, { track: t }); },
  ui: ui as unknown as HTMLElement, surface: { w: 1440, h: 900 } as unknown as Surface2D,
  view3d: null, records: new RecordBook(), library: new TrackLibrary(), setup: settings().raceSetup as GameContext['setup'],
  mode: 'race', lastResult: null, interrupted: false, preview: null,
  drive() {}, start() {}, openSetup() {}, closeSetup() {}, refreshPaint() {},
  go(id) { if (current === 'career') screen.exit(); current = id; if (id === 'career') screen.enter(); },
  event: null, startEvent(e) { event = e; screen.exit(); current = 'race'; }, career: new CareerStore(),
};
const screen = new CareerScreen(game); screen.enter();
after(() => win.close());
const text = () => ui.textContent ?? '';
const buttons = () => [...ui.querySelectorAll('button')];
const find = (label: string) => buttons().find((b) => b.getAttribute('aria-label') === label || b.querySelector('.btn-label')?.textContent === label || b.querySelector('.career-team-name')?.textContent === label);
const click = (label: string) => { const b = find(label); assert.ok(b, 'button ' + label + ' exists'); b.click(); };
const save = () => { const s = game.career.save; assert.ok(s); return s; };
const handed = () => { assert.ok(event); return event; };
const press = (code: string) => win.dispatchEvent(new win.KeyboardEvent('keydown', { code, bubbles: true }));

test('owner career uses the native fullscreen shell and six focused sections', () => {
  click('Take over an existing team');
  const name = ui.querySelector('input') as unknown as HTMLInputElement;
  name.value = 'Oskar'; name.dispatchEvent(new win.Event('input') as unknown as Event);
  click('Solaris Racing'); click('Long'); click('8 races'); click('Start career');
  save().seed = 1234; game.career.write();
  assert.equal(save().owner!.cash, 8_000_000);
  assert.equal(save().owner!.engineering!.rp, 850);
  assert.equal(ui.querySelectorAll('.owner-nav button').length, 6);
  assert.ok(text().includes('Team headquarters'));
  assert.equal(ui.querySelectorAll('.owner-driver').length, 2);
  assert.equal(ui.querySelector('.owner-lineup-art'), null);
  assert.ok(find('Advance to race weekend'));
  assert.equal(new CareerStore().save?.owner?.engineering?.rp, 850);
});

test('research, manufacturing and fitting are separate user actions', () => {
  click('Drivers'); click('Race as Nakamura');
  click('Personnel'); click('Hire Luca Soren');
  click('Driver lineup'); click('Train Nakamura: Qualifying pace');
  click('Engineering'); click('Research Front wing profiles');
  const s = save(), cash = s.owner!.cash;
  assert.equal(s.owner!.engineering!.rp, 400);
  assert.equal(s.owner!.engineering!.research.length, 1);
  assert.equal(s.owner!.engineering!.researched.length, 0);
  click('Advance to race weekend');
  assert.ok(s.owner!.engineering!.researched.includes('aero-1'));
  assert.equal(s.owner!.cash, cash);
  click('Development');
  const one = ui.querySelector('[aria-label="Build 1 Front wing profiles"]') as unknown as HTMLButtonElement;
  assert.ok(one && !one.disabled); one.click();
  assert.equal(s.owner!.cash, cash - 400_000);
  assert.equal(s.owner!.engineering!.production.length, 1);
  click('Assign upgrades');
  assert.equal(s.owner!.engineering!.fitted[0].length, 0);
  assert.ok(text().includes('No manufactured copy available'));
  click('Overview');
});

test('valid practice signals earn programmes once and qualifying retains the chosen driver and grid', async () => {
  const { trackLapTime } = await import('../src/race/strategy.ts');
  click('Practice'); const practice = handed(), rp = save().owner!.engineering!.rp;
  assert.equal(practice.session, 'practice');
  for (let i = 0; i < 2; i++) practice.practised?.(trackLapTime(game.track));
  assert.equal(new CareerStore().save?.owner?.engineering?.practice.laps, 2, 'valid laps persist even when that lap pays no new RP');
  for (let i = 0; i < 2; i++) practice.practised?.(trackLapTime(game.track));
  assert.equal(save().owner!.engineering!.rp, rp + 450);
  practice.leave();
  click('Qualifying'); const e = handed();
  assert.equal(e.you.id, 'nak'); assert.equal(e.field.length, 19);
  assert.deepEqual(e.car, playerCar(save()));
  for (const rival of e.field) assert.deepEqual(rival.tune, carPerformance(save(), rival.id));
  const order = ['lin', 'nak', 'bre', ...e.field.map((d) => d.id).filter((id) => !['lin', 'bre'].includes(id))];
  e.qualified(order, {}); e.leave();
  assert.deepEqual(save().grid, order);
  click('Race as Brennan');
  assert.equal(save().owner!.selected, 'bre'); assert.deepEqual(save().grid, order);
  click('Engineering');
  assert.ok(text().includes('Available before qualifying'));
  click('Drivers'); click('Personnel');
  assert.equal(ui.querySelectorAll('.campaign-staff-card button:disabled').length, 6);
  click('Overview'); press('Enter');
  assert.equal(handed().session, 'race'); assert.equal(handed().you.id, 'bre');
});

test('race results pay once, charge workforce and staff, and deliver booked training', () => {
  const e = handed(), cash = save().owner!.cash;
  const order = ['nak', 'bre', ...e.field.map((d) => d.id).filter((id) => id !== 'nak')];
  const result: EventResult = { order, dnf: ['tan'], fastest: 'nak', times: order.map((id, i) => id === 'tan' ? null : 600 + i * 2), laps: order.map(() => 12), estimated: false };
  e.finished(result);
  assert.equal(save().done.length, 1);
  assert.equal(save().owner!.cash, cash + 1_000_000 + 43 * 35_000 - 165_000);
  assert.equal(save().owner!.world!.drivers.nak.pace, 1);
  assert.equal(save().owner!.world!.drivers.nak.xp, 42);
  assert.equal(save().owner!.engineering!.stock['aero-1'], undefined);
  const funds = save().owner!.cash;
  e.finished(result); assert.equal(save().owner!.cash, funds); assert.equal(save().done.length, 1);
  assert.ok(text().includes('You finished 2nd: 18 points'));
  press('Enter'); click('Championship'); click('Standings');
  assert.equal(ui.querySelectorAll('.career-table').length, 2);
  click('Team'); click('Finance'); assert.ok(text().includes('Staff and department operations'));
});

test('advancing the next weekend delivers stock, then fitting updates only the chosen physical car and persists', () => {
  click('Overview'); click('Advance to race weekend');
  assert.equal(save().owner!.engineering!.stock['aero-1'], 1);
  click('Engineering'); click('Assign upgrades');
  const cards = ui.querySelectorAll('.engineering-car-columns > section');
  const fit = [...cards[0].querySelectorAll('button')].find((b) => b.textContent === 'Fit upgrade');
  assert.ok(fit); fit.click();
  assert.deepEqual(save().owner!.engineering!.fitted, [['aero-1'], []]);
  assert.equal(save().owner!.engineering!.stock['aero-1'], 0);
  assert.deepEqual(new CareerStore().save?.owner?.engineering?.fitted, [['aero-1'], []]);
  click('Progress history'); assert.ok(text().includes('fitted to car 1'));
  click('Overview'); click('Race as Nakamura'); click('Engineering'); click('Vehicle');
  assert.ok(text().includes('Brennan ·'), 'AI reliability describes the current teammate, not the player-controlled car');
  click('Overview');
});

test('seasons carry engineering, finances, drivers and team identity forward', () => {
  const s = save();
  while (nextRound(s) !== null) recordRound(s, { order: ['nak', 'bre', ...lineup(s).map((d) => d.id)], dnf: [], fastest: null });
  const funds = s.owner!.cash, workers = s.owner!.engineering!.workforce;
  screen.exit(); screen.enter(); assert.ok(text().includes('Season 1 is over'));
  click('Start season 2');
  assert.equal(s.team, 'solaris'); assert.equal(s.owner!.cash, funds);
  assert.equal(s.owner!.engineering!.workforce, workers);
  assert.ok(s.owner!.engineering!.researched.includes('aero-1') || s.owner!.engineering!.history.some((item) => item.title.includes('regulation')));
  assert.equal(s.season, 2); assert.ok(find('Advance to race weekend'));
  click('Team'); click('Finance');
  const sign = [...ui.querySelectorAll('.owner-contract')].find((c) => c.textContent?.includes('Vector Energy'))!.querySelector('button')!;
  sign.click(); assert.equal(s.owner!.sponsor, 'vector');
});

test('focused navigation cannot start a session and abandonment still requires two taps', () => {
  const before = current;
  find('Drivers')!.dispatchEvent(new win.KeyboardEvent('keydown', { code: 'Enter', bubbles: true }));
  assert.equal(current, before);
  click('Career settings'); click('Abandon career'); assert.ok(game.career.save);
  click('Abandon it? Tap again'); assert.equal(game.career.save, null);
  press('Escape'); assert.equal(current, 'menu');
});

test('custom careers retain their 24-car identity through a season review', async () => {
  const { createCustomCareer } = await import('../src/career/teamManagement.ts');
  const s = createCustomCareer({ principal: 'Oskar', name: 'Nova Racing', paint: 0x7657ed, secondary: 0x61e2be, drivers: ['gp-norrin', 'gp-verstallen'], difficulty: 50, length: 'short', rounds: 'short' })!;
  while (nextRound(s) !== null) recordRound(s, { order: lineup(s).map((e) => e.id), dnf: [], fastest: null });
  game.career.start(s); current = 'career'; screen.enter();
  assert.ok(text().includes('Nova Racing'));
  click('Start season 2');
  assert.equal(s.team, 'privateer'); assert.deepEqual(s.entry!.drivers, ['gp-norrin', 'gp-verstallen']);
  assert.ok(text().includes('Nova Racing'));
});
