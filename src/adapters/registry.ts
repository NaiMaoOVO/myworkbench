import { ClaudeAdapter } from './claude-adapter.js';
import { CodexAdapter } from './codex-adapter.js';
import { ExportsCompatibilityAdapter } from './exports-adapter.js';
import { GeminiAdapter } from './gemini-adapter.js';
import { GitAdapter } from './git-adapter.js';
import { HermesAdapter } from './hermes-adapter.js';
import { IFlowAdapter } from './iflow-adapter.js';
import { KimiCodeAdapter } from './kimi-code-adapter.js';
import { ObsidianAdapter } from './obsidian-adapter.js';
import { OpenClawAdapter } from './openclaw-adapter.js';
import { ZCodeAdapter } from './zcode-adapter.js';
import type { SourceAdapter } from '../core/types.js';

export function createAdapters(): SourceAdapter[] {
  return [
    new ExportsCompatibilityAdapter(),
    new ObsidianAdapter(),
    new GitAdapter(),
    new CodexAdapter(),
    new ClaudeAdapter(),
    new IFlowAdapter(),
    new ZCodeAdapter(),
    new KimiCodeAdapter(),
    new GeminiAdapter(),
    new HermesAdapter(),
    new OpenClawAdapter(),
  ];
}
