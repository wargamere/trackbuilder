import { STR, fmt } from '../config/strings.ts';
import { TRACK, type SmoothingLevel, type TrackOptions } from '../config/track.ts';
import type { Settings } from '../core/settings.ts';
import type { InkStats } from '../track/ink.ts';
import type { TrackStats } from '../track/stats.ts';
import { button, h, segmented, slider, type Choice, type Slider } from './dom.ts';

export type MessageKind = 'info' | 'ok' | 'error' | 'warn';
export type EditorMode = 'draw' | 'dots' | 'height';
export type Terrain = 'flat' | 'rolling' | 'hilly';
export type DisplaySettings = Pick<Settings, 'graphics' | 'units' | 'minimap' | 'cornerLabels'>;

export interface EditorActions {
  back(): void;
  undo(): void;
  redo(): void;
  clear(): void;
  race(): void;
  practice(): void;
  preview(): void;
  setMode(m: EditorMode): void;
  setSmoothing(s: SmoothingLevel): void;
  setSnap(on: boolean): void;
  setSoft(on: boolean): void;
  setOptions(o: Partial<TrackOptions>): void;
  setDisplay(d: Partial<DisplaySettings>): void;
  reverse(): void;
  sample(i: number): void;
  rename(name: string): void;
  myTracks(): void;
  share(): void;
  save(): void;
  hills(): void;
  terrain(t: Terrain): void;
  smoothHeights(): void;
  flatten(): void;
  transform(how: 'grow' | 'shrink' | 'rotate' | 'mirror'): void;
  zoom(how: 'in' | 'out' | 'fit'): void;
  focusCorner(i: number): void;
  /** Slider drags: change without an undo step each time, then commit once on release. */
  previewOptions(o: Partial<TrackOptions>): void;
  commitLive(): void;
  /** Bank of numbered corner `i` at its apex (degrees), or null for the track's level. */
  cornerBank(i: number, deg: number | null): void;
  /** Slides the start line along the road (metres; negative = back). */
  moveStart(metres: number): void;
}

/** One numbered corner, for the Corners section. */
export interface CornerInfo {
  dir: 'L' | 'R';
  radius: number;
  /** Bank angle at the apex (degrees). */
  bank: number;
  /** The corner has its own bank (not the track's level). */
  custom: boolean;
}

/** Everything the editor overlay shows; set every frame (DOM is only touched on change). */
export interface EditorViewState {
  canUndo: boolean;
  canRedo: boolean;
  canRace: boolean;
  mode: EditorMode;
  smoothing: SmoothingLevel;
  snap: boolean;
  soft: boolean;
  options: TrackOptions;
  display: DisplaySettings;
  name: string;
  stats: TrackStats | null;
  corners: CornerInfo[];
  /** Pits are switched on but there is no room for them. */
  pitsNoRoom: boolean;
  /** The track as it is now is in My tracks. */
  saved: boolean;
}

function checkbox(label: string, onChange: (on: boolean) => void): { el: HTMLElement; input: HTMLInputElement } {
  const input = h('input');
  input.type = 'checkbox';
  input.addEventListener('change', () => onChange(input.checked));
  return { el: h('label', { class: 'field check' }, input, h('span', { text: label })), input };
}

const field = (label: string, ...children: (Node | string)[]) => h('div', { class: 'field' }, h('span', { class: 'label', text: label }), ...children);

interface Section {
  root: HTMLElement;
  summary: HTMLElement;
  body: HTMLElement;
}

/** Wide screens dock the sidebar; narrower ones show a rail of numbers that opens over the map. */
const DOCK_MIN_WIDTH = 1100;

/**
 * DOM overlay for the track editor: a sidebar of seven numbered sections
 * (Draw, Size & shape, Corners, Start & pits, Track edges, Scenery & world,
 * Display) with the race button at the bottom, a top bar (undo, ink, messages,
 * multiplier), a stats strip along the bottom and zoom buttons.
 */
export class EditorUI {
  readonly root: HTMLElement;
  private readonly sidebar: HTMLElement;
  private readonly top: HTMLElement;
  private readonly statsBar: HTMLElement;
  private readonly statCells: Record<'length' | 'corners' | 'straight' | 'gradient' | 'elevation' | 'radius', HTMLElement>;
  private readonly inkFill: HTMLElement;
  private readonly inkValue: HTMLElement;
  private readonly inkBox: HTMLElement;
  private readonly multValue: HTMLElement;
  private readonly multDetail: HTMLElement;
  private readonly message: HTMLElement;
  private readonly undoBtn: HTMLButtonElement;
  private readonly redoBtn: HTMLButtonElement;
  private readonly raceBtn: HTMLButtonElement;
  private readonly practiceBtn: HTMLButtonElement;
  private readonly saveBtn: HTMLButtonElement;
  private readonly zoomBox: HTMLElement;
  private readonly sections: Section[] = [];
  private open: number;
  private docked = true;
  private overlay = false;
  private readonly name: HTMLInputElement;
  private readonly ctl: {
    mode: Choice<EditorMode>;
    smoothing: Choice<SmoothingLevel>;
    snap: HTMLInputElement;
    soft: HTMLInputElement;
    heightTools: HTMLElement;
    width: Slider;
    terrain: Choice<Terrain>;
    banking: Choice<number>;
    cornerList: HTMLElement;
    laps: Choice<number>;
    pits: Choice<boolean>;
    pitsNote: HTMLElement;
    kerbs: Choice<string>;
    runoff: Choice<string>;
    barrier: Choice<string>;
    theme: Choice<string>;
    time: Choice<string>;
    trees: Choice<string>;
    graphics: Choice<string>;
    units: Choice<string>;
    minimap: HTMLInputElement;
    cornerLabels: HTMLInputElement;
  };
  private cornerKey = '';
  private cornerActions: EditorActions | null = null;
  private cornerRows: { slider: Slider; auto: HTMLElement; label: HTMLElement }[] = [];

  constructor(actions: EditorActions, sampleNames: readonly string[], openSection = 0) {
    const k = STR.editor.keys;
    const S = STR.sidebar;
    this.open = openSection;

    // ---------------------------------------------------------- top bar
    this.inkFill = h('div', { class: 'meter-fill' });
    this.inkValue = h('span', { class: 'ink-value' });
    this.inkBox = h('div', { class: 'ink' }, h('span', { class: 'label', text: STR.editor.ink }), h('div', { class: 'meter' }, this.inkFill), this.inkValue);
    this.multValue = h('div', { class: 'mult-value' });
    this.multDetail = h('div', { class: 'mult-detail' });
    const mult = h('div', { class: 'mult', title: STR.editor.multiplierLabel }, h('div', { class: 'label', text: STR.editor.multiplierLabel }), this.multValue, this.multDetail);
    this.message = h('div', { class: 'message' });
    this.undoBtn = button('', actions.undo, { icon: '↶', class: 'tool', title: `${STR.buttons.undo} (${k.undo})` });
    this.redoBtn = button('', actions.redo, { icon: '↷', class: 'tool', title: `${STR.buttons.redo} (${k.redo})` });
    const tools = h(
      'div',
      { class: 'tools' },
      this.undoBtn,
      this.redoBtn,
      button('', actions.clear, { icon: '⌫', class: 'tool', title: `${STR.buttons.clear} (${k.clear})` }),
      button('', actions.preview, { icon: '◈', class: 'tool', title: S.preview }),
    );
    this.top = h('div', { class: 'bar top' }, tools, this.message, this.inkBox, mult);

    // ------------------------------------------------------------- sidebar
    this.name = h('input', { class: 'text-input' });
    this.name.type = 'text';
    this.name.maxLength = 32;
    this.name.placeholder = STR.editor.optName;
    this.name.addEventListener('input', () => actions.rename(this.name.value));
    this.name.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === 'Escape') this.name.blur();
      e.stopPropagation(); // typing a name must not trigger editor shortcuts
    });

    const opt = actions.setOptions;
    const ctlMode = segmented<EditorMode>(
      [
        ['draw', STR.editor.modeDraw, '✎'],
        ['dots', STR.editor.modeDots, '●'],
        ['height', STR.editor.modeHeight, '▲'],
      ],
      actions.setMode,
    );
    const smoothing = segmented<SmoothingLevel>(
      [
        ['sharp', STR.editor.smoothing.sharp],
        ['normal', STR.editor.smoothing.normal],
        ['smooth', STR.editor.smoothing.smooth],
      ],
      actions.setSmoothing,
    );
    const snap = checkbox(STR.editor.optSnap, actions.setSnap);
    const soft = checkbox(STR.editor.optSoft, actions.setSoft);
    const heightTools = h(
      'div',
      { class: 'row wrap' },
      button(STR.editor.hills, actions.hills, { icon: '⛰', key: k.hills }),
      button(STR.editor.smoothHeights, actions.smoothHeights, { icon: '∿' }),
      button(STR.editor.flatten, actions.flatten, { icon: '▬' }),
    );
    const samples = h('div', { class: 'row wrap' }, ...sampleNames.map((n, i) => button(n, () => actions.sample(i), { icon: '★' })));

    const width = slider(TRACK.minWidth, TRACK.maxWidth, 0.5, (w) => actions.previewOptions({ width: w }), actions.commitLive, (w) => fmt(S.widthValue, { w: w.toFixed(1) }));
    const terrain = segmented<Terrain>(
      [
        ['flat', S.terrains.flat],
        ['rolling', S.terrains.rolling],
        ['hilly', S.terrains.hilly],
      ],
      actions.terrain,
    );
    const banking = segmented<number>(
      [
        [0, STR.editor.banking[0]],
        [1, STR.editor.banking[1]],
        [2, STR.editor.banking[2]],
      ],
      (b) => opt({ banking: b as TrackOptions['banking'] }),
    );
    const cornerList = h('div', { class: 'corner-list' });
    cornerList.addEventListener('click', (e) => {
      const el = e.target as HTMLElement;
      const auto = el.closest<HTMLElement>('[data-auto]');
      if (auto) {
        actions.cornerBank(Number(auto.dataset.auto), null);
        actions.commitLive();
        return;
      }
      const row = el.closest<HTMLElement>('[data-focus]');
      if (row) actions.focusCorner(Number(row.dataset.focus));
    });
    this.cornerActions = actions;
    const laps = segmented<number>(
      [
        [1, '1'],
        [3, '3'],
        [5, '5'],
      ],
      (n) => opt({ laps: n as TrackOptions['laps'] }),
    );
    const pits = segmented<boolean>(
      [
        [true, S.on],
        [false, S.off],
      ],
      (on) => opt({ pits: on }),
    );
    const pitsNote = h('p', { class: 'help warn', text: S.pitsNoRoom });
    const kerbs = segmented<string>(
      (['raised', 'flat', 'none'] as const).map((v) => [v, S.kerbStyles[v]] as [string, string]),
      (v) => opt({ kerbs: v as TrackOptions['kerbs'] }),
    );
    const runoff = segmented<string>(
      (['grass', 'gravel', 'tarmac'] as const).map((v) => [v, S.runoffs[v]] as [string, string]),
      (v) => opt({ runoff: v as TrackOptions['runoff'] }),
    );
    const barrier = segmented<string>(
      (['none', 'concrete', 'tyres'] as const).map((v) => [v, S.barriers[v]] as [string, string]),
      (v) => opt(v === 'none' ? { walls: false } : { walls: true, barrier: v as TrackOptions['barrier'] }),
    );
    const theme = segmented<string>(
      (['meadow', 'desert', 'snow'] as const).map((v) => [v, STR.editor.themes[v]] as [string, string]),
      (v) => opt({ theme: v as TrackOptions['theme'] }),
    );
    const time = segmented<string>(
      (['day', 'sunset'] as const).map((v) => [v, S.times[v]] as [string, string]),
      (v) => opt({ time: v as TrackOptions['time'] }),
    );
    const trees = segmented<string>(
      (['sparse', 'normal', 'dense'] as const).map((v) => [v, S.treeLevels[v]] as [string, string]),
      (v) => opt({ trees: v as TrackOptions['trees'] }),
    );
    const graphics = segmented<string>(
      (['full', 'fast'] as const).map((v) => [v, S.graphicsLevels[v]] as [string, string]),
      (v) => actions.setDisplay({ graphics: v as Settings['graphics'] }),
    );
    const units = segmented<string>(
      (['kmh', 'mph'] as const).map((v) => [v, S.unitNames[v]] as [string, string]),
      (v) => actions.setDisplay({ units: v as Settings['units'] }),
    );
    const minimap = checkbox(S.minimap, (on) => actions.setDisplay({ minimap: on }));
    const cornerLabels = checkbox(S.cornerLabels, (on) => actions.setDisplay({ cornerLabels: on }));
    this.ctl = {
      mode: ctlMode,
      smoothing,
      snap: snap.input,
      soft: soft.input,
      heightTools,
      width,
      terrain,
      banking,
      cornerList,
      laps,
      pits,
      pitsNote,
      kerbs,
      runoff,
      barrier,
      theme,
      time,
      trees,
      graphics,
      units,
      minimap: minimap.input,
      cornerLabels: cornerLabels.input,
    };

    const bodies: [string, HTMLElement[]][] = [
      [
        S.sections.draw,
        [
          field(S.tool, ctlMode.el),
          heightTools,
          field(STR.editor.optSmoothing, smoothing.el),
          snap.el,
          soft.el,
          field(STR.editor.optSamples, samples),
          h('p', { class: 'help', text: STR.editor.optHelp }),
        ],
      ],
      [
        S.sections.shape,
        [
          field(S.roadWidth, width.el),
          h('div', { class: 'row wrap' }, ...[10, 12, 15].map((w) => button(fmt(S.widthValue, { w }), () => opt({ width: w }), { class: 'compact' }))),
          field(
            S.resize,
            h(
              'div',
              { class: 'row wrap' },
              button(S.shrink, () => actions.transform('shrink'), { icon: '−' }),
              button(S.grow, () => actions.transform('grow'), { icon: '+' }),
              button(S.rotate, () => actions.transform('rotate'), { icon: '⟳' }),
              button(S.mirror, () => actions.transform('mirror'), { icon: '⇋' }),
            ),
          ),
          field(S.terrain, terrain.el, h('div', { class: 'row wrap' }, button(STR.editor.smoothHeights, actions.smoothHeights, { icon: '∿' }))),
          h('p', { class: 'help', text: S.terrainHelp }),
        ],
      ],
      [S.sections.corners, [field(STR.editor.optBanking, banking.el), field(S.cornerListLabel, cornerList)]],
      [
        S.sections.start,
        [
          field(S.laps, laps.el),
          field(S.pits, pits.el),
          pitsNote,
          field(
            S.startLine,
            h(
              'div',
              { class: 'row wrap' },
              button(S.startBack, () => actions.moveStart(-10), { icon: '◀' }),
              button(S.startOn, () => actions.moveStart(10), { icon: '▶' }),
            ),
          ),
          h('p', { class: 'help', text: S.startHelp }),
          h('div', { class: 'row wrap' }, button(STR.buttons.reverse, actions.reverse, { icon: '⇄', key: 'R' })),
        ],
      ],
      [S.sections.edges, [field(S.kerbs, kerbs.el), field(S.runoff, runoff.el), field(S.barrier, barrier.el), h('p', { class: 'help', text: S.edgesHelp })]],
      [S.sections.world, [field(STR.editor.optTheme, theme.el), field(S.time, time.el), field(S.trees, trees.el)]],
      [S.sections.display, [field(S.graphics, graphics.el), h('p', { class: 'help', text: S.graphicsHelp }), field(S.units, units.el), minimap.el, cornerLabels.el]],
    ];
    const list = h('div', { class: 'sections' });
    bodies.forEach(([title, content], i) => {
      const summary = h('span', { class: 'sec-summary' });
      const head = h(
        'button',
        { class: 'sec-head' },
        h('span', { class: 'sec-num', text: String(i + 1) }),
        h('span', { class: 'sec-text' }, h('span', { class: 'sec-title', text: title }), summary),
        h('span', { class: 'sec-chev', text: '▸' }),
      );
      head.type = 'button';
      head.tabIndex = -1;
      head.title = title;
      head.addEventListener('mousedown', (e) => e.preventDefault());
      head.addEventListener('click', () => this.toggleSection(i));
      const body = h('div', { class: 'sec-body' }, ...content);
      const root = h('div', { class: 'sec' }, head, body);
      this.sections.push({ root, summary, body });
      list.append(root);
    });

    this.raceBtn = button(STR.buttons.raceIt, actions.race, { key: k.race, icon: '▶', class: 'primary race' });
    this.saveBtn = button(S.save, actions.save, { icon: '⬇', class: 'compact save', title: S.save });
    this.practiceBtn = button(STR.buttons.practice, actions.practice, { icon: '⟳', class: 'compact', title: STR.menu.practiceHint });
    const foot = h(
      'div',
      { class: 'side-foot' },
      h(
        'div',
        { class: 'row' },
        button(S.preview, actions.preview, { icon: '◈', class: 'compact', title: `${S.preview} (V)` }),
        button(STR.buttons.share, actions.share, { icon: '⧉', class: 'compact', title: STR.buttons.share }),
        this.saveBtn,
        button(STR.buttons.myTracks, actions.myTracks, { icon: '☰', class: 'compact', title: STR.buttons.myTracks }),
        this.practiceBtn,
      ),
      this.raceBtn,
    );
    const head = h(
      'div',
      { class: 'side-head' },
      button('', actions.back, { icon: '✕', class: 'tool', title: `${STR.buttons.back} (${k.back})` }),
      h('span', { class: 'side-title', text: S.title }),
    );
    this.sidebar = h('aside', { class: 'sidebar' }, head, h('div', { class: 'side-name' }, this.name), list, foot);

    // ------------------------------------------------------ stats + zoom
    const cell = (label: string) => {
      const v = h('span', { class: 'stat-v', text: '—' });
      return { el: h('div', { class: 'stat-cell' }, h('span', { class: 'stat-l', text: label }), v), v };
    };
    const cells = {
      length: cell(S.stats.length),
      corners: cell(S.stats.corners),
      straight: cell(S.stats.straight),
      gradient: cell(S.stats.gradient),
      elevation: cell(S.stats.elevation),
      radius: cell(S.stats.radius),
    };
    this.statCells = { length: cells.length.v, corners: cells.corners.v, straight: cells.straight.v, gradient: cells.gradient.v, elevation: cells.elevation.v, radius: cells.radius.v };
    this.statsBar = h('div', { class: 'stats-bar' }, ...Object.values(cells).map((c) => c.el));
    this.zoomBox = h(
      'div',
      { class: 'zoom-box' },
      button('', () => actions.zoom('in'), { icon: '+', class: 'round', title: `${STR.editor.zoomIn} (${k.zoomIn})` }),
      button('', () => actions.zoom('out'), { icon: '−', class: 'round', title: `${STR.editor.zoomOut} (${k.zoomOut})` }),
      button('', () => actions.zoom('fit'), { icon: '⤢', class: 'round', title: `${STR.editor.zoomFit} (${k.zoomFit})` }),
    );
    this.root = h('div', { class: 'screen editor' }, this.top, this.statsBar, this.zoomBox, this.sidebar);
    this.applySections();
  }

  // ------------------------------------------------------------- layout

  /** Docks the sidebar on wide screens, or folds it into a rail; true if that changed. */
  setLayout(w: number): boolean {
    const docked = w >= DOCK_MIN_WIDTH;
    if (docked === this.docked) return false;
    this.docked = docked;
    this.overlay = false;
    this.applySections();
    return true;
  }

  /** Space taken by the bars, so the map can keep clear of them. */
  insets(): { top: number; bottom: number; left: number } {
    // On narrow screens the sidebar opens over the map, so only the rail counts.
    const rail = parseFloat(getComputedStyle(this.root).getPropertyValue('--rail')) || 54;
    const left = this.docked ? this.sidebar.offsetWidth : rail;
    return { top: this.top.offsetHeight, bottom: this.statsBar.offsetHeight + 6, left };
  }

  /** Keeps the zoom buttons in the free area on the right. */
  placeZoom(top: number, bottom: number): void {
    this.zoomBox.style.top = `${top}px`;
    this.zoomBox.style.bottom = `${bottom}px`;
  }

  /** Moves the stats strip up when the height profile takes the bottom of the screen. */
  placeStats(bottom: number): void {
    this.statsBar.style.bottom = `${bottom}px`;
  }

  /** True while the sidebar is open over the map (narrow screens). */
  get overlayOpen(): boolean {
    return !this.docked && this.overlay;
  }

  closeOverlay(): void {
    if (!this.overlayOpen) return;
    this.overlay = false;
    this.applySections();
  }

  /** "O": open or close the sidebar section (and, on narrow screens, the overlay). */
  toggleSidebar(): void {
    if (this.docked) this.toggleSection(this.open >= 0 ? this.open : 0);
    else {
      this.overlay = !this.overlay;
      if (this.overlay && this.open < 0) this.open = 0;
      this.applySections();
    }
  }

  /** Opens a section (e.g. Draw when switching modes) without closing it if it's open. */
  showSection(i: number): void {
    if (this.open === i && (this.docked || this.overlay)) return;
    this.open = i;
    if (!this.docked) this.overlay = true;
    this.applySections();
  }

  /** The open section (-1 = none), to remember between visits. */
  get openSection(): number {
    return this.open;
  }

  private toggleSection(i: number): void {
    if (!this.docked && !this.overlay) {
      this.overlay = true;
      this.open = i;
    } else if (this.open === i) {
      this.open = -1;
      if (!this.docked) this.overlay = false;
    } else this.open = i;
    this.applySections();
  }

  private applySections(): void {
    this.root.classList.toggle('docked', this.docked);
    this.root.classList.toggle('rail', !this.docked);
    this.sidebar.classList.toggle('open', this.docked || this.overlay);
    this.sections.forEach((s, i) => s.root.classList.toggle('expanded', i === this.open));
  }

  // -------------------------------------------------------------- state

  setInk(left: number, out = false): void {
    const pct = Math.max(0, Math.min(1, left));
    this.inkFill.style.width = `${(pct * 100).toFixed(1)}%`;
    const t = fmt(STR.editor.inkLeft, { pct: Math.round(pct * 100) });
    if (this.inkValue.textContent !== t) this.inkValue.textContent = t;
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
    const cls = `message ${kind}`;
    if (this.message.className !== cls) this.message.className = cls;
  }

  setState(s: EditorViewState): void {
    const S = STR.sidebar;
    const c = this.ctl;
    const o = s.options;
    this.undoBtn.disabled = !s.canUndo;
    this.redoBtn.disabled = !s.canRedo;
    this.raceBtn.disabled = !s.canRace;
    this.practiceBtn.disabled = !s.canRace;
    this.saveBtn.disabled = !s.canRace || s.saved;
    const saveLabel = this.saveBtn.querySelector('.btn-label');
    const saveText = s.saved ? `${STR.sidebar.savedTick} ✓` : STR.sidebar.save;
    if (saveLabel && saveLabel.textContent !== saveText) saveLabel.textContent = saveText;
    this.saveBtn.classList.toggle('unsaved', s.canRace && !s.saved);
    c.mode.set(s.mode);
    c.heightTools.hidden = s.mode !== 'height';
    c.smoothing.set(s.smoothing);
    c.snap.checked = s.snap;
    c.soft.checked = s.soft;
    c.width.set(o.width);
    c.terrain.set(s.stats?.terrain ?? 'flat');
    c.banking.set(o.banking);
    c.laps.set(o.laps);
    c.pits.set(o.pits);
    c.pitsNote.hidden = !s.pitsNoRoom;
    c.kerbs.set(o.kerbs);
    c.runoff.set(o.runoff);
    c.barrier.set(o.walls ? o.barrier : 'none');
    c.theme.set(o.theme);
    c.time.set(o.time);
    c.trees.set(o.trees);
    c.graphics.set(s.display.graphics);
    c.units.set(s.display.units);
    c.minimap.checked = s.display.minimap;
    c.cornerLabels.checked = s.display.cornerLabels;
    if (document.activeElement !== this.name) this.name.value = s.name;

    // Section summaries, as in "1.36 km · 12 m wide · terrain flat".
    const st = s.stats;
    const modeName = s.mode === 'draw' ? STR.editor.modeDraw : s.mode === 'dots' ? STR.editor.modeDots : STR.editor.modeHeight;
    const summaries = [
      s.mode === 'draw' ? fmt(S.sum.draw, { mode: modeName, smoothing: STR.editor.smoothing[s.smoothing] }) : modeName,
      fmt(S.sum.shape, { len: st ? (st.length / 1000).toFixed(2) : '—', width: o.width, terrain: S.terrains[st?.terrain ?? 'flat'].toLowerCase() }),
      fmt(S.sum.corners, { n: st?.corners ?? 0, banking: S.bankingSum[o.banking] }),
      fmt(S.sum.start, { laps: o.laps, pits: o.pits ? (s.pitsNoRoom ? S.pitsNoRoomShort : S.pitsOn) : S.pitsOff }),
      fmt(S.sum.edges, { kerbs: S.kerbStyles[o.kerbs], runoff: S.runoffs[o.runoff], barrier: o.walls ? S.barriers[o.barrier] : S.noBarriers }),
      fmt(S.sum.world, { theme: STR.editor.themes[o.theme], time: S.times[o.time], trees: S.treeLevels[o.trees] }),
      fmt(S.sum.display, { graphics: S.graphicsLevels[s.display.graphics], units: S.unitNames[s.display.units] }),
    ];
    summaries.forEach((t, i) => {
      const el = this.sections[i].summary;
      if (el.textContent !== t) el.textContent = t;
    });

    // Corner list: rebuilt when the corners change, bank sliders updated in place.
    const key = s.corners.map((k) => `${k.dir}${Math.round(k.radius)}`).join(',');
    if (key !== this.cornerKey) {
      this.cornerKey = key;
      const a = this.cornerActions;
      this.cornerRows = [];
      c.cornerList.replaceChildren(
        ...(s.corners.length && a
          ? s.corners.map((_, i) => {
              const sl = slider(0, 30, 1, (v) => a.cornerBank(i, v), a.commitLive, (v) => `${Math.round(v)}°`);
              const auto = h('button', { class: 'corner-auto', 'data-auto': String(i), text: S.auto, title: S.autoTitle });
              const label = h('span', { class: 'corner-text' });
              this.cornerRows.push({ slider: sl, auto, label });
              return h(
                'div',
                { class: 'corner-row' },
                h('button', { class: 'corner-head', 'data-focus': String(i), title: S.zoomCorner }, h('span', { class: 'corner-num', text: String(i + 1) }), label),
                h('div', { class: 'corner-bank' }, sl.el, auto),
              );
            })
          : [h('p', { class: 'help', text: S.noCorners })]),
      );
    }
    s.corners.forEach((k, i) => {
      const row = this.cornerRows[i];
      if (!row) return;
      const t = fmt(S.cornerRow, { dir: k.dir === 'L' ? S.left : S.right, r: Math.round(k.radius) });
      if (row.label.textContent !== t) row.label.textContent = t;
      row.slider.set(Math.round(k.bank));
      row.auto.hidden = !k.custom;
    });

    // Stats strip.
    const v = this.statCells;
    const set = (el: HTMLElement, t: string) => {
      if (el.textContent !== t) el.textContent = t;
    };
    set(v.length, st ? `${(st.length / 1000).toFixed(2)} km` : '—');
    set(v.corners, st ? String(st.corners) : '—');
    set(v.straight, st ? `${Math.round(st.longestStraight)} m` : '—');
    set(v.gradient, st ? `${st.maxGradient.toFixed(1)}%` : '—');
    set(v.elevation, st ? `${st.elevation.toFixed(1)} m` : '—');
    set(v.radius, st && Number.isFinite(st.tightestRadius) ? `${Math.round(st.tightestRadius)} m` : '—');
  }
}
