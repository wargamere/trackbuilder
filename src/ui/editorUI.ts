import { STR, fmt } from '../config/strings.ts';
import type { SmoothingLevel, ThemeId, TrackOptions } from '../config/track.ts';
import type { InkStats } from '../track/ink.ts';
import { button, h } from './dom.ts';

export type MessageKind = 'info' | 'ok' | 'error' | 'warn';
export type EditorMode = 'draw' | 'dots' | 'height';

export interface EditorActions {
  back(): void;
  undo(): void;
  redo(): void;
  clear(): void;
  race(): void;
  setMode(m: EditorMode): void;
  setSmoothing(s: SmoothingLevel): void;
  setSnap(on: boolean): void;
  reverse(): void;
  sample(i: number): void;
  rename(name: string): void;
  myTracks(): void;
  share(): void;
  setSoft(on: boolean): void;
  setOptions(o: Partial<TrackOptions>): void;
  hills(): void;
  flatten(): void;
  smoothHeights(): void;
  zoom(how: 'in' | 'out' | 'fit'): void;
}

/** A row of buttons where exactly one is "on". */
function segmented<T extends string>(items: [T, string, string?][], onPick: (v: T) => void): { el: HTMLElement; set(v: T): void } {
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

/** DOM overlay for the track editor. */
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
  private readonly redoBtn: HTMLButtonElement;
  private readonly raceBtn: HTMLButtonElement;
  private readonly optionsBtn: HTMLButtonElement;
  private readonly options: HTMLElement;
  private readonly mode: { el: HTMLElement; set(v: EditorMode): void };
  private readonly smoothing: { el: HTMLElement; set(v: SmoothingLevel): void };
  private readonly snap: HTMLInputElement;
  private readonly soft: HTMLInputElement;
  private readonly walls: HTMLInputElement;
  private readonly banking: { el: HTMLElement; set(v: '0' | '1' | '2'): void };
  private readonly theme: { el: HTMLElement; set(v: ThemeId): void };
  private readonly name: HTMLInputElement;
  private readonly tools: HTMLElement;
  private readonly zoomBox: HTMLElement;

  constructor(actions: EditorActions, sampleNames: readonly string[]) {
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

    this.undoBtn = button(STR.buttons.undo, actions.undo, { key: k.undo, icon: '↶', class: 'compact' });
    this.redoBtn = button(STR.buttons.redo, actions.redo, { key: k.redo, icon: '↷', class: 'compact' });
    this.raceBtn = button(STR.buttons.raceIt, actions.race, { key: k.race, icon: '▶', class: 'primary' });
    this.mode = segmented<EditorMode>(
      [
        ['draw', STR.editor.modeDraw, '✎'],
        ['dots', STR.editor.modeDots, '●'],
        ['height', STR.editor.modeHeight, '▲'],
      ],
      actions.setMode,
    );
    this.optionsBtn = button(STR.buttons.options, () => this.toggleOptions(), { key: k.options, icon: '⚙', class: 'compact' });
    this.bottom = h(
      'div',
      { class: 'bar bottom' },
      button(STR.buttons.back, actions.back, { key: k.back, icon: '✕', class: 'compact' }),
      this.undoBtn,
      this.redoBtn,
      button(STR.buttons.clear, actions.clear, { key: k.clear, icon: '⌫', class: 'compact' }),
      this.mode.el,
      this.optionsBtn,
      h('div', { class: 'spacer' }),
      this.raceBtn,
    );

    // Options panel.
    this.name = h('input', { class: 'text-input' });
    this.name.type = 'text';
    this.name.maxLength = 32;
    this.name.addEventListener('input', () => actions.rename(this.name.value));
    this.name.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === 'Escape') this.name.blur();
      e.stopPropagation(); // typing a name must not trigger editor shortcuts
    });
    this.smoothing = segmented<SmoothingLevel>(
      [
        ['sharp', STR.editor.smoothing.sharp],
        ['normal', STR.editor.smoothing.normal],
        ['smooth', STR.editor.smoothing.smooth],
      ],
      actions.setSmoothing,
    );
    this.snap = h('input');
    this.snap.type = 'checkbox';
    this.snap.addEventListener('change', () => actions.setSnap(this.snap.checked));
    const samples = h('div', { class: 'row wrap' }, ...sampleNames.map((n, i) => button(n, () => actions.sample(i), { icon: '★' })));
    this.soft = h('input');
    this.soft.type = 'checkbox';
    this.soft.addEventListener('change', () => actions.setSoft(this.soft.checked));
    this.walls = h('input');
    this.walls.type = 'checkbox';
    this.walls.addEventListener('change', () => actions.setOptions({ walls: this.walls.checked }));
    this.banking = segmented<'0' | '1' | '2'>(
      [
        ['0', STR.editor.banking[0]],
        ['1', STR.editor.banking[1]],
        ['2', STR.editor.banking[2]],
      ],
      (v) => actions.setOptions({ banking: Number(v) as 0 | 1 | 2 }),
    );
    this.theme = segmented<ThemeId>(
      [
        ['meadow', STR.editor.themes.meadow],
        ['desert', STR.editor.themes.desert],
        ['snow', STR.editor.themes.snow],
      ],
      (v) => actions.setOptions({ theme: v }),
    );
    this.options = h(
      'div',
      { class: 'options-panel' },
      h('label', { class: 'field' }, h('span', { class: 'label', text: STR.editor.optName }), this.name),
      h('div', { class: 'field' }, h('span', { class: 'label', text: STR.editor.optSmoothing }), this.smoothing.el),
      h('label', { class: 'field check' }, this.snap, h('span', { text: STR.editor.optSnap })),
      h('label', { class: 'field check' }, this.soft, h('span', { text: STR.editor.optSoft })),
      h('div', { class: 'field' }, h('span', { class: 'label', text: STR.editor.optTheme }), this.theme.el),
      h('div', { class: 'field' }, h('span', { class: 'label', text: STR.editor.optBanking }), this.banking.el),
      h('label', { class: 'field check' }, this.walls, h('span', { text: STR.editor.optWalls })),
      h('div', { class: 'row wrap' }, button(STR.buttons.reverse, actions.reverse, { icon: '⇄', key: 'R' }), button(STR.buttons.shareTrack, actions.share, { icon: '⧉' })),
      h('div', { class: 'row' }, button(STR.buttons.myTracks, actions.myTracks, { icon: '☰' })),
      h('div', { class: 'field' }, h('span', { class: 'label', text: STR.editor.optSamples }), samples),
      h('div', { class: 'field' }, h('span', { class: 'label', text: STR.editor.optHelpTitle }), h('p', { class: 'help', text: STR.editor.optHelp })),
    );
    this.options.hidden = true;

    // Height tools (a second bar under the top one, in Height mode only).
    this.tools = h(
      'div',
      { class: 'bar tools' },
      button(STR.editor.hills, actions.hills, { icon: '⛰', key: k.hills }),
      button(STR.editor.smoothHeights, actions.smoothHeights, { icon: '∿' }),
      button(STR.editor.flatten, actions.flatten, { icon: '▬' }),
    );
    this.tools.hidden = true;

    // Zoom buttons at the right edge.
    this.zoomBox = h(
      'div',
      { class: 'zoom-box' },
      button('', () => actions.zoom('in'), { icon: '+', class: 'round', title: `${STR.editor.zoomIn} (${k.zoomIn})` }),
      button('', () => actions.zoom('out'), { icon: '−', class: 'round', title: `${STR.editor.zoomOut} (${k.zoomOut})` }),
      button('', () => actions.zoom('fit'), { icon: '⤢', class: 'round', title: `${STR.editor.zoomFit} (${k.zoomFit})` }),
    );
    this.root = h('div', { class: 'screen editor' }, this.top, this.tools, this.zoomBox, this.options, this.bottom);
  }

  /** Heights of the top and bottom bars, so the canvas can keep the track clear of them. */
  insets(): { top: number; bottom: number } {
    return { top: this.top.offsetHeight + (this.tools.hidden ? 0 : this.tools.offsetHeight), bottom: this.bottom.offsetHeight };
  }

  /** Shows the height tools; returns true if that changed the layout. */
  showTools(on: boolean): boolean {
    if (this.tools.hidden === !on) return false;
    this.tools.hidden = !on;
    this.tools.style.top = `${this.top.offsetHeight}px`;
    return true;
  }

  /** Keeps the zoom buttons in the middle of the free area on the right. */
  placeZoom(top: number, bottom: number): void {
    this.zoomBox.style.top = `${top}px`;
    this.zoomBox.style.bottom = `${bottom}px`;
  }

  toggleOptions(force?: boolean): void {
    this.options.hidden = force === undefined ? !this.options.hidden : !force;
    this.optionsBtn.classList.toggle('on', !this.options.hidden);
  }

  get optionsOpen(): boolean {
    return !this.options.hidden;
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

  /** Live estimate while drawing (ink part only; corners are counted when the loop closes). */
  setProjectedMultiplier(value: number): void {
    this.multValue.classList.add('projected');
    this.multValue.textContent = fmt(STR.editor.multiplier, { mult: value.toFixed(2) });
    this.multDetail.textContent = STR.editor.multiplierProjected;
  }

  setMessage(text: string, kind: MessageKind = 'info'): void {
    if (this.message.textContent !== text) this.message.textContent = text;
    this.message.className = `message ${kind}`;
  }

  setState(s: {
    canUndo: boolean;
    canRedo: boolean;
    canRace: boolean;
    mode: EditorMode;
    smoothing: SmoothingLevel;
    snap: boolean;
    soft: boolean;
    options: TrackOptions;
    name: string;
  }): void {
    this.undoBtn.disabled = !s.canUndo;
    this.redoBtn.disabled = !s.canRedo;
    this.raceBtn.disabled = !s.canRace;
    this.mode.set(s.mode);
    this.smoothing.set(s.smoothing);
    this.snap.checked = s.snap;
    this.soft.checked = s.soft;
    this.walls.checked = s.options.walls;
    this.banking.set(String(s.options.banking) as '0' | '1' | '2');
    this.theme.set(s.options.theme);
    if (document.activeElement !== this.name) this.name.value = s.name;
  }
}
