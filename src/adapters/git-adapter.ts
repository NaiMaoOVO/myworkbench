import { promisify } from 'node:util';
import { execFile as execFileCallback } from 'node:child_process';
import { basename } from 'node:path';
import type { AdapterHealth, AuthorizationGrant, CandidateLocation, Diagnostic, NormalizedRecord, PlatformContext, RawRecord, ScanPreview, ScanRecord, SourceAdapter, SourceManifest } from '../core/types.js';
import { assertPathWithinGrant } from '../platform/path-policy.js';

const execFile = promisify(execFileCallback);
const sourceId = 'git';

interface Commit {
  id: string;
  time: string;
  author: string;
  subject: string;
}

async function git(cwd: string, args: string[]): Promise<string> {
  const { stdout } = await execFile('git', args, { cwd, encoding: 'utf8', maxBuffer: 2 * 1024 * 1024 });
  return stdout;
}

async function repositoryRoot(grant: AuthorizationGrant): Promise<string> {
  const root = await assertPathWithinGrant(grant.root, grant.root);
  const candidate = (await git(root, ['rev-parse', '--show-toplevel'])).trim();
  return assertPathWithinGrant(root, candidate);
}

async function commits(root: string): Promise<Commit[]> {
  const output = await git(root, ['log', '--format=%H%x1f%cI%x1f%an%x1f%s%x1e', '--max-count=1000']);
  return output.split('\x1e').filter(Boolean).flatMap((entry) => {
    const [id, time, author, subject] = entry.replace(/^\n/, '').split('\x1f');
    if (!id || !time || !author || subject === undefined || Number.isNaN(Date.parse(time))) return [];
    return [{ id, time, author, subject }];
  });
}

export class GitAdapter implements SourceAdapter {
  manifest(): SourceManifest {
    return { id: sourceId, displayName: 'Git repositories', version: '1.0.0', supportedPlatforms: ['darwin', 'win32', 'linux'], supportsBodies: false };
  }

  async discover(_platform: PlatformContext): Promise<CandidateLocation[]> {
    return [];
  }

  async preview(grant: AuthorizationGrant): Promise<ScanPreview> {
    const root = await repositoryRoot(grant);
    const records = await commits(root);
    const dates = records.map((record) => record.time).sort();
    return { estimatedRecords: records.length, earliest: dates.at(0) ?? null, latest: dates.at(-1) ?? null, excluded: ['Source file bodies, diffs, remotes and credentials are not read.'] };
  }

  async *scan(grant: AuthorizationGrant, _cursor?: string): AsyncIterable<ScanRecord> {
    try {
      const root = await repositoryRoot(grant);
      for (const commit of await commits(root)) {
        yield {
          kind: 'record',
          value: {
            id: commit.id,
            time: commit.time,
            type: 'git_commit',
            title: commit.subject,
            workspace: basename(root),
            locator: commit.id,
          },
        };
      }
    } catch {
      const diagnostic: Diagnostic = {
        sourceId,
        code: 'GIT_REPOSITORY_UNAVAILABLE',
        severity: 'error',
        safeMessage: 'The granted folder is not an accessible Git repository.',
        createdAt: new Date().toISOString(),
      };
      yield { kind: 'diagnostic', value: diagnostic };
    }
  }

  normalize(raw: RawRecord): NormalizedRecord {
    return { id: `${sourceId}:${raw.id}`, sourceId, occurredAt: raw.time, type: raw.type, title: raw.title, workspace: raw.workspace ?? null, body: null, locator: raw.locator, factLevel: 'observed' };
  }

  redact(record: NormalizedRecord, _scope: AuthorizationGrant['scope']): NormalizedRecord {
    return { ...record, body: null };
  }

  async health(): Promise<AdapterHealth> {
    return { state: 'ready' };
  }

  async migrate(_fromVersion: string): Promise<void> {}
}
