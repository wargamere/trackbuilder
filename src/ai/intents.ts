/** Race rules and strategy may supply these. None is a racing line or a driving command. */
export interface DrivingIntent {
  difficulty: number;
  racing: boolean;
  countdown: boolean;
  finished: boolean;
  yellow: boolean;
  safetyCar: boolean;
  speedLimit: number;
  pit: 'none' | 'enter' | 'service' | 'exit';
  /** Only valid during a called stop. Local pit-path targets are allowed by the policy contract. */
  pitDistance: number;
  pitLateralNow: number;
  pitLateral20: number;
  pitLateral50: number;
}
export function defaultIntent(difficulty = 1): DrivingIntent {
  return { difficulty, racing: true, countdown: false, finished: false, yellow: false, safetyCar: false, speedLimit: Infinity, pit: 'none', pitDistance: 0, pitLateralNow: 0, pitLateral20: 0, pitLateral50: 0 };
}
