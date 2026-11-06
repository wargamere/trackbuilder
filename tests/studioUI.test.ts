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
