import { INPUT } from '../config/handling.ts';
import { clamp } from '../core/math.ts';
import type { DriveInput } from './physics.ts';

export type InputAction = 'pause' | 'reset' | 'camera' | 'mute';
export type InputDevice = 'keyboard' | 'gamepad' | 'touch';

/** Written by the on-screen touch controls. */
export interface TouchState {
  throttle: boolean;
  brake: boolean;
  /** -1, 0 or +1 */
  steer: number;
  /** Gear changes asked for by the ▲ ▼ buttons and not yet made (+ up, - down). */
  shift: number;
}

const KEYS = {
  throttle: ['KeyW', 'ArrowUp'],
  brake: ['KeyS', 'ArrowDown'],
  left: ['KeyA', 'ArrowLeft'],
  right: ['KeyD', 'ArrowRight'],
} as const;

/** Gear changes (manual gearbox): one per press. */
const SHIFT_KEYS: Record<string, number> = { KeyE: 1, KeyQ: -1 };

const ACTION_KEYS: Record<string, InputAction> = {
  Escape: 'pause',
  KeyP: 'pause',
  KeyR: 'reset',
  KeyC: 'camera',
  KeyM: 'mute',
};

/** Standard-mapping gamepad buttons. */
const PAD = { a: 0, b: 1, x: 2, y: 3, lb: 4, rb: 5, lt: 6, rt: 7, back: 8, start: 9, left: 14, right: 15 } as const;
const PAD_ACTIONS: [number, InputAction][] = [
  [PAD.start, 'pause'],
  [PAD.back, 'reset'],
  [PAD.y, 'camera'],
];

const ALL_DRIVE_KEYS = new Set<string>([...Object.values(KEYS).flat(), ...Object.keys(SHIFT_KEYS)]);

/**
 * Merges keyboard, gamepad and touch into one DriveInput. Driving keys are read
 * as "held" state when the physics samples them; pause/reset/camera fire once
 * per press through `onAction`. Only browser-safe keys are bound.
 */
export class InputManager {
  onAction: (a: InputAction) => void = () => {};
  /** The device used most recently (the HUD shows matching hints). */
  lastDevice: InputDevice = 'keyboard';
  readonly touch: TouchState = { throttle: false, brake: false, steer: 0, shift: 0 };
  /** Gear changes asked for (keyboard and gamepad) and not yet made. */
  private shifts = 0;

  private readonly keys = new Set<string>();
  private readonly pad: DriveInput = { throttle: 0, brake: 0, steer: 0, handbrake: false };
  private padPressed: boolean[] = [];
  private abort: AbortController | null = null;

  attach(): void {
    this.detach();
    this.abort = new AbortController();
    const opts = { signal: this.abort.signal };
    window.addEventListener('keydown', (e) => this.onKey(e, true), opts);
    window.addEventListener('keyup', (e) => this.onKey(e, false), opts);
    window.addEventListener('blur', () => this.clear(), opts);
    document.addEventListener('visibilitychange', () => this.clear(), opts);
  }

  detach(): void {
    this.abort?.abort();
    this.abort = null;
    this.clear();
  }

  /** Releases everything (e.g. when the window loses focus mid-press). */
  clear(): void {
    this.keys.clear();
    this.touch.throttle = false;
    this.touch.brake = false;
    this.touch.steer = 0;
    this.touch.shift = 0;
    this.shifts = 0;
  }

  private onKey(e: KeyboardEvent, down: boolean): void {
    if (e.ctrlKey || e.metaKey || e.altKey) return; // never interfere with browser shortcuts
    const action = ACTION_KEYS[e.code];
    if (!ALL_DRIVE_KEYS.has(e.code) && !action) return;
    e.preventDefault(); // arrows would otherwise scroll the host page
    this.lastDevice = 'keyboard';
    if (down) {
      this.keys.add(e.code);
      if (action && !e.repeat) this.onAction(action);
      if (SHIFT_KEYS[e.code] && !e.repeat) this.shifts += SHIFT_KEYS[e.code];
    } else {
      this.keys.delete(e.code);
    }
  }

  /** Reads the gamepad. Call once per frame, before the physics steps. */
  pollGamepad(): void {
    let pads: (Gamepad | null)[] = [];
    try {
      pads = navigator.getGamepads ? Array.from(navigator.getGamepads()) : [];
    } catch {
      pads = []; // blocked by permissions policy in some iframes
    }
    const gp = pads.find((p): p is Gamepad => !!p && p.connected);
    const p = this.pad;
    if (!gp) {
      p.throttle = p.brake = p.steer = 0;
      this.padPressed = [];
      return;
    }
    const btn = (i: number) => gp.buttons[i]?.value ?? 0;
    const pressed = (i: number) => !!gp.buttons[i]?.pressed;
    const dz = (v: number, zone: number) => (Math.abs(v) < zone ? 0 : (v - Math.sign(v) * zone) / (1 - zone));
    const stick = dz(gp.axes[0] ?? 0, INPUT.stickDeadZone);
    const dpad = (pressed(PAD.right) ? 1 : 0) - (pressed(PAD.left) ? 1 : 0);
    p.steer = clamp(stick + dpad, -1, 1);
    p.throttle = Math.max(dz(btn(PAD.rt), INPUT.triggerDeadZone), pressed(PAD.a) ? 1 : 0);
    p.brake = Math.max(dz(btn(PAD.lt), INPUT.triggerDeadZone), pressed(PAD.x) ? 1 : 0);
    if (p.steer || p.throttle || p.brake) this.lastDevice = 'gamepad';
    for (const [i, dir] of [[PAD.rb, 1], [PAD.lb, -1]] as const) {
      if (pressed(i) && !this.padPressed[i]) {
        this.lastDevice = 'gamepad';
        this.shifts += dir;
      }
    }
    for (const [i, action] of PAD_ACTIONS) {
      if (pressed(i) && !this.padPressed[i]) {
        this.lastDevice = 'gamepad';
        this.onAction(action);
      }
    }
    this.padPressed = gp.buttons.map((b) => b.pressed);
  }

  /** The combined input for one physics tick. */
  sample(out: DriveInput): DriveInput {
    const held = (codes: readonly string[]) => codes.some((c) => this.keys.has(c));
    const t = this.touch;
    const keySteer = (held(KEYS.right) ? 1 : 0) - (held(KEYS.left) ? 1 : 0);
    out.throttle = Math.max(held(KEYS.throttle) ? 1 : 0, this.pad.throttle, t.throttle ? 1 : 0);
    out.brake = Math.max(held(KEYS.brake) ? 1 : 0, this.pad.brake, t.brake ? 1 : 0);
    out.steer = clamp(keySteer + this.pad.steer + t.steer, -1, 1);
    out.handbrake = false; // the handbrake is switched off for now
    // One gear change per tick, so quick presses go through one after the other.
    const want = this.shifts + t.shift;
    out.shift = Math.sign(want);
    if (this.shifts) this.shifts -= Math.sign(this.shifts);
    else if (t.shift) t.shift -= Math.sign(t.shift);
    return out;
  }
}
