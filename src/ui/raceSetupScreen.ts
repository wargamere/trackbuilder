import { AI } from '../config/race.ts';
import { STR, fmt } from '../config/strings.ts';
import type { DriveMode, GameContext, RaceSetup, Screen } from '../core/screen.ts';
import { settings } from '../core/settings.ts';
import { TrackOrbit } from '../render/orbit.ts';
import { AssistsPanel, assistsSummary } from './assistsPanel.ts';
import { trackTyreLife } from '../race/strategy.ts';
import { ConditionsPanel, conditionsSummary, timeFor } from './conditionsPanel.ts';
import { SetupPanel, setupSummary } from './setupPanel.ts';
import { button, h, segmented, slider, type Choice, type Slider } from './dom.ts';

type GridKind = RaceSetup['grid'];

/**
 * SETUP state: the race setup menu, opened wherever you choose to race a
 * track (main menu, editor, 3D view, My tracks, results, pause menu). Practice
 * or race, laps (1–50) and the ghost of your record; in a race, how many cars
 * (you and up to eleven AI cars), how fast the AI is, and how the grid is
 * decided: qualifying, a random draw, or the slot you pick. Assists and the
 * conditions (rain, time of day, tyre wear) each have a panel of their own.
 * The track circles slowly behind it, in the conditions chosen.
 */
export class RaceSetupScreen implements Screen {
  readonly layer = '3d';
  private readonly game: GameContext;
  private readonly root: HTMLElement;
  private readonly panel: HTMLElement;
  private readonly trackLine: HTMLElement;
  private readonly modeChoice: Choice<DriveMode>;
  private readonly modeHint: HTMLElement;
  private readonly lapsSlider: Slider;
  private readonly ghostChoice: Choice<boolean>;
  private readonly ghostHint: HTMLElement;
  private readonly carsSlider: Slider;
  private readonly carsHint: HTMLElement;
  private readonly diffSlider: Slider;
  private readonly diffHint: HTMLElement;
  private readonly gridChoice: Choice<GridKind>;
  private readonly gridHint: HTMLElement;
  private readonly slotSlider: Slider;
  private readonly raceOnly: HTMLElement[];
  /** Rows only for a race with AI cars. */
  private readonly withAi: HTMLElement[];
  private readonly slotRow: HTMLElement;
  private readonly orbit = new TrackOrbit();
  private readonly assistsPanel = new AssistsPanel();
  private readonly assistsLine: HTMLElement;
  private readonly conditionsPanel = new ConditionsPanel();
  private readonly conditionsLine: HTMLElement;
  private readonly setupPanel = new SetupPanel();
  private readonly setupLine: HTMLElement;
  /** The choices being made (the game's setup only changes on Start). */
  private draft: RaceSetup;
  private abort: AbortController | null = null;
  private restore: (() => void) | null = null;

  constructor(game: GameContext) {
    this.game = game;
    this.draft = { ...game.setup };
    const S = STR.setup;
    const field = (label: string, ...children: (Node | null)[]) => h('div', { class: 'field' }, h('span', { class: 'label', text: label }), ...children);
    const ord = (n: number) => STR.results.ordinals[n - 1] ?? String(n);
    this.trackLine = h('div', { class: 'setup-track' });
    this.modeChoice = segmented<DriveMode>(
      [
        ['practice', S.practice, '⟳'],
        ['race', S.race, '🏁'],
      ],
      (m) => this.set({ mode: m }),
    );
    this.modeHint = h('p', { class: 'setup-hint' });
    this.lapsSlider = slider(1, 50, 1, (n) => this.set({ laps: n }, false), () => {}, (n) => (n === 1 ? S.lapValue : fmt(S.lapsValue, { n })));
    this.ghostChoice = segmented<boolean>(
      [
        [true, S.on],
        [false, S.off],
      ],
      (g) => this.set({ ghost: g }),
    );
    this.ghostHint = h('p', { class: 'setup-hint' });
    // Cars counts you too: 1 = just you, 12 = you and eleven AI cars.
    this.carsSlider = slider(1, AI.maxOpponents + 1, 1, (n) => this.set({ opponents: n - 1 }, false), () => this.render(), (n) => (n === 1 ? S.carsSolo : fmt(S.carsValue, { n })));
    this.carsHint = h('p', { class: 'setup-hint' });
    this.diffSlider = slider(1, 100, 1, (n) => this.set({ difficulty: n }, false), () => {}, (n) => fmt(S.difficultyValue, { n }));
    this.diffHint = h('p', { class: 'setup-hint' });
    this.gridChoice = segmented<GridKind>(
      [
        ['qualifying', S.gridQualifying, '⏱'],
        ['random', S.gridRandom, '🎲'],
        ['pick', S.gridPick, '☝'],
      ],
      (g) => this.set({ grid: g }),
    );
    this.gridHint = h('p', { class: 'setup-hint' });
    this.slotSlider = slider(1, 2, 1, (n) => this.set({ startSlot: n }, false), () => {}, (n) => {
      const cars = this.draft.opponents + 1;
      return n === 1 ? fmt(S.slotPole, { pos: ord(n) }) : n >= cars ? fmt(S.slotBack, { pos: ord(n) }) : ord(n);
    });
    const laps = field(S.laps, this.lapsSlider.el);
    const cars = field(S.cars, this.carsSlider.el, this.carsHint);
    const diff = field(S.difficulty, this.diffSlider.el, this.diffHint);
    const grid = field(S.grid, this.gridChoice.el, this.gridHint);
    this.slotRow = field(S.startSlot, this.slotSlider.el);
    this.assistsLine = h('span', { class: 'assists-summary' });
    const assists = h(
      'div',
      { class: 'setup-assists' },
      h('span', { class: 'label', text: STR.assists.title }),
      this.assistsLine,
      button(STR.assists.open, () => this.assistsPanel.open(this.game.ui, () => this.renderHints()), { icon: '🛞', class: 'compact', key: 'A' }),
    );
    this.conditionsLine = h('span', { class: 'assists-summary' });
    const conditions = h(
      'div',
      { class: 'setup-assists setup-conditions' },
      h('span', { class: 'label', text: STR.conditions.title }),
      this.conditionsLine,
      button(STR.conditions.open, () => this.openConditions(), { icon: '🌦', class: 'compact', key: 'C' }),
    );
    this.setupLine = h('span', { class: 'assists-summary' });
    const carSetup = h(
      'div',
      { class: 'setup-assists setup-car' },
      h('span', { class: 'label', text: STR.carSetup.title }),
      this.setupLine,
      button(STR.carSetup.open, () => this.openSetupPanel(), { icon: '🔧', class: 'compact', key: 'G' }),
    );
    this.raceOnly = [laps, cars];
    this.withAi = [diff, grid];
    this.panel = h(
      'div',
      { class: 'panel' },
      h('h2', { text: S.title }),
      this.trackLine,
      h(
        'div',
        { class: 'setup-cols' },
        h('div', { class: 'setup-col' }, field(S.mode, this.modeChoice.el, this.modeHint), laps, field(S.ghost, this.ghostChoice.el, this.ghostHint)),
        h('div', { class: 'setup-col race-col' }, cars, diff, grid, this.slotRow),
      ),
      assists,
      conditions,
      carSetup,
      h(
        'div',
        { class: 'menu row setup-buttons' },
        button(S.back, () => this.game.closeSetup(), { icon: '←', key: 'Esc' }),
        button(S.start, () => this.start(), { icon: '▶', class: 'primary', key: 'Enter' }),
      ),
      h('p', { class: 'menu-keys', text: S.keys }),
    );
    this.root = h('div', { class: 'screen overlay main-menu race-setup' }, this.panel);
  }

  enter(): void {
    this.draft = { ...this.game.setup };
    const t = this.game.track;
    this.trackLine.textContent = fmt(STR.setup.trackLine, { name: t.def.name, len: (t.center.length / 1000).toFixed(2) });
    this.game.ui.append(this.root);
    const v = this.game.view3d;
    if (v) {
      this.restore = v.hideExtras();
      v.setQuality(settings().graphics);
      this.orbit.show(v, t);
    }
    this.render();
    this.abort = new AbortController();
    window.addEventListener(
      'keydown',
      (e) => {
        if (e.ctrlKey || e.metaKey || e.altKey || e.repeat) return;
        // A panel on top: Esc closes it, nothing else here.
        const panel = this.assistsPanel.isOpen ? this.assistsPanel : this.conditionsPanel.isOpen ? this.conditionsPanel : this.setupPanel.isOpen ? this.setupPanel : null;
        if (panel) {
          if (e.code === 'Escape') {
            e.preventDefault();
            panel.close();
          }
          return;
        }
        const act: Record<string, () => void> = {
          Enter: () => this.start(),
          NumpadEnter: () => this.start(),
          Escape: () => this.game.closeSetup(),
          KeyP: () => this.set({ mode: 'practice' }),
          KeyR: () => this.set({ mode: 'race' }),
          KeyA: () => this.assistsPanel.open(this.game.ui, () => this.renderHints()),
          KeyC: () => this.openConditions(),
          KeyG: () => this.openSetupPanel(),
        };
        const a = act[e.code];
        if (!a) return;
        e.preventDefault();
        a();
      },
      { signal: this.abort.signal },
    );
  }

  exit(): void {
    this.assistsPanel.close();
    this.conditionsPanel.close();
    this.setupPanel.close();
    this.game.view3d?.setConditions(null);
    this.abort?.abort();
    this.abort = null;
    this.root.remove();
    this.restore?.();
    this.restore = null;
    this.game.view3d?.setQuality(settings().graphics);
  }

  resize(): void {
    const s = this.game.surface;
    this.game.view3d?.resize(s.w, s.h);
  }

  frame(dt: number): void {
    const v = this.game.view3d;
    if (v) this.orbit.frame(v, dt);
  }

  private openSetupPanel(): void {
    this.setupPanel.open(this.game.ui, this.game.track, () => this.renderHints());
  }

  private openConditions(): void {
    this.conditionsPanel.open(this.game.ui, {
      get: () => this.draft,
      change: (patch) => this.set(patch),
      trackTime: this.game.track.options.time,
      mediumLife: trackTyreLife(this.game.track),
      onClose: () => this.renderHints(),
    });
  }

  private start(): void {
    this.clampSlot();
    this.game.start(this.draft);
  }

  /** Your slot can't be behind the last car. */
  private clampSlot(): void {
    this.draft.startSlot = Math.max(1, Math.min(this.draft.startSlot, this.draft.opponents + 1));
  }

  /** Changes the draft; `redraw` false while a slider is being dragged (it shows its own value). */
  private set(patch: Partial<RaceSetup>, redraw = true): void {
    // Keep "the back of the grid" the back when cars are added.
    const wasBack = this.draft.startSlot >= this.draft.opponents + 1;
    Object.assign(this.draft, patch);
    if (patch.opponents !== undefined && wasBack) this.draft.startSlot = this.draft.opponents + 1;
    this.clampSlot();
    if (redraw) this.render();
    else this.renderHints();
  }

  private render(): void {
    const d = this.draft;
    this.modeChoice.set(d.mode);
    this.lapsSlider.set(d.laps);
    this.ghostChoice.set(d.ghost);
    this.carsSlider.set(d.opponents + 1);
    this.diffSlider.set(d.difficulty);
    this.gridChoice.set(d.grid);
    this.slotSlider.setRange(1, Math.max(2, d.opponents + 1));
    this.slotSlider.set(d.startSlot);
    this.renderHints();
  }

  private renderHints(): void {
    const d = this.draft;
    const S = STR.setup;
    const race = d.mode === 'race';
    const ai = race && d.opponents > 0;
    this.modeHint.textContent = race ? S.raceHint : S.practiceHint;
    for (const el of this.raceOnly) el.hidden = !race;
    for (const el of this.withAi) el.hidden = !ai;
    this.slotRow.hidden = !ai || d.grid !== 'pick';
    this.panel.classList.toggle('one-col', !race);
    this.carsHint.textContent = d.opponents === 0 ? S.carsSoloHint : d.opponents === 1 ? S.carsHintOne : fmt(S.carsHint, { n: d.opponents });
    const hasGhost = !!this.game.records.get(this.game.track.def.id).ghost;
    this.ghostHint.textContent = hasGhost ? S.ghostHint : S.ghostNone;
    const hints = S.difficultyHints;
    const k = d.difficulty >= 95 ? 4 : d.difficulty >= 75 ? 3 : d.difficulty >= 45 ? 2 : d.difficulty >= 20 ? 1 : 0;
    this.diffHint.textContent = hints[k];
    this.gridHint.textContent = fmt(S.gridHints[d.grid], { n: AI.qualifyingLaps });
    this.assistsLine.textContent = assistsSummary(settings().assists);
    this.conditionsLine.textContent = conditionsSummary(d, this.game.track.options.time);
    this.setupLine.textContent = setupSummary(settings().carSetup);
    // The track behind shows the conditions chosen.
    this.game.view3d?.setConditions({ time: timeFor(d, this.game.track.options.time), rain: d.weather === 'rain' });
    // The slot slider's labels depend on the number of cars.
    this.slotSlider.setRange(1, Math.max(2, d.opponents + 1));
    this.slotSlider.set(d.startSlot);
  }
}
