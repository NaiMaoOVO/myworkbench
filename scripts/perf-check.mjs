#!/usr/bin/env node
// PRD 16.1 性能验证：10 万条元数据的本地 API 响应时间（进程内调度，与生产同一代码路径）。
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LocalApiServer } from '../src/local-api/server.js';

const TARGET = Number(process.env.PERF_ROWS ?? 100000);
const SAMPLES = Number(process.env.PERF_SAMPLES ?? 120);

const sources = ['claude', 'codex', 'zcode', 'gemini', 'git', 'obsidian', 'exports-compat', 'iflow', 'kimi-code', 'hermes', 'openclaw'];
const types = ['session_completed', 'model_io', 'tool_call', 'note_updated', 'commit_pushed', 'assistant_message'];

console.log('生成 ' + TARGET + ' 条合成事件…');
const t0 = Date.now();
const root = await mkdtemp(join(tmpdir(), 'mw-perf-'));
const api = new LocalApiServer({ databasePath: join(root, 'perf.sqlite'), appOrigin: 'http://127.0.0.1:1' });
const db = api.runtime.database;
const generate = () => {
  const rows = [];
  for (let index = 0; index < TARGET; index += 1) {
    const sourceId = sources[index % sources.length];
    const occurredAt = new Date(Date.now() - (index % 90) * 86400000 - (index % 86400000)).toISOString();
    rows.push({
      id: 'perf-' + index,
      sourceId,
      occurredAt,
      type: types[index % types.length],
      title: 'Perf 样例标题 #' + index,
      workspace: 'workspace-' + (index % 40),
      body: null,
      locator: String(index),
      factLevel: 'observed',
    });
    if (rows.length === 5000) { db.transaction(() => db.insertEventsBulk(rows)); rows.length = 0; }
  }
  if (rows.length) db.transaction(() => db.insertEventsBulk(rows));
};
generate();
console.log('生成完成 ' + (Date.now() - t0) + 'ms');

async function bench(name, path, samples) {
  const times = [];
  for (let index = 0; index < samples; index += 1) {
    const start = process.hrtime.bigint();
    const response = await api.request({ method: 'GET', url: path });
    const ms = Number(process.hrtime.bigint() - start) / 1e6;
    if (response.status !== 200) throw new Error(name + ' -> ' + response.status);
    times.push(ms);
  }
  times.sort((a, b) => a - b);
  const p95 = times[Math.floor(times.length * 0.95)] ?? times[times.length - 1];
  const p50 = times[Math.floor(times.length * 0.5)];
  console.log(name.padEnd(16) + ' p50=' + p50.toFixed(1) + 'ms p95=' + p95.toFixed(1) + 'ms max=' + times[times.length - 1].toFixed(1) + 'ms');
  return p95;
}

console.log('--- 预热后采样 ' + SAMPLES + ' 次 ---');
let worst = 0;
worst = Math.max(worst, await bench('/api/dashboard', '/api/dashboard', SAMPLES));
worst = Math.max(worst, await bench('/api/heatmap', '/api/heatmap', SAMPLES));
worst = Math.max(worst, await bench('/api/events', '/api/events', SAMPLES));
worst = Math.max(worst, await bench('/api/projects', '/api/projects', SAMPLES));
worst = Math.max(worst, await bench('/api/content', '/api/content?q=perf', SAMPLES));
worst = Math.max(worst, await bench('/api/quality', '/api/quality', SAMPLES));
console.log('最慢端点 p95 = ' + worst.toFixed(1) + 'ms（目标 ≤200ms）→ ' + (worst <= 200 ? '达标' : '未达标'));
const rss = process.memoryUsage().rss / 1048576;
console.log('RSS = ' + rss.toFixed(0) + 'MB');
await api.stop();