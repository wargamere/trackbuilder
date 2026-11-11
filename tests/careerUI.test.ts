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
const { CareerStore, lineup, nextRound, recordRound } = await import('../src/career/career.ts');
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

test('start an owner career with two named drivers and a persistent budget', () => {
  assert.ok(text().includes('Start a team-owner career'));
  assert.equal(ui.querySelectorAll('.career-team').length, 10);
  const name = ui.querySelector('input') as unknown as HTMLInputElement;
  name.value = 'Oskar'; name.dispatchEvent(new win.Event('input') as unknown as Event);
  click('Solaris Racing'); click('Long'); click('8 races'); click('Start career');
  const s = save();
  assert.deepEqual([s.name, s.team, s.length, s.rounds, s.calendar.length], ['Oskar', 'solaris', 'long', 'short', 8]);
  assert.equal(s.owner!.cash, 8_000_000); assert.equal(s.owner!.selected, 'bre');
  assert.ok(text().includes('TEAM OWNER') && text().includes('Team principal'));
  assert.ok(text().includes('Melbourne') && text().includes('GRAND PRIX'));
  assert.ok(ui.querySelector('svg[aria-label="Melbourne circuit layout"]'));
  assert.equal(ui.querySelectorAll('.owner-driver').length, 2);
  assert.ok(find('Qualifying') && find('Practice'));
  assert.equal(new CareerStore().save?.owner?.cash, 8_000_000);
});

test('owner navigation, upgrades and driver choice affect saved state', () => {
  click('Drivers'); click('Race as Nakamura');
  assert.equal(save().owner!.selected, 'nak');
  assert.equal(find('Race as Nakamura')!.getAttribute('aria-pressed'), 'true');
  click('Development'); (ui.querySelector('.research-balanced button') as unknown as HTMLButtonElement).click();
  assert.equal(save().owner!.cash, 6_000_000); assert.equal(save().owner!.project, true);
  assert.equal(ui.querySelectorAll('.research-option button:disabled').length, 3);
  click('Facilities'); buttons().find((b) => b.textContent?.includes('Expand headquarters'))!.click();
  assert.equal(save().owner!.facilities, 1);
  click('Vehicle'); assert.ok(text().includes('CAR RATING'));
  click('Overview'); buttons().find((b) => b.dataset.compound === 'hard')!.click();
  assert.equal(save().tyres, 'hard');
});

test('qualifying uses the chosen driver, nineteen AI cars and a shared pit box', () => {
  click('Qualifying'); const e = handed();
  assert.equal(e.session, 'qualifying'); assert.equal(e.you.id, 'nak'); assert.equal(e.you.name, 'Nakamura');
  assert.equal(e.field.length, 19);
  assert.ok(e.field.some((d) => d.id === 'bre' && d.box === e.you.box));
  assert.ok(!e.field.some((d) => d.id === 'nak' || d.id === 'you'));
  assert.deepEqual([e.setup.tyreWear, e.setup.damage, e.setup.safetyCar, e.setup.tyres], [true, true, true, 'hard']);
  const order = ['lin', 'nak', 'bre', ...e.field.map((f) => f.id).filter((id) => id !== 'lin' && id !== 'bre')];
  e.qualified(order, {}); e.leave();
  assert.equal(current, 'career'); assert.deepEqual(save().grid, order);
  assert.equal(ui.querySelectorAll('.career-grid li').length, 20);
  click('Race as Brennan'); assert.deepEqual(save().grid, order);
  assert.ok(text().includes('You start 3rd of 20'));
  click('Practice'); assert.equal(handed().session, 'practice'); assert.equal(handed().setup.damage, false); handed().leave();
  press('Enter'); assert.equal(handed().session, 'race'); assert.equal(handed().you.id, 'bre');
  assert.deepEqual(handed().grid, order);
});

test('results score both drivers, pay the team and deliver development', () => {
  const e = handed(); const order = ['nak', 'bre', ...e.field.map((d) => d.id).filter((id) => id !== 'nak')];
  const result: EventResult = { order, dnf: ['tan'], fastest: 'nak', times: order.map((id, i) => id === 'tan' ? null : 600 + i * 2), laps: order.map(() => 12), estimated: false };
  e.finished(result);
  assert.equal(save().done.length, 1); assert.equal(save().owner!.development, 1);
  assert.equal(save().owner!.earned, 1_250_000 + 43 * 35_000);
  const funds = save().owner!.cash;
  e.finished(result);
  assert.equal(save().done.length, 1, 'a repeated finish callback cannot record another round');
  assert.equal(save().owner!.cash, funds, 'a repeated finish cannot pay again');
  assert.ok(text().includes('You finished 2nd: 18 points'));
  assert.equal(ui.querySelectorAll('.career-table tbody tr').length, 20);
  press('Enter'); click('Standings');
  assert.equal(ui.querySelectorAll('.career-table').length, 2);
  click('Finance');
  assert.equal(ui.querySelectorAll('.owner-contract').length, 3);
  assert.equal(ui.querySelectorAll('.owner-contract button:disabled').length, 3);
  assert.ok(text().includes('Headquarters · level 1'));
  click('Overview'); assert.ok(text().includes('ROUND 02'));
  assert.equal(new CareerStore().save?.owner?.development, 1);
});

test('owners keep their team, selection and funds next season', () => {
  const s = save();
  while (nextRound(s) !== null) recordRound(s, { order: ['nak', 'bre', ...lineup(s).map((d) => d.id).filter((id) => id !== 'nak' && id !== 'bre')], dnf: [], fastest: null });
  const funds = s.owner!.cash; screen.exit(); screen.enter();
  assert.ok(text().includes('Season 1 is over'));
  assert.equal(ui.querySelectorAll('.career-offers .career-team').length, 1);
  click('Start season 2');
  assert.equal(s.team, 'solaris'); assert.equal(s.owner!.cash, funds); assert.equal(s.owner!.selected, 'bre');
  assert.equal(s.season, 2); assert.ok(text().includes('CHAMPIONSHIP / SEASON 02'));
  click('Finance');
  const sign = [...ui.querySelectorAll('.owner-contract')].find((c) => c.textContent?.includes('Vector Energy'))!.querySelector('button')!;
  sign.click();
  assert.equal(s.owner!.sponsor, 'vector');
  assert.equal(new CareerStore().save?.owner?.sponsor, 'vector');
});

test('focused navigation cannot launch a race; abandonment needs two taps', () => {
  const before = current;
  find('Drivers')!.dispatchEvent(new win.KeyboardEvent('keydown', { code: 'Enter', bubbles: true }));
  assert.equal(current, before);
  click('Career settings'); click('Abandon career'); assert.ok(game.career.save);
  click('Abandon it? Tap again'); assert.equal(game.career.save, null); assert.equal(storage.getItem('career.v1'), null);
  press('Escape'); assert.equal(current, 'menu');
});
