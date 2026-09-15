import { lstat, realpath } from 'node:fs/promises';
import path from 'node:path';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function contextInboxPath(dataRoot: string, toolContextId: string): string {
  if (!UUID.test(toolContextId)) throw new Error('Tool Context ID must be a UUID.');
  return path.join(dataRoot, 'automation-sessions', toolContextId, 'inbox');
}

export async function validateContextInboxCandidate(
  dataRoot: string,
  toolContextId: string,
  candidate: string,
): Promise<string | null> {
  const inbox = contextInboxPath(dataRoot, toolContextId);
  try {
    const inboxMetadata = await lstat(inbox);
    if (!inboxMetadata.isDirectory() || inboxMetadata.isSymbolicLink()) return null;
    const candidateMetadata = await lstat(candidate);
    if (!candidateMetadata.isFile() || candidateMetadata.isSymbolicLink()) return null;
    const realInbox = await realpath(inbox);
    const realCandidate = await realpath(candidate);
    const relative = path.relative(realInbox, realCandidate);
    if (
      !relative ||
      relative === '..' ||
      relative.startsWith(`..${path.sep}`) ||
      path.isAbsolute(relative) ||
      path.dirname(relative) !== '.'
    ) {
      return null;
    }
    return realCandidate;
  } catch {
    return null;
  }
}
