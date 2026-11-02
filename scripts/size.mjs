// Prints the size of a build folder and checks the CrazyGames packaging rules:
// total size <= 20 MB, index.html at the root, and only relative asset paths.
// Usage: node scripts/size.mjs dist/crazygames
import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { join, relative } from 'node:path';

const dir = process.argv[2] ?? 'dist/web';
const LIMIT = 20 * 1024 * 1024;

function walk(d) {
  return readdirSync(d).flatMap((name) => {
    const p = join(d, name);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

const fmt = (n) => (n < 1024 * 1024 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1024 / 1024).toFixed(2)} MB`);

if (!existsSync(join(dir, 'index.html'))) {
  console.error(`✗ ${dir}/index.html is missing`);
  process.exit(1);
}

const files = walk(dir).map((f) => ({ f: relative(dir, f), size: statSync(f).size }));
const total = files.reduce((s, x) => s + x.size, 0);

console.log(`\nBuild: ${dir}`);
for (const { f, size } of files.sort((a, b) => b.size - a.size)) {
  console.log(`  ${fmt(size).padStart(10)}  ${f}`);
}
console.log(`  ${'-'.repeat(10)}`);
console.log(`  ${fmt(total).padStart(10)}  total in ${files.length} file(s)  (limit ${fmt(LIMIT)})`);

const html = readFileSync(join(dir, 'index.html'), 'utf8');
const absolute = [...html.matchAll(/(?:src|href)="(\/[^/"][^"]*)"/g)].map((m) => m[1]);
let ok = true;
if (absolute.length) {
  console.error(`✗ absolute asset paths in index.html: ${absolute.join(', ')}`);
  ok = false;
}
if (total > LIMIT) {
  console.error('✗ build exceeds the 20 MB budget');
  ok = false;
}
if (ok) console.log('✓ relative paths only, within size budget\n');
process.exit(ok ? 0 : 1);
