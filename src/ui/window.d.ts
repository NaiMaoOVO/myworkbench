export {};

declare global {
  interface Window {
    myWorkbench?: {
      platform: string;
      sources: {
        list(): Promise<{ ok: boolean; sources?: unknown[]; error?: string }>;
        chooseDirectory(sourceId: string): Promise<{ ok: boolean; cancelled?: boolean; selectionHandle?: string; error?: string }>;
        previewSelection(sourceId: string, selectionHandle: string, scope: 'metadata' | 'metadata_and_body'): Promise<{ ok: boolean; value?: unknown; error?: string }>;
        grant(sourceId: string, selectionHandle: string, scope: 'metadata' | 'metadata_and_body'): Promise<{ ok: boolean; error?: string }>;
        preview(sourceId: string): Promise<{ ok: boolean; value?: unknown; error?: string }>;
        scan(sourceId: string): Promise<{ ok: boolean; value?: unknown; error?: string }>;
        cancelScan(sourceId: string): Promise<{ ok: boolean; error?: string }>;
        revoke(sourceId: string): Promise<{ ok: boolean; error?: string }>;
        deleteIndex(sourceId: string): Promise<{ ok: boolean; error?: string }>;
        revealDirectory(sourceId: string): Promise<{ ok: boolean; error?: string }>;
        discoverCandidates(): Promise<{ ok: boolean; value?: Array<{ sourceId: string; path: string; exists: boolean }>; error?: string }>;
        grantDirectory(sourceId: string, root: string, scope: 'metadata' | 'metadata_and_body'): Promise<{ ok: boolean; error?: string }>;
      };
      settings: {
        get(): Promise<{ ok: boolean; value?: Record<string, string>; error?: string }>;
        set(key: string, value: string): Promise<{ ok: boolean; error?: string }>;
      };
      sync: {
        status(): Promise<{ ok: boolean; value?: { running: boolean; lastSyncAt: string | null; lastError: string | null }; error?: string }>;
        runNow(): Promise<{ ok: boolean; value?: Array<{ sourceId: string; status: string; parsed: number; failed: number }>; error?: string }>;
      };
    };
  }
}
