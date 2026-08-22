#!/usr/bin/env node
// Real-Electron visual/runtime acceptance driver.
// Usage: node scripts/acceptance/run-acceptance.mjs
// Requires: dist-web build present; seeded user-data dir produced by seed.mts.
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import { join, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const DIST = join(ROOT, 'dist-web');
const OUT = join(ROOT, '.mw-local', 'acceptance');
const RUN_ROOT = join(ROOT, '.mw-local', 'acceptance-run');
const EMPTY_DIR = join(RUN_ROOT, 'empty-user-data');
const DATA_DIR = join(RUN_ROOT, 'data-user-data');
const CDP_PORT = 9337;
const WIDTHS = [320, 375, 768, 1024, 1440];
const ELECTRON = join(ROOT, 'node_modules', 'electron', 'dist', 'Electron.app', 'Contents', 'MacOS', 'Electron');

const results = [];
const consoleIssues = [];
function record(name, ok, detail) {
  results.push({ name, ok, detail: detail ?? '' });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);
}

// ---------- static server for dist-web ----------
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.woff2': 'font/woff2',
  '.json': 'application/json',
};
const uiPort = await new Promise((resolve, reject) => {
  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://127.0.0.1');
      let pathname = decodeURIComponent(url.pathname);
      if (pathname.endsWith('/')) pathname += 'index.html';
      let target = join(DIST, pathname);
      try {
        await readFile(target);
      } catch {
        target = join(DIST, 'index.html');
      }
      const body = await readFile(target);
      res.writeHead(200, { 'Content-Type': MIME[extname(target)] ?? 'application/octet-stream' });
      res.end(body);
    } catch (error) {
      res.writeHead(500);
      res.end(String(error));
    }
  });
  server.on('error', reject);
  server.listen(0, '127.0.0.1', () => resolve(server.address().port));
});
console.log(`static server: http://127.0.0.1:${uiPort}/`);

// ---------- minimal CDP client ----------
class CDP {
  constructor(ws) {
    this.ws = ws;
    this.nextId = 1;
    this.pending = new Map();
    this.handlers = new Map();
    ws.addEventListener('message', (event) => {
      const msg = JSON.parse(event.data);
      if (msg.id !== undefined && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        if (msg.error) reject(new Error(`${msg.error.message}`));
        else resolve(msg.result);
      } else if (msg.method) {
        for (const handler of this.handlers.get(msg.method) ?? []) handler(msg.params);
      }
    });
  }
  send(method, params = {}) {
    const id = this.nextId++;
    this.ws.send(JSON.stringify({ id, method, params }));
    return new Promise((resolve, reject) => this.pending.set(id, { resolve, reject }));
  }
  on(method, handler) {
    const list = this.handlers.get(method) ?? [];
    list.push(handler);
    this.handlers.set(method, list);
  }
  once(method) {
    return new Promise((resolve) => {
      const handler = (params) => {
        this.handlers.set(method, (this.handlers.get(method) ?? []).filter((h) => h !== handler));
        resolve(params);
      };
      this.on(method, handler);
    });
  }
}

async function connectCDP(timeoutMs = 45000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`);
      const targets = await response.json();
      const page = targets.find((t) => t.type === 'page');
      if (page?.webSocketDebuggerUrl) {
        const ws = new WebSocket(page.webSocketDebuggerUrl);
        await new Promise((resolve, reject) => {
          ws.addEventListener('open', resolve, { once: true });
          ws.addEventListener('error', () => reject(new Error('ws error')), { once: true });
        });
        return new CDP(ws);
      }
    } catch {
      // retry until the debugger socket is up
    }
    await sleep(300);
  }
  throw new Error('Timed out waiting for Electron remote debugging endpoint.');
}

async function launch(userDataDir) {
  const child = spawn(ELECTRON, [
    ROOT,
    `--user-data-dir=${userDataDir}`,
    `--remote-debugging-port=${CDP_PORT}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--no-sandbox',
    '--disable-gpu',
  ], {
    cwd: ROOT,
    env: { ...process.env, MYWORKBENCH_UI_URL: `http://127.0.0.1:${uiPort}/` },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stderrTail = '';
  child.stderr.on('data', (chunk) => { stderrTail = (stderrTail + chunk).slice(-4000); });
  const cdp = await connectCDP();
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');
  await cdp.send('Log.enable');
  await cdp.send('Network.enable');
  cdp.on('Runtime.consoleAPICalled', (params) => {
    if (params.type === 'error') consoleIssues.push(params.args.map((a) => a.value ?? a.description ?? '').join(' ').slice(0, 300));
  });
  cdp.on('Log.entryAdded', (params) => {
    if (params.entry.level === 'error') consoleIssues.push((params.entry.text ?? '').slice(0, 300));
  });
  cdp.on('Runtime.exceptionThrown', (params) => {
    consoleIssues.push('exception: ' + (params.exceptionDetails.exception?.description ?? params.exceptionDetails.text ?? '').slice(0, 300));
  });
  return { child, cdp, stderrTail: () => stderrTail };
}

async function stop(child) {
  if (!child || child.exitCode !== null) return;
  child.kill('SIGTERM');
  await new Promise((resolve) => child.once('exit', resolve));
  await sleep(250);
}

async function evaluate(cdp, expression) {
  const result = await cdp.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (result.exceptionDetails) {
    throw new Error('evaluate failed: ' + (result.exceptionDetails.exception?.description ?? result.exceptionDetails.text));
  }
  return result.result.value;
}

async function shot(cdp, name) {
  const { data } = await cdp.send('Page.captureScreenshot', { format: 'png' });
  await writeFile(join(OUT, `${name}.png`), Buffer.from(data, 'base64'));
}

async function setViewport(cdp, width, height = 900) {
  await cdp.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
  await sleep(420);
}

async function overflowCheck(cdp, label) {
  const metrics = await evaluate(cdp, `JSON.stringify({
    innerWidth: window.innerWidth,
    scrollWidth: document.documentElement.scrollWidth,
    innerHeight: window.innerHeight,
    scrollHeight: document.documentElement.scrollHeight,
    bodyScrollWidth: document.body.scrollWidth,
  })`);
  const m = JSON.parse(metrics);
  const horizontalOk = m.scrollWidth <= m.innerWidth + 1 && m.bodyScrollWidth <= m.innerWidth + 1;
  record(`overflow/${label}`, horizontalOk, `inner=${m.innerWidth} scrollW=${m.scrollWidth} bodyW=${m.bodyScrollWidth}`);
  return m;
}

async function widthLoop(cdp, prefix) {
  for (const width of WIDTHS) {
    await setViewport(cdp, width);
    await shot(cdp, `${prefix}-${width}`);
    await overflowCheck(cdp, `${prefix}@${width}`);
  }
}

async function waitForLoad(cdp, timeoutMs = 20000) {
  // The load event can fire before the CDP listener attaches, so poll the
  // document instead of relying on catching the event.
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const state = JSON.parse(await evaluate(cdp, "JSON.stringify({ ready: document.readyState, shell: Boolean(document.querySelector('.cockpit-shell')) })"));
      if (state.ready === 'complete' && state.shell) {
        await sleep(900);
        return;
      }
    } catch {
      // execution context not ready yet
    }
    await sleep(250);
  }
  throw new Error('load timeout');
}

function keyParams(key) {
  const map = { ArrowRight: [39, 'ArrowRight'], ArrowLeft: [37, 'ArrowLeft'], Home: [36, 'Home'], End: [35, 'End'] };
  const [vk, code] = map[key];
  return { key, code, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk };
}
async function pressKey(cdp, key) {
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', ...keyParams(key) });
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', ...keyParams(key) });
  await sleep(120);
}
const selectedName = (cdp) => evaluate(cdp, `document.querySelector('.project-rack')?.getAttribute('aria-activedescendant') ?? null`);

await mkdir(OUT, { recursive: true });

// ================= PHASE A — empty local database =================
console.log('--- phase A: empty state ---');
await rm(EMPTY_DIR, { recursive: true, force: true });
let session = await launch(EMPTY_DIR);
let cdp = session.cdp;
try {
  await waitForLoad(cdp);
  const bodyText = await evaluate(cdp, '(document.body?.innerText ?? "")');
  record('empty/no-indexed-evidence-copy', /尚无已索引的证据/i.test(bodyText), bodyText.replace(/\s+/g, ' ').slice(0, 140));
  await widthLoop(cdp, 'empty');

  // loading surface: heavy throttling keeps requests in flight during reload
  await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 1500, downloadThroughput: 512 * 1024, uploadThroughput: 512 * 1024 });
  await cdp.send('Page.reload', { ignoreCache: true });
  const shellDeadline = Date.now() + 25000;
  let shellSeen = false;
  while (Date.now() < shellDeadline) {
    try {
      if (await evaluate(cdp, "Boolean(document.querySelector('.cockpit-shell'))")) { shellSeen = true; break; }
    } catch { /* context swapping during reload */ }
    await sleep(120);
  }
  if (!shellSeen) throw new Error('shell did not remount under throttle');
  await setViewport(cdp, 1440);
  await shot(cdp, 'empty-loading');
  const loadingText = await evaluate(cdp, '(document.body?.innerText ?? "").replace(/\\s+/g, " ").slice(0, 300)');
  record('empty/loading-surface', /正在加载/i.test(loadingText), loadingText.slice(0, 120));
  await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
  await waitForLoad(cdp);

  // error surface: fail every API-origin request
  const apiOrigin = await evaluate(cdp, 'new URL(location.href).searchParams.get("apiOrigin")');
  record('runtime/api-origin-present', Boolean(apiOrigin), apiOrigin ?? 'missing');
  if (apiOrigin) {
    await cdp.send('Fetch.enable', { patterns: [{ urlPattern: '*', interceptionStage: 'Request' }] });
    const failHandler = async ({ requestId, request }) => {
      if (request.url.startsWith(apiOrigin)) await cdp.send('Fetch.failRequest', { requestId, errorReason: 'Failed' }).catch(() => {});
      else await cdp.send('Fetch.continueRequest', { requestId }).catch(() => {});
    };
    cdp.on('Fetch.requestPaused', failHandler);
    await cdp.send('Page.reload');
    await sleep(1600);
    await shot(cdp, 'empty-error');
    const errorText = await evaluate(cdp, '(document.body?.innerText ?? "").replace(/\\s+/g, " ")');
    record('empty/error-surface', /不可用|重试/i.test(errorText), errorText.slice(0, 160));
    await cdp.send('Fetch.disable');
    await waitForLoad(cdp);
  }
} catch (error) {
  record('phase-A/run', false, String(error));
  console.error(session.stderrTail());
} finally {
  await stop(session.child);
}

// ================= PHASE B — seeded real scan data =================
console.log('--- phase B: seeded real data ---');
session = await launch(DATA_DIR);
cdp = session.cdp;
try {
  await waitForLoad(cdp);
  const dash = await evaluate(cdp, `fetch(new URLSearchParams(location.search).get('apiOrigin') + '/api/dashboard').then((r) => r.json()).then((d) => d.eventCount)`);
  record('runtime/seeded-db-read', typeof dash === 'number' && dash > 0, `eventCount=${dash}`);
  await widthLoop(cdp, 'data');

  // --- keyboard ---
  await setViewport(cdp, 1440);
  await evaluate(cdp, `document.querySelector('.project-rack')?.focus()`);
  const initial = await selectedName(cdp);
  await pressKey(cdp, 'ArrowRight');
  const afterRight = await selectedName(cdp);
  await pressKey(cdp, 'ArrowLeft');
  const afterLeft = await selectedName(cdp);
  await pressKey(cdp, 'End');
  const afterEnd = await selectedName(cdp);
  await pressKey(cdp, 'Home');
  const afterHome = await selectedName(cdp);
  await shot(cdp, 'keyboard-home');
  record('keyboard/arrow-right-moves-selection', Boolean(initial) && afterRight !== initial, `${initial} -> ${afterRight}`);
  record('keyboard/arrow-left-returns', afterLeft === initial, `${afterRight} -> ${afterLeft}`);
  record('keyboard/end-selects-last', Boolean(afterEnd) && afterEnd !== afterHome, `end=${afterEnd}`);
  record('keyboard/home-selects-first', afterHome === initial, `home=${afterHome}`);

  // evidence panel follows selection
  const panelTitle = await evaluate(cdp, `document.querySelector('.evidence-panel h2')?.textContent ?? null`);
  record('rack/evidence-panel-follows-selection', panelTitle === initial?.replace('project-card-', ''), `panel=${panelTitle}`);

  // --- wheel ---
  const rackRect = JSON.parse(await evaluate(cdp, `JSON.stringify(document.querySelector('.project-rack').getBoundingClientRect())`));
  const cx = Math.round(rackRect.x + rackRect.width / 2);
  const cy = Math.round(rackRect.y + rackRect.height / 2);
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: cx, y: cy, deltaX: 0, deltaY: 120 });
  await sleep(150);
  const afterWheelDown = await selectedName(cdp);
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: cx, y: cy, deltaX: 0, deltaY: -120 });
  await sleep(150);
  const afterWheelUp = await selectedName(cdp);
  record('wheel/down-advances', Boolean(afterHome) && afterWheelDown !== afterHome, `${afterHome} -> ${afterWheelDown}`);
  record('wheel/up-retreats', afterWheelUp === afterHome, `${afterWheelDown} -> ${afterWheelUp}`);

  // --- drag (pointer swipe right selects previous) ---
  const beforeDrag = await selectedName(cdp);
  await pressKey(cdp, 'ArrowRight'); // ensure there is a previous slot to move back to
  const dragStart = await selectedName(cdp);
  const startX = cx + 40;
  await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: startX, y: cy, button: 'left', buttons: 1, clickCount: 1 });
  for (let step = 1; step <= 6; step++) {
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: startX + step * 14, y: cy, button: 'left', buttons: 1 });
    await sleep(30);
  }
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: startX + 84, y: cy, button: 'left', buttons: 0, clickCount: 1 });
  await sleep(200);
  const afterDrag = await selectedName(cdp);
  record('drag/swipe-right-selects-previous', afterDrag === beforeDrag, `${dragStart} -> ${afterDrag} (expect ${beforeDrag})`);

  // --- reduced motion ---
  await cdp.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
  await sleep(250);
  const motion = await evaluate(cdp, `JSON.stringify({
    perspective: getComputedStyle(document.querySelector('.project-rack')).perspective,
    currentTransform: getComputedStyle(document.querySelector('.project-card--current')).transform,
  })`);
  const motionValues = JSON.parse(motion);
  record('reduced-motion/perspective-removed', motionValues.perspective === 'none', `perspective=${motionValues.perspective}`);
  record('reduced-motion/card-transform-none', motionValues.currentTransform === 'none', `transform=${motionValues.currentTransform}`);
  await shot(cdp, 'reduced-motion');
  await cdp.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: '' }] });

  // --- long text ---
  await evaluate(cdp, `document.evaluate("//button[contains(., 'quill-notes')]", document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue?.click()`);
  await sleep(350);
  await shot(cdp, 'long-text-evidence');
  await overflowCheck(cdp, 'long-text@1440');
  const longPanel = await evaluate(cdp, `document.querySelector('.evidence-panel h2')?.textContent ?? ''`);
  record('long-text/project-still-selected', longPanel.includes('quill-notes'), `panel=${longPanel}`);

  // --- views ---
  const navButtons = await evaluate(cdp, `document.querySelectorAll('.nav-item').length`);
  record('nav/four-primary-views', navButtons === 4, `count=${navButtons}`);
  for (const [index, view] of [['1', 'content'], ['2', 'quality'], ['3', 'sources']]) {
    await evaluate(cdp, `document.querySelectorAll('.nav-item')[${index}].click()`);
    await sleep(500);
    await shot(cdp, `view-${view}-1440`);
    await setViewport(cdp, 320);
    await shot(cdp, `view-${view}-320`);
    await overflowCheck(cdp, `${view}@320`);
    await setViewport(cdp, 1440);
  }

  // content view search: match + no-results
  await evaluate(cdp, `document.querySelectorAll('.nav-item')[1].click()`);
  await sleep(500);
  const searchSelector = `(document.querySelector('#workspace input[type="search"]') ?? document.querySelector('#workspace input'))?.id ?? null`;
  const searchId = await evaluate(cdp, `(()=>{const el=document.querySelector('#workspace input[type="search"]')??document.querySelector('#workspace input');if(!el)return null;if(!el.id)el.id='acc-search-input';return el.id;})()`);
  void searchSelector;
  if (searchId) {
    await evaluate(cdp, `document.getElementById(${JSON.stringify(searchId)}).focus()`);
    await cdp.send('Input.insertText', { text: 'atlas' });
    await sleep(450);
    await shot(cdp, 'view-content-search-hit');
    await evaluate(cdp, `{const el=document.getElementById(${JSON.stringify(searchId)});const setter=Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,'value').set;setter.call(el,'zzzqqq');el.dispatchEvent(new Event('input',{bubbles:true}));}`);
    await sleep(450);
    await shot(cdp, 'view-content-search-empty');
    const emptyCopy = await evaluate(cdp, 'document.body.innerText.replace(/\\s+/g, " ")');
    record('content/no-results-surface', /没有匹配的已授权内容元数据/i.test(emptyCopy), emptyCopy.match(/当前视图.{0,40}/)?.[0] ?? '');
  } else {
    record('content/search-input-found', false, 'no input rendered');
  }
} catch (error) {
  record('phase-B/run', false, String(error));
  console.error(session.stderrTail());
} finally {
  await stop(session.child);
}

const uniqueIssues = [...new Set(consoleIssues)];
const failures = results.filter((r) => !r.ok);
await writeFile(join(OUT, 'results.json'), JSON.stringify({ results, consoleIssues: uniqueIssues }, null, 2));
console.log(`\n== ${results.length - failures.length}/${results.length} checks passed; ${uniqueIssues.length} console issues ==`);
for (const issue of uniqueIssues.slice(0, 12)) console.log('console:', issue);
process.exitCode = failures.length === 0 ? 0 : 1;
