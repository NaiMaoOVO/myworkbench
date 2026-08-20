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
        revoke(sourceId: string): Promise<{ ok: boolean; error?: string }>;
        deleteIndex(sourceId: string): Promise<{ ok: boolean; error?: string }>;
      };
    };
  }
}
