import { projectBrowseStateSchema, type ProjectBrowseState } from '@scli/contracts';

const key = (ownerId: string) => `scli.v4.projects.browse.${ownerId}`;
export function readProjectBrowse(ownerId?: string): ProjectBrowseState | null {
  if (!ownerId) return null;
  try {
    const result = projectBrowseStateSchema.safeParse(
      JSON.parse(window.localStorage.getItem(key(ownerId)) ?? 'null'),
    );
    return result.success ? result.data : null;
  } catch {
    return null;
  }
}
export function writeProjectBrowse(ownerId: string | undefined, input: unknown): void {
  if (!ownerId) return;
  const result = projectBrowseStateSchema.safeParse(input);
  if (!result.success) return;
  try {
    window.localStorage.setItem(key(ownerId), JSON.stringify(result.data));
  } catch {
    /* A restricted browser must still allow filtering and navigation. */
  }
}
