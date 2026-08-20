import { cp, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { WorkbenchSourceService } from '../src/core/source-service.js';

let service: WorkbenchSourceService | undefined;

afterEach(() => service?.close());

describe('desktop source authorization service', () => {
  it('uses a one-time opaque selection handle for grant → preview → scan → revoke → delete', async () => {
    const root = await mkdtemp(join(tmpdir(), 'mw-source-service-'));
    const fixtureRoot = join(root, 'fixture');
    await cp('fixtures/anonymous/exports', fixtureRoot, { recursive: true });
    service = new WorkbenchSourceService(join(root, 'workbench.sqlite'));

    const handle = await service.createSelection('exports-compat', fixtureRoot);
    expect(handle).not.toContain(fixtureRoot);
    await expect(service.previewSelection('exports-compat', handle, 'metadata')).resolves.toMatchObject({ estimatedRecords: 2 });
    await expect(service.grant('exports-compat', handle, 'metadata')).resolves.toMatchObject({ sourceId: 'exports-compat', scope: 'metadata' });
    expect(JSON.stringify(service.list())).not.toContain(fixtureRoot);
    await expect(service.grant('exports-compat', handle, 'metadata')).rejects.toThrow('selected folder');
    await expect(service.preview('exports-compat')).resolves.toMatchObject({ estimatedRecords: 2 });
    await expect(service.scan('exports-compat')).resolves.toMatchObject({ status: 'partial', parsed: 2, failed: 1 });
    service.revoke('exports-compat');
    await expect(service.preview('exports-compat')).rejects.toThrow('active source authorization');
    service.deleteIndex('exports-compat');
  });

  it('does not create a selection for an unavailable adapter', async () => {
    const root = await mkdtemp(join(tmpdir(), 'mw-source-service-'));
    service = new WorkbenchSourceService(join(root, 'workbench.sqlite'));
    await expect(service.createSelection('openclaw', root)).rejects.toThrow('not available');
    expect(service.list()).toEqual(expect.arrayContaining([expect.objectContaining({ id: 'openclaw', state: 'unsupported' })]));
  });
});
