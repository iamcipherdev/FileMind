/**
 * npm run demo:files — safe demo corpus generator (CLI shim).
 * Uses the compiled main-process module; compiles it first if missing.
 */
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const target = path.join(root, 'dist-electron', 'main', 'services', 'demoFiles.js');

if (!existsSync(target)) {
  console.log('[demo:files] compiling main process first…');
  const r = spawnSync('npx', ['tsc', '-p', 'tsconfig.build.json'], {
    cwd: root, stdio: 'inherit', shell: true,
  });
  if (r.status !== 0) {
    console.error('[demo:files] compile failed — run `npm run build:main` and retry.');
    process.exit(1);
  }
}

const require = createRequire(import.meta.url);
const { generateDemoFiles } = require(target);

const arg = process.argv[2] ?? path.join(process.cwd(), 'FileMindDemo');
try {
  const out = generateDemoFiles(path.resolve(String(arg)));
  console.log(`Created ${out.created} demo files in: ${out.dir}`);
  console.log('Open FileMind → Organize, add that folder, and take the pipeline for a spin.');
} catch (err) {
  console.error('Could not create demo files:', err?.message ?? err);
  process.exit(1);
}
