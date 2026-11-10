import { bindKey, canBind, DEFAULT_BINDINGS, DRIVE_ACTIONS, KEY_SLOTS, keyLabel, PAUSE_KEY, type DriveAction } from '../car/bindings.ts';
import { STR, fmt } from '../config/strings.ts';
import { settings, updateSettings } from '../core/settings.ts';
import { button, h } from './dom.ts';

/**
 * The keyboard controls: every driving action with two keys. Click a key and
 * press the new one (Esc cancels, Backspace clears it); a key already used by
 * another action moves over, and the panel says from where. While it's open
 * it keeps the keys to itself, so nothing behind it (the game, the menu)
 * reacts. Opens from the main menu and the pause menu.
 */
export class ControlsPanel {
  readonly root: HTMLElement;
  private readonly grid: HTMLElement;
  private readonly note: HTMLElement;
  private capturing: { action: DriveAction; slot: number } | null = null;
  private onClose: () => void = () => {};
  private abort: AbortController | null = null;

  constructor() {
    const C = STR.controls;
    this.grid = h('div', { class: 'controls-grid' });
    this.note = h('p', { class: 'controls-note' });
    this.note.setAttribute('role', 'status');
    this.note.setAttribute('aria-live', 'polite');
    const panel = h(
      'div',
      { class: 'panel controls-panel' },
      h('h2', { text: C.title }),
      h('p', { class: 'assists-intro', text: C.intro }),
      this.grid,
      this.note,
      h('p', { class: 'setup-hint', text: `${C.escNote} ${C.gamepad}` }),
      h(
        'div',
        { class: 'menu row' },
        button(C.reset, () => this.resetAll(), { icon: '↺' }),
        button(C.done, () => this.close(), { icon: '✓', class: 'primary', key: keyLabel(PAUSE_KEY) }),
      ),
    );
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-label', C.title);
    this.root = h('div', { class: 'screen overlay controls-overlay' }, panel);
    this.root.hidden = true;
    this.root.addEventListener('pointerdown', (e) => {
      if (e.target === this.root) this.close();
    });
  }

  get isOpen(): boolean {
    return !this.root.hidden;
  }

  /** Shows it over `host`; `onClose` runs when it's closed. */
  open(host: HTMLElement, onClose: () => void = () => {}): void {
    this.onClose = onClose;
    this.capturing = null;
    this.note.textContent = '';
    this.render();
    host.append(this.root);
    this.root.hidden = false;
    this.abort = new AbortController();
    // Capture phase, on the window: it sees every key first.
    window.addEventListener('keydown', (e) => this.onKey(e), { capture: true, signal: this.abort.signal });
    (this.grid.querySelector('button') as HTMLButtonElement | null)?.focus({ preventScroll: true });
  }

  close(): void {
    if (this.root.hidden) return;
    this.abort?.abort();
    this.abort = null;
    this.capturing = null;
    this.root.hidden = true;
    this.root.remove();
    this.onClose();
  }

  private onKey(e: KeyboardEvent): void {
    const pass = !this.capturing && (e.code === 'Tab' || e.code === 'Enter' || e.code === 'NumpadEnter' || e.code === 'Space');
    if (pass) return; // moving between buttons and pressing them
    e.preventDefault();
    e.stopImmediatePropagation();
    if (e.repeat) return;
    const cap = this.capturing;
    if (!cap) {
      if (e.code === PAUSE_KEY) this.close();
      return;
    }
    if (e.code === PAUSE_KEY) {
      this.capturing = null;
      this.render();
      return;
    }
    if (e.code === 'Backspace' || e.code === 'Delete') {
      this.set(cap.action, cap.slot, null);
      return;
    }
    if (canBind(e.code)) this.set(cap.action, cap.slot, e.code);
  }

  private set(action: DriveAction, slot: number, code: string | null): void {
    const { bindings, movedFrom } = bindKey(settings().keys, action, slot, code);
    updateSettings({ keys: bindings });
    this.capturing = null;
    this.note.textContent = code && movedFrom ? fmt(STR.controls.moved, { key: keyLabel(code), from: STR.controls.actions[movedFrom] }) : '';
    this.render();
  }

  private resetAll(): void {
    updateSettings({ keys: Object.fromEntries(DRIVE_ACTIONS.map((a) => [a, [...DEFAULT_BINDINGS[a]]])) as typeof DEFAULT_BINDINGS });
    this.capturing = null;
    this.note.textContent = STR.controls.resetDone;
    this.render();
  }

  private render(): void {
    const C = STR.controls;
    const b = settings().keys;
    const focused = document.activeElement instanceof HTMLElement ? document.activeElement.dataset.slot : undefined;
    const rows = DRIVE_ACTIONS.map((action) => {
      const keys = b[action];
      const label = h('span', { class: 'controls-action', text: C.actions[action] });
      if (!keys.length) label.append(h('span', { class: 'controls-missing', text: ` (${C.noKey})` }));
      const cells = Array.from({ length: KEY_SLOTS }, (_, slot) => {
        const code = keys[slot];
        const cap = this.capturing?.action === action && this.capturing.slot === Math.min(slot, keys.length);
        // An empty slot past the first gap just adds a key.
        const text = cap ? C.press : code ? keyLabel(code) : slot === keys.length ? C.add : C.unset;
        const btn = button(text, () => {
          this.capturing = { action, slot: Math.min(slot, keys.length) };
          this.note.textContent = '';
          this.render();
        }, { class: `compact key-btn${cap ? ' capturing' : ''}${code ? '' : ' empty'}`, title: fmt(C.keyTitle, { action: C.actions[action], n: slot + 1 }) });
        btn.dataset.slot = `${action}-${slot}`;
        btn.disabled = !code && slot > keys.length;
        return btn;
      });
      return h('div', { class: 'controls-row' }, label, ...cells);
    });
    this.grid.replaceChildren(...rows);
    // Keep the keyboard focus where it was.
    if (focused) (this.grid.querySelector(`[data-slot="${focused}"]`) as HTMLButtonElement | null)?.focus({ preventScroll: true });
  }
}
