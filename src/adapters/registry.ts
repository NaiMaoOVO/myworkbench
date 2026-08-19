import { ClaudeAdapter } from './claude-adapter.js';
import { CodexAdapter } from './codex-adapter.js';
import { ExportsCompatibilityAdapter } from './exports-adapter.js';
import { GitAdapter } from './git-adapter.js';
import { ObsidianAdapter } from './obsidian-adapter.js';
import { UnavailableAdapter } from './unavailable-adapter.js';
import type { SourceAdapter } from '../core/types.js';

const unsupported = (id: string, displayName: string): UnavailableAdapter => new UnavailableAdapter({
  id,
  displayName,
  version: '0.0.0',
  supportedPlatforms: ['darwin', 'win32', 'linux'],
  supportsBodies: true,
});

export function createAdapters(): SourceAdapter[] {
  return [
    new ExportsCompatibilityAdapter(),
    new ObsidianAdapter(),
    new GitAdapter(),
    new CodexAdapter(),
    new ClaudeAdapter(),
    unsupported('iflow', 'iFlow'),
    unsupported('zcode', 'ZCode'),
    unsupported('kimi-code', 'Kimi Code'),
    unsupported('gemini', 'Gemini'),
    unsupported('hermes', 'Hermes'),
    unsupported('openclaw', 'OpenClaw'),
  ];
}
