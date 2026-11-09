import { STR, fmt } from '../config/strings.ts';
import { TRACK, type SmoothingLevel, type TrackOptions } from '../config/track.ts';
import type { Settings } from '../core/settings.ts';
import { STARTERS, starterTrack, type StarterId } from '../editor/starters.ts';
import { GEN_STYLES, type GenStyle } from '../editor/generate.ts';
import type { TrackStats } from '../track/stats.ts';
import { button, h, segmented, slider, type Choice, type Slider } from './dom.ts';
import { drawThumbnail } from './thumbnail.ts';
import { formatTime } from '../race/session.ts';

export type MessageKind = 'info' | 'ok' | 'error' | 'warn';
export type EditorMode = 'draw' | 'dots' | 'height';
export type Terrain = 'flat' | 'rolling' | 'hilly';
export type DisplaySettings = Pick<Settings, 'graphics' | 'units' | 'minimap' | 'cornerLabels' | 'editorCar'>;

export interface EditorActions {
  back(): void;
  starter(id: StarterId): void;
  surprise(): void;
  restoreDraft(): void;
  closeLoop(): void;
  locateIssue(): void;
  /** Mends a track that isn't valid. */
  fixIt(): void;
  soften(): void;
  selectPoint(direction: number): void;
  nudgePoint(dx: number, dy: number, dh?: number): void;
  deletePoint(): void;
  undo(): void;
  redo(): void;
  clear(): void;
  race(): void;
  practice(): void;
  preview(): void;
  setMode(m: EditorMode): void;
  pan(): void;
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
  /** A made-up track of a style. */
  generate(style: GenStyle): void;
  /** Tracks to pick from, and loading one (a copy) to edit. */
  trackList(group: 'saved' | 'builtIn' | 'world'): { id: string; name: string; note: string }[];
  loadTrack(group: 'saved' | 'builtIn' | 'world', id: string): void;
  /** Loads a pasted code; the problem, or null when it loaded. */
  loadCode(text: string): string | null;
  /** An image to trace over (null removes it), and how it's shown. */
  traceImage(file: File | null): void;
  traceLook(look: { opacity?: number; size?: number }): void;
  /** Shape sliders (live; commitLive on release): lap length (m), climb (m), corner smoothing (min radius, m). */
  setLength(metres: number): void;
  setClimb(metres: number): void;
  setCornerSmoothing(radius: number): void;
  /** Every corner's bank (degrees, as the banking level's; null: back to the level). */
  bankAll(deg: number | null): void;
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
  panActive: boolean;
  empty: boolean;
  drawing: boolean;
  closed: boolean;
  pointCount: number;
  selected: number;
  selectedHeight: number;
  hasProblem: boolean;
  /** There's a problem "Fix it" could try to mend. */
  canFix: boolean;
  /** The gold-medal lap of the track as it is (s), once worked out. */
  lap: number | null;
  hasDraft: boolean;
  draftSaved: boolean;
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
  /** Highest minus lowest dot (m). */
  climb: number;
  /** Every corner's bank if they're all the same (degrees), 'mixed', or null (the track's level). */
  bankAll: number | 'mixed' | null;
  /** An image is being traced. */
  tracing: boolean;
}

function checkbox(label: string, onChange: (on: boolean) => void): { el: HTMLElement; input: HTMLInputElement } {
  const input = h('input');
  input.type = 'checkbox';
  input.addEventListener('change', () => onChange(input.checked));
  return { el: h('label', { class: 'field check' }, input, h('span', { text: label })), input };
}

const field = (label: string, ...children: (Node | string)[]) => {
  const el = h('div', { class: 'field' }, h('span', { class: 'label', text: label }), ...children);
  el.querySelectorAll('input:not([type="checkbox"])').forEach((input) => input.setAttribute('aria-label', label));
  return el;
};

interface Section {
  root: HTMLElement;
  summary: HTMLElement;
  body: HTMLElement;
  head: HTMLButtonElement;
}

/** Wide screens dock the sidebar; narrower ones show a rail of numbers that opens over the map. */
const DOCK_MIN_WIDTH = 900;

/**
 * DOM overlay for the track editor: a sidebar of seven numbered sections
 * (Draw, Size & shape, Corners, Start & pits, Track edges, Scenery & world,
 * Display) with visible drawing tools, starter layouts, point controls,
 * a status bar, a quick guide and draft recovery.
 */
export class EditorUI {
  readonly root: HTMLElement;
  private readonly sidebar: HTMLElement;
  private readonly top: HTMLElement;
  private readonly statsBar: HTMLElement;
  private readonly statCells: Record<'length' | 'corners' | 'lap' | 'straight' | 'gradient' | 'elevation' | 'radius', HTMLElement>;
  private readonly toolMode: Choice<EditorMode | 'pan'>;
  private readonly welcome: HTMLElement;
  private welcomeDismissed = false;
  private wasEmpty = false;
  private readonly toolHint: HTMLElement;
  private readonly restoreBtn: HTMLButtonElement;
  private readonly closeBtn: HTMLButtonElement;
  private readonly locateBtn: HTMLButtonElement;
  private readonly fixBtn: HTMLButtonElement;
  private readonly draftStatus: HTMLElement;
  private readonly pointLabel: HTMLElement;
  private readonly pointControls: HTMLElement;
  private readonly prevPoint: HTMLButtonElement;
  private readonly nextPoint: HTMLButtonElement;
  private readonly previewBtn: HTMLButtonElement;
  private readonly shareBtn: HTMLButtonElement;
  private readonly help: HTMLDialogElement;
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
    car: HTMLInputElement;
    drawHow: Choice<'draw' | 'dots'>;
    length: Slider;
    climb: Slider;
    bankAll: Slider;
    bankAllState: HTMLElement;
    traceTools: HTMLElement;
  };
  private readonly picker: HTMLDialogElement;
  private cornerSel = -1;
  private cornerKey = '';
  private cornerActions: EditorActions | null = null;
  private cornerRows: { slider: Slider; auto: HTMLElement; label: HTMLElement }[] = [];

  constructor(actions: EditorActions, sampleNames: readonly string[], openSection = 0) {
    const k = STR.editor.keys;
    const S = STR.sidebar;
    this.open = openSection;

    // ---------------------------------------------------------- top bar
    const T = STR.studio;
    this.message = h('div', { class: 'message' });
    this.message.setAttribute('role', 'status');
    this.message.setAttribute('aria-live', 'polite');
    this.undoBtn = button('', actions.undo, { icon: '↶', class: 'tool', title: `${STR.buttons.undo} (Z)` });
    this.redoBtn = button('', actions.redo, { icon: '↷', class: 'tool', title: `${STR.buttons.redo} (Y)` });
    this.toolMode = segmented<EditorMode | 'pan'>([
      ['draw', STR.editor.modeDraw, '✎'], ['dots', STR.editor.modeDots, '◇'], ['height', STR.editor.modeHeight, '△'], ['pan', T.pan, '✥'],
    ], (mode) => mode === 'pan' ? actions.pan() : actions.setMode(mode));
    this.toolMode.el.setAttribute('aria-label', T.tools);
    this.toolMode.el.classList.add('studio-modes');
    this.closeBtn = button(T.closeLoop, actions.closeLoop, { icon: '↻', class: 'compact' });
    this.locateBtn = button(T.locate, actions.locateIssue, { icon: '⌖', class: 'compact' });
    this.fixBtn = button(T.fixIt, actions.fixIt, { icon: '🔧', class: 'compact fix', title: T.fixHint });
    this.previewBtn = button(S.preview, actions.preview, { icon: '◈', class: 'compact' });
    this.toolHint = h('span', { class: 'studio-tool-hint' });
    const tools = h('div', { class: 'tools' }, this.undoBtn, this.redoBtn);
    const toolbar = h('div', { class: 'studio-toolbar' }, this.toolMode.el, tools,
      button(T.blank, actions.clear, { icon: '+', class: 'compact studio-blank' }), this.previewBtn,
      button(T.guide, () => this.help.showModal(), { icon: '?', class: 'compact studio-guide' }));
    this.top = h('div', { class: 'bar top' }, toolbar,
      h('div', { class: 'studio-status' }, this.message, this.closeBtn, this.fixBtn, this.locateBtn), this.toolHint);

    // ------------------------------------------------------------- sidebar
    this.name = h('input', { class: 'text-input' });
    this.name.type = 'text';
    this.name.setAttribute('aria-label', STR.editor.optName);
    this.name.maxLength = 32;
    this.name.placeholder = STR.editor.optName;
    this.name.addEventListener('input', () => actions.rename(this.name.value));
    this.name.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === 'Escape') this.name.blur();
      e.stopPropagation(); // typing a name must not trigger editor shortcuts
    });

    const opt = actions.setOptions;
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
      (['day', 'sunset', 'night'] as const).map((v) => [v, S.times[v]] as [string, string]),
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
    // ---- new tools (Draw, Size & shape, Corners)
    const P = STR.editorPlus;
    this.picker = h('dialog', { class: 'track-picker' }) as HTMLDialogElement;
    const pick = (group: 'saved' | 'builtIn' | 'world' | 'code') => this.openPicker(actions, group);
    const pickRow = h(
      'div',
      { class: 'row wrap' },
      button(P.saved, () => pick('saved'), { icon: '💾', class: 'compact' }),
      button(P.builtIn, () => pick('builtIn'), { icon: '★', class: 'compact' }),
      button(P.world, () => pick('world'), { icon: '🌍', class: 'compact' }),
      button(P.code, () => pick('code'), { icon: '⌨', class: 'compact' }),
    );
    const drawHow = segmented<'draw' | 'dots'>(
      [
        ['draw', P.freehand, '✎'],
        ['dots', P.dots, '◇'],
      ],
      (m) => actions.setMode(m),
    );
    const genGrid = h(
      'div',
      { class: 'gen-grid' },
      ...GEN_STYLES.map((g) => button(P.gen[g], () => actions.generate(g), { class: 'compact', title: P.genHints[g] })),
    );
    const traceInput = h('input', { class: 'visually-hidden' }) as HTMLInputElement;
    traceInput.type = 'file';
    traceInput.accept = 'image/*';
    traceInput.addEventListener('change', () => {
      const f = traceInput.files?.[0] ?? null;
      if (f) actions.traceImage(f);
      traceInput.value = '';
    });
    const traceOpacity = slider(0.1, 1, 0.05, (v) => actions.traceLook({ opacity: v }), () => {}, (v) => `${Math.round(v * 100)}%`);
    traceOpacity.set(0.45);
    const traceSize = slider(0.3, 3, 0.05, (v) => actions.traceLook({ size: v }), () => {}, (v) => `${Math.round(v * 100)}%`);
    traceSize.set(1);
    const traceTools = h(
      'div',
      { class: 'trace-tools' },
      field(P.traceOpacity, traceOpacity.el),
      field(P.traceSize, traceSize.el),
      button(P.traceRemove, () => actions.traceImage(null), { icon: '×', class: 'compact' }),
    );
    const traceRow = h(
      'div',
      {},
      traceInput,
      button(P.traceChoose, () => traceInput.click(), { icon: '🖼', class: 'compact' }),
      traceTools,
      h('p', { class: 'help', text: P.traceNote }),
    );
    const lengthSl = slider(TRACK.minLength, 2400, 10, (m) => actions.setLength(m), actions.commitLive, (m) => fmt(P.lengthValue, { km: (m / 1000).toFixed(2) }));
    const climbSl = slider(0, TRACK.maxHeight, 0.5, (m) => actions.setClimb(m), actions.commitLive, (m) => (m < 0.5 ? P.climbFlat : fmt(P.climbValue, { m: Math.round(m) })));
    const smoothSl = slider(0, 40, 1, (r) => actions.setCornerSmoothing(r), actions.commitLive, (r) => (r < 1 ? P.smoothingAsDrawn : fmt(P.smoothingValue, { r })));
    smoothSl.set(0);
    const bankAllSl = slider(0, 20, 0.5, (d) => actions.bankAll(d), actions.commitLive, (d) => fmt(P.bankValue, { d }));
    const bankAllState = h('span', { class: 'bank-all-state' });
    const cornerNav = h(
      'div',
      { class: 'row wrap' },
      button('', () => this.stepCorner(actions, -1), { icon: '‹', class: 'compact', title: P.prevCorner }),
      button('', () => this.stepCorner(actions, 1), { icon: '›', class: 'compact', title: P.nextCorner }),
      button(P.flattenAll, () => {
        actions.bankAll(0);
        actions.commitLive();
      }, { icon: '▬', class: 'compact' }),
      button(P.levelAll, () => {
        actions.bankAll(null);
        actions.commitLive();
      }, { icon: '↺', class: 'compact' }),
    );

    const minimap = checkbox(S.minimap, (on) => actions.setDisplay({ minimap: on }));
    const cornerLabels = checkbox(S.cornerLabels, (on) => actions.setDisplay({ cornerLabels: on }));
    const car = checkbox(T.carToggle, (on) => actions.setDisplay({ editorCar: on }));
    this.ctl = {
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
      car: car.input,
      drawHow,
      length: lengthSl,
      climb: climbSl,
      bankAll: bankAllSl,
      bankAllState,
      traceTools,
    };

    this.pointLabel = h('p', { class: 'studio-point-label', text: T.pointNone });
    this.prevPoint = button('', () => actions.selectPoint(-1), { icon: '‹', title: T.prevPoint });
    this.nextPoint = button('', () => actions.selectPoint(1), { icon: '›', title: T.nextPoint });
    this.pointControls = h('div', { class: 'studio-point-controls' },
      button('', () => actions.nudgePoint(-1, 0), { icon: '←', title: T.moveLeft }),
      button('', () => actions.nudgePoint(0, -1), { icon: '↑', title: T.moveUp }),
      button('', () => actions.nudgePoint(0, 1), { icon: '↓', title: T.moveDown }),
      button('', () => actions.nudgePoint(1, 0), { icon: '→', title: T.moveRight }),
      button('−h', () => actions.nudgePoint(0, 0, -0.5), { title: T.lower }),
      button('+h', () => actions.nudgePoint(0, 0, 0.5), { title: T.raise }),
      button('', actions.deletePoint, { icon: '×', title: T.deletePoint }));
    const pointInspector = h('div', { class: 'studio-point' }, h('span', { class: 'label', text: T.point }),
      h('div', { class: 'row' }, this.prevPoint, this.pointLabel, this.nextPoint), this.pointControls,
      h('p', { class: 'help', text: T.pointHelp }));

    const bodies: [string, HTMLElement[]][] = [
      [
        S.sections.draw,
        [
          field(P.pickTrack, pickRow),
          field(P.howDraw, drawHow.el),
          field(P.generate, genGrid),
          h('div', { class: 'row wrap' },
            button(T.surprise, actions.surprise, { icon: '🎲', class: 'studio-surprise', title: T.surpriseHint }),
            button(T.blank, actions.clear, { icon: '+', class: 'studio-new', title: T.blank })),
          field(P.trace, traceRow),
          heightTools,
          field(STR.editor.optSmoothing, smoothing.el),
          snap.el,
          soft.el,
          h('details', { class: 'studio-details' }, h('summary', { text: P.moreStarts }),
            h('p', { class: 'help', text: T.starterHelp }), this.starterCards(actions, false), samples),
          pointInspector,
          h('details', { class: 'studio-details' }, h('summary', { text: T.moreTips }), h('p', { class: 'help', text: STR.editor.optHelp })),
        ],
      ],
      [
        S.sections.shape,
        [
          field(P.length, lengthSl.el),
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
          field(P.climb, climbSl.el, terrain.el, h('div', { class: 'row wrap' }, button(STR.editor.smoothHeights, actions.smoothHeights, { icon: '∿' }))),
          h('p', { class: 'help', text: `${P.climbHelp} ${S.terrainHelp}` }),
          field(P.cornerSmoothing, smoothSl.el, h('div', { class: 'row wrap' }, button(T.soften, actions.soften, { icon: '∿', class: 'compact' }))),
        ],
      ],
      [
        S.sections.corners,
        [
          field(STR.editor.optBanking, banking.el),
          field(P.bankAll, bankAllState, bankAllSl.el),
          cornerNav,
          field(S.cornerListLabel, cornerList),
        ],
      ],
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
      [S.sections.display, [field(S.graphics, graphics.el), h('p', { class: 'help', text: S.graphicsHelp }), field(S.units, units.el), minimap.el, cornerLabels.el, car.el]],
    ];
    const list = h('div', { class: 'sections' });
    bodies.forEach(([title, content], i) => {
      const summary = h('span', { class: 'sec-summary' });
      const head = h(
        'button',
        { class: 'sec-head' },
        h('span', { class: 'sec-num', text: ['✎', '⤢', '∿', '⚑', '▥', '☀', '⚙'][i] }),
        h('span', { class: 'sec-text' }, h('span', { class: 'sec-title', text: title }), summary),
        h('span', { class: 'sec-chev', text: '▸' }),
      );
      head.type = 'button';
      head.tabIndex = 0;
      head.title = title;
      head.addEventListener('mousedown', (e) => e.preventDefault());
      head.addEventListener('click', () => this.toggleSection(i));
      const body = h('div', { class: 'sec-body' }, ...content);
      const root = h('div', { class: 'sec' }, head, body);
      body.id = `studio-section-${i}`;
      head.setAttribute('aria-controls', body.id);
      this.sections.push({ root, summary, body, head });
      list.append(root);
    });

    this.raceBtn = button(STR.buttons.raceIt, actions.race, { key: k.race, icon: '▶', class: 'primary race' });
    this.saveBtn = button(S.save, actions.save, { icon: '⬇', class: 'compact save', title: S.save });
    this.practiceBtn = button(T.testDrive, actions.practice, { icon: '⟳', class: 'compact', title: fmt(T.testDriveTitle, { hint: STR.menu.practiceHint }) });
    this.restoreBtn = button(T.restore, actions.restoreDraft, { icon: '↺', class: 'compact studio-restore' });
    this.draftStatus = h('span', { class: 'studio-draft', title: T.draftHint });
    this.shareBtn = button(STR.buttons.share, actions.share, { icon: '⧉', class: 'compact' });
    const foot = h(
      'div',
      { class: 'side-foot' },
      h('div', { class: 'studio-draft-row' }, this.draftStatus, this.restoreBtn),
      h(
        'div',
        { class: 'row' },
        this.shareBtn,
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
    this.sidebar = h('aside', { class: 'sidebar' }, head, h('div', { class: 'side-name' }, h('label', { class: 'label', text: STR.editor.optName }), this.name), list, foot);

    // ------------------------------------------------------ stats + zoom
    const cell = (label: string) => {
      const v = h('span', { class: 'stat-v', text: '—' });
      return { el: h('div', { class: 'stat-cell' }, h('span', { class: 'stat-l', text: label }), v), v };
    };
    const cells = {
      length: cell(S.stats.length),
      corners: cell(S.stats.corners),
      lap: cell(T.lapLabel),
      straight: cell(S.stats.straight),
      gradient: cell(S.stats.gradient),
      elevation: cell(S.stats.elevation),
      radius: cell(S.stats.radius),
    };
    this.statCells = { length: cells.length.v, corners: cells.corners.v, lap: cells.lap.v, straight: cells.straight.v, gradient: cells.gradient.v, elevation: cells.elevation.v, radius: cells.radius.v };
    this.statsBar = h('div', { class: 'stats-bar' }, ...Object.values(cells).map((c) => c.el));
    this.zoomBox = h(
      'div',
      { class: 'zoom-box' },
      button('', () => actions.zoom('in'), { icon: '+', class: 'round', title: `${STR.editor.zoomIn} (${k.zoomIn})` }),
      button('', () => actions.zoom('out'), { icon: '−', class: 'round', title: `${STR.editor.zoomOut} (${k.zoomOut})` }),
      button('', () => actions.zoom('fit'), { icon: '⤢', class: 'round', title: `${STR.editor.zoomFit} (${k.zoomFit})` }),
    );
    this.welcome = h('div', { class: 'studio-welcome' },
      h('span', { class: 'studio-eyebrow', text: T.eyebrow }), h('h1', { text: T.intro }),
      h('p', { text: T.description }), this.starterCards(actions, true),
      h('div', { class: 'row' }, button(T.start, () => { this.welcomeDismissed = true; actions.setMode('draw'); }, { icon: '✎', class: 'primary' }),
        button(T.surprise, actions.surprise, { icon: '🎲' })));
    this.help = h('dialog', { class: 'studio-help' },
      h('div', { class: 'studio-help-head' }, h('h2', { text: T.guide }), button(T.closeGuide, () => this.help.close(), { icon: '✕', class: 'compact' })),
      ...T.guideCards.map(([title, text]) => h('section', {}, h('h3', { text: title }), h('p', { text }))),
      h('p', { class: 'help', text: T.navigationHelp }));
    this.help.setAttribute('aria-label', T.guide);
    this.help.addEventListener('click', (event) => { if (event.target === this.help) { const r = this.help.getBoundingClientRect(); if (event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom) this.help.close(); } });
    this.root = h('div', { class: 'screen editor' }, this.top, this.statsBar, this.zoomBox, this.sidebar, this.welcome, this.help);
    this.enableKeyboard();
    this.applySections();
  }

  /** Editor controls remain reachable by Tab without stealing game shortcuts. */
  private enableKeyboard(): void {
    this.root.querySelectorAll<HTMLButtonElement | HTMLInputElement>('button, input').forEach((el) => { el.tabIndex = 0; });
  }

  private starterCards(actions: EditorActions, large: boolean): HTMLElement {
    const cards = STARTERS.map((starter) => {
      const b = button('', () => actions.starter(starter.id), { class: 'studio-template', title: `${starter.name}: ${starter.hint}` });
      const thumb = h('canvas', { class: 'thumb' });
      thumb.setAttribute('aria-hidden', 'true');
      drawThumbnail(thumb, starterTrack(starter.id).control);
      b.append(thumb, h('span', { class: 'studio-template-name', text: starter.name }));
      if (large) b.append(h('span', { class: 'studio-template-hint', text: starter.hint }));
      return b;
    });
    return h('div', { class: `studio-templates ${large ? 'large' : ''}` }, ...cards);
  }

  closeHelp(): void { this.help.close(); }

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
    // The stats strip sits a few pixels up from the bottom; leave a gap above it too.
    const below = parseFloat(getComputedStyle(this.statsBar).bottom) || 0;
    return { top: this.top.offsetHeight, bottom: this.statsBar.offsetHeight + below + 4, left };
  }

  /** Keeps the zoom buttons in the free area on the right. */
  placeZoom(top: number, bottom: number): void {
    this.root.style.setProperty('--studio-top', `${top}px`);
    this.zoomBox.style.top = `${top}px`;
    this.root.style.setProperty('--studio-bottom', `${bottom}px`);
    this.zoomBox.style.bottom = `${bottom}px`;
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
    if (!this.docked && !this.overlay) this.sidebar.querySelector('.sections')!.scrollTop = 0;
    this.sections.forEach((s, i) => { s.root.classList.toggle('expanded', i === this.open); s.head.setAttribute('aria-expanded', String(i === this.open && (this.docked || this.overlay))); });
  }

  // -------------------------------------------------------------- state

  setMessage(text: string, kind: MessageKind = 'info'): void {
    if (this.message.textContent !== text) this.message.textContent = text;
    const cls = `message ${kind}`;
    if (this.message.className !== cls) this.message.className = cls;
  }

  /** The track picker: a list of saved, built-in or real tracks, or a box to paste a code into. */
  private openPicker(actions: EditorActions, group: 'saved' | 'builtIn' | 'world' | 'code'): void {
    const P = STR.editorPlus;
    const d = this.picker;
    const close = button(P.close, () => d.close(), { icon: '×', class: 'compact' });
    let body: HTMLElement;
    if (group === 'code') {
      const input = h('input', { class: 'text-input' }) as HTMLInputElement;
      input.type = 'text';
      input.placeholder = P.codePlaceholder;
      input.setAttribute('aria-label', P.codePlaceholder);
      input.addEventListener('keydown', (e) => e.stopPropagation());
      const err = h('p', { class: 'help warn' });
      err.hidden = true;
      const load = () => {
        const problem = actions.loadCode(input.value);
        err.textContent = problem ?? '';
        err.hidden = !problem;
        if (!problem) d.close();
      };
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') load();
      });
      body = h('div', { class: 'picker-code' }, input, button(P.codeLoad, load, { icon: '⤓', class: 'primary compact' }), err);
      setTimeout(() => input.focus(), 0);
    } else {
      const items = actions.trackList(group);
      body = items.length
        ? h(
            'div',
            { class: 'picker-list' },
            ...items.map((it) =>
              button(it.note ? `${it.name} · ${it.note}` : it.name, () => {
                actions.loadTrack(group, it.id);
                d.close();
              }, { class: 'picker-item' }),
            ),
          )
        : h('p', { class: 'help', text: P.pickerEmpty });
    }
    d.replaceChildren(
      h('div', { class: 'picker-head' }, h('h3', { text: P.pickerTitles[group] }), close),
      group === 'code' ? h('span', {}) : h('p', { class: 'help', text: P.pickerHelp }),
      body,
    );
    if (!d.isConnected) this.root.append(d);
    if (!d.open) d.showModal();
  }

  /** ‹ › in Corners: the previous or next numbered corner, zoomed in on. */
  private stepCorner(actions: EditorActions, dir: number): void {
    const n = this.cornerRows.length;
    if (!n) return;
    this.cornerSel = (((this.cornerSel < 0 ? (dir > 0 ? -1 : 0) : this.cornerSel) + dir) % n + n) % n;
    actions.focusCorner(this.cornerSel);
    this.cornerRows.forEach((r, i) => r.label.closest('.corner-row')?.classList.toggle('picked', i === this.cornerSel));
  }

  setState(s: EditorViewState): void {
    const S = STR.sidebar;
    const T = STR.studio;
    if (s.empty && !this.wasEmpty) this.welcomeDismissed = false;
    this.wasEmpty = s.empty;
    this.welcome.hidden = !s.empty || s.drawing || this.welcomeDismissed;
    this.root.classList.toggle('is-drawing', s.drawing);
    this.toolMode.set(s.panActive ? 'pan' : s.mode);
    this.toolHint.textContent = s.panActive ? T.panHint : s.mode === 'draw' ? T.drawHint : s.mode === 'dots' ? T.reshapeHint : T.heightHint;
    this.root.classList.toggle('is-empty', s.empty);
    this.closeBtn.hidden = s.closed || s.pointCount < 3;
    this.locateBtn.hidden = !s.hasProblem;
    this.fixBtn.hidden = !s.canFix;
    this.restoreBtn.hidden = !s.hasDraft;
    this.draftStatus.textContent = s.draftSaved ? `✓ ${T.draftSaved}` : T.draftIdle;
    this.previewBtn.disabled = !s.canRace;
    this.shareBtn.disabled = !s.canRace;
    this.pointLabel.textContent = s.selected >= 0 ? fmt(T.pointValue, { i: s.selected + 1, n: s.pointCount, h: s.selectedHeight.toFixed(1) }) : T.pointNone;
    this.prevPoint.disabled = this.nextPoint.disabled = !s.pointCount;
    this.pointControls.querySelectorAll('button').forEach((b) => (b.disabled = s.selected < 0));
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
    c.heightTools.hidden = s.mode !== 'height';
    c.smoothing.set(s.smoothing);
    c.snap.checked = s.snap;
    c.soft.checked = s.soft;
    c.width.set(o.width);
    c.drawHow.set(s.mode === 'draw' || s.mode === 'dots' ? s.mode : ('' as 'draw'));
    if (s.stats) c.length.set(s.stats.length);
    c.climb.set(s.climb);
    c.traceTools.hidden = !s.tracing;
    const bankState = s.bankAll === 'mixed' ? STR.editorPlus.bankMixed : s.bankAll === null ? STR.editorPlus.bankLevel : '';
    if (c.bankAllState.textContent !== bankState) c.bankAllState.textContent = bankState;
    if (typeof s.bankAll === 'number') c.bankAll.set(s.bankAll);
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
    c.car.checked = s.display.editorCar;
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
              const input = sl.el.querySelector('input')!; input.tabIndex = 0; input.setAttribute('aria-label', fmt(STR.studio.cornerBank, { n: i + 1 }));
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
    set(v.lap, s.lap !== null ? formatTime(s.lap) : '—');
  }
}
