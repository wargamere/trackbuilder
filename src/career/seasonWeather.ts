import { hashString, rng } from '../core/random.ts';
import type { CareerSave, RoundWeather } from './career.ts';
import { CAREER } from '../config/career.ts';

// Game-balance weights, rather than a forecast of any real Grand Prix.
const desert = new Set(['world-bh-2002', 'world-sa-2021', 'world-us-2023', 'world-qa-2004', 'world-ae-2009']);
const wetter = new Set(['world-gb-1948', 'world-be-1925', 'world-jp-1962', 'world-br-1940', 'world-ca-1978']);
const cache = new WeakMap<CareerSave, { key: string; weather: RoundWeather[] }>();

/** Stable circuit-weighted weather, bounded so one season cannot become a rain marathon. */
export function seasonWeather(save: CareerSave): readonly RoundWeather[] {
  const key = `${save.seed}:${save.season}:${save.calendar.join(',')}`, known = cache.get(save);
  if (known?.key === key) return known.weather;
  const weather: RoundWeather[] = save.calendar.map(() => 'dry');
  const candidates = save.calendar.map((track, round) => {
    const roll = rng(hashString(`${save.seed}:${save.season}:${track}:climate-v2`))();
    const chance = desert.has(track) ? .015 : wetter.has(track) ? .24 : CAREER.rain + CAREER.changing;
    return { round, roll, chance };
  }).filter(c => c.roll < c.chance).sort((a, b) => a.roll / a.chance - b.roll / b.chance);
  let wet = 0;
  for (const c of candidates) {
    if (wet >= Math.max(1, Math.floor(save.calendar.length / 4))) break;
    const i = c.round;
    if ((weather[i-1] !== undefined && weather[i-1] !== 'dry' && weather[i-2] !== undefined && weather[i-2] !== 'dry') ||
        (weather[i-1] !== undefined && weather[i-1] !== 'dry' && weather[i+1] !== undefined && weather[i+1] !== 'dry') ||
        (weather[i+1] !== undefined && weather[i+1] !== 'dry' && weather[i+2] !== undefined && weather[i+2] !== 'dry')) continue;
    weather[i] = rng(hashString(`${key}:${i}:intensity`))() < CAREER.rain / (CAREER.rain + CAREER.changing) ? 'rain' : 'changing'; wet++;
  }
  cache.set(save, { key, weather }); return weather;
}
