/** Experimental training contract. No production switch is enabled by this module. */
export const POLICY = {
  version: 1,
  hz: 30,
  hidden: [128, 128] as readonly number[],
  actionSize: 2,
  neighbours: 8,
  neighbourRange: 100,
  lookahead: [-10, -3, 5, 10, 15, 20, 30, 40, 55, 70, 90, 115, 140, 175, 220] as readonly number[],
  defaultBrain: 'classic' as const,
} as const;
