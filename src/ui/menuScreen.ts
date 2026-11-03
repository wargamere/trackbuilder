import { audio } from '../audio/audio.ts';
import { STR, fmt } from '../config/strings.ts';
import type { GameContext, Screen } from '../core/screen.ts';
import { settings, updateSettings } from '../core/settings.ts';
import { getSampleTrack, SAMPLE_COUNT } from '../editor/pipeline.ts';
import { medalFor, medalTimes } from '../race/medals.ts';
import { formatTime } from '../race/session.ts';
import { TrackOrbit } from '../render/orbit.ts';
import { buildTrack, type Track, type TrackDef } from '../track/track.ts';
import { button, h } from './dom.ts';

/** A track the menu can pick: the built-in samples, then your saved tracks. */
interface Pick {
  def: TrackDef;
  track: () => Track;
}

/**
 * MENU state (the boot screen): the current track turning slowly in 3D behind
 * a panel with Race this track (which opens the race setup), Draw a track and
 * My tracks, a track picker, and sound / graphics / units toggles.
 */
export class MenuScreen implements Screen {
  readonly layer = '3d';
  private readonly game: GameContext;
  private readonly root: HTMLElement;
  private readonly trackName: HTMLElement;
  private readonly trackInfo: HTMLElement;
  private readonly trackBest: HTMLElement;
  private readonly soundBtn: HTMLButtonElement;
  private readonly gfxBtn: HTMLButtonElement;
  private readonly unitsBtn: HTMLButtonElement;
  private abort: AbortController | null = null;
  private restore: (() => void) | null = null;
  private picks: Pick[] = [];
  private index = 0;
  private readonly orbit = new TrackOrbit();

  constructor(game: GameContext) {
    this.game = game;
    const M = STR.menu;
    this.trackName = h('div', { class: 'menu-track-name' });
    this.trackInfo = h('div', { class: 'menu-track-info' });
    this.trackBest = h('div', { class: 'menu-track-best' });
    // Labels are filled in by refresh(); they need a placeholder so the label comes before the key hint.
    this.soundBtn = button(STR.buttons.soundOn, () => this.toggleSound(), { icon: '♪', class: 'small', key: 'M' });
    this.gfxBtn = button(STR.sidebar.graphics, () => this.toggleGraphics(), { icon: '⚙', class: 'small' });
    this.unitsBtn = button(STR.sidebar.unitNames.kmh, () => this.toggleUnits(), { icon: '⏱', class: 'small' });
    this.root = h(
      'div',
      { class: 'screen overlay main-menu' },
      h(
        'div',
        { class: 'panel' },
        h('h1', { class: 'menu-title', text: STR.gameName }),
        h('p', { class: 'menu-tagline', text: STR.tagline }),
        h(
          'div',
          { class: 'menu-track' },
          button('', () => this.step(-1), { icon: '‹', class: 'round', title: M.prev }),
          h('div', { class: 'menu-track-text' }, this.trackName, this.trackInfo, this.trackBest),
          button('', () => this.step(1), { icon: '›', class: 'round', title: M.next }),
        ),
        h(
          'div',
          { class: 'menu' },
          h('div', { class: 'menu-choice' }, button(M.race, () => this.game.openSetup(), { icon: '🏁', class: 'primary', key: 'Enter' }), h('span', { class: 'menu-hint', text: M.raceHint })),
          h(
            'div',
            { class: 'menu row' },
            button(M.draw, () => this.game.go('editor'), { icon: '✎', key: 'E' }),
            button(M.myTracks, () => this.game.go('library'), { icon: '☰', key: 'L' }),
          ),
        ),
        h('div', { class: 'menu row settings' }, this.soundBtn, this.gfxBtn, this.unitsBtn),
        h('p', { class: 'menu-keys', text: M.keys }),
      ),
    );
  }

  enter(): void {
    const v = this.game.view3d;
    // Tracks to flick through: the samples, then your own (newest first).
    const samples: Pick[] = Array.from({ length: SAMPLE_COUNT }, (_, i) => ({ def: getSampleTrack(i).def, track: () => getSampleTrack(i) }));
    const mine: Pick[] = this.game.library.list().map((e) => {
      let built: Track | null = null;
      return { def: e.def, track: () => (built ??= buildTrack(e.def)) };
    });
    this.picks = [...samples, ...mine];
    const cur = this.game.track;
    this.index = this.picks.findIndex((p) => p.def.id === cur.def.id);
    if (this.index < 0) {
      this.picks.unshift({ def: cur.def, track: () => cur });
      this.index = 0;
    }
    this.game.ui.append(this.root);
    if (v) {
      this.restore = v.hideExtras();
      v.setQuality(settings().graphics);
    }
    this.showTrack(cur);
    this.refresh();

    this.abort = new AbortController();
    window.addEventListener(
      'keydown',
      (e) => {
        if (e.ctrlKey || e.metaKey || e.altKey || e.repeat) return;
        const act: Record<string, () => void> = {
          Enter: () => this.game.openSetup(),
          NumpadEnter: () => this.game.openSetup(),
          KeyE: () => this.game.go('editor'),
          KeyL: () => this.game.go('library'),
          KeyM: () => this.toggleSound(),
          ArrowLeft: () => this.step(-1),
          KeyA: () => this.step(-1),
          ArrowRight: () => this.step(1),
          KeyD: () => this.step(1),
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

  /** Previous / next track in the list. */
  private step(d: number): void {
    if (!this.picks.length) return;
    this.index = (this.index + d + this.picks.length) % this.picks.length;
    const t = this.picks[this.index].track();
    this.game.setTrack(t);
    this.showTrack(t);
    this.refresh();
  }

  /** Puts a track in the 3D view and frames it for the slow orbit. */
  private showTrack(t: Track): void {
    const v = this.game.view3d;
    if (v) this.orbit.show(v, t);
  }

  private refresh(): void {
    const t = this.game.track;
    const rec = this.game.records.summary(t.def.id);
    this.trackName.textContent = t.def.name;
    this.trackInfo.textContent = fmt(STR.menu.trackInfo, { len: (t.center.length / 1000).toFixed(2), mult: t.ink.multiplier.toFixed(2) });
    this.trackBest.replaceChildren();
    const medal = rec.best && rec.author ? medalFor(rec.best.time, medalTimes(rec.author)) : null;
    if (medal) this.trackBest.append(h('i', { class: `medal ${medal}`, title: STR.medals[medal] }));
    this.trackBest.append(rec.best ? fmt(STR.menu.best, { time: formatTime(rec.best.time) }) : STR.menu.noBest);
    const label = (b: HTMLButtonElement, text: string) => {
      const l = b.querySelector('.btn-label');
      if (l) l.textContent = text;
      else b.append(h('span', { class: 'btn-label', text }));
    };
    label(this.soundBtn, audio.silent ? STR.buttons.soundOff : STR.buttons.soundOn);
    label(this.gfxBtn, `${STR.sidebar.graphics}: ${STR.sidebar.graphicsLevels[settings().graphics]}`);
    label(this.unitsBtn, STR.sidebar.unitNames[settings().units]);
  }

  private toggleSound(): void {
    audio.toggleMute();
    this.refresh();
  }

  private toggleGraphics(): void {
    const graphics = settings().graphics === 'full' ? 'fast' : 'full';
    updateSettings({ graphics });
    const v = this.game.view3d;
    if (v) {
      v.setQuality(graphics);
      this.orbit.applyFog(v);
    }
    this.refresh();
  }

  private toggleUnits(): void {
    updateSettings({ units: settings().units === 'kmh' ? 'mph' : 'kmh' });
    this.refresh();
  }

  frame(dt: number): void {
    const v = this.game.view3d;
    if (v) this.orbit.frame(v, dt);
  }
}
