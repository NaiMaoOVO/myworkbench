import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

export interface DiscoveredCandidate {
  sourceId: string;
  path: string;
  exists: boolean;
}

// Version-tolerant candidate rules. These are hints only — never a product
// contract — and every entry reports mere existence, no content reads.
const candidatesBySource: Record<string, string[]> = {
  claude: ['~/.claude/projects', '~/.claude'],
  codex: ['~/.codex/sessions', '~/.codex'],
  gemini: ['~/.gemini/tmp', '~/.gemini'],
  iflow: ['~/.iflow/session', '~/.iflow/tmp', '~/.iflow'],
  zcode: ['~/.zcode/cli/rollout', '~/.zcode'],
  'kimi-code': ['~/.kimi/sessions', '~/.kimi'],
  hermes: ['~/.hermes/sessions', '~/.hermes'],
  openclaw: ['~/.openclaw/sessions', '~/.openclaw'],
};

export function discoverCandidates(): DiscoveredCandidate[] {
  const home = homedir();
  const out: DiscoveredCandidate[] = [];
  for (const [sourceId, patterns] of Object.entries(candidatesBySource)) {
    for (const pattern of patterns) {
      const path = join(home, pattern.replace(/^~\/?/, ''));
      out.push({ sourceId, path, exists: existsSync(path) });
    }
  }
  return out;
}
