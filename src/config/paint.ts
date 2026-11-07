/**
 * Car paints. Each unlocks after a number of finished runs, or straight away
 * by watching a rewarded ad (CrazyGames Full Launch only). Yellow is free.
 */
export const PAINTS = [
  { id: 'yellow', hex: 0xf2b705, runs: 0 },
  { id: 'red', hex: 0xd8342c, runs: 1 },
  { id: 'blue', hex: 0x2f6fd6, runs: 2 },
  { id: 'green', hex: 0x2fa84f, runs: 4 },
  { id: 'white', hex: 0xf0f0ea, runs: 6 },
  { id: 'black', hex: 0x2a2c33, runs: 9 },
  { id: 'pink', hex: 0xe8559a, runs: 12 },
  { id: 'purple', hex: 0x7b4bd6, runs: 16 },
] as const;

export type PaintId = (typeof PAINTS)[number]['id'];

/** Extra colours for AI cars only (with the paints above, enough for a full grid all in different colours). */
export const AI_PAINTS = [0xf07c1e, 0x1fa3a3, 0x9ccc2a, 0x8a5a33, 0x5cc8f0] as const;
