/** Tiny DOM helpers for the overlay UI. */

type Child = Node | string | null | undefined | false;

export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: { class?: string; text?: string; title?: string; [data: `data-${string}`]: string } = {},
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, val] of Object.entries(props)) {
    if (val === undefined) continue;
    if (k === 'class') el.className = val;
    else if (k === 'text') el.textContent = val;
    else el.setAttribute(k, val);
  }
  for (const c of children) if (c) el.append(c);
  return el;
}

export interface ButtonOpts {
  class?: string;
  /** Keyboard shortcut shown as a small hint on devices with a keyboard. */
  key?: string;
  icon?: string;
  /** Tooltip (and accessible name for icon-only buttons). */
  title?: string;
}

/**
 * A game button. It never takes keyboard focus, so Space/Enter in the game
 * can't accidentally "click" the last button pressed.
 */
export function button(label: string, onPress: () => void, opts: ButtonOpts = {}): HTMLButtonElement {
  const b = h('button', { class: `btn ${opts.class ?? ''}`.trim() });
  b.type = 'button';
  b.tabIndex = -1;
  if (opts.title) {
    b.title = opts.title;
    b.setAttribute('aria-label', opts.title);
  }
  if (opts.icon) b.append(h('span', { class: 'btn-icon', text: opts.icon }));
  if (label) b.append(h('span', { class: 'btn-label', text: label }));
  if (opts.key) b.append(h('kbd', { text: opts.key }));
  b.addEventListener('mousedown', (e) => e.preventDefault()); // keep focus off the button
  b.addEventListener('click', (e) => {
    e.preventDefault();
    if (!b.disabled) onPress();
  });
  return b;
}

export interface Choice<T> {
  el: HTMLElement;
  set(v: T): void;
}

/** A row of buttons where exactly one is "on". */
export function segmented<T extends string | number | boolean>(items: [T, string, string?][], onPick: (v: T) => void): Choice<T> {
  const btns = new Map<T, HTMLButtonElement>();
  const el = h('div', { class: 'segmented' });
  for (const [value, label, icon] of items) {
    const b = button(label, () => onPick(value), { icon });
    btns.set(value, b);
    el.append(b);
  }
  return {
    el,
    set(v: T) {
      for (const [k, b] of btns) b.classList.toggle('on', k === v);
    },
  };
}

export interface Slider {
  el: HTMLElement;
  /** Shows a value (ignored while the slider is being dragged). */
  set(v: number): void;
  /** Changes the range. */
  setRange(min: number, max: number): void;
}

/** A range slider with its value beside it; `onInput` while dragging, `onDone` when let go. */
export function slider(min: number, max: number, step: number, onInput: (v: number) => void, onDone: () => void, format: (v: number) => string): Slider {
  const input = h('input', { class: 'range' });
  input.type = 'range';
  input.min = String(min);
  input.max = String(max);
  input.step = String(step);
  input.tabIndex = -1;
  const value = h('span', { class: 'range-value' });
  let dragging = false;
  input.addEventListener('input', () => {
    dragging = true;
    value.textContent = format(Number(input.value));
    onInput(Number(input.value));
  });
  input.addEventListener('change', () => {
    dragging = false;
    onDone();
  });
  input.addEventListener('keydown', (e) => e.stopPropagation()); // arrows move the slider, not the editor
  return {
    el: h('div', { class: 'range-row' }, input, value),
    set(v: number) {
      if (dragging) return;
      if (input.value !== String(v)) input.value = String(v);
      const t = format(v);
      if (value.textContent !== t) value.textContent = t;
    },
    setRange(lo: number, hi: number) {
      input.min = String(lo);
      input.max = String(hi);
    },
  };
}
