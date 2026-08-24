import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { WorkbenchSourceService } from '../../src/core/source-service.js';

const userDataDir = process.argv[2];
if (!userDataDir) throw new Error('usage: tsx scripts/acceptance/seed.mts <user-data-dir>');

const fixturesRoot = join(process.cwd(), '.mw-local', 'acceptance-fixtures');
const now = Date.now();
const hoursAgo = (hours: number): string => new Date(now - hours * 3_600_000).toISOString();

const longTitle =
  'Quarterly reliability retrospective: cascading retry storm postmortem, capacity model refresh, ' +
  'and the long tail of regional failover drills across three cloud regions and two on-call rotations';

const claudeRows: unknown[] = [
  { parentUuid: null, type: 'user', message: { role: 'user', content: longTitle }, uuid: 'acc-001', timestamp: hoursAgo(2), cwd: '/repo/atlas-engine', sessionId: 'sess-atlas' },
  { parentUuid: null, type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: 'Planner cache warmup checkpoint 已完成。' }] }, uuid: 'acc-002', timestamp: hoursAgo(5), cwd: '/repo/atlas-engine', sessionId: 'sess-atlas' },
  { parentUuid: null, type: 'user', message: { role: 'user', content: 'Beacon dashboard 图表 token 审查请求。' }, uuid: 'acc-003', timestamp: hoursAgo(26), cwd: '/repo/beacon-dashboard', sessionId: 'sess-beacon' },
  { parentUuid: null, type: 'user', message: { role: 'user', content: longTitle }, uuid: 'acc-004', timestamp: hoursAgo(50), cwd: '/repo/quill-notes', sessionId: 'sess-quill' },
  'this line is intentionally malformed',
  { parentUuid: null, type: 'tool_use', message: { role: 'assistant', content: [{ type: 'tool_use', name: 'shell', input: {} }] }, uuid: 'acc-005', timestamp: hoursAgo(96), cwd: '/repo/quill-notes', sessionId: 'sess-quill' },
];

const codexRows: unknown[] = [
  { timestamp: hoursAgo(3), type: 'session_meta', payload: { session_id: 'sess-codex-atlas', id: 'meta-atlas', cwd: '/repo/atlas-engine', cli_version: '0.42.0' } },
  { timestamp: hoursAgo(2), type: 'response_item', payload: { type: 'message', id: 'ri-cod-001', role: 'assistant', content: [{ type: 'text', text: 'Atlas engine: retry budget instrumentation' }] } },
  { timestamp: hoursAgo(30), type: 'response_item', payload: { type: 'message', id: 'ri-cod-002', role: 'user', content: [{ type: 'text', text: 'Beacon dashboard: alert rule lint pass' }] } },
  'this line is intentionally malformed',
  { timestamp: hoursAgo(120), type: 'event_msg', payload: { type: 'task_complete', turn_id: 'turn-cod-1', last_agent_message: 'Beacon dashboard: dark shelf contrast sweep 完成', duration_ms: 25 * 60000 } },
];

const exportRows: unknown[] = [
  { id: 'exp-001', time: hoursAgo(1), type: 'note_updated', title: 'Atlas engine: incident note trimmed', workspace: 'atlas-engine' },
  { id: 'exp-002', time: hoursAgo(8), type: 'note_created', title: 'Quill notes: acceptance checklist draft', workspace: 'quill-notes' },
  { id: 'exp-003', time: hoursAgo(74), type: 'note_updated', title: 'Beacon dashboard: metric glossary', workspace: 'beacon-dashboard' },
];

rmSync(fixturesRoot, { recursive: true, force: true });
const writeJsonl = (dir: string, name: string, rows: unknown[]): void => {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, name), rows.map((row) => (typeof row === 'string' ? row : JSON.stringify(row))).join('\n') + '\n');
};
writeJsonl(join(fixturesRoot, 'claude'), 'claude.jsonl', claudeRows);
writeJsonl(join(fixturesRoot, 'codex'), 'codex.jsonl', codexRows);
writeJsonl(join(fixturesRoot, 'exports'), 'exports.jsonl', exportRows);

mkdirSync(userDataDir, { recursive: true });
const dbPath = join(userDataDir, 'workbench.sqlite');
const service = new WorkbenchSourceService(dbPath);
try {
  const grants: Array<[string, string]> = [
    ['claude', join(fixturesRoot, 'claude')],
    ['codex', join(fixturesRoot, 'codex')],
    ['exports-compat', join(fixturesRoot, 'exports')],
  ];
  for (const [sourceId, root] of grants) {
    const handle = await service.createSelection(sourceId, root);
    await service.grant(sourceId, handle, 'metadata');
    const summary = await service.scan(sourceId);
    console.log(`${sourceId}: ${summary.status} parsed=${summary.parsed} failed=${summary.failed}`);
  }
  console.log('SEEDED', dbPath);
} finally {
  service.close();
}
