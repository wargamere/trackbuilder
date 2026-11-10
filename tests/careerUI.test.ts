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
const { CareerStore, driverStandings, lineup, nextRound, recordRound } = await import('../src/career/career.ts');
const { CAREER, YOU_ID } = await import('../src/config/career.ts');
const { getSampleTrack } = await import('../src/editor/pipeline.ts');
const { RecordBook } = await import('../src/race/records.ts');
const { TrackLibrary } = await import('../src/track/library.ts');
const { storage } = await import('../src/platform/storage.ts');
const { settings } = await import('../src/core/settings.ts');

storage.removeItem('career.v1');
const ui = win.document.createElement('div');
win.document.body.append(ui);
/** What the screen asked the game for: the round handed to the race screen, and where it went. */
let event: RaceEventSpec | null = null;
let current = 'career';
const went: string[] = [];
const game: GameContext = {
  track: getSampleTrack(0),
  setTrack(t) { Object.assign(this, { track: t }); },
  ui: ui as unknown as HTMLElement,
  surface: { w: 1440, h: 900 } as unknown as Surface2D,
  view3d: null, records: new RecordBook(), library: new TrackLibrary(), setup: settings().raceSetup as GameContext['setup'],
  mode: 'race', lastResult: null, interrupted: false, preview: null,
  drive() {}, start() {}, openSetup() {}, closeSetup() {}, refreshPaint() {},
  go(id) {
    went.push(id);
    // (As the game does it: the screen being left is closed, the one gone to is opened.)
    if (current === 'career') screen.exit();
    current = id;
    if (id === 'career') screen.enter();
  },
  event: null,
  startEvent(e) {
    event = e;
    screen.exit();
    current = 'race';
  },
  career: new CareerStore(),
};
const screen = new CareerScreen(game);
screen.enter();
after(() => win.close());

const text = () => ui.textContent ?? '';
const buttons = () => [...ui.querySelectorAll('button')];
const find = (label: string) => buttons().find((b) => b.querySelector('.btn-label')?.textContent === label || b.querySelector('.career-team-name')?.textContent === label);
const click = (label: string) => {
  const b = find(label);
  assert.ok(b, `button "${label}" exists (have: ${buttons().map((x) => x.textContent).join(' | ')})`);
  b.click();
};
const press = (code: string) => win.dispatchEvent(new win.KeyboardEvent('keydown', { code, bubbles: true }));
const save = () => {
  const s = game.career.save;
  assert.ok(s, 'a career is under way');
  return s;
};
/** The round the screen last handed over. */
const handed = (): RaceEventSpec => {
  assert.ok(event, 'a round was handed to the race screen');
  return event;
};

test('starting a career: your name, a team, how fast the AI is and how long the races and the season are', () => {
  assert.equal(game.career.save, null);
  assert.ok(text().includes('Start a career'));
  assert.equal(ui.querySelectorAll('.career-team').length, 10, 'ten teams to choose from');
  const name = ui.querySelector('input') as unknown as HTMLInputElement;
  name.value = 'Oskar';
  name.dispatchEvent(new win.Event('input') as unknown as Event);
  click('Solaris Racing');
  assert.ok(find('Solaris Racing')?.classList.contains('on'));
  assert.ok(text().includes('Expects 3rd'), 'the third-best car');
  assert.equal((ui.querySelector('input') as unknown as HTMLInputElement).value, 'Oskar', 'the name survives the other choices');
  click('Long');
  click('8 races');
  click('Start career');
  const s = save();
  assert.deepEqual([s.name, s.team, s.length, s.rounds, s.season, s.calendar.length], ['Oskar', 'solaris', 'long', 'short', 1, 8]);
  assert.ok(storage.getItem('career.v1'), 'saved at once');
});

test('the paddock: the next race with its track, the forecast and your tyres; the track is the game’s, ready to drive', () => {
  const s = save();
  assert.ok(text().includes('Season 1'));
  assert.ok(text().includes('Round 1 of 8'));
  assert.ok(text().includes('Melbourne'), 'the first round of the calendar');
  assert.equal(game.track.def.id, s.calendar[0]);
  assert.ok(text().includes('Oskar'));
  assert.ok(find('Qualifying') && find('Practice') && !find('Start the race'), 'no race before qualifying');
  // Tyres: the choice is kept.
  const hard = buttons().find((b) => b.dataset.compound === 'hard');
  assert.ok(hard);
  hard.click();
  assert.equal(save().tyres, 'hard');
  assert.ok(buttons().find((b) => b.dataset.compound === 'hard')?.classList.contains('on'));
});

test('a round handed to the race screen: nineteen named AI cars in their team colours, teammates sharing a pit box, the championship’s rules', () => {
  click('Qualifying');
  const e = handed();
  assert.equal(current, 'race');
  assert.equal(e.session, 'qualifying');
  assert.equal(e.grid, null);
  assert.equal(e.field.length, CAREER.cars - 1);
  assert.equal(new Set(e.field.map((f) => f.id)).size, 19);
  assert.ok(!e.field.some((f) => f.id === YOU_ID || f.id === 'bre'), 'you have Brennan’s seat');
  for (const f of e.field) {
    const team = CAREER.teams.find((t) => t.drivers.includes(f.id));
    assert.ok(team);
    assert.equal(f.paint, team.paint);
    assert.equal(f.box, CAREER.teams.indexOf(team));
    assert.ok(f.difficulty > 0.35 && f.difficulty <= 0.52, `${f.id}: ${f.difficulty.toFixed(3)} around the 50 % chosen`);
  }
  for (let k = 1; k < e.field.length; k++) assert.ok(e.field[k - 1].difficulty >= e.field[k].difficulty, 'quickest first');
  const solaris = CAREER.teams.find((t) => t.id === 'solaris');
  assert.ok(solaris);
  assert.deepEqual(e.you, { id: YOU_ID, name: 'Oskar', paint: solaris.paint, box: 2 });
  assert.equal(e.field.find((f) => f.id === 'nak')?.box, 2, 'your teammate shares your box');
  assert.ok(e.car.grip < 1 && e.car.grip > 0.98, 'the third-best car: a touch off the best');
  const st = e.setup;
  assert.deepEqual([st.mode, st.opponents, st.tyreWear, st.damage, st.safetyCar, st.ghost, st.tyres], ['race', 19, true, true, true, false, 'hard']);
  assert.ok(st.laps >= CAREER.lengths.long.minLaps && st.laps <= CAREER.maxLaps, `${st.laps} laps`);
  assert.ok(e.title.includes('Round 1 of 8'));
  assert.ok(e.tyreLife >= st.laps * CAREER.tyreShare - 1e-9, `mediums last ${e.tyreLife.toFixed(1)} of ${st.laps} laps: a long race is a stop or two, not four`);
});

test('qualifying sets the grid, which is kept: leave and come back, and the race starts from it', () => {
  const e = handed();
  const order = ['val', 'lin', YOU_ID, ...e.field.map((f) => f.id).filter((id) => id !== 'val' && id !== 'lin')];
  e.qualified(order, {});
  assert.deepEqual(save().grid, order);
  assert.deepEqual(new CareerStore().save?.grid, order, 'saved');
  // Back to the paddock without racing.
  e.leave();
  assert.equal(current, 'career');
  assert.ok(text().includes('You start 3rd of 20'));
  assert.equal(ui.querySelectorAll('.career-grid li').length, 20);
  assert.ok(ui.querySelector('.career-grid li.you')?.textContent?.includes('Oskar'));
  assert.equal(save().done.length, 0, 'nothing is scored by leaving');
  // Practice changes nothing either: alone, no wear or damage.
  click('Practice');
  assert.deepEqual([handed().session, handed().setup.mode, handed().setup.damage, handed().setup.tyreWear], ['practice', 'practice', false, false]);
  handed().leave();
  assert.deepEqual(save().grid, order);
  // Enter starts the race, from the grid.
  press('Enter');
  assert.equal(current, 'race');
  assert.equal(handed().session, 'race');
  assert.deepEqual(handed().grid, order);
});

test('the race’s result: the classification with the points, saved; then the standings', () => {
  const e = handed();
  const ids = [YOU_ID, ...e.field.map((f) => f.id)];
  const order = ['lin', YOU_ID, ...ids.filter((id) => id !== 'lin' && id !== YOU_ID && id !== 'tan' && id !== 'rey'), 'rey', 'tan'];
  const result: EventResult = {
    order,
    dnf: ['tan'],
    fastest: YOU_ID,
    times: order.map((id, i) => (id === 'tan' ? null : 600 + i * 1.5)),
    laps: order.map((id) => (id === 'tan' ? 4 : id === 'rey' ? 11 : 12)),
    estimated: false,
  };
  e.finished(result);
  assert.equal(current, 'career');
  assert.equal(went[went.length - 1], 'career');
  const s = save();
  assert.equal(s.done.length, 1);
  assert.equal(s.grid, null);
  assert.equal(s.done[0].pole, 'val');
  assert.equal(new CareerStore().save?.done.length, 1, 'saved');
  assert.ok(text().includes('You finished 2nd: 18 points'));
  assert.ok(text().includes('Round 1: Melbourne'));
  const rows = [...ui.querySelectorAll('.career-table tbody tr')];
  assert.equal(rows.length, 20);
  assert.ok(rows[0].textContent?.includes('Lindqvist') && rows[0].textContent.includes('+25') && rows[0].textContent.includes('10:00.00'));
  assert.ok(rows[1].classList.contains('you') && rows[1].textContent?.includes('+18') && rows[1].textContent.includes('+1.50'));
  assert.ok(rows[1].querySelector('.career-fl'), 'your fastest lap is marked');
  assert.ok(rows[18].textContent?.includes('+1 lap'), 'a car flagged a lap down');
  assert.ok(rows[19].classList.contains('dnf') && rows[19].textContent?.includes('DNF') && !rows[19].textContent.includes('+'));
  assert.ok(!rows[10].textContent?.includes('+1') || rows[10].textContent.includes('.'), 'no points outside the top ten');
  // Continue: the drivers' standings, then the next round.
  press('Enter');
  const table = [...ui.querySelectorAll('.career-table tbody tr')];
  assert.equal(table.length, 20);
  assert.ok(table[0].textContent?.includes('Lindqvist') && table[0].textContent.includes('25'));
  assert.ok(table[1].classList.contains('you') && table[1].textContent?.includes('18'));
  assert.ok(text().includes('Round 2 of 8'));
  assert.equal(game.track.def.id, s.calendar[1], 'the next round’s track is up');
  click('Teams');
  const teams = [...ui.querySelectorAll('.career-table tbody tr')];
  assert.equal(teams.length, 10);
  assert.ok(teams.some((r) => r.classList.contains('you') && r.textContent?.includes('Solaris Racing')));
  click('Calendar');
  const cal = [...ui.querySelectorAll('.career-calendar li')];
  assert.equal(cal.length, 8);
  assert.ok(cal[0].textContent?.includes('Won by Lindqvist') && cal[0].textContent.includes('You: 2nd'));
  assert.ok(cal[1].classList.contains('next'));
  click('Next race');
  assert.ok(find('Qualifying') && !find('Start the race'), 'the next round needs its own qualifying');
});

test('the end of the season: the champions, your season against your team’s target, the teams that want you, and on to the next', () => {
  const s = save();
  // You win every race that's left.
  while (nextRound(s) !== null) recordRound(s, { order: [YOU_ID, ...lineup(s).map((e) => e.id).filter((id) => id !== YOU_ID)], dnf: [], fastest: null });
  game.career.write();
  screen.exit();
  screen.enter();
  assert.ok(text().includes('Season 1 is over'));
  assert.equal(driverStandings(s)[0].id, YOU_ID);
  assert.ok(text().includes('You are the champion!'));
  assert.ok(text().includes('7 wins'));
  const offers = [...ui.querySelectorAll('.career-offers .career-team')];
  assert.equal(offers.length, 10, 'the champion can go anywhere');
  assert.ok(offers.some((b) => b.textContent?.includes('Solaris Racing (your team)')));
  click('Aurora GP');
  click('Start season 2');
  assert.deepEqual([s.season, s.team, s.done.length, s.history.length], [2, 'aurora', 0, 1]);
  assert.equal(s.history[0].position, 1);
  assert.ok(text().includes('Season 2') && text().includes('Round 1 of 8'));
  assert.equal(new CareerStore().save?.season, 2, 'saved');
  click('Career');
  assert.ok(text().includes('1 drivers’ title'));
  assert.ok(text().includes('Season 1 · Solaris Racing · 1st'));
});

test('abandoning the career takes two taps, then a new one can be started; Esc goes back to the main menu', () => {
  click('Abandon career');
  assert.ok(game.career.save, 'one tap does nothing yet');
  click('Abandon it? Tap again');
  assert.equal(game.career.save, null);
  assert.equal(storage.getItem('career.v1'), null);
  assert.ok(text().includes('Start a career'));
  went.length = 0;
  press('Escape');
  assert.deepEqual(went, ['menu']);
});
