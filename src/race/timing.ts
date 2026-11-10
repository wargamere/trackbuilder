/**
 * Time gaps between cars, the way race timing works them out: when each car
 * passed each mark of race distance (every `step` m). The gap from a car
 * behind to one ahead is how long ago the one ahead passed the point where
 * the one behind is now.
 */
export class GapTracker {
  private readonly marks: number[][];
  /** Each car's latest race distance and time (for points past its last mark). */
  private readonly lastD: number[];
  private readonly lastT: number[];
  readonly step: number;

  constructor(cars: number, step = 10) {
    this.step = step;
    this.marks = Array.from({ length: cars }, () => []);
    this.lastD = Array.from({ length: cars }, () => -Infinity);
    this.lastT = Array.from({ length: cars }, () => 0);
  }

  /** Car `i` is at race distance `d` (m) at time `t` (s): records the marks it has passed. */
  update(i: number, d: number, t: number): void {
    const m = this.marks[i];
    while (m.length * this.step <= d) m.push(t);
    this.lastD[i] = d;
    this.lastT[i] = t;
  }

  /** When car `i` passed race distance `d`, or null if it hasn't (yet). */
  timeAt(i: number, d: number): number | null {
    const m = this.marks[i];
    if (d < 0 || d > this.lastD[i]) return null;
    const k = d / this.step;
    const j = Math.floor(k);
    if (j >= m.length) return null;
    if (j + 1 < m.length) return m[j] + (m[j + 1] - m[j]) * (k - j);
    // Past its last mark: between that and where it is now.
    const span = this.lastD[i] - j * this.step;
    return span <= 0 ? m[j] : m[j] + (this.lastT[i] - m[j]) * ((d - j * this.step) / span);
  }

  /**
   * Seconds car `a` (at race distance `da`) is behind car `b` (at `db`);
   * negative when it's ahead. Null before the first mark.
   */
  gap(a: number, da: number, b: number, db: number, now: number): number | null {
    if (db >= da) {
      const t = this.timeAt(b, da);
      return t === null ? null : now - t;
    }
    const t = this.timeAt(a, db);
    return t === null ? null : -(now - t);
  }
}

/** A gap for the timing tower: "+1.8", "−0.4", "+1 LAP", "+2 LAPS" (by laps when that far apart). */
export function formatGap(seconds: number | null, distBehind: number, lapLength: number, lapWord: string, lapsWord: string): string {
  const laps = Math.floor(Math.abs(distBehind) / lapLength);
  const sign = distBehind > 0 ? '+' : '−';
  if (laps >= 1) return `${sign}${laps} ${laps === 1 ? lapWord : lapsWord}`;
  if (seconds === null) return '';
  return `${seconds >= 0 ? '+' : '−'}${Math.abs(seconds).toFixed(1)}`;
}
