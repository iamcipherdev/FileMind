#!/usr/bin/env node
/**
 * FileMind installed-app E2E driver (runs on the Windows machine, incl. CI).
 *
 * Connects to the INSTALLED app over CDP (--remote-debugging-port) and drives
 * the REAL UI:
 *   phase=onboarding  stub only the native folder dialog, click through the
 *                     real onboarding (Add a folder -> Next -> Next ->
 *                     Start organizing), so the real settings:set +
 *                     watcher:update path executes, then waits for Home.
 *   phase=existing    waits for Home directly (saved-folder relaunch path).
 *
 * Fallback when the contextBridge function cannot be overridden: the same
 * settings:set payload Onboarding.finish() sends is applied via the real
 * bridge, then the page is reloaded so Home mounts through the real path.
 *
 * Exit code 0 = reached Home and stayed responsive. Non-zero = reproduction
 * of the crash (or automation failure — the bootstrap log distinguishes).
 */
import { setTimeout as sleep } from 'node:timers/promises';

const args = Object.fromEntries(process.argv.slice(2).reduce((acc, a, i, arr) => {
  if (a.startsWith('--')) acc.push([a.slice(2), arr[i + 1] && !arr[i + 1].startsWith('--') ? arr[i + 1] : true]);
  return acc;
}, []));

const PORT = Number(args.port ?? 9222);
const PHASE = args.phase ?? 'onboarding';
const FOLDER = args.folder ?? '';
const WAIT_HOME_MS = Number(args['wait-home-ms'] ?? 45000);

const log = (...m) => console.log('[e2e-driver]', ...m);

async function getTargets() {
  const res = await fetch(`http://127.0.0.1:${PORT}/json/list`);
  return res.json();
}

let target = null;
for (let i = 0; i < 60; i++) {
  try {
    const targets = await getTargets();
    target = targets.find((t) => t.type === 'page' && !/devtools/i.test(t.url));
    if (target) break;
  } catch { /* app not up yet */ }
  await sleep(1000);
}
if (!target) {
  console.error('[e2e-driver] FAIL: no renderer page target found (app window never came up)');
  process.exit(2);
}
log('renderer target:', target.title, target.url);

const WebSocket = (await import('ws')).default;

let ws = null;
let seq = 0;
const pending = new Map();

async function connectToRenderer() {
  let tgt = null;
  for (let i = 0; i < 60; i++) {
    try {
      const targets = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
      tgt = targets.find((t) => t.type === 'page' && !/devtools/i.test(t.url));
      if (tgt) break;
    } catch { /* app not up yet */ }
    await sleep(1000);
  }
  if (!tgt) throw new Error('no renderer page target found (app window never came up)');
  log('renderer target:', tgt.title, tgt.url);
  if (ws) { try { ws.close(); } catch {} }
  ws = new WebSocket(tgt.webSocketDebuggerUrl, { maxPayload: 64 * 1024 * 1024 });
  await new Promise((res, rej) => { ws.once('open', res); ws.once('error', rej); });
  ws.on('message', (data) => {
    const msg = JSON.parse(data.toString());
    if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
  });
}

function send(method, params = {}) {
  const id = ++seq;
  ws.send(JSON.stringify({ id, method, params }));
  return new Promise((res, rej) => {
    pending.set(id, (msg) => (msg.error ? rej(new Error(`${method}: ${JSON.stringify(msg.error)}`)) : res(msg.result)));
    setTimeout(() => { if (pending.has(id)) { pending.delete(id); rej(new Error(`${method} timeout`)); } }, 30000);
  });
}
async function evaluate(expression, awaitPromise = true) {
  const r = await send('Runtime.evaluate', { expression, awaitPromise, returnByValue: true, userGesture: true });
  if (r.exceptionDetails) throw new Error(`evaluate failed: ${r.exceptionDetails.exception?.description ?? JSON.stringify(r.exceptionDetails)}`);
  return r.result?.value;
}

// innerText reflects CSS text-transform (e.g. the uppercase "ORGANIZE
// FOLDERS" label) — compare case-insensitively.
const bodyHas = (txt) => `document.body && document.body.innerText.toLowerCase().includes(${JSON.stringify(txt.toLowerCase())})`;

await connectToRenderer();

try {
  if (PHASE === 'onboarding') {
    // Wait for onboarding UI.
    await waitFor(() => evaluate(bodyHas('Welcome to FileMind')), 'onboarding screen', WAIT_HOME_MS);

    // Stub ONLY the native folder dialog; everything else stays real.
    // NOTE: contextBridge objects may reject property assignment — probe via
    // toString() WITHOUT calling (calling would open the real native dialog
    // and block forever). If the stub did not stick, use the real-bridge
    // fallback below (identical main-process path, no native dialog).
    const stubbed = await evaluate(`(() => {
      try {
        window.filemind.pickFolder = async () => ${JSON.stringify(FOLDER)};
        return String(window.filemind.pickFolder).includes(${JSON.stringify(FOLDER)});
      } catch { return false; }
    })()`);
    log('pickFolder stubbed:', stubbed);

    if (stubbed) {
      await evaluate(`[...document.querySelectorAll('button')].find(b => b.textContent.includes('Add a folder'))?.click()`);
      await sleep(800);
      await evaluate(`[...document.querySelectorAll('button')].find(b => b.textContent.includes('Add a folder'))?.click()`);
      await sleep(800);
      // Wait until the picked folder is visible in the onboarding list.
      await waitFor(() => evaluate(bodyHas(FOLDER)), 'picked folder listed', 15000);
      await evaluate(`[...document.querySelectorAll('button')].find(b => b.textContent.trim() === 'Next')?.click()`);
      await sleep(500);
      await evaluate(`[...document.querySelectorAll('button')].find(b => b.textContent.trim() === 'Next')?.click()`);
      await sleep(500);
      await evaluate(`[...document.querySelectorAll('button')].find(b => b.textContent.includes('Start organizing'))?.click()`);
      log('clicked through real onboarding');
    } else {
      // Fallback: identical payload to Onboarding.finish() (v0.1.4: watching
      // is NOT auto-enabled), via the real bridge.
      log('fallback: applying finish() payload via real settings bridge');
      await evaluate(`(async () => {
        const s = await window.filemind.getSettings();
        await window.filemind.setSettings({ ...s, organizeFolders: [${JSON.stringify(FOLDER)}], watchedFolders: [] });
      })()`);
      // Reload mounts the post-onboarding app (same as the real onDone path).
      await evaluate(`window.location.reload()`);
      // Navigation destroyed the old execution context — reconnect cleanly.
      await sleep(2500);
      await connectToRenderer();
    }
  }

  // Wait for Home (post-onboarding page that mounts ML status etc.).
  await waitFor(() => evaluate(bodyHas('Organize folders')), 'Home page', WAIT_HOME_MS);
  log('HOME REACHED');

  // Give Home's mount effects time to fire (ml:status on mount).
  await sleep(3000);
  const ml = await evaluate(`(async () => {
    return window.filemind
      ? await window.filemind.getMlStatus().then(s => s.message).catch(e => 'ml:status rejected: ' + e.message)
      : 'no bridge';
  })()`);
  log('ml:status message:', ml);

  // Optional: explicit ML worker warmup (production ONNX test — proves the
  // packaged ONNX runtime + model session work, isolated from the main process).
  if (args.warmup) {
    const warm = await evaluate(`(async () => window.filemind.warmupMl())()`);
    log('ml:warmup ->', JSON.stringify(warm));
  }

  // Optional: explicitly enable watching (Settings-equivalent opt-in path).
  if (args.watch) {
    await evaluate(`(async () => {
      const s = await window.filemind.getSettings();
      await window.filemind.setSettings({ ...s, watchedFolders: [...new Set([...(s.watchedFolders ?? []), ${JSON.stringify(FOLDER)}])] });
    })()`);
    await sleep(2000);
    log('watcher explicitly enabled for', FOLDER);
  }

  await evaluate(`window.filemind && window.filemind.marker && window.filemind.marker('E2E_HOME_VERIFIED')`);
  console.log('[e2e-driver] RESULT OK');
  ws.close();
  process.exit(0);
} catch (err) {
  console.error('[e2e-driver] RESULT FAIL:', err.message);
  try { ws.close(); } catch {}
  process.exit(1);
}

async function waitFor(fn, what, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try { if (await fn()) { log('waited for:', what); return; } } catch { /* page mid-navigation */ }
    await sleep(700);
  }
  throw new Error(`timeout waiting for ${what}`);
}
