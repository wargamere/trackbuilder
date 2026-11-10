// Zips a build folder's contents (index.html at the root of the zip, as the
// CrazyGames Developer Portal wants), after the size check passes.
// Usage: node scripts/zipBuild.mjs dist/crazygames dist/track-builder-3d-crazygames.zip
import { execFileSync } from 'node:child_process';
import { existsSync, rmSync, statSync } from 'node:fs';
import { resolve } from 'node:path';

const dir = process.argv[2] ?? 'dist/crazygames';
const out = resolve(process.argv[3] ?? 'dist/track-builder-3d-crazygames.zip');
execFileSync('node', ['scripts/size.mjs', dir], { stdio: 'inherit' });
if (existsSync(out)) rmSync(out);
try {
  execFileSync('zip', ['-r', '-X', '-q', out, '.'], { cwd: dir, stdio: 'inherit' });
} catch {
  console.error(`✗ couldn't run "zip": install it, or zip the contents of ${dir} by hand (index.html at the top level).`);
  process.exit(1);
}
const page = resolve(dir, 'index.html');
console.log(`✓ upload ${page} (${(statSync(page).size / 1024).toFixed(0)} KB, the whole game in one file) in the CrazyGames Developer Portal`);
console.log(`  (or this zip of it: ${out}, ${(statSync(out).size / 1024).toFixed(0)} KB)`);
