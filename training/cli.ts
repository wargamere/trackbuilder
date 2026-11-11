import { execFileSync } from 'node:child_process';
import { mkdir, writeFile, rename } from 'node:fs/promises';
import { dirname } from 'node:path';

export function argumentsOf(args = process.argv.slice(2)): Map<string, string> {
  const out = new Map<string, string>();
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--') continue;
    if (!args[i].startsWith('--') || !args[i + 1] || args[i + 1].startsWith('--')) throw new Error(`Expected --option value, got ${args[i]}`);
    out.set(args[i].slice(2), args[++i]);
  }
  return out;
}
export function integer(args: Map<string, string>, key: string, fallback: number, min = 1, max = 1_000_000): number {
  const value = Number(args.get(key) ?? fallback);
  if (!Number.isSafeInteger(value) || value < min || value > max) throw new Error(`--${key} must be an integer in ${min}..${max}`);
  return value;
}
export function revision(): string {
  try { return execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(); } catch { return 'unknown'; }
}
export async function jsonFile(path: string, data: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(`${path}.tmp`, JSON.stringify(data, null, 2) + '\n');
  await rename(`${path}.tmp`, path);
}
