/**
 * Dev orchestrator: starts Vite dev server, waits for it, then launches
 * Electron pointing at it. No extra deps (no concurrently) — plain Node.
 */
import { spawn } from 'node:child_process';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const PORT = 5173;

function waitForServer(url, timeoutMs = 30000) {
  const started = Date.now();
  return new Promise((resolve, reject) => {
    const tick = () => {
      const req = http.get(url, (res) => {
        res.resume();
        resolve();
      });
      req.on('error', () => {
        if (Date.now() - started > timeoutMs) reject(new Error('Vite dev server did not start in time'));
        else setTimeout(tick, 300);
      });
    };
    tick();
  });
}

async function main() {
  console.log('[dev] starting vite…');
  const vite = spawn('npx', ['vite', '--port', String(PORT), '--strictPort'], {
    cwd: root,
    shell: true,
    stdio: 'inherit',
    env: { ...process.env, FORCE_COLOR: '1' },
  });

  try {
    await waitForServer(`http://localhost:${PORT}`);
  } catch (err) {
    console.error(String(err));
    vite.kill();
    process.exit(1);
  }

  console.log('[dev] launching electron…');
  const electron = spawn('npx', ['electron', '.'], {
    cwd: root,
    shell: true,
    stdio: 'inherit',
    env: {
      ...process.env,
      VITE_DEV_SERVER_URL: `http://localhost:${PORT}`,
      ELECTRON_START_URL: `http://localhost:${PORT}`,
    },
  });

  electron.on('exit', () => {
    vite.kill();
    process.exit(0);
  });
  vite.on('exit', () => {
    electron.kill();
    process.exit(0);
  });
}

main();
