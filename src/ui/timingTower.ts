import type { Compound } from '../config/race.ts';
import { STR, fmt } from '../config/strings.ts';
import { h } from './dom.ts';

/** One car in the tower. */
export interface TowerRow {
  /** 1-based race position. */
  pos: number;
  name: string;
  paint: number;
  you: boolean;
  /** Gap to you ("+1.8", "−0.4", "+1 LAP"), or "" for you and before the first mark. */
  gap: string;
  /** With tyre wear: the kind of tyres on, laps on them and the share of their life left. */
  tyre: Compound | null;
  tyreAge: number;
  tyreLeft: number;
  stops: number;
  /** In the pits now (going in, stopped or coming out). */
  pit: boolean;
  finished: boolean;
  /** Retired from the race. */
  out?: boolean;
}

const hexColour = (hex: number) => `#${hex.toString(16).padStart(6, '0')}`;

/**
 * The live timing tower in a race with AI cars, down the left of the screen:
 * position, name, the tyres each car is on (and how old), stops made, the
 * gap to you, and who's in the pits. Under it, with tyre wear on, where you'd
 * rejoin if you stopped now. Compact shows the leaders and the cars around
 * you; tapping it switches between full and compact.
 */
export class TimingTower {
  readonly root: HTMLElement;
  private readonly rows: HTMLElement;
  private readonly footer: HTMLElement;
  mode: 'full' | 'compact' | 'off' = 'full';
  /** Called when a tap switches full / compact. */
  onToggle: (mode: 'full' | 'compact') => void = () => {};

  constructor() {
    this.rows = h('div', { class: 'tower-rows' });
    this.footer = h('div', { class: 'tower-footer' });
    this.root = h('div', { class: 'timing-tower' }, this.rows, this.footer);
    this.root.title = STR.tower.hint;
    this.root.setAttribute('role', 'table');
    this.root.setAttribute('aria-label', STR.tower.title);
    this.root.hidden = true;
    this.root.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      const next = this.mode === 'full' ? 'compact' : 'full';
      this.mode = next;
      this.onToggle(next);
    });
  }

  hide(): void {
    this.root.hidden = true;
  }

  /** Shows the rows (in race order) and the line under them (null: none). */
  update(rows: readonly TowerRow[], footer: string | null): void {
    this.root.hidden = this.mode === 'off' || rows.length < 2;
    if (this.root.hidden) return;
    const T = STR.tower;
    const you = rows.findIndex((r) => r.you);
    // Compact: the top three and the two cars either side of you.
    const shown = this.mode === 'compact' ? rows.filter((_, i) => i < 3 || Math.abs(i - you) <= 2) : rows;
    const els = shown.map((r, i) => {
      const gapText = r.out ? T.out : r.you ? T.you : r.finished && !r.gap ? T.finished : r.gap;
      const tyre = r.tyre
        ? h('span', { class: 'tower-tyre' }, h('span', { class: 'tyre-chip', text: STR.tyres.letters[r.tyre] }), h('span', { class: 'tower-age', text: fmt(T.age, { n: Math.floor(r.tyreAge) }) }))
        : null;
      const chip = tyre?.querySelector('.tyre-chip') as HTMLElement | null;
      if (chip && r.tyre) chip.dataset.compound = r.tyre;
      if (r.tyreLeft <= 0 && r.tyre) tyre?.classList.add('gone');
      const row = h(
        'div',
        { class: `tower-row${r.you ? ' you' : ''}${r.out ? ' out' : ''}` },
        h('span', { class: 'tower-pos', text: String(r.pos) }),
        h('span', { class: 'tower-colour' }),
        h('span', { class: 'tower-name', text: r.name }),
        r.out ? null : r.pit ? h('span', { class: 'tower-pit', text: T.pit }) : r.stops > 0 ? h('span', { class: 'tower-stops', text: fmt(r.stops === 1 ? T.stops : T.stopsMany, { n: r.stops }) }) : null,
        tyre,
        h('span', { class: 'tower-gap', text: gapText }),
      );
      row.setAttribute('role', 'row');
      (row.querySelector('.tower-colour') as HTMLElement).style.background = hexColour(r.paint);
      // A gap in the list (compact) gets a thin divider.
      if (i > 0 && shown[i - 1].pos !== r.pos - 1) row.classList.add('after-gap');
      return row;
    });
    this.rows.replaceChildren(...els);
    // A full grid of twenty: tighter rows, so it fits a small screen.
    this.root.classList.toggle('long', shown.length > 12);
    this.footer.textContent = footer ?? '';
    this.footer.hidden = !footer;
  }
}
