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
  { uuid: 'acc-001', created_at: hoursAgo(2), type: 'assistant_message', title: 'Atlas engine: planner cache warmup checkpoint', project: 'atlas-engine' },
  { uuid: 'acc-002', created_at: hoursAgo(5), type: 'tool_use', title: 'Atlas engine: migration dry-run on staging snapshot', project: 'atlas-engine' },
  { uuid: 'acc-003', created_at: hoursAgo(26), type: 'assistant_message', title: 'Beacon dashboard: chart token audit', project: 'beacon-dashboard' },
  { uuid: 'acc-004', created_at: hoursAgo(50), type: 'assistant_message', title: longTitle, project: 'quill-notes' },
  'this line is intentionally malformed',
  { uuid: 'acc-005', created_at: hoursAgo(96), type: 'tool_use', title: 'Quill notes: sync conflict rehearsal', project: 'quill-notes' },
];

const codexRows: unknown[] = [
  { id: 'cod-001', timestamp: hoursAgo(3), event_type: 'session_completed', summary: 'Atlas engine: retry budget instrumentation', cwd: 'atlas-engine' },
  { id: 'cod-002', timestamp: hoursAgo(30), event_type: 'tool_call', summary: 'Beacon dashboard: alert rule lint pass', cwd: 'beacon-dashboard' },
  'this line is intentionally malformed',
  { id: 'cod-003', timestamp: hoursAgo(120), event_type: 'session_completed', summary: 'Beacon dashboard: dark shelf contrast sweep', cwd: 'beacon-dashboard' },
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
