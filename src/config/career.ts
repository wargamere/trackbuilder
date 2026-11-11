/**
 * The career: a championship season by season, driving for a team. All the
 * numbers and the made-up teams and drivers are here; the rules are in
 * career/career.ts.
 */

/** How long a race is: the laps are worked out per track so each takes about as long. */
export type RaceLength = 'short' | 'medium' | 'long';
/** How many rounds a season has. */
export type SeasonLength = 'short' | 'standard' | 'full';

export interface TeamDef {
  id: string;
  name: string;
  /** The cars' colour. */
  paint: number;
  /** Optional second livery colour. */
  secondary?: number;
  /** How good its car is in the first season, 0 (the slowest) to 1 (the quickest). */
  car: number;
  /** Its two drivers (ids in CAREER.drivers). You take the second one's seat when you drive for it. */
  drivers: readonly [string, string];
}

export interface DriverDef {
  id: string;
  /** Surname (the timing tower, standings) and first name. */
  name: string;
  first: string;
  /** Three letters, as on a timing screen. */
  code: string;
  /** 0 (the weakest in the field) to 1 (the best). */
  skill: number;
}

export const CAREER = {
  /**
   * Points for 1st to 10th, as in the real thing. A car that retires (DNF)
   * scores nothing. Ties in the standings go to whoever has the most wins,
   * then the most 2nd places, and so on.
   */
  points: [25, 18, 15, 12, 10, 8, 6, 4, 2, 1],
  /** Ten teams of two: twenty cars. */
  cars: 20,
  /** Rounds in a season of each length (out of the calendar below). */
  rounds: { short: 8, standard: 16, full: 24 },
  /**
   * Race length: about this many minutes of racing, so the laps differ from
   * track to track (as the real distance is the same everywhere), with at
   * least `minLaps`.
   */
  lengths: {
    short: { minutes: 4, minLaps: 3 },
    medium: { minutes: 8, minLaps: 5 },
    long: { minutes: 16, minLaps: 8 },
  },
  maxLaps: 50,
  /**
   * Tyres are made for the distance: medium tyres last at least this share
   * of the race (and never less than they do on that track anyway), so a
   * long race is one or two stops, not four.
   */
  tyreShare: 0.4,
  /**
   * How fast everyone is. The quickest car with the best driver races at the
   * career's difficulty; the rest are up to `spread` (of difficulty, 0..1)
   * below it, `carShare` of that by their car and the rest by the driver.
   * Each race weekend every driver is up to `form` better or worse.
   */
  spread: 0.1,
  carShare: 0.7,
  form: 0.012,
  /**
   * Your own car, by your team's car (1 = the quickest): the slowest car has
   * this much less grip, engine pull and top speed (about 1.5–2 % a lap, the
   * same as the gap between the quickest and slowest AI cars).
   */
  carGrip: 0.03,
  carPull: 0.05,
  carTop: 0.015,
  /** The weather for a round: this often rain all race, this often changing (rain on the way), else dry. */
  rain: 0.08,
  changing: 0.22,
  /** Each AI car has this chance a race of a mechanical failure, somewhere between these shares of the distance. */
  failure: 0.03,
  failFrom: 0.15,
  failTo: 0.92,
  /** Between seasons every team's car gets up to this much better or worse. */
  drift: 0.14,
  /**
   * Offers at the end of a season: your own team always keeps you; teams
   * whose car ranks no better than this many places above where your
   * championship position puts you (5th–6th is the third-best car's level)
   * make an offer.
   */
  offerReach: 1,
  /** The calendar, in order (ids of the real-world circuits in track/data/world.ts). Shorter seasons take an even spread of it. */
  calendar: [
    'world-au-1953',
    'world-cn-2004',
    'world-jp-1962',
    'world-bh-2002',
    'world-sa-2021',
    'world-us-2022',
    'world-it-1953',
    'world-mc-1929',
    'world-es-1991',
    'world-ca-1978',
    'world-at-1969',
    'world-gb-1948',
    'world-be-1925',
    'world-hu-1986',
    'world-nl-1948',
    'world-it-1922',
    'world-az-2016',
    'world-sg-2008',
    'world-us-2012',
    'world-mx-1962',
    'world-br-1940',
    'world-us-2023',
    'world-qa-2004',
    'world-ae-2009',
  ],
  /** The teams, quickest car first (in the first season). All made up. */
  teams: [
    { id: 'aurora', name: 'Aurora GP', paint: 0x1fa3a3, car: 1, drivers: ['lin', 'oka'] },
    { id: 'vento', name: 'Scuderia Vento', paint: 0xd8342c, car: 0.9, drivers: ['val', 'mor'] },
    { id: 'solaris', name: 'Solaris Racing', paint: 0xf07c1e, car: 0.8, drivers: ['nak', 'bre'] },
    { id: 'sterling', name: 'Sterling Motorsport', paint: 0xc9ced6, car: 0.68, drivers: ['har', 'vol'] },
    { id: 'kestrel', name: 'Kestrel Works', paint: 0x2f6fd6, car: 0.55, drivers: ['alm', 'whi'] },
    { id: 'emerald', name: 'Emerald Motors', paint: 0x2fa84f, car: 0.45, drivers: ['rau', 'des'] },
    { id: 'mistral', name: 'Équipe Mistral', paint: 0xe8559a, car: 0.35, drivers: ['lef', 'vdi'] },
    { id: 'nordlys', name: 'Nordlys Racing', paint: 0x5cc8f0, car: 0.25, drivers: ['hal', 'kow'] },
    { id: 'obsidian', name: 'Obsidian Racing', paint: 0x2a2c33, car: 0.14, drivers: ['dla', 'rey'] },
    { id: 'goldcrest', name: 'Goldcrest Racing', paint: 0xf2b705, car: 0.04, drivers: ['oha', 'tan'] },
  ] as readonly TeamDef[],
  /** The drivers. All made up. */
  drivers: [
    { id: 'lin', name: 'Lindqvist', first: 'Erik', code: 'LIN', skill: 1 },
    { id: 'oka', name: 'Okafor', first: 'Tunde', code: 'OKA', skill: 0.8 },
    { id: 'val', name: 'Valtieri', first: 'Marco', code: 'VAL', skill: 0.94 },
    { id: 'mor', name: 'Moreau', first: 'Luc', code: 'MOR', skill: 0.76 },
    { id: 'nak', name: 'Nakamura', first: 'Kenji', code: 'NAK', skill: 0.9 },
    { id: 'bre', name: 'Brennan', first: 'Declan', code: 'BRE', skill: 0.68 },
    { id: 'har', name: 'Hartmann', first: 'Jonas', code: 'HAR', skill: 0.84 },
    { id: 'vol', name: 'Volkov', first: 'Sasha', code: 'VOL', skill: 0.64 },
    { id: 'alm', name: 'Almeida', first: 'Tiago', code: 'ALM', skill: 0.78 },
    { id: 'whi', name: 'Whitlock', first: 'Harry', code: 'WHI', skill: 0.58 },
    { id: 'rau', name: 'Rautio', first: 'Niko', code: 'RAU', skill: 0.72 },
    { id: 'des', name: 'Desai', first: 'Arjun', code: 'DES', skill: 0.54 },
    { id: 'lef', name: 'Lefèvre', first: 'Théo', code: 'LEF', skill: 0.66 },
    { id: 'vdi', name: 'van Dijk', first: 'Sem', code: 'VDI', skill: 0.48 },
    { id: 'hal', name: 'Halvorsen', first: 'Magnus', code: 'HAL', skill: 0.6 },
    { id: 'kow', name: 'Kowal', first: 'Piotr', code: 'KOW', skill: 0.42 },
    { id: 'dla', name: 'Dlamini', first: 'Sipho', code: 'DLA', skill: 0.5 },
    { id: 'rey', name: 'Reyes', first: 'Mateo', code: 'REY', skill: 0.36 },
    { id: 'oha', name: 'O’Hara', first: 'Finn', code: 'OHA', skill: 0.4 },
    { id: 'tan', name: 'Tanaka', first: 'Ryo', code: 'TAN', skill: 0.28 },
  ] as readonly DriverDef[],
} as const;

/** Your id among the drivers (in grids, results and standings). */
export const YOU_ID = 'you';
