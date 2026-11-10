import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { Window, HTMLElement as TestElement, HTMLInputElement as TestInput, HTMLButtonElement as TestButton } from 'happy-dom';
import type { GameContext } from '../src/core/screen.ts';
import type { Surface2D } from '../src/core/surface2d.ts';

const win = new Window({ url: 'https://studio.test/' });
for (const key of ['window', 'document', 'HTMLElement', 'HTMLInputElement', 'HTMLTextAreaElement', 'HTMLButtonElement', 'Element', 'Node', 'AbortController', 'getComputedStyle']) {
  Object.defineProperty(globalThis, key, { configurable: true, value: key === 'window' ? win : Reflect.get(win, key) });
}
const { EditorScreen } = await import('../src/editor/drawing.ts');
const { getSampleTrack } = await import('../src/editor/pipeline.ts');
const { RecordBook } = await import('../src/race/records.ts');
const { TrackLibrary } = await import('../src/track/library.ts');
const { readDraft } = await import('../src/editor/draft.ts');
const { storage } = await import('../src/platform/storage.ts');
const { settings } = await import('../src/core/settings.ts');
const { CareerStore } = await import('../src/career/career.ts');

const canvas = win.document.createElement('canvas');
const ctx = new Proxy({}, { get: (_target, key) => key === 'measureText' ? (text: string) => ({ width: text.length * 7 }) : () => {} });
const ui = win.document.createElement('div');
ui.id = 'ui';
win.document.body.append(canvas, ui);
const { installCommonFixes } = await import('../src/core/browserInput.ts');
installCommonFixes();
let drove = '';
const game: GameContext = {
  track: getSampleTrack(0),
  setTrack(t) { Object.assign(this, { track: t }); },
  ui: ui as unknown as HTMLElement,
  surface: { canvas, w: 1440, h: 900, begin: () => ctx } as unknown as Surface2D,
  view3d: null, records: new RecordBook(), library: new TrackLibrary(), setup: settings().raceSetup as GameContext['setup'],
  mode: 'practice', lastResult: null, interrupted: false, preview: null,
  drive(mode) { drove = mode; }, go() {}, start() {}, openSetup() {}, closeSetup() {}, refreshPaint() {},
  event: null, startEvent() {}, career: new CareerStore(),
};
const editor = new EditorScreen(game);
editor.enter();
const frame = () => editor.frame(0, 0);
const click = (label: string) => {
  frame();
  const b = [...ui.querySelectorAll('button')].find((b) => b.getAttribute('aria-label') === label || b.querySelector('.btn-label')?.textContent === label);
  assert.ok(b, `button ${label} exists`);
  assert.equal(b.disabled, false, `${label} is enabled`);
  b.click();
  frame();
};
const press = (code: string, extra: Record<string, boolean> = {}) => {
  win.dispatchEvent(new win.KeyboardEvent('keydown', { code, bubbles: true, ...extra }));
  frame();
};
frame();
after(() => { editor.exit(); win.happyDOM.abort(); });

test('studio has keyboard reachable tools, named fields and no ink controls', () => {
  assert.equal(ui.querySelector('[aria-label="Track name"]')?.tagName, 'INPUT');
  assert.equal(ui.querySelectorAll('.ink, .mult').length, 0);
  for (const b of ui.querySelectorAll('button')) assert.equal(b.tabIndex, 0);
  for (const input of ui.querySelectorAll('input[type="range"]')) assert.ok(input.getAttribute('aria-label'));
  const tool = ui.querySelector('.studio-modes');
  assert.equal(tool?.getAttribute('role'), 'group');
  assert.equal(tool?.querySelector('[aria-pressed="true"]')?.textContent?.includes('Reshape'), settings().editorMode === 'dots');
});

test('UI scrolling and native keyboard activation are not swallowed by game input', () => {
  const button = ui.querySelector('button')!;
  const space = new win.KeyboardEvent('keydown', { key: ' ', code: 'Space', bubbles: true, cancelable: true });
  button.dispatchEvent(space);
  assert.equal(space.defaultPrevented, false, 'Space activates a focused control');
  const wheel = new win.WheelEvent('wheel', { deltaY: 100, bubbles: true, cancelable: true });
  ui.querySelector('.sections')!.dispatchEvent(wheel);
  assert.equal(wheel.defaultPrevented, false, 'the sidebar can scroll');
  const canvasWheel = new win.WheelEvent('wheel', { deltaY: 100, bubbles: true, cancelable: true });
  canvas.dispatchEvent(canvasWheel);
  assert.equal(canvasWheel.defaultPrevented, true, 'canvas wheel is reserved for zoom');
});

test('blank workspace offers starters; loading and undoing a template is reversible', () => {
  click('New blank track');
  assert.equal(ui.querySelector<TestElement>('.studio-welcome')?.hidden, false);
  click('Easy oval: Wide turns. Find your flow.');
  assert.equal(ui.querySelector<TestElement>('.studio-welcome')?.hidden, true);
  assert.equal(ui.querySelector<TestInput>('[aria-label="Track name"]')?.value, 'Easy oval');
  click('Undo (Z)');
  assert.equal(ui.querySelector<TestElement>('.studio-welcome')?.hidden, false);
  click('Redo (Y)');
  click('Test drive');
  assert.equal(drove, 'practice');
  assert.equal(game.track.def.name, 'Easy oval');
});

test('point controls and keyboard support precise changes with undo', () => {
  click('Next point');
  const before = game.track.def.control[0].x;
  press('ArrowRight');
  click('Test drive');
  assert.equal(game.track.def.control[0].x, before + 1);
  click('Undo (Z)');
  click('Test drive');
  assert.equal(game.track.def.control[0].x, before);
  click('Next point');
  click('Raise point 0.5 m');
  click('Test drive');
  assert.equal(game.track.def.control[0].h, 0.5);
});

test('unfinished dots have a visible Close loop action and repair guidance', () => {
  click('New blank track');
  const reshape = [...ui.querySelectorAll('.studio-modes button')].find((b) => b.textContent?.includes('Reshape'))!;
  (reshape as unknown as HTMLButtonElement).click();
  frame();
  for (const [x, y] of [[600, 400], [1100, 400], [1100, 600], [600, 600]]) {
    canvas.dispatchEvent(new win.PointerEvent('pointerdown', { clientX: x, clientY: y, pointerId: 1, pointerType: 'mouse', button: 0 }));
    canvas.dispatchEvent(new win.PointerEvent('pointerup', { clientX: x, clientY: y, pointerId: 1, pointerType: 'mouse', button: 0 }));
    frame();
  }
  const close = [...ui.querySelectorAll('button')].find((b) => b.textContent?.includes('Close loop'))!;
  assert.equal(close.hidden, false);
  click('Close loop');
  assert.equal(close.hidden, true);
});

test('a broken track shows Fix it, which mends it as one undo step', () => {
  click('Easy oval: Wide turns. Find your flow.');
  const fix = ui.querySelector<TestButton>('.btn.fix')!;
  assert.equal(fix.hidden, true, 'nothing to fix on a good track');
  click('Next point');
  for (let i = 0; i < 14; i++) press('ArrowUp', { shiftKey: true });
  assert.equal(fix.hidden, false, 'a kinked oval can be fixed');
  click('Fix it');
  assert.equal(fix.hidden, true);
  assert.match(ui.querySelector('.message')?.textContent ?? '', /^Fixed!/);
  click('Undo (Z)');
  assert.equal(fix.hidden, false, 'undo brings the problem back');
  click('Redo (Y)');
  click('Test drive');
  assert.equal(game.track.def.name, 'Easy oval');
});

test('draft backup survives leaving and can be recovered without losing undo', () => {
  click('Easy oval: Wide turns. Find your flow.');
  click('Next point');
  click('Move point left');
  editor.exit();
  const draft = readDraft();
  assert.ok(draft);
  assert.equal(draft.name, 'Easy oval');
  editor.enter(); frame();
  click('New blank track');
  click('Recover last draft');
  assert.equal(ui.querySelector<TestInput>('[aria-label="Track name"]')?.value, 'Easy oval');
  click('Undo (Z)');
  assert.equal(ui.querySelector<TestElement>('.studio-welcome')?.hidden, false);
  storage.removeItem('editor.draft.v1');
});

test('Pan moves the map without editing the track, and tool buttons keep native activation', () => {
  click('Easy oval: Wide turns. Find your flow.');
  const before = game.library.list().length;
  click('Pan');
  assert.equal(ui.querySelector('.studio-modes .on .btn-label')?.textContent, 'Pan');
  canvas.dispatchEvent(new win.PointerEvent('pointerdown', { clientX: 600, clientY: 400, pointerId: 2, pointerType: 'mouse', button: 0 }));
  canvas.dispatchEvent(new win.PointerEvent('pointermove', { clientX: 650, clientY: 430, pointerId: 2, pointerType: 'mouse', button: 0 }));
  canvas.dispatchEvent(new win.PointerEvent('pointerup', { clientX: 650, clientY: 430, pointerId: 2, pointerType: 'mouse', button: 0 }));
  frame();
  assert.equal(game.library.list().length, before);
  click('Reshape');
  click('Test drive');
  assert.equal(game.track.def.control.length, 16);
});

const message = () => ui.querySelector('.message')?.textContent ?? '';
const slide = (label: string, value: number) => {
  frame();
  const input = ui.querySelector<TestInput>(`input[type="range"][aria-label="${label}"]`);
  assert.ok(input, `slider ${label} exists`);
  input.value = String(value);
  input.dispatchEvent(new win.Event('input', { bubbles: true }));
  input.dispatchEvent(new win.Event('change', { bubbles: true }));
  frame();
};
const built = () => {
  click('Test drive');
  return game.track;
};

test('Generate makes a fresh track of each style, one undo step each', () => {
  click('Easy oval: Wide turns. Find your flow.');
  for (const style of ['Grand Prix', 'Flowing', 'Technical', 'Street', 'Oval', 'Kart']) {
    click(style);
    assert.match(message(), /is yours to change/, style);
    assert.equal(built().def.name.length > 0, true);
  }
  assert.equal(game.track.def.name, 'Kart track');
  click('Undo (Z)');
  assert.equal(built().def.name, 'Speedway');
});

test('Pick a track loads a real circuit or a pasted code as a copy of your own', async () => {
  const { encodeTrack } = await import('../src/track/code.ts');
  click('Real circuits');
  const monza = [...ui.querySelectorAll<TestButton>('.track-picker button')].find((b) => b.textContent?.startsWith('Monza'));
  assert.ok(monza, 'Monza is listed');
  monza.click();
  frame();
  const t = built();
  assert.equal(t.def.name, 'Monza');
  assert.notEqual(t.def.builtIn, true, 'a copy of your own');
  const easy = getSampleTrack(0);
  click('Paste a code');
  const box = ui.querySelector<TestInput>('.track-picker input[type="text"]');
  assert.ok(box);
  box.value = 'not a code';
  click('Load');
  assert.equal(ui.querySelector('.track-picker .help.warn')?.textContent, 'That isn’t a track code.');
  // (A built-in's own code loads under its own name, so this one is changed a little.)
  const moved = easy.def.control.map((d, i) => (i === 0 ? { ...d, x: d.x + 2 } : d));
  box.value = encodeTrack('Pasted', moved, easy.def.options);
  click('Load');
  assert.equal(built().def.name, 'Pasted');
  assert.equal(game.track.def.control.length, easy.def.control.length);
});

const pickTrack = (group: string, name: string) => {
  click(group);
  const item = [...ui.querySelectorAll<TestButton>('.track-picker button')].find((b) => b.textContent?.startsWith(name));
  assert.ok(item, `${name} is listed`);
  item.click();
  frame();
};

test('Size & shape sliders: length, terrain climb and corner smoothing, each one undo step', () => {
  // (Monza: a fixed layout with tight chicanes to smooth out.)
  pickTrack('Real circuits', 'Monza');
  const before = built().center.length;
  slide('Track length', 1000);
  const after = built().center.length;
  assert.ok(Math.abs(after - 1000) < 80, `about 1 km: ${after.toFixed(0)} m (was ${before.toFixed(0)} m)`);
  click('Undo (Z)');
  assert.ok(Math.abs(built().center.length - before) < 1, 'undo puts the length back');
  slide('Terrain', 0);
  assert.equal(Math.max(...built().def.control.map((d) => d.h ?? 0)), 0, 'flat');
  slide('Terrain', 20);
  const hs = built().def.control.map((d) => d.h ?? 0);
  assert.equal(Math.max(...hs) - Math.min(...hs), 20, '20 m from lowest to highest');
  const tight = built().center.curvature.reduce((m, k) => Math.max(m, Math.abs(k)), 0);
  slide('Corner smoothing', 30);
  const eased = built().center.curvature.reduce((m, k) => Math.max(m, Math.abs(k)), 0);
  assert.ok(eased < tight, `corners opened up: tightest radius ${(1 / tight).toFixed(0)} → ${(1 / eased).toFixed(0)} m`);
});

test('Banking, every corner sets and clears every bank at once', () => {
  click('Grand Prix');
  slide('Banking, every corner', 12);
  assert.ok(built().def.control.every((d) => d.b === 12));
  click('Flatten all');
  assert.ok(built().def.control.every((d) => d.b === 0));
  click('Back to the level');
  assert.ok(built().def.control.every((d) => d.b === undefined));
  click('Undo (Z)');
  assert.ok(built().def.control.every((d) => d.b === 0), 'undo brings back the flat corners');
});

test('Track edges and Scenery & world: barrier styles and distance, ground, landscapes, kerbs', () => {
  click('Grand Prix');
  const before = built().center.wallOffset;
  click('Armco');
  click('Painted');
  slide('Barrier distance', 10);
  click('Dirt');
  click('Alpine');
  const t = built();
  assert.equal(t.options.barrier, 'armco');
  assert.equal(t.options.kerbs, 'painted');
  assert.equal(t.options.road, 'dirt');
  assert.equal(t.options.theme, 'alpine');
  assert.ok(Math.abs(t.center.wallOffset - before - 10) < 1e-9, 'the barriers moved 10 m out');
  assert.match(ui.querySelector('.range-value')?.textContent ?? '', /./);
  click('Undo (Z)');
  assert.equal(built().options.theme, 'meadow');
});

test('Place scenery, corner run-off, bump kerbs and painting, each one undo step', () => {
  pickTrack('Real circuits', 'Monza');
  const tap = (x: number, y: number, id = 7) => {
    canvas.dispatchEvent(new win.PointerEvent('pointerdown', { clientX: x, clientY: y, pointerId: id, pointerType: 'mouse', button: 0 }));
    canvas.dispatchEvent(new win.PointerEvent('pointerup', { clientX: x, clientY: y, pointerId: id, pointerType: 'mouse', button: 0 }));
    frame();
  };
  // A grandstand somewhere on the paper beside the track (wherever a tap finds room).
  click('Grandstand');
  let placed = false;
  for (const [x, y] of [[700, 300], [900, 650], [500, 600], [1200, 300], [800, 450]]) {
    tap(x, y);
    if (/placed/.test(message())) {
      placed = true;
      break;
    }
  }
  assert.ok(placed, `placed: ${message()}`);
  click('Done');
  assert.equal(built().def.extras?.placed?.filter((p) => p.kind === 'grandstand').length, 1);
  // Corner 1: gravel; every chicane: bump kerbs.
  click('Next corner');
  const picked = ui.querySelector('.picked-corner')!;
  assert.equal((picked as unknown as TestElement).hidden, false);
  const gravel = [...picked.querySelectorAll<TestButton>('button')].find((b) => b.textContent?.includes('Gravel'))!;
  gravel.click();
  frame();
  assert.ok(built().def.extras?.paint?.length, 'the corner\'s run-off is painted');
  click('On every chicane');
  const bumps = built().def.extras?.placed?.filter((p) => p.kind === 'bump').length ?? 0;
  assert.ok(bumps >= 2, `${bumps} bump kerbs`);
  click('Undo (Z)');
  assert.equal(built().def.extras?.placed?.filter((p) => p.kind === 'bump').length ?? 0, 0, 'undo takes the bumps back');
  click('Redo (Y)');
  click('Remove bump kerbs');
  assert.equal(built().def.extras?.placed?.filter((p) => p.kind === 'bump').length ?? 0, 0);
  click('Clear paint');
  assert.equal(built().def.extras?.paint, undefined);
  click('Clear scenery');
  assert.equal(built().def.extras, undefined, 'nothing left');
});

test('small screens expose sidebar sections by name with expansion state', () => {
  Object.assign(game.surface, { w: 600, h: 380 });
  editor.resize(); frame();
  assert.ok(ui.querySelector('.editor.rail'));
  const head = ui.querySelector<TestButton>('.sec-head')!;
  head.click();
  assert.equal(head.getAttribute('aria-expanded'), 'true');
  assert.ok(head.getAttribute('aria-controls'));
  ui.querySelector('.sections')!.scrollTop = 200;
  head.click();
  assert.equal(head.getAttribute('aria-expanded'), 'false');
  assert.equal(ui.querySelector('.sections')!.scrollTop, 0);
});
