export const scanStatuses = ['success', 'partial', 'blocked', 'cancelled'] as const;
export type ScanStatus = (typeof scanStatuses)[number];

export const sourceStates = ['undiscovered', 'awaiting_authorization', 'ready', 'scanning', 'partial', 'blocked', 'unsupported'] as const;
export type SourceState = (typeof sourceStates)[number];

export type ContentScope = 'metadata' | 'metadata_and_body';
export type FactLevel = 'observed' | 'derived' | 'suggested' | 'confirmed';

export interface AuthorizationGrant {
  sourceId: string;
  root: string;
  scope: ContentScope;
  grantedAt: string;
  revokedAt: string | null;
  lastUsedAt: string | null;
}

export interface Diagnostic {
  sourceId: string;
  code: string;
  severity: 'info' | 'warning' | 'error';
  safeMessage: string;
  createdAt: string;
}

export interface SourceManifest {
  id: string;
  displayName: string;
  version: string;
  supportedPlatforms: Array<'darwin' | 'win32' | 'linux'>;
  supportsBodies: boolean;
}

export interface CandidateLocation {
  path: string;
  exists: boolean;
  reason: string;
}

export interface ScanPreview {
  estimatedRecords: number;
  earliest: string | null;
  latest: string | null;
  excluded: string[];
}

export interface RawRecord {
  id: string;
  time: string;
  type: string;
  title: string;
  workspace?: string;
  body?: string;
  locator: string;
}

export interface NormalizedRecord {
  id: string;
  sourceId: string;
  occurredAt: string;
  type: string;
  title: string;
  workspace: string | null;
  body: string | null;
  locator: string;
  factLevel: FactLevel;
}

export type ScanRecord =
  | { kind: 'record'; value: RawRecord }
  | { kind: 'diagnostic'; value: Diagnostic };

export interface AdapterHealth {
  state: 'ready' | 'partial' | 'blocked' | 'unsupported';
  detail?: string;
}

export interface PlatformContext {
  platform: NodeJS.Platform;
}

export interface AdapterFileState {
  mtimeMs: number;
  size: number;
}

export interface AdapterScanContext {
  previousFileState(key: string): AdapterFileState | null;
  recordFileState(key: string, locatorHash: string, state: AdapterFileState): void;
  deleteRecordsForLocator(sourceId: string, locatorHash: string): void;
  forgetFileStatesExcept(sourceId: string, keepKeys: string[]): void;
}

export interface SourceAdapter {
  manifest(): SourceManifest;
  discover(platform: PlatformContext): Promise<CandidateLocation[]>;
  preview(grant: AuthorizationGrant): Promise<ScanPreview>;
  scan(grant: AuthorizationGrant, cursor?: string, context?: AdapterScanContext): AsyncIterable<ScanRecord>;
  normalize(raw: RawRecord): NormalizedRecord;
  redact(record: NormalizedRecord, scope: ContentScope): NormalizedRecord;
  health(): Promise<AdapterHealth>;
  migrate(fromVersion: string): Promise<void>;
}

export interface ScanSummary {
  id: string;
  sourceId: string;
  status: ScanStatus;
  startedAt: string;
  endedAt: string | null;
  parsed: number;
  failed: number;
}
