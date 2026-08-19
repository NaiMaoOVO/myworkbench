import type { AdapterHealth, AuthorizationGrant, CandidateLocation, Diagnostic, NormalizedRecord, PlatformContext, RawRecord, ScanPreview, ScanRecord, SourceAdapter, SourceManifest } from '../core/types.js';

export class UnavailableAdapter implements SourceAdapter {
  constructor(private readonly descriptor: SourceManifest) {}

  manifest(): SourceManifest {
    return this.descriptor;
  }

  async discover(_platform: PlatformContext): Promise<CandidateLocation[]> {
    return [];
  }

  async preview(_grant: AuthorizationGrant): Promise<ScanPreview> {
    return { estimatedRecords: 0, earliest: null, latest: null, excluded: ['This adapter is not available in the current build.'] };
  }

  async *scan(_grant: AuthorizationGrant, _cursor?: string): AsyncIterable<ScanRecord> {
    const diagnostic: Diagnostic = {
      sourceId: this.descriptor.id,
      code: 'ADAPTER_NOT_AVAILABLE',
      severity: 'warning',
      safeMessage: `${this.descriptor.displayName} is not available in this build.`,
      createdAt: new Date().toISOString(),
    };
    yield { kind: 'diagnostic', value: diagnostic };
  }

  normalize(raw: RawRecord): NormalizedRecord {
    return { id: `${this.descriptor.id}:${raw.id}`, sourceId: this.descriptor.id, occurredAt: raw.time, type: raw.type, title: raw.title, workspace: raw.workspace ?? null, body: null, locator: raw.locator, factLevel: 'observed' };
  }

  redact(record: NormalizedRecord, _scope: AuthorizationGrant['scope']): NormalizedRecord {
    return { ...record, body: null };
  }

  async health(): Promise<AdapterHealth> {
    return { state: 'unsupported', detail: 'Adapter is not available in this build.' };
  }

  async migrate(_fromVersion: string): Promise<void> {}
}
