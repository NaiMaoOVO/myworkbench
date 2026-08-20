import { describe, expect, it } from 'vitest';
import { trustedUiUrl } from '../src/platform/trusted-ui-url.js';

describe('trusted desktop UI origin', () => {
  it('accepts loopback development UI origins', () => {
    expect(trustedUiUrl('http://127.0.0.1:5173/').origin).toBe('http://127.0.0.1:5173');
  });

  it('rejects non-loopback and non-http origins before renderer IPC is exposed', () => {
    expect(() => trustedUiUrl('https://example.test/')).toThrow('loopback');
    expect(() => trustedUiUrl('file:///tmp/index.html')).toThrow('loopback');
  });
});
