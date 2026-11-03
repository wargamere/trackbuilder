import { AI } from '../config/race.ts';
import { STR, fmt } from '../config/strings.ts';
import type { DriveMode, GameContext, RaceSetup, Screen } from '../core/screen.ts';
import { settings } from '../core/settings.ts';
import { TrackOrbit } from '../render/orbit.ts';
import { button, h, segmented, slider, type Choice, type Slider } from './dom.ts';

/**
 * SETUP state: the race setup menu, opened wherever you choose to race a
 * track (main menu, editor, 3D view, My tracks, results, pause menu). Practice
 * or race, laps (1–10), the ghost of your record on or off, and in a race how
 * many AI cars and how fast. The track circles slowly behind it.
 */
export class RaceSetupScreen implements Screen {
  readonly layer = '3d';
  private readonly game: GameContext;
  private readonly root: HTMLElement;
  private readonly trackLine: HTMLElement;
  private readonly modeChoice: Choice<DriveMode>;
  private readonly modeHint: HTMLElement;
  private readonly lapsSlider: Slider;
  private readonly ghostChoice: Choice<boolean>;
  private readonly ghostHint: HTMLElement;
  private readonly aiSlider: Slider;
  private readonly diffSlider: Slider;
  private readonly diffHint: HTMLElement;
  private readonly raceOnly: HTMLElement[];
  private readonly diffRow: HTMLElement;
  private readonly orbit = new TrackOrbit();
  /** The choices being made (the game's setup only changes on Start). */
  private draft: RaceSetup;
  private abort: AbortController | null = null;
  private restore: (() => void) | null = null;

  constructor(game: GameContext) {
    this.game = game;
    this.draft = { ...game.setup };
    const S = STR.setup;
    const field = (label: string, ...children: (Node | null)[]) => h('div', { class: 'field' }, h('span', { class: 'label', text: label }), ...children);
    this.trackLine = h('div', { class: 'setup-track' });
    this.modeChoice = segmented<DriveMode>(
      [
        ['practice', S.practice, '⟳'],
        ['race', S.race, '🏁'],
      ],
      (m) => this.set({ mode: m }),
    );
    this.modeHint = h('p', { class: 'setup-hint' });
    this.lapsSlider = slider(1, 10, 1, (n) => this.set({ laps: n }, false), () => {}, (n) => (n === 1 ? S.lapValue : fmt(S.lapsValue, { n })));
    this.ghostChoice = segmented<boolean>(
      [
        [true, S.on],
        [false, S.off],
      ],
      (g) => this.set({ ghost: g }),
    );
    this.ghostHint = h('p', { class: 'setup-hint' });
    this.aiSlider = slider(0, AI.maxOpponents, 1, (n) => this.set({ opponents: n }, false), () => {}, (n) => (n === 0 ? S.noOpponents : fmt(S.opponentsValue, { n })));
    this.diffSlider = slider(1, 100, 1, (n) => this.set({ difficulty: n }, false), () => {}, (n) => fmt(S.difficultyValue, { n }));
    this.diffHint = h('p', { class: 'setup-hint' });
    const laps = field(S.laps, this.lapsSlider.el);
    const ai = field(S.opponents, this.aiSlider.el);
    this.diffRow = field(S.difficulty, this.diffSlider.el, this.diffHint);
    this.raceOnly = [laps, ai, this.diffRow];
    this.root = h(
      'div',
      { class: 'screen overlay main-menu race-setup' },
      h(
        'div',
        { class: 'panel' },
        h('h2', { text: S.title }),
        this.trackLine,
        field(S.mode, this.modeChoice.el, this.modeHint),
        laps,
        field(S.ghost, this.ghostChoice.el, this.ghostHint),
        ai,
        this.diffRow,
        h(
          'div',
          { class: 'menu row setup-buttons' },
          button(S.back, () => this.game.closeSetup(), { icon: '←', key: 'Esc' }),
          button(S.start, () => this.start(), { icon: '▶', class: 'primary', key: 'Enter' }),
        ),
        h('p', { class: 'menu-keys', text: S.keys }),
      ),
    );
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
        const act: Record<string, () => void> = {
          Enter: () => this.start(),
          NumpadEnter: () => this.start(),
          Escape: () => this.game.closeSetup(),
          KeyP: () => this.set({ mode: 'practice' }),
          KeyR: () => this.set({ mode: 'race' }),
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

  private start(): void {
    this.game.start(this.draft);
  }

  /** Changes the draft; `redraw` false while a slider is being dragged (it shows its own value). */
  private set(patch: Partial<RaceSetup>, redraw = true): void {
    Object.assign(this.draft, patch);
    if (redraw) this.render();
    else this.renderHints();
  }

  private render(): void {
    const d = this.draft;
    this.modeChoice.set(d.mode);
    this.lapsSlider.set(d.laps);
    this.ghostChoice.set(d.ghost);
    this.aiSlider.set(d.opponents);
    this.diffSlider.set(d.difficulty);
    this.renderHints();
  }

  private renderHints(): void {
    const d = this.draft;
    const S = STR.setup;
    const race = d.mode === 'race';
    this.modeHint.textContent = race ? S.raceHint : S.practiceHint;
    for (const el of this.raceOnly) el.hidden = !race;
    this.diffRow.classList.toggle('disabled', d.opponents === 0);
    const hasGhost = !!this.game.records.get(this.game.track.def.id).ghost;
    this.ghostHint.textContent = hasGhost ? S.ghostHint : S.ghostNone;
    const hints = S.difficultyHints;
    const k = d.difficulty >= 95 ? 4 : d.difficulty >= 75 ? 3 : d.difficulty >= 50 ? 2 : d.difficulty >= 25 ? 1 : 0;
    this.diffHint.textContent = hints[k];
  }
}
