import { realpath } from 'node:fs/promises';
import { isAbsolute, relative, resolve } from 'node:path';

export class GrantBoundaryError extends Error {
  constructor() {
    super('The requested location is outside the authorized directory.');
    this.name = 'GrantBoundaryError';
  }
}

function isInside(root: string, candidate: string): boolean {
  const distance = relative(root, candidate);
  return distance === '' || (!distance.startsWith('..') && !isAbsolute(distance));
}

export async function canonicalizeExistingPath(value: string): Promise<string> {
  return realpath(resolve(value));
}

export async function canonicalizeGrantRoot(root: string): Promise<string> {
  return canonicalizeExistingPath(root);
}

export async function assertPathWithinGrant(root: string, candidate: string): Promise<string> {
  const [canonicalRoot, canonicalCandidate] = await Promise.all([
    canonicalizeExistingPath(root),
    canonicalizeExistingPath(candidate),
  ]);

  if (!isInside(canonicalRoot, canonicalCandidate)) {
    throw new GrantBoundaryError();
  }

  return canonicalCandidate;
}
