import { build } from 'esbuild';
import { readdir, stat, unlink } from 'node:fs/promises';
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

await build({
  entryPoints,
  bundle: true,
  platform: 'node',
  target: 'node18',
  format: 'esm',
  outdir: 'api',
  outbase: 'api',
  allowOverwrite: true,
  banner: { js: '// Bundled by esbuild' },
  // Vercel provides @vercel/node at runtime; keep all npm deps external-free
  // by bundling everything except Node.js built-ins
  packages: 'bundle',
});

// Remove .ts entry points so Vercel picks up the bundled .js files
// (only affects the Vercel build environment, not local source)
await Promise.all(entryPoints.map((f) => unlink(f)));

console.log(`Bundled ${entryPoints.length} API functions`);
