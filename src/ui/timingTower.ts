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

  /** The row elements, reused from one update to the next (only what changed is touched). */
  private readonly pool: TowerRowEls[] = [];

  /** Shows the rows (in race order) and the line under them (null: none). */
  update(rows: readonly TowerRow[], footer: string | null): void {
    const hidden = this.mode === 'off' || rows.length < 2;
    if (this.root.hidden !== hidden) this.root.hidden = hidden;
    if (hidden) return;
    const T = STR.tower;
    const you = rows.findIndex((r) => r.you);
    // Compact: the top three and the two cars either side of you.
    const shown = this.mode === 'compact' ? rows.filter((_, i) => i < 3 || Math.abs(i - you) <= 2) : rows;
    while (this.pool.length < shown.length) this.pool.push(towerRowEls());
    shown.forEach((r, i) => {
      const el = this.pool[i];
      const gapText = r.out ? T.out : r.you ? T.you : r.finished && !r.gap ? T.finished : r.gap;
      // A gap in the list (compact) gets a thin divider.
      const afterGap = i > 0 && shown[i - 1].pos !== r.pos - 1;
      text(el.pos, String(r.pos));
      text(el.name, r.name);
      text(el.gap, gapText);
      cls(el.row, `tower-row${r.you ? ' you' : ''}${r.out ? ' out' : ''}${afterGap ? ' after-gap' : ''}`);
      const colour = hexColour(r.paint);
      if (el.colourHex !== colour) {
        el.colourHex = colour;
        el.colour.style.background = colour;
      }
      // In the pits, or how many stops so far (nothing for a car that's out, or hasn't stopped).
      const badge = r.out ? '' : r.pit ? T.pit : r.stops > 0 ? fmt(r.stops === 1 ? T.stops : T.stopsMany, { n: r.stops }) : '';
      cls(el.badge, r.pit && !r.out ? 'tower-pit' : 'tower-stops');
      text(el.badge, badge);
      if (el.badge.hidden !== !badge) el.badge.hidden = !badge;
      if (el.tyre.hidden !== !r.tyre) el.tyre.hidden = !r.tyre;
      if (r.tyre) {
        text(el.chip, STR.tyres.letters[r.tyre]);
        if (el.chip.dataset.compound !== r.tyre) el.chip.dataset.compound = r.tyre;
        text(el.age, fmt(T.age, { n: Math.floor(r.tyreAge) }));
        cls(el.tyre, r.tyreLeft <= 0 ? 'tower-tyre gone' : 'tower-tyre');
      }
      if (this.rows.children[i] !== el.row) this.rows.insertBefore(el.row, this.rows.children[i] ?? null);
    });
    // Rows no longer shown (compact, or cars gone from the list).
    while (this.rows.children.length > shown.length) this.rows.lastElementChild?.remove();
    // A full grid of twenty: tighter rows, so it fits a small screen.
    this.root.classList.toggle('long', shown.length > 12);
    text(this.footer, footer ?? '');
    if (this.footer.hidden !== !footer) this.footer.hidden = !footer;
  }
}

/** One row's elements. */
interface TowerRowEls {
  row: HTMLElement;
  pos: HTMLElement;
  colour: HTMLElement;
  colourHex: string;
  name: HTMLElement;
  badge: HTMLElement;
  tyre: HTMLElement;
  chip: HTMLElement;
  age: HTMLElement;
  gap: HTMLElement;
}

function towerRowEls(): TowerRowEls {
  const pos = h('span', { class: 'tower-pos' });
  const colour = h('span', { class: 'tower-colour' });
  const name = h('span', { class: 'tower-name' });
  const badge = h('span', { class: 'tower-stops' });
  const chip = h('span', { class: 'tyre-chip' });
  const age = h('span', { class: 'tower-age' });
  const tyre = h('span', { class: 'tower-tyre' }, chip, age);
  const gap = h('span', { class: 'tower-gap' });
  const row = h('div', { class: 'tower-row' }, pos, colour, name, badge, tyre, gap);
  row.setAttribute('role', 'row');
  badge.hidden = true;
  tyre.hidden = true;
  return { row, pos, colour, colourHex: '', name, badge, tyre, chip, age, gap };
}

/** Sets an element's text only if it changed (no needless style and layout work). */
function text(el: HTMLElement, value: string): void {
  if (el.textContent !== value) el.textContent = value;
}

/** Sets an element's classes only if they changed. */
function cls(el: HTMLElement, value: string): void {
  if (el.className !== value) el.className = value;
}
