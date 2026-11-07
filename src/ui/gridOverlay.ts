import { STR, fmt } from '../config/strings.ts';
import { formatTime } from '../race/session.ts';
import { button, h } from './dom.ts';

/** One car on the grid after qualifying. */
export interface GridEntry {
  name: string;
  paint: number;
  /** Best clean qualifying lap, or null for no time. */
  time: number | null;
  you: boolean;
}

/**
 * After qualifying: the grid, pole first, with each car's time and gap to
 * pole, where you start, and Start race (Enter) or Race settings.
 */
export class GridOverlay {
  readonly root: HTMLElement;
  private readonly note: HTMLElement;
  private readonly list: HTMLElement;
  private abort: AbortController | null = null;
  private readonly actions: { start(): void; settings(): void };

  constructor(actions: { start(): void; settings(): void }) {
    this.actions = actions;
    this.note = h('p', { class: 'grid-note' });
    this.list = h('ol', { class: 'standings' });
    this.root = h(
      'div',
      { class: 'screen overlay grid-overlay' },
      h(
        'div',
        { class: 'panel' },
        h('h2', { text: STR.grid.title }),
        this.note,
        this.list,
        h(
          'div',
          { class: 'menu row setup-buttons' },
          button(STR.buttons.raceSettings, () => this.actions.settings(), { icon: '🏁' }),
          button(STR.grid.start, () => this.actions.start(), { icon: '▶', class: 'primary', key: 'Enter' }),
        ),
      ),
    );
    this.root.hidden = true;
  }

  show(entries: readonly GridEntry[]): void {
    const ord = (i: number) => STR.results.ordinals[i] ?? String(i + 1);
    const pole = entries[0]?.time ?? null;
    const you = entries.findIndex((e) => e.you);
    this.note.textContent = fmt(STR.grid.youStart, { pos: ord(you), n: entries.length });
    this.list.replaceChildren(
      ...entries.map((e, i) => {
        const dot = h('i', { class: 'car-dot' });
        dot.style.background = `#${e.paint.toString(16).padStart(6, '0')}`;
        const time = e.time === null ? STR.grid.noTime : i === 0 || pole === null ? formatTime(e.time) : fmt(STR.results.gap, { t: (e.time - pole).toFixed(2) });
        return h(
          'li',
          { class: e.you ? 'you' : '' },
          h('span', { class: 'standing-pos', text: ord(i) }),
          dot,
          h('span', { class: 'standing-name', text: e.name }),
          h('span', { class: 'standing-time', text: time }),
        );
      }),
    );
    this.root.hidden = false;
    this.abort?.abort();
    this.abort = new AbortController();
    window.addEventListener(
      'keydown',
      (e) => {
        if (e.repeat || e.ctrlKey || e.metaKey || e.altKey) return;
        if (e.code === 'Enter' || e.code === 'NumpadEnter') {
          e.preventDefault();
          this.actions.start();
        }
      },
      { signal: this.abort.signal },
    );
  }

  hide(): void {
    this.root.hidden = true;
    this.abort?.abort();
    this.abort = null;
  }

  get visible(): boolean {
    return !this.root.hidden;
  }
}
