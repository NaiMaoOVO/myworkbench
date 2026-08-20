const loopbackHosts = new Set(['127.0.0.1', '::1', 'localhost']);

export function trustedUiUrl(value: string): URL {
  const url = new URL(value);
  if (url.protocol !== 'http:' || !loopbackHosts.has(url.hostname)) {
    throw new Error('MyWorkbench UI must be served from a loopback HTTP origin.');
  }
  return url;
}
