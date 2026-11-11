/** A car as the race order sees it. */
export interface Placed {
  /** How far round the race it is (m; see RaceSession.raceDistance): its laps × the lap once it has finished, or where it retired. */
  dist: number;
  /** Session time it finished, or null. */
  end: number | null;
  /** Retired (broken down): out of the race. */
  out: boolean;
}

/**
 * Race order: by how far round the race each car is (a car that has finished
 * has done its laps; of two that finished on the same lap, the one that
 * crossed the line first), then the cars that retired, the one that got
 * furthest first. So a car flagged a lap down is behind every car on the
 * lead lap, and a retirement is behind everyone still running.
 */
export function raceOrder<T extends Placed>(cars: readonly T[]): T[] {
  return [...cars].sort((a, b) => Number(a.out) - Number(b.out) || b.dist - a.dist || (a.end ?? Infinity) - (b.end ?? Infinity));
}
