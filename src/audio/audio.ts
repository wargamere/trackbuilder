import { settings, updateSettings } from '../core/settings.ts';

/**
 * All game audio, synthesised with WebAudio (no files):
 *  - engine: two oscillators through a low-pass filter; pitch follows the
 *    car's revs (its real gearbox), and the filter opens with throttle,
 *  - tyre squeal: band-passed noise when the car slides on tarmac,
 *  - grass rumble: low-passed noise when wheels are on the grass,
 *  - rain: a hiss of filtered noise, louder with speed (the spray),
 *  - short beeps for the countdown and laps, and a knock for barrier hits.
 *
 * There is exactly one AudioContext. It is created on the first user gesture,
 * and resumed on every later touchend/click/keydown while it is suspended (iOS
 * suspends it after interruptions such as calls or the app switcher).
 */

const IDLE_RPM = 900;
const MAX_RPM = 6500;

export interface EngineInput {
  speed: number;
  /** Engine revs as a share of the rev limit (from the car's gearbox). */
  rpm: number;
  throttle: number;
  slip: number;
  grass: number;
}

type Ctx = AudioContext;

class Voice {
  readonly gain: GainNode;
  constructor(ctx: Ctx, out: AudioNode) {
    this.gain = ctx.createGain();
    this.gain.gain.value = 0;
    this.gain.connect(out);
  }
}

export class AudioEngine {
  private ctx: Ctx | null = null;
  private master: GainNode | null = null;
  private engineVoice: Voice | null = null;
  private osc1: OscillatorNode | null = null;
  private osc2: OscillatorNode | null = null;
  private filter: BiquadFilterNode | null = null;
  private squeal: Voice | null = null;
  private rumble: Voice | null = null;
  private rainVoice: Voice | null = null;
  /** How hard it's raining (0..1). */
  private raining = 0;
  private noise: AudioBuffer | null = null;
  /** The player's sound toggle (read from settings in installUnlock, after platform init). */
  private muted = false;
  /** Muted while a video ad plays. */
  private held = false;
  /** The platform's mute setting (CrazyGames settings.muteAudio); overrides the player's toggle. */
  private platformMuted = false;
  private engineOn = false;

  /** Creates/resumes the context on user gestures. Call once at start-up, after platform init. */
  installUnlock(): void {
    this.muted = settings().muted;
    const unlock = () => this.unlock();
    for (const type of ['pointerdown', 'touchend', 'click', 'keydown']) {
      window.addEventListener(type, unlock, { capture: true, passive: true });
    }
    document.addEventListener('visibilitychange', () => {
      if (!this.ctx) return;
      if (document.hidden) void this.ctx.suspend().catch(() => {});
      else void this.ctx.resume().catch(() => {});
    });
  }

  private unlock(): void {
    try {
      if (!this.ctx) this.build();
      const state = this.ctx?.state as string | undefined;
      if (this.ctx && (state === 'suspended' || state === 'interrupted') && !document.hidden) {
        void this.ctx.resume().catch(() => {});
      }
    } catch {
      /* no WebAudio: play silently */
    }
  }

  private build(): void {
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return;
    const ctx = new Ctor();
    this.ctx = ctx;
    this.master = ctx.createGain();
    this.master.gain.value = this.targetMaster();
    this.master.connect(ctx.destination);

    // Engine.
    this.engineVoice = new Voice(ctx, this.master);
    this.filter = ctx.createBiquadFilter();
    this.filter.type = 'lowpass';
    this.filter.frequency.value = 600;
    this.filter.Q.value = 1.2;
    this.filter.connect(this.engineVoice.gain);
    this.osc1 = ctx.createOscillator();
    this.osc1.type = 'sawtooth';
    this.osc2 = ctx.createOscillator();
    this.osc2.type = 'square';
    const subGain = ctx.createGain();
    subGain.gain.value = 0.5;
    this.osc1.connect(this.filter);
    this.osc2.connect(subGain).connect(this.filter);
    this.osc1.start();
    this.osc2.start();

    // Noise for squeal and rumble.
    const noise = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const ch = noise.getChannelData(0);
    for (let i = 0; i < ch.length; i++) ch[i] = Math.random() * 2 - 1;
    this.noise = noise;
    const noiseSource = (type: BiquadFilterType, freq: number, q: number, voice: Voice) => {
      const src = ctx.createBufferSource();
      src.buffer = noise;
      src.loop = true;
      const f = ctx.createBiquadFilter();
      f.type = type;
      f.frequency.value = freq;
      f.Q.value = q;
      src.connect(f).connect(voice.gain);
      src.start();
    };
    this.squeal = new Voice(ctx, this.master);
    noiseSource('bandpass', 1500, 7, this.squeal);
    this.rumble = new Voice(ctx, this.master);
    noiseSource('lowpass', 260, 0.8, this.rumble);
    this.rainVoice = new Voice(ctx, this.master);
    noiseSource('bandpass', 2600, 0.35, this.rainVoice);
  }

  private targetMaster(): number {
    return this.muted || this.held || this.platformMuted ? 0 : 0.55;
  }

  private applyMaster(): void {
    if (this.ctx && this.master) this.master.gain.setTargetAtTime(this.targetMaster(), this.ctx.currentTime, 0.05);
  }

  get isMuted(): boolean {
    return this.muted;
  }

  setMuted(m: boolean): void {
    this.muted = m;
    updateSettings({ muted: m });
    this.applyMaster();
  }

  toggleMute(): void {
    this.setMuted(!this.muted);
  }

  /** Silences everything while a video ad plays. */
  setHeld(h: boolean): void {
    this.held = h;
    this.applyMaster();
  }

  /** The platform's own mute setting; while it is on, the in-game toggle can't unmute. */
  setPlatformMuted(m: boolean): void {
    this.platformMuted = m;
    this.applyMaster();
  }

  /** True when no sound plays for any reason (for the pause menu label). */
  get silent(): boolean {
    return this.muted || this.platformMuted;
  }

  /** Engine, squeal, rumble and rain on (racing) or faded out (menus, pause). */
  setEngine(on: boolean): void {
    this.engineOn = on;
    if (!on && this.ctx) {
      const t = this.ctx.currentTime;
      for (const v of [this.engineVoice, this.squeal, this.rumble, this.rainVoice]) v?.gain.gain.setTargetAtTime(0, t, 0.08);
    }
  }

  /** How hard it's raining, 0..1 (true: full rain). It's heard while racing, and wet tyres hardly squeal. */
  setRain(level: boolean | number): void {
    this.raining = Math.min(1, Math.max(0, Number(level)));
  }

  /** Called every frame while racing. */
  update(inp: EngineInput): void {
    const ctx = this.ctx;
    if (!ctx || !this.engineOn || !this.osc1 || !this.osc2 || !this.filter || !this.engineVoice || !this.squeal || !this.rumble) return;
    const t = ctx.currentTime;
    const v = Math.abs(inp.speed);
    // The revs climb through each gear and drop at every change up.
    const frac = Math.max(0, Math.min(1, inp.rpm));
    const load = Math.max(0, Math.min(1, inp.throttle));
    const rpm = IDLE_RPM + (MAX_RPM - IDLE_RPM) * Math.min(1, frac * 0.92 + load * 0.08);
    const hz = (rpm / 60) * 2; // four-cylinder firing frequency
    this.osc1.frequency.setTargetAtTime(hz, t, 0.03);
    this.osc2.frequency.setTargetAtTime(hz * 0.5, t, 0.03);
    this.filter.frequency.setTargetAtTime(380 + 1700 * load + 900 * frac, t, 0.05);
    this.engineVoice.gain.gain.setTargetAtTime(0.07 + 0.09 * load + 0.03 * frac, t, 0.05);

    const moving = Math.min(1, v / 8);
    const squeal = Math.max(0, Math.min(1, (inp.slip - 2.2) / 4)) * (1 - inp.grass) * moving * (1 - 0.65 * this.raining);
    this.squeal.gain.gain.setTargetAtTime(squeal * 0.13, t, 0.04);
    this.rainVoice?.gain.gain.setTargetAtTime(this.raining * (0.035 + 0.05 * Math.min(1, v / 40)), t, 0.25);
    this.rumble.gain.gain.setTargetAtTime(inp.grass * Math.min(1, v / 10) * 0.22, t, 0.06);
  }

  /** A dull knock for hitting a barrier; `strength` 0..1. */
  thud(strength: number): void {
    const ctx = this.ctx;
    if (!ctx || !this.master || !this.noise) return;
    const t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = 180 + 260 * strength;
    const g = ctx.createGain();
    const vol = 0.12 + 0.38 * Math.min(1, strength);
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.22 + 0.15 * strength);
    src.connect(f).connect(g).connect(this.master);
    src.start(t, Math.random() * 0.5);
    src.stop(t + 0.45);
  }

  /** A short tone (countdown, lap). */
  beep(freq: number, duration = 0.14, volume = 0.22, delay = 0): void {
    const ctx = this.ctx;
    if (!ctx || !this.master) return;
    const t = ctx.currentTime + delay;
    const o = ctx.createOscillator();
    o.type = 'triangle';
    o.frequency.value = freq;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(volume, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.001, t + duration);
    o.connect(g).connect(this.master);
    o.start(t);
    o.stop(t + duration + 0.05);
  }
}

/** The game's single audio engine. */
export const audio = new AudioEngine();
