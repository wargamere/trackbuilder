import type { TouchState } from '../car/input.ts';
import { STR } from '../config/strings.ts';
import { h } from './dom.ts';

/** Keeps receiving a pointer's events even if it slides off the control, so release is never missed. */
function capture(el: HTMLElement, e: PointerEvent): void {
  try {
    el.setPointerCapture(e.pointerId);
  } catch {
    /* pointer already gone */
  }
}

/**
 * On-screen controls for phones and tablets: a steering pad split into left
 * and right halves (bottom left), and GAS / BRAKE buttons (bottom right).
 * Multi-touch: each pointer is tracked on its own.
 */
export class TouchControls {
  readonly root: HTMLElement;
  private readonly state: TouchState;
  private readonly steerPointers = new Map<number, number>();
  private abort = new AbortController();
  private readonly shiftBox: HTMLElement;

  constructor(state: TouchState) {
    this.state = state;
    const left = h('div', { class: 'steer-half', text: '◀' });
    const right = h('div', { class: 'steer-half', text: '▶' });
    const steer = h('div', { class: 'touch-steer' }, left, right);
    const brake = h('div', { class: 'touch-pedal brake', text: STR.race.touchBrake });
    const gas = h('div', { class: 'touch-pedal gas', text: STR.race.touchGas });
    // Manual gears: change up / down (one gear per tap).
    const up = h('div', { class: 'touch-shift', text: '▲' });
    const down = h('div', { class: 'touch-shift', text: '▼' });
    up.setAttribute('aria-label', STR.race.shiftUp);
    down.setAttribute('aria-label', STR.race.shiftDown);
    this.shiftBox = h('div', { class: 'touch-shifts' }, up, down);
    this.shiftBox.hidden = true;
    this.root = h('div', { class: 'touch-controls' }, steer, h('div', { class: 'spacer' }), this.shiftBox, brake, gas);

    const o = { signal: this.abort.signal };
    const sideOf = (e: PointerEvent) => {
      const r = steer.getBoundingClientRect();
      return e.clientX < r.left + r.width / 2 ? -1 : 1;
    };
    const updateSteer = () => {
      let sum = 0;
      for (const s of this.steerPointers.values()) sum += s;
      this.state.steer = Math.max(-1, Math.min(1, sum));
      left.classList.toggle('active', [...this.steerPointers.values()].includes(-1));
      right.classList.toggle('active', [...this.steerPointers.values()].includes(1));
    };
    steer.addEventListener(
      'pointerdown',
      (e) => {
        e.preventDefault();
        capture(steer, e);
        this.steerPointers.set(e.pointerId, sideOf(e));
        updateSteer();
      },
      o,
    );
    steer.addEventListener(
      'pointermove',
      (e) => {
        if (!this.steerPointers.has(e.pointerId)) return;
        this.steerPointers.set(e.pointerId, sideOf(e));
        updateSteer();
      },
      o,
    );
    for (const type of ['pointerup', 'pointercancel', 'lostpointercapture'] as const) {
      steer.addEventListener(
        type,
        (e) => {
          this.steerPointers.delete(e.pointerId);
          updateSteer();
        },
        o,
      );
    }
    this.pedal(gas, (v) => (this.state.throttle = v));
    this.pedal(brake, (v) => (this.state.brake = v));
    for (const [el, dir] of [[up, 1], [down, -1]] as const) {
      el.addEventListener(
        'pointerdown',
        (e) => {
          e.preventDefault();
          this.state.shift += dir;
          el.classList.add('active');
        },
        o,
      );
      for (const type of ['pointerup', 'pointercancel', 'pointerleave'] as const) el.addEventListener(type, () => el.classList.remove('active'), o);
    }
    this.root.addEventListener('contextmenu', (e) => e.preventDefault(), o);
  }

  private pedal(el: HTMLElement, set: (v: boolean) => void): void {
    const pointers = new Set<number>();
    const o = { signal: this.abort.signal };
    const update = () => {
      set(pointers.size > 0);
      el.classList.toggle('active', pointers.size > 0);
    };
    el.addEventListener(
      'pointerdown',
      (e) => {
        e.preventDefault();
        capture(el, e);
        pointers.add(e.pointerId);
        update();
      },
      o,
    );
    for (const type of ['pointerup', 'pointercancel', 'lostpointercapture'] as const) {
      el.addEventListener(
        type,
        (e) => {
          pointers.delete(e.pointerId);
          update();
        },
        o,
      );
    }
  }

  /** Shows the ▲ ▼ gear buttons (manual gears only). */
  setManualGears(on: boolean): void {
    this.shiftBox.hidden = !on;
  }

  /** Lifts every finger (e.g. on pause). */
  release(): void {
    this.steerPointers.clear();
    this.state.steer = 0;
    this.state.throttle = false;
    this.state.brake = false;
    this.state.shift = 0;
    for (const el of this.root.querySelectorAll('.active')) el.classList.remove('active');
  }

  dispose(): void {
    this.abort.abort();
    this.root.remove();
  }
}
