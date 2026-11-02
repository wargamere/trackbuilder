import { STR, fmt } from '../config/strings.ts';
import type { InkStats } from '../track/ink.ts';
import { button, h } from './dom.ts';

export type MessageKind = 'info' | 'ok' | 'error' | 'warn';

export interface EditorActions {
  back(): void;
  undo(): void;
  clear(): void;
  sample(): void;
  race(): void;
}

/** DOM overlay for the track editor: ink meter, multiplier, message and buttons. */
export class EditorUI {
  readonly root: HTMLElement;
  private readonly top: HTMLElement;
  private readonly bottom: HTMLElement;
  private readonly inkFill: HTMLElement;
  private readonly inkValue: HTMLElement;
  private readonly inkBox: HTMLElement;
  private readonly multValue: HTMLElement;
  private readonly multDetail: HTMLElement;
  private readonly message: HTMLElement;
  private readonly undoBtn: HTMLButtonElement;
  private readonly raceBtn: HTMLButtonElement;

  constructor(actions: EditorActions) {
    const k = STR.editor.keys;
    this.inkFill = h('div', { class: 'meter-fill' });
    this.inkValue = h('span', { class: 'ink-value' });
    this.inkBox = h(
      'div',
      { class: 'ink' },
      h('span', { class: 'label', text: STR.editor.ink }),
      h('div', { class: 'meter' }, this.inkFill),
      this.inkValue,
    );
    this.multValue = h('div', { class: 'mult-value' });
    this.multDetail = h('div', { class: 'mult-detail' });
    const mult = h(
      'div',
      { class: 'mult', title: STR.editor.multiplierLabel },
      h('div', { class: 'label', text: STR.editor.multiplierLabel }),
      this.multValue,
      this.multDetail,
    );
    this.message = h('div', { class: 'message' });
    this.top = h('div', { class: 'bar top' }, this.inkBox, this.message, mult);

    this.undoBtn = button(STR.buttons.undo, actions.undo, { key: k.undo, icon: '↶' });
    this.raceBtn = button(STR.buttons.raceIt, actions.race, { key: k.race, icon: '▶', class: 'primary' });
    this.bottom = h(
      'div',
      { class: 'bar bottom' },
      button(STR.buttons.back, actions.back, { key: k.back, icon: '✕' }),
      this.undoBtn,
      button(STR.buttons.clear, actions.clear, { key: k.clear, icon: '⌫' }),
      button(STR.buttons.sample, actions.sample, { key: k.sample, icon: '★' }),
      h('div', { class: 'spacer' }),
      this.raceBtn,
    );
    this.root = h('div', { class: 'screen editor' }, this.top, this.bottom);
  }

  /** Heights of the top and bottom bars, so the canvas can keep the track clear of them. */
  insets(): { top: number; bottom: number } {
    return { top: this.top.offsetHeight, bottom: this.bottom.offsetHeight };
  }

  setInk(left: number, out = false): void {
    const pct = Math.max(0, Math.min(1, left));
    this.inkFill.style.width = `${(pct * 100).toFixed(1)}%`;
    this.inkValue.textContent = fmt(STR.editor.inkLeft, { pct: Math.round(pct * 100) });
    this.inkBox.classList.toggle('low', pct < 0.15);
    this.inkBox.classList.toggle('out', out);
  }

  /** Final multiplier of a finished track, or `null` for none. */
  setMultiplier(ink: InkStats | null): void {
    this.multValue.classList.remove('projected');
    if (!ink) {
      this.multValue.textContent = '—';
      this.multDetail.textContent = '';
      return;
    }
    this.multValue.textContent = fmt(STR.editor.multiplier, { mult: ink.multiplier.toFixed(2) });
    this.multDetail.textContent = fmt(STR.editor.multiplierBreakdown, {
      ink: ink.inkMult.toFixed(2),
      corners: ink.tightCorners,
      bonus: ink.cornerBonus.toFixed(2),
    });
  }

  /** Live estimate while drawing (ink part only; corners are counted on release). */
  setProjectedMultiplier(value: number): void {
    this.multValue.classList.add('projected');
    this.multValue.textContent = fmt(STR.editor.multiplier, { mult: value.toFixed(2) });
    this.multDetail.textContent = STR.editor.multiplierProjected;
  }

  setMessage(text: string, kind: MessageKind = 'info'): void {
    this.message.textContent = text;
    this.message.className = `message ${kind}`;
  }

  setCanUndo(v: boolean): void {
    this.undoBtn.disabled = !v;
  }

  setCanRace(v: boolean): void {
    this.raceBtn.disabled = !v;
  }
}
