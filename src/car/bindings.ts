import { STR } from '../config/strings.ts';

/**
 * Keyboard bindings for driving: up to two keys per action (KeyboardEvent.code,
 * so they're the same physical keys on any layout). Esc always pauses, whatever
 * is bound, so there's always a way out.
 */
export const DRIVE_ACTIONS = ['throttle', 'brake', 'left', 'right', 'gearUp', 'gearDown', 'reset', 'camera', 'pause', 'mute'] as const;
export type DriveAction = (typeof DRIVE_ACTIONS)[number];
export type KeyBindings = Record<DriveAction, string[]>;

/** Keys per action. */
export const KEY_SLOTS = 2;

export const DEFAULT_BINDINGS: KeyBindings = {
  throttle: ['KeyW', 'ArrowUp'],
  brake: ['KeyS', 'ArrowDown'],
  left: ['KeyA', 'ArrowLeft'],
  right: ['KeyD', 'ArrowRight'],
  gearUp: ['KeyE'],
  gearDown: ['KeyQ'],
  reset: ['KeyR'],
  camera: ['KeyC'],
  pause: ['KeyP'],
  mute: ['KeyM'],
};

/** Always pauses (and closes menus), and can't be bound to anything else. */
export const PAUSE_KEY = 'Escape';

/**
 * Keys that can't be bound: Esc (pause / cancel), Tab (moving between
 * buttons), Backspace and Delete (clear a key while choosing one), and the
 * modifier keys the browser uses for its own shortcuts.
 */
const RESERVED = new Set(['Escape', 'Tab', 'Backspace', 'Delete', 'ControlLeft', 'ControlRight', 'AltLeft', 'AltRight', 'MetaLeft', 'MetaRight', 'OSLeft', 'OSRight', 'ContextMenu', 'F5', 'F11', 'F12']);

export function canBind(code: string): boolean {
  return !!code && !RESERVED.has(code) && /^[A-Za-z0-9]+$/.test(code);
}

/** Bindings as saved, made safe: known actions only, valid keys, no key twice, at most KEY_SLOTS each. */
export function cleanBindings(saved: unknown): KeyBindings {
  const out = Object.fromEntries(DRIVE_ACTIONS.map((a) => [a, [] as string[]])) as KeyBindings;
  const raw = saved && typeof saved === 'object' ? (saved as Record<string, unknown>) : {};
  const used = new Set<string>();
  for (const a of DRIVE_ACTIONS) {
    const keys = Array.isArray(raw[a]) ? (raw[a] as unknown[]) : DEFAULT_BINDINGS[a];
    for (const k of keys) {
      if (typeof k === 'string' && canBind(k) && !used.has(k) && out[a].length < KEY_SLOTS) {
        out[a].push(k);
        used.add(k);
      }
    }
  }
  return out;
}

/**
 * Puts `code` in `slot` of `action` (null clears the slot). A key already
 * used by another action moves here; returns the new bindings and the action
 * it moved from, if any.
 */
export function bindKey(b: KeyBindings, action: DriveAction, slot: number, code: string | null): { bindings: KeyBindings; movedFrom: DriveAction | null } {
  const next = Object.fromEntries(DRIVE_ACTIONS.map((a) => [a, [...b[a]]])) as KeyBindings;
  let movedFrom: DriveAction | null = null;
  if (code !== null) {
    for (const a of DRIVE_ACTIONS) {
      const i = next[a].indexOf(code);
      if (i < 0) continue;
      if (a !== action) movedFrom = a;
      next[a].splice(i, 1);
    }
  }
  const keys = next[action];
  if (code === null) keys.splice(slot, 1);
  else if (slot < keys.length) keys[slot] = code;
  else keys.push(code);
  next[action] = keys.slice(0, KEY_SLOTS);
  return { bindings: next, movedFrom };
}

/** What each key code is bound to (Esc always pauses). */
export function actionMap(b: KeyBindings): Map<string, DriveAction> {
  const m = new Map<string, DriveAction>();
  for (const a of DRIVE_ACTIONS) for (const k of b[a]) m.set(k, a);
  m.set(PAUSE_KEY, 'pause');
  return m;
}

const NAMES: Record<string, string> = {
  ArrowUp: '↑',
  ArrowDown: '↓',
  ArrowLeft: '←',
  ArrowRight: '→',
  Space: 'Space',
  Enter: 'Enter',
  NumpadEnter: 'Num Enter',
  ShiftLeft: 'L-Shift',
  ShiftRight: 'R-Shift',
  CapsLock: 'Caps',
  Escape: 'Esc',
  Minus: '-',
  Equal: '=',
  BracketLeft: '[',
  BracketRight: ']',
  Backslash: '\\',
  Semicolon: ';',
  Quote: "'",
  Backquote: '`',
  Comma: ',',
  Period: '.',
  Slash: '/',
  NumpadAdd: 'Num +',
  NumpadSubtract: 'Num −',
  NumpadMultiply: 'Num *',
  NumpadDivide: 'Num /',
  NumpadDecimal: 'Num .',
  PageUp: 'Pg Up',
  PageDown: 'Pg Down',
};

/** What the keys print on this keyboard's layout (e.g. Z for KeyW on AZERTY), where the browser can say. */
let layout: Map<string, string> | null = null;
try {
  const kb = (globalThis.navigator as unknown as { keyboard?: { getLayoutMap?: () => Promise<Map<string, string>> } } | undefined)?.keyboard;
  void kb
    ?.getLayoutMap?.()
    .then((m) => (layout = m))
    .catch(() => {});
} catch {
  /* not available */
}

/** A key's name for the screen: "W", "↑", "Space", "Num 8"… */
export function keyLabel(code: string): string {
  const printed = layout?.get(code);
  if (printed && printed.trim().length === 1) return printed.toUpperCase();
  if (NAMES[code]) return NAMES[code];
  let m = /^Key([A-Z])$/.exec(code);
  if (m) return m[1];
  m = /^Digit(\d)$/.exec(code);
  if (m) return m[1];
  m = /^Numpad(\d)$/.exec(code);
  if (m) return `Num ${m[1]}`;
  return code;
}

/** An action's keys for hints: "W/↑", or "" if none. */
export function keysText(b: KeyBindings, action: DriveAction): string {
  return b[action].map(keyLabel).join('/');
}

/**
 * The keyboard hint shown when a race starts and in the pause menu, from the
 * keys actually bound ("W/↑ drive · S/↓ brake & reverse · …"); actions with
 * no key are left out. With manual gears it says the gear keys, and in
 * practice that a double reset restarts the lap.
 */
export function keyboardHint(b: KeyBindings, opts: { manual: boolean; practice: boolean }): string {
  const H = STR.race.hintKeys;
  const k = (a: DriveAction) => keysText(b, a);
  const parts: string[] = [];
  const add = (keys: string, what: string) => {
    if (keys.trim()) parts.push(`${keys} ${what}`);
  };
  add(k('throttle'), H.throttle);
  add(k('brake'), H.brake);
  add([k('left'), k('right')].filter(Boolean).join(' '), H.steer);
  if (opts.manual) add([k('gearUp'), k('gearDown')].filter(Boolean).join(' / '), H.gears);
  add(k('reset'), H.reset);
  add(k('camera'), H.camera);
  add(k('mute'), H.mute);
  add(keyLabel(PAUSE_KEY), H.pause);
  const reset = b.reset[0];
  if (opts.practice && reset) add(`${keyLabel(reset)} ${keyLabel(reset)}`, H.restart);
  return parts.join(' · ');
}
