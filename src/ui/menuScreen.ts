import { audio } from '../audio/audio.ts';
import { STR, fmt } from '../config/strings.ts';
import type { GameContext, Screen } from '../core/screen.ts';
import { settings, updateSettings } from '../core/settings.ts';
import { builtInTracks } from '../editor/pipeline.ts';
import { medalFor, medalTimes } from '../race/medals.ts';
import { formatTime } from '../race/session.ts';
import { TrackOrbit } from '../render/orbit.ts';
import type { TrackGroup } from '../track/catalog.ts';
import { buildTrack, type Track, type TrackDef } from '../track/track.ts';
import { button, h, segmented, type Choice } from './dom.ts';

/** A track the menu can pick. */
interface Pick {
  def: TrackDef;
  track: () => Track;
}

const GROUPS: readonly TrackGroup[] = ['builtIn', 'world', 'mine'];

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
  /** The three lists (the game's tracks, real circuits, yours), the one shown and where in it we are. */
  private lists: Record<TrackGroup, Pick[]> = { builtIn: [], world: [], mine: [] };
  private group: TrackGroup = 'builtIn';
  private index = 0;
  private readonly groupChoice: Choice<TrackGroup>;
  private readonly trackPos: HTMLElement;
  private readonly orbit = new TrackOrbit();

  constructor(game: GameContext) {
    this.game = game;
    const M = STR.menu;
    this.trackName = h('div', { class: 'menu-track-name' });
    this.trackInfo = h('div', { class: 'menu-track-info' });
    this.trackBest = h('div', { class: 'menu-track-best' });
    this.trackPos = h('div', { class: 'menu-track-pos' });
    this.groupChoice = segmented<TrackGroup>(
      GROUPS.map((g) => [g, STR.groups[g]]),
      (g) => this.pickGroup(g),
    );
    this.groupChoice.el.classList.add('menu-groups');
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
        this.groupChoice.el,
        h(
          'div',
          { class: 'menu-track' },
          button('', () => this.step(-1), { icon: '‹', class: 'round', title: M.prev }),
          h('div', { class: 'menu-track-text' }, this.trackName, this.trackInfo, this.trackBest, this.trackPos),
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
    // Tracks to flick through, in three lists: the game's own, real circuits, and yours (newest first).
    const all = builtInTracks();
    this.lists = {
      builtIn: all.filter((b) => b.group === 'builtIn'),
      world: all.filter((b) => b.group === 'world'),
      mine: this.game.library.list().map((e) => {
        let built: Track | null = null;
        return { def: e.def, track: () => (built ??= buildTrack(e.def)) };
      }),
    };
    // Start in the list the current track is in (a track just drawn and not saved goes first in yours).
    const cur = this.game.track;
    const found = GROUPS.map((g) => [g, this.lists[g].findIndex((p) => p.def.id === cur.def.id)] as const).find(([, i]) => i >= 0);
    if (found) [this.group, this.index] = found;
    else {
      this.lists.mine.unshift({ def: cur.def, track: () => cur });
      this.group = 'mine';
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
          ArrowUp: () => this.stepGroup(-1),
          ArrowDown: () => this.stepGroup(1),
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
    const list = this.lists[this.group];
    if (!list.length) return;
    this.index = (this.index + d + list.length) % list.length;
    this.select();
  }

  /** Shows another list (from its first track), if it has any. */
  private pickGroup(g: TrackGroup): void {
    if (g === this.group || !this.lists[g].length) return;
    this.group = g;
    this.index = 0;
    this.select();
  }

  /** The previous / next list that has tracks in it. */
  private stepGroup(d: number): void {
    let k = GROUPS.indexOf(this.group);
    for (let n = 0; n < GROUPS.length; n++) {
      k = (k + d + GROUPS.length) % GROUPS.length;
      if (this.lists[GROUPS[k]].length) break;
    }
    this.pickGroup(GROUPS[k]);
  }

  /** Makes the track at the current place in the list the one to race. */
  private select(): void {
    const t = this.lists[this.group][this.index].track();
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
    const info = fmt(STR.menu.trackInfo, { len: (t.center.length / 1000).toFixed(2) });
    this.trackInfo.textContent = t.def.place ? `${t.def.place} · ${info}` : info;
    this.groupChoice.set(this.group);
    for (const g of GROUPS) {
      const b = this.groupChoice.el.children[GROUPS.indexOf(g)] as HTMLButtonElement;
      b.disabled = !this.lists[g].length;
      b.title = this.lists[g].length ? `${STR.groups[g]} (${this.lists[g].length})` : STR.menu.noMine;
    }
    this.trackPos.textContent = fmt(STR.menu.position, { i: this.index + 1, n: this.lists[this.group].length });
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
