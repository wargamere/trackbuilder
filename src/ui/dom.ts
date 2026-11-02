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
}

/**
 * A game button. It never takes keyboard focus, so Space/Enter in the game
 * can't accidentally "click" the last button pressed.
 */
export function button(label: string, onPress: () => void, opts: ButtonOpts = {}): HTMLButtonElement {
  const b = h('button', { class: `btn ${opts.class ?? ''}`.trim() });
  b.type = 'button';
  b.tabIndex = -1;
  if (opts.icon) b.append(h('span', { class: 'btn-icon', text: opts.icon }));
  b.append(h('span', { class: 'btn-label', text: label }));
  if (opts.key) b.append(h('kbd', { text: opts.key }));
  b.addEventListener('mousedown', (e) => e.preventDefault()); // keep focus off the button
  b.addEventListener('click', (e) => {
    e.preventDefault();
    if (!b.disabled) onPress();
  });
  return b;
}
