import { build } from 'esbuild';
import { readdir, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

// Find all API endpoint .ts files, skipping _lib helpers
async function findEntryPoints(dir) {
  const entries = [];
  for (const item of await readdir(dir)) {
    if (item.startsWith('_')) continue;
    const full = join(dir, item);
    const s = await stat(full);
    if (s.isDirectory()) {
      entries.push(...(await findEntryPoints(full)));
    } else if (item.endsWith('.ts')) {
      entries.push(full);
    }
  }
  return entries;
}

const entryPoints = await findEntryPoints('api');

// Bundle but don't write to disk yet — we need to overwrite .ts files in-place
const result = await build({
  entryPoints,
  bundle: true,
  platform: 'node',
  target: 'node18',
  format: 'esm',
  write: false,
  outdir: 'api',
  outbase: 'api',
  packages: 'bundle',
});

// Overwrite each .ts source with its bundled JS output.
// Vercel pre-scans for .ts files before the build runs, so they must still
// exist. The content is now self-contained JS (valid TypeScript too).
for (const file of result.outputFiles) {
  const tsPath = file.path.replace(/\.js$/, '.ts');
  await writeFile(tsPath, file.text);
}

console.log(`Bundled ${entryPoints.length} API functions`);
