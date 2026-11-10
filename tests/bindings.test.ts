import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { Window } from 'happy-dom';
import { actionMap, bindKey, cleanBindings, DEFAULT_BINDINGS, keyboardHint, keyLabel, type KeyBindings } from '../src/car/bindings.ts';
import { InputManager } from '../src/car/input.ts';
import type { DriveInput } from '../src/car/physics.ts';
import { settings, updateSettings } from '../src/core/settings.ts';

test('saved bindings are cleaned: unknown keys and actions dropped, no key twice, at most two each, defaults when missing', () => {
  const b = cleanBindings({ throttle: ['KeyI', 'KeyI', 'KeyK', 'KeyL'], brake: ['Tab', 'ControlLeft', 'KeyK'], fly: ['KeyF'], left: 'nope' });
  assert.deepEqual(b.throttle, ['KeyI', 'KeyK']);
  assert.deepEqual(b.brake, [], 'reserved keys and keys used already are dropped');
  assert.deepEqual(b.left, DEFAULT_BINDINGS.left, 'not a list: the default');
  assert.deepEqual(b.gearUp, DEFAULT_BINDINGS.gearUp, 'missing: the default');
  assert.equal((b as Record<string, unknown>).fly, undefined);
  assert.deepEqual(cleanBindings(null), DEFAULT_BINDINGS);
});

test('binding a key: replaces the slot, adds to an empty one, clears with null, and moves a key from another action', () => {
  let r = bindKey(DEFAULT_BINDINGS, 'throttle', 0, 'KeyI');
  assert.deepEqual(r.bindings.throttle, ['KeyI', 'ArrowUp']);
  assert.equal(r.movedFrom, null);
  r = bindKey(r.bindings, 'gearUp', 1, 'Space');
  assert.deepEqual(r.bindings.gearUp, ['KeyE', 'Space']);
  // E is Gear up's: giving it to Camera moves it.
  r = bindKey(r.bindings, 'camera', 0, 'KeyE');
  assert.deepEqual(r.bindings.camera, ['KeyE']);
  assert.deepEqual(r.bindings.gearUp, ['Space']);
  assert.equal(r.movedFrom, 'gearUp');
  r = bindKey(r.bindings, 'throttle', 1, null);
  assert.deepEqual(r.bindings.throttle, ['KeyI']);
  // The defaults are untouched.
  assert.deepEqual(DEFAULT_BINDINGS.throttle, ['KeyW', 'ArrowUp']);
});

test('Esc always pauses, whatever is bound', () => {
  const none: KeyBindings = { ...DEFAULT_BINDINGS, pause: [] };
  assert.equal(actionMap(none).get('Escape'), 'pause');
  assert.equal(actionMap(DEFAULT_BINDINGS).get('KeyW'), 'throttle');
});

test('key names for the screen', () => {
  assert.equal(keyLabel('KeyW'), 'W');
  assert.equal(keyLabel('ArrowUp'), '↑');
  assert.equal(keyLabel('Digit3'), '3');
  assert.equal(keyLabel('Numpad8'), 'Num 8');
  assert.equal(keyLabel('Space'), 'Space');
  assert.equal(keyLabel('ShiftLeft'), 'L-Shift');
});

test('the controls hint is built from the keys you have', () => {
  const plain = keyboardHint(DEFAULT_BINDINGS, { manual: false, practice: false });
  assert.equal(plain, 'W/↑ drive · S/↓ brake & reverse · A/← D/→ steer · R reset · C camera · M sound · Esc pause');
  const full = keyboardHint(DEFAULT_BINDINGS, { manual: true, practice: true });
  assert.ok(full.includes('E / Q gear up / down') && full.endsWith('R R restart lap'), full);
  const mine = bindKey(bindKey(DEFAULT_BINDINGS, 'throttle', 0, 'KeyI').bindings, 'camera', 0, null).bindings;
  const hint = keyboardHint(mine, { manual: false, practice: false });
  assert.ok(hint.startsWith('I/↑ drive'), hint);
  assert.ok(!hint.includes('camera'), 'an action with no key is left out');
});

test('driving uses your keys: a rebound key drives, the old one does nothing', () => {
  const saved = settings().keys;
  after(() => updateSettings({ keys: saved }));
  updateSettings({ keys: bindKey(DEFAULT_BINDINGS, 'throttle', 0, 'KeyI').bindings });
  const im = new InputManager();
  const key = (code: string, down: boolean) =>
    (im as unknown as { onKey(e: Partial<KeyboardEvent>, d: boolean): void }).onKey({ code, ctrlKey: false, metaKey: false, altKey: false, repeat: false, preventDefault() {} }, down);
  const out: DriveInput = { throttle: 0, brake: 0, steer: 0, handbrake: false };
  key('KeyI', true);
  assert.equal(im.sample(out).throttle, 1);
  key('KeyI', false);
  key('KeyW', true);
  assert.equal(im.sample(out).throttle, 0, 'W is not bound any more');
  key('KeyW', false);
  // Gear keys queue one change per press.
  key('KeyE', true);
  key('KeyE', false);
  assert.equal(im.sample(out).shift, 1);
  assert.equal(im.sample(out).shift, 0);
});

test('the controls panel: click a key, press the new one; Esc cancels; Backspace clears; reset brings the defaults back', async () => {
  const saved = settings().keys;
  const win = new Window({ url: 'https://controls.test/' });
  const keys = ['window', 'document', 'HTMLElement', 'HTMLButtonElement', 'HTMLInputElement', 'KeyboardEvent'] as const;
  const before = keys.map((k) => Object.getOwnPropertyDescriptor(globalThis, k));
  for (const k of keys) Object.defineProperty(globalThis, k, { configurable: true, value: k === 'window' ? win : Reflect.get(win, k) });
  after(() => {
    keys.forEach((k, i) => {
      const d = before[i];
      if (d) Object.defineProperty(globalThis, k, d);
      else delete (globalThis as Record<string, unknown>)[k];
    });
    updateSettings({ keys: saved });
    win.happyDOM.abort();
  });
  updateSettings({ keys: DEFAULT_BINDINGS });
  const { ControlsPanel } = await import('../src/ui/controlsPanel.ts');
  const host = win.document.createElement('div');
  win.document.body.append(host);
  const panel = new ControlsPanel();
  let closed = false;
  panel.open(host as unknown as HTMLElement, () => (closed = true));
  const slot = (id: string) => host.querySelector(`[data-slot="${id}"]`) as unknown as HTMLButtonElement;
  const press = (code: string) => win.dispatchEvent(new win.KeyboardEvent('keydown', { code, bubbles: true, cancelable: true }));
  // Behind the panel, the game must not see the keys.
  let leaked = 0;
  win.addEventListener('keydown', () => leaked++);

  slot('throttle-0').click();
  assert.equal(slot('throttle-0').textContent?.includes('Press a key'), true);
  press('KeyI');
  assert.deepEqual(settings().keys.throttle, ['KeyI', 'ArrowUp']);
  // E moves from Gear up to Camera, and the panel says so.
  slot('camera-0').click();
  press('KeyE');
  assert.deepEqual(settings().keys.camera, ['KeyE']);
  assert.deepEqual(settings().keys.gearUp, []);
  assert.match(host.querySelector('.controls-note')?.textContent ?? '', /moved here from “Gear up”/);
  // Esc while choosing cancels; Backspace clears.
  slot('brake-1').click();
  press('Escape');
  assert.deepEqual(settings().keys.brake, ['KeyS', 'ArrowDown']);
  assert.equal(panel.isOpen, true, 'Esc only cancelled the key');
  slot('brake-1').click();
  press('Backspace');
  assert.deepEqual(settings().keys.brake, ['KeyS']);
  assert.equal(leaked, 0, 'nothing behind the panel saw the keys');

  const resetBtn = [...host.querySelectorAll('button')].find((b) => b.textContent?.includes('Reset to defaults')) as unknown as HTMLButtonElement;
  resetBtn.click();
  assert.deepEqual(settings().keys, DEFAULT_BINDINGS);
  press('Escape');
  assert.equal(panel.isOpen, false);
  assert.equal(closed, true);
});
