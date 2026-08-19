import { readdir, readFile, stat } from 'node:fs/promises';
import { basename, join, relative, sep } from 'node:path';
import type { AdapterHealth, AuthorizationGrant, CandidateLocation, Diagnostic, NormalizedRecord, PlatformContext, RawRecord, ScanPreview, ScanRecord, SourceAdapter, SourceManifest } from '../core/types.js';
import { assertPathWithinGrant } from '../platform/path-policy.js';

const sourceId = 'obsidian';
const ignoredDirectories = new Set(['.obsidian', '.git', 'node_modules']);

async function* markdownFiles(root: string, directory = root): AsyncIterable<string> {
  const entries = await readdir(directory, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.isSymbolicLink()) continue;
    const file = join(directory, entry.name);
    if (entry.isDirectory()) {
      if (!ignoredDirectories.has(entry.name)) yield* markdownFiles(root, file);
      continue;
    }
    if (entry.isFile() && entry.name.toLowerCase().endsWith('.md')) yield file;
  }
}

function toRaw(root: string, file: string, details: Awaited<ReturnType<typeof stat>>, body?: string): RawRecord {
  const relativePath = relative(root, file).split(sep).join('/');
  return {
    id: relativePath,
    time: details.mtime.toISOString(),
    type: 'note_modified',
    title: basename(file, '.md'),
    workspace: basename(root),
    body,
    locator: relativePath,
  };
}

export class ObsidianAdapter implements SourceAdapter {
  manifest(): SourceManifest {
    return { id: sourceId, displayName: 'Obsidian', version: '1.0.0', supportedPlatforms: ['darwin', 'win32', 'linux'], supportsBodies: true };
  }

  async discover(_platform: PlatformContext): Promise<CandidateLocation[]> {
    return [];
  }

  async preview(grant: AuthorizationGrant): Promise<ScanPreview> {
    const root = await assertPathWithinGrant(grant.root, grant.root);
    let estimatedRecords = 0;
    const times: string[] = [];
    for await (const file of markdownFiles(root)) {
      const details = await stat(file);
      estimatedRecords += 1;
      const timestamp = details.mtime.toISOString();
      times.push(timestamp);
    }
    times.sort();
    return { estimatedRecords, earliest: times.at(0) ?? null, latest: times.at(-1) ?? null, excluded: ['Markdown body is excluded until Obsidian body permission is enabled.', '.obsidian, .git and node_modules directories are excluded.'] };
  }

  async *scan(grant: AuthorizationGrant, _cursor?: string): AsyncIterable<ScanRecord> {
    const root = await assertPathWithinGrant(grant.root, grant.root);
    for await (const unverifiedFile of markdownFiles(root)) {
      try {
        const file = await assertPathWithinGrant(root, unverifiedFile);
        const details = await stat(file);
        const body = grant.scope === 'metadata_and_body' ? await readFile(file, 'utf8') : undefined;
        yield { kind: 'record', value: toRaw(root, file, details, body) };
      } catch {
        const diagnostic: Diagnostic = {
          sourceId,
          code: 'OBSIDIAN_NOTE_UNAVAILABLE',
          severity: 'warning',
          safeMessage: 'An authorized note could not be read and was skipped.',
          createdAt: new Date().toISOString(),
        };
        yield { kind: 'diagnostic', value: diagnostic };
      }
    }
  }

  normalize(raw: RawRecord): NormalizedRecord {
    return { id: `${sourceId}:${raw.id}`, sourceId, occurredAt: raw.time, type: raw.type, title: raw.title, workspace: raw.workspace ?? null, body: raw.body ?? null, locator: raw.locator, factLevel: 'observed' };
  }

  redact(record: NormalizedRecord, scope: AuthorizationGrant['scope']): NormalizedRecord {
    return { ...record, body: scope === 'metadata_and_body' ? record.body : null };
  }

  async health(): Promise<AdapterHealth> {
    return { state: 'ready' };
  }

  async migrate(_fromVersion: string): Promise<void> {}
}
