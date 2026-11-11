import { CarPhysics, NO_INPUT, type CarState, type DriveInput } from '../src/car/physics.ts';
import { collideCars } from '../src/car/contact.ts';
import { carriedTow, slipstream } from '../src/car/slipstream.ts';
import { HANDLING } from '../src/config/handling.ts';
import { DAMAGE } from '../src/config/race.ts';
import { rng } from '../src/core/random.ts';
import { AiDriver, gridPlace } from '../src/race/ai.ts';
import { RaceSession, type Progress, type RaceEvent } from '../src/race/session.ts';
import { RaceControl, type ControlCar, type ControlEvent } from '../src/race/raceControl.ts';
import { Weather } from '../src/race/weather.ts';
import { aiCars } from '../src/race/traffic.ts';
import { suggestedSetup } from '../src/race/strategy.ts';
import { assistDriver } from '../src/race/assists.ts';
import type { Track } from '../src/track/track.ts';

export const DT = 1 / HANDLING.tickRate;
export interface AgentSpec { brain: 'classic' | 'external'; difficulty: number; player?: boolean }
export interface EnvOptions {
  seed: number;
  laps?: number;
  seconds?: number;
  weather?: 'dry' | 'rain' | 'changing';
  tyreWear?: boolean;
  damage?: boolean;
  safetyCar?: boolean;
  drafting?: boolean;
}
export interface Agent {
  car: CarPhysics;
  session: RaceSession;
  classic: AiDriver | null;
  spec: AgentSpec;
  before: Progress;
  now: Progress;
  input: DriveInput;
  gone: boolean;
  outFor: number;
  distance: number;
  offSeconds: number;
  wallHits: number;
  hardContacts: number;
  resets: number;
  maxHit: number;
}

/** Node/browser-compatible stepping core. No rendering, fake physics, wall-clock input or training imports. */
export class DrivingEnv {
  readonly track: Track;
  readonly agents: Agent[];
  readonly weather: Weather;
  readonly control: RaceControl;
  readonly options: EnvOptions;
  readonly states: CarState[];
  readonly events: RaceEvent[] = [];
  readonly controlEvents: ControlEvent[] = [];
  tick = 0;
  firmContacts = 0;
  hardContacts = 0;
  playerContacts = 0;
  // Index-preserving control data; only physical contact and drafting use the live list.
  private readonly controlCars: ControlCar[];
  private readonly liveStates: CarState[] = [];
  private readonly live: number[] = [];
  private readonly drafts: Float32Array;
  private readonly touching: Uint8Array;
  private readonly touchingNow: Uint8Array;

  constructor(track: Track, specs: readonly AgentSpec[], options: EnvOptions) {
    if (specs.length < 1 || specs.length > 24) throw new Error('Environment supports 1–24 cars');
    if (!Number.isFinite(options.seed)) throw new Error('A deterministic seed is required');
    this.track = track;
    this.options = options;
    const laps = options.laps ?? 2;
    this.weather = new Weather(options.weather ?? 'dry', options.seconds ?? 180, rng(options.seed));
    this.control = new RaceControl(track.center.length, laps, !!options.safetyCar);
    this.agents = specs.map((spec, slot) => {
      const classic = spec.brain === 'classic' ? new AiDriver(track, { name: `teacher-${slot}`, paint: 0, difficulty: spec.difficulty, laps, slot, wet: options.weather === 'rain', tyreWear: options.tyreWear, damage: options.damage }) : null;
      const car = classic?.car ?? new CarPhysics(track);
      if (!classic) {
        const g = gridPlace(track, slot);
        car.placeAt(g.s, g.lateral);
        car.setup = suggestedSetup(track);
        car.wear = !!options.tyreWear;
        car.damageOn = !!options.damage;
        car.wet = options.weather === 'rain';
        aiCars.set(car.state, spec.difficulty);
      }
      if (spec.player) aiCars.delete(car.state);
      const session = classic?.session ?? new RaceSession(track.center.length, null, laps, track.center.width);
      return { car, classic, session, spec, before: this.progress(car), now: this.progress(car), input: { ...NO_INPUT }, gone: false, outFor: 0, distance: 0, offSeconds: 0, wallHits: 0, hardContacts: 0, resets: 0, maxHit: 0 };
    });
    this.states = this.agents.map((a) => a.car.state);
    this.controlCars = this.agents.map((a) => ({ st: a.car.state, dist: 0, racing: false, hit: 0, out: false }));
    this.drafts = new Float32Array(specs.length);
    this.touching = new Uint8Array(specs.length * specs.length);
    this.touchingNow = new Uint8Array(this.touching.length);
    this.refreshLive();
  }

  private progress(car: CarPhysics, out: Progress = { s: 0, lateral: 0, along: 0 }): Progress {
    const st = car.state;
    const t = this.track.center.tangents[Math.max(0, st.trackIndex)];
    out.s = st.s; out.lateral = st.lateral; out.along = st.vx * t.x + st.vz * t.y; out.offTrack = st.offTrack;
    return out;
  }

  private refreshLive(): void {
    this.live.length = this.liveStates.length = 0;
    for (let i = 0; i < this.agents.length; i++) if (!this.agents[i].gone) {
      this.live.push(i); this.liveStates.push(this.states[i]);
    }
  }

  /** External actions are held by the caller between policy ticks. Classic cars use the unmodified game teacher. */
  step(actions?: readonly (Readonly<DriveInput> | undefined)[]): void {
    const n = this.agents.length;
    this.weather.step(DT);
    // This is environmental wetness, not a policy feature: match the game's drying-line model.
    const line = this.options.weather && this.options.weather !== 'dry' ? assistDriver(this.track) : null;
    for (const a of this.agents) if (!a.gone) {
      this.progress(a.car, a.before);
      a.car.wetness = this.weather.wetnessAt(line ? a.car.state.lateral - line.lateralAt(a.car.state.s) : 0);
      a.maxHit = 0;
    }
    if (this.options.drafting !== false) {
      slipstream(this.liveStates, this.track.center.length, this.drafts);
      for (let i = 0; i < this.live.length; i++) {
        const car = this.agents[this.live[i]].car;
        car.draft = carriedTow(car.draft, this.drafts[i], DT);
      }
    }
    // Same sequential drive/physics order as raceScreen; do not update all controls from a stale snapshot.
    for (const i of this.live) {
      const a = this.agents[i], st = a.car.state;
      const x = st.x, z = st.z;
      let input: Readonly<DriveInput> = NO_INPUT;
      if (a.classic) input = a.classic.drive(this.liveStates, DT);
      else if (a.session.canDrive && !a.session.retired) input = actions?.[i] ?? NO_INPUT;
      Object.assign(a.input, input);
      const jumped = Math.hypot(st.x - x, st.z - z) > 3;
      if (jumped) a.resets++;
      a.car.step(input);
      a.maxHit = st.wallHit;
      if (st.wallHit > 4 && a.car.prev.wallHit <= 4) a.wallHits++;
    }
    this.touchingNow.fill(0);
    for (let pass = 0; pass < 3; pass++) for (let u = 0; u < this.live.length; u++) for (let v = u + 1; v < this.live.length; v++) {
      const i = this.live[u], j = this.live[v], k = i * n + j;
      const hit = collideCars(this.states[i], this.states[j]);
      if (hit > 0) this.touchingNow[k] = 1;
      if (pass !== 0 || hit <= 0) continue;
      const a = this.agents[i], b = this.agents[j];
      a.car.addDamage(hit); b.car.addDamage(hit);
      a.maxHit = Math.max(a.maxHit, hit); b.maxHit = Math.max(b.maxHit, hit);
      if (hit > 2 && !this.touching[k]) {
        this.firmContacts++;
        if (a.spec.player || b.spec.player) this.playerContacts++;
        if (hit > 4) { this.hardContacts++; a.hardContacts++; b.hardContacts++; }
      }
    }
    this.touching.set(this.touchingNow);
    let refresh = false, finished = false;
    for (let i = 0; i < n; i++) {
      const a = this.agents[i];
      if (a.gone) continue;
      this.events.length = 0;
      a.session.step(a.before, this.progress(a.car, a.now), this.events);
      if (a.session.phase === 'racing' && a.car.state.offTrack) a.offSeconds += DT;
      if (a.car.broken && !a.session.retired) a.session.retire(a.car.state.s);
      if (a.session.retired) {
        a.outFor += DT;
        if (a.outFor > DAMAGE.recoverAfter) { a.gone = true; refresh = true; }
      } else if (a.session.phase === 'finished') finished = true;
      a.distance = a.session.raceDistance(a.car.state.s);
      const cc = this.controlCars[i];
      cc.dist = a.distance; cc.hit = a.maxHit; cc.out = a.session.retired || a.gone;
      cc.racing = !a.gone && (a.session.retired || (a.session.phase === 'racing' && a.session.lapStart !== null && !a.classic?.pitting && !a.car.state.inPits));
    }
    if (finished) for (const a of this.agents) a.session.flagged = true;
    this.controlEvents.length = 0;
    this.control.step(DT, this.controlCars, this.controlEvents);
    for (let i = 0; i < n; i++) if (this.agents[i].classic) {
      this.agents[i].classic!.raceCap = this.control.cap(i, this.controlCars);
      this.agents[i].classic!.yellow = this.control.yellowAt(this.states[i].s);
    }
    if (refresh) this.refreshLive();
    this.tick++;
  }

  cap(index: number): number { return this.control.cap(index, this.controlCars); }
  get done(): boolean { return this.agents.every((a) => a.session.phase === 'finished') || this.tick >= (this.options.seconds ?? 180) / DT; }
  order(): number[] { return this.agents.map((_, i) => i).sort((i, j) => this.agents[j].distance - this.agents[i].distance || i - j); }
}
