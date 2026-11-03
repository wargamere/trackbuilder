import { nextLockedPaint, paintUnlocked, selectPaint, unlockPaintByAd } from '../car/paint.ts';
import { PAINTS } from '../config/paint.ts';
import { STR, fmt } from '../config/strings.ts';
import type { GameContext, Screen } from '../core/screen.ts';
import { settings } from '../core/settings.ts';
import { platform } from '../platform/services.ts';
import { button, h } from '../ui/dom.ts';
import { ShareDialog } from '../ui/shareDialog.ts';
import { medalFor, medalTimes, nextMedal } from './medals.ts';
import type { RunResult } from './records.ts';
import { formatTime } from './session.ts';

/**
 * RESULTS state: the run's times and score over a slow orbit of the finished
 * car, plus the paint shop.
 *  - "Race again" restarts on the same track with the same setup (your best
 *    lap becomes the ghost); "Race settings" opens the race setup first.
 *    In a Full Launch build this is where a midgame ad may play: a natural
 *    break between races. The UI is blocked until the ad finishes or fails.
 *  - Paints unlock by finishing runs; in a Full Launch build the next one can
 *    also be unlocked now with a rewarded ad (never offered during a race).
 */
export class ResultsScreen implements Screen {
  readonly layer = '3d';
  private readonly game: GameContext;
  private readonly root: HTMLElement;
  private readonly body: HTMLElement;
  private readonly paint: HTMLElement;
  private readonly blocker: HTMLElement;
  private angle = 0;
  private busy = false;
  private paintNote: { text: string; kind: 'ok' | 'warn' } | null = null;
  private abort: AbortController | null = null;
  private readonly share = new ShareDialog();
  private readonly saveBtn: HTMLButtonElement;

  constructor(game: GameContext) {
    this.game = game;
    this.saveBtn = button(STR.buttons.saveTrack, () => this.saveTrack(), { icon: '⬇' });
    this.body = h('div', { class: 'results-body' });
    this.paint = h('div', { class: 'paint-shop' });
    this.blocker = h('div', { class: 'ad-blocker' }, h('div', { class: 'spinner' }), h('span', { text: STR.ads.loading }));
    this.blocker.hidden = true;
    this.root = h(
      'div',
      { class: 'screen overlay results' },
      h(
        'div',
        { class: 'panel' },
        h('h2', { text: STR.results.title }),
        h(
          'div',
          { class: 'results-grid' },
          this.body,
          h(
            'div',
            { class: 'results-side' },
            h(
              'div',
              { class: 'menu row' },
              button(STR.buttons.raceAgain, () => void this.raceAgain(), { icon: '⟲', class: 'primary', key: 'Enter' }),
              button(STR.buttons.newTrack, () => this.leave('editor'), { icon: '✎', key: 'E' }),
            ),
            this.paint,
            h(
              'div',
              { class: 'menu row secondary' },
              this.saveBtn,
              button(STR.buttons.shareTrack, () => this.share.open(this.game.track.def, this.game.ui), { icon: '⧉' }),
              button(STR.buttons.myTracks, () => this.leave('library'), { icon: '☰' }),
              button(STR.buttons.raceSettings, () => this.raceSettings(), { icon: '🏁', key: 'S' }),
              button(STR.buttons.mainMenu, () => this.leave('menu'), { icon: '⌂' }),
            ),
          ),
        ),
      ),
      this.blocker,
    );
  }

  enter(): void {
    const r = this.game.lastResult;
    this.body.replaceChildren();
    this.paintNote = null;
    if (r) {
      const row = (label: string, value: string, badge?: string) =>
        h('div', { class: 'stat' }, h('span', { class: 'stat-label', text: label }), h('span', { class: 'stat-value', text: value }), badge ? h('span', { class: 'badge', text: badge }) : null);
      this.body.append(
        h('div', { class: 'results-track', text: r.trackName }),
        h(
          'div',
          { class: 'score' },
          h('div', { class: 'score-label', text: STR.results.score }),
          h('div', { class: 'score-value', text: r.score.toLocaleString('en-US') }),
          r.newBestScore ? h('div', { class: 'badge big', text: STR.results.newBestScore }) : h('div', { class: 'score-best', text: `${STR.results.bestScore}: ${r.bestScore.toLocaleString('en-US')}` }),
        ),
        ...[this.standingsBlock(r)].filter((x): x is HTMLElement => !!x),
        h(
          'div',
          { class: 'stats' },
          row(STR.results.total, formatTime(r.total)),
          row(STR.results.bestLap, r.bestLap === null ? STR.results.noCleanLap : formatTime(r.bestLap), r.newRecord ? STR.results.newRecord : undefined),
          r.newRecord || r.recordLap === null ? null : row(STR.results.record, formatTime(r.recordLap)),
          row(STR.results.laps, r.laps.map((t, i) => (r.lapValid[i] === false ? `${formatTime(t)} ✗` : formatTime(t))).join('  ·  ')),
          r.lapValid.some((v) => !v) ? h('p', { class: 'score-hint warn', text: STR.results.cutNote }) : null,
          row(
            STR.results.avgSpeed,
            settings().units === 'mph' ? fmt(STR.results.mph, { v: (r.avgSpeedKmh / 1.609344).toFixed(1) }) : fmt(STR.results.kmh, { v: r.avgSpeedKmh.toFixed(1) }),
          ),
          row(STR.results.multiplier, `×${r.multiplier.toFixed(2)}`),
          this.medalRow(r.bestLap, r.author),
        ),
        h('p', { class: 'score-hint', text: STR.results.scoreHint }),
      );
      if (r.unlockedPaints.length) {
        const name = STR.paint.names[r.unlockedPaints[r.unlockedPaints.length - 1]];
        this.paintNote = { text: fmt(STR.paint.unlockedByRun, { name }), kind: 'ok' };
      }
    }
    this.renderPaint();
    this.updateSave();
    this.game.ui.append(this.root);
    this.angle = 0;
    this.busy = false;
    this.blocker.hidden = true;
    this.abort = new AbortController();
    window.addEventListener(
      'keydown',
      (e) => {
        if (e.ctrlKey || e.metaKey || e.altKey || e.repeat || this.share.isOpen || this.busy) return;
        if (e.code === 'Enter' || e.code === 'NumpadEnter') {
          e.preventDefault();
          void this.raceAgain();
        } else if (e.code === 'KeyE') {
          e.preventDefault();
          this.leave('editor');
        } else if (e.code === 'KeyS') {
          e.preventDefault();
          this.raceSettings();
        }
      },
      { signal: this.abort.signal },
    );
    // Check for an ad blocker in the background so the paint offer can say so.
    if (platform.adsEnabled) void platform.hasAdblock().then(() => this.renderPaint());
  }

  /** Saves the raced track to My tracks (built-in tracks are always there). */
  private saveTrack(): void {
    const def = this.game.track.def;
    if (!def.builtIn) this.game.library.save(def);
    this.updateSave();
  }

  private updateSave(): void {
    const def = this.game.track.def;
    const saved = !!def.builtIn || this.game.library.has(def.id);
    this.saveBtn.disabled = saved;
    const l = this.saveBtn.querySelector('.btn-label');
    if (l) l.textContent = saved ? `${STR.buttons.savedTrack} ✓` : STR.buttons.saveTrack;
  }

  /** Opens the race setup; Back comes back here. */
  private raceSettings(): void {
    if (!this.busy) this.game.openSetup();
  }

  /** Your place and the finishing order, in a race against AI cars. */
  private standingsBlock(r: RunResult): HTMLElement | null {
    if (!r.standings || r.position === null) return null;
    const n = r.standings.length;
    const winner = r.standings[0].time;
    const ord = (i: number) => STR.results.ordinals[i] ?? String(i + 1);
    const list = h('ol', { class: 'standings' });
    r.standings.forEach((e, i) => {
      const time = i === 0 ? formatTime(e.time) : fmt(STR.results.gap, { t: (e.time - winner).toFixed(2) });
      const dot = h('i', { class: 'car-dot' });
      dot.style.background = `#${e.paint.toString(16).padStart(6, '0')}`;
      list.append(
        h(
          'li',
          { class: e.you ? 'you' : '' },
          h('span', { class: 'standing-pos', text: ord(i) }),
          dot,
          h('span', { class: 'standing-name', text: e.name }),
          h('span', { class: 'standing-time', text: e.estimated ? `${time} · ${STR.results.estimated}` : time }),
        ),
      );
    });
    return h(
      'div',
      { class: 'results-standings' },
      h('div', { class: 'stat' }, h('span', { class: 'stat-label', text: STR.results.position }), h('span', { class: 'stat-value', text: fmt(STR.results.positionValue, { pos: ord(r.position - 1), n }) })),
      h('div', { class: 'label', text: STR.results.standings }),
      list,
    );
  }

  /** The medal the run's best lap won, and the time for the next one up. */
  private medalRow(bestLap: number | null, author: number | null): HTMLElement | null {
    if (!author) return null;
    if (bestLap === null) bestLap = Infinity;
    const m = medalTimes(author);
    const won = medalFor(bestLap, m);
    const next = nextMedal(won);
    return h(
      'div',
      { class: 'stat' },
      h('span', { class: 'stat-label', text: STR.results.medal }),
      h('span', { class: 'stat-value' }, won ? h('i', { class: `medal ${won}` }) : null, won ? STR.medals[won] : STR.results.noMedal),
      h('span', {
        class: `badge${won ? '' : ' muted'}`,
        text: next ? fmt(STR.results.nextMedal, { medal: STR.medals[next], time: formatTime(m[next]) }) : STR.results.allMedals,
      }),
    );
  }

  exit(): void {
    this.abort?.abort();
    this.abort = null;
    this.share.close();
    this.root.remove();
  }

  resize(): void {
    const s = this.game.surface;
    this.game.view3d?.resize(s.w, s.h);
  }

  private leave(to: 'editor' | 'library' | 'menu'): void {
    if (!this.busy) this.game.go(to);
  }

  /** Race again, after a midgame ad if one is available (the SDK paces them). */
  private async raceAgain(): Promise<void> {
    if (this.busy) return;
    if (platform.adsEnabled) {
      this.busy = true;
      this.blocker.hidden = false;
      await platform.requestAd('midgame');
      this.blocker.hidden = true;
      this.busy = false;
    }
    this.game.go('race');
  }

  private async watchAdForPaint(): Promise<void> {
    const next = nextLockedPaint();
    if (!next || this.busy) return;
    this.busy = true;
    this.blocker.hidden = false;
    const result = await platform.requestAd('rewarded');
    this.blocker.hidden = true;
    this.busy = false;
    const name = STR.paint.names[next.id];
    if (result === 'finished') {
      unlockPaintByAd(next.id);
      this.game.refreshPaint();
      this.paintNote = { text: fmt(STR.paint.rewarded, { name }), kind: 'ok' };
    } else {
      // Never reward on adError.
      this.paintNote = { text: STR.paint.noAd, kind: 'warn' };
    }
    this.renderPaint();
  }

  /** Swatches, how to unlock the next paint, and (Full Launch) the rewarded-ad offer. */
  private renderPaint(): void {
    const selected = settings().paint;
    const swatches = h('div', { class: 'swatches' });
    for (const p of PAINTS) {
      const unlocked = paintUnlocked(p.id);
      const name = STR.paint.names[p.id];
      const b = h('button', { class: `swatch${unlocked ? '' : ' locked'}${p.id === selected ? ' on' : ''}` });
      b.type = 'button';
      b.tabIndex = -1;
      b.style.background = `#${p.hex.toString(16).padStart(6, '0')}`;
      b.title = unlocked ? name : fmt(STR.paint.locked, { name, runs: p.runs });
      b.setAttribute('aria-label', b.title);
      if (!unlocked) b.textContent = '🔒';
      b.addEventListener('click', () => {
        if (!unlocked || this.busy) return;
        selectPaint(p.id);
        this.game.refreshPaint();
        this.renderPaint();
      });
      swatches.append(b);
    }
    const next = nextLockedPaint();
    const info = next
      ? fmt(STR.paint.next, { name: STR.paint.names[next.id], n: Math.max(1, next.runs - settings().runs) })
      : STR.paint.allUnlocked;
    const parts: (HTMLElement | null)[] = [
      h('div', { class: 'label', text: STR.paint.title }),
      swatches,
      h('div', { class: 'paint-info', text: info }),
    ];
    const note = h('div', { class: `paint-note ${this.paintNote?.kind ?? ''}`, text: this.paintNote?.text ?? '' });
    if (next && platform.adsEnabled) {
      const offer = button(fmt(STR.paint.watchAd, { name: STR.paint.names[next.id] }), () => void this.watchAdForPaint(), { icon: '🎬' });
      parts.push(offer);
      void platform.hasAdblock().then((blocked) => {
        if (!blocked) return;
        offer.disabled = true;
        offer.title = STR.paint.adblock;
        if (!this.paintNote) this.paintNote = { text: STR.paint.adblock, kind: 'warn' };
        note.textContent = this.paintNote.text;
        note.className = `paint-note ${this.paintNote.kind}`;
      });
    }
    parts.push(note);
    this.paint.replaceChildren(...parts.filter((p): p is HTMLElement => !!p));
  }

  frame(dt: number): void {
    const v = this.game.view3d;
    const r = this.game.lastResult;
    if (!v || !r) return;
    this.angle += dt * 0.25;
    const cam = v.camera;
    cam.position.set(r.carX + Math.cos(this.angle) * 11, 4.5, r.carZ + Math.sin(this.angle) * 11);
    cam.lookAt(r.carX, 0.8, r.carZ);
    if (Math.abs(cam.fov - 55) > 0.01) {
      cam.fov = 55;
      cam.updateProjectionMatrix();
    }
    v.render();
  }
}
