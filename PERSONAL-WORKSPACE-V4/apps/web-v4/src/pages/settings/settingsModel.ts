import type {
  CreateFolderProfileInput,
  ProfileFolderNodeDraftInput,
  UpdateFolderProfileInput,
} from '@scli/contracts';
import type { FolderProfile, FolderProfileRef, ProjectType } from '@scli/domain';

export interface FolderProfileDraft {
  name: string;
  description: string;
  folders: ProfileFolderNodeDraftInput[];
  outputDefaults: Array<{ outputTypeId: string; destinationPath: string }>;
}

export const blankFolderProfileDraft = (): FolderProfileDraft => ({
  name: '',
  description: '',
  folders: [{ name: 'Project', semanticRole: null, children: [] }],
  outputDefaults: [],
});

function profilePath(profile: FolderProfile, folderId: string): string {
  const byId = new Map(profile.folders.map((folder) => [folder.profileFolderId, folder]));
  const parts: string[] = [];
  let current = byId.get(folderId);
  const visited = new Set<string>();
  while (current && !visited.has(current.profileFolderId)) {
    visited.add(current.profileFolderId);
    parts.unshift(current.name);
    current = current.parentProfileFolderId ? byId.get(current.parentProfileFolderId) : undefined;
  }
  return parts.join('/');
}

export function folderProfileToDraft(profile: FolderProfile): FolderProfileDraft {
  const childrenByParent = new Map<string | null, FolderProfile['folders']>();
  for (const folder of profile.folders) {
    const siblings = childrenByParent.get(folder.parentProfileFolderId) ?? [];
    siblings.push(folder);
    childrenByParent.set(folder.parentProfileFolderId, siblings);
  }
  const build = (parentId: string | null): ProfileFolderNodeDraftInput[] =>
    (childrenByParent.get(parentId) ?? [])
      .toSorted((a, b) => a.displayOrder - b.displayOrder)
      .map((folder) => ({
        profileFolderId: folder.profileFolderId,
        name: folder.name,
        semanticRole: folder.semanticRole,
        children: build(folder.profileFolderId),
      }));
  return {
    name: profile.name,
    description: profile.description ?? '',
    folders: build(null),
    outputDefaults: profile.outputDefaults.map((output) => ({
      outputTypeId: output.outputTypeId,
      destinationPath: profilePath(profile, output.destinationProfileFolderId),
    })),
  };
}

function stripFolderIds(folder: ProfileFolderNodeDraftInput): ProfileFolderNodeDraftInput {
  return {
    name: folder.name,
    semanticRole: folder.semanticRole ?? null,
    children: folder.children.map(stripFolderIds),
  };
}

export function createFolderProfileInput(draft: FolderProfileDraft): CreateFolderProfileInput {
  return {
    name: draft.name.trim(),
    description: draft.description.trim() || null,
    folders: draft.folders.map(stripFolderIds),
    outputDefaults: draft.outputDefaults.map((output) => ({
      outputTypeId: output.outputTypeId.trim(),
      destinationPath: output.destinationPath.trim(),
    })),
  };
}

export function updateFolderProfileInput(draft: FolderProfileDraft): UpdateFolderProfileInput {
  return {
    name: draft.name.trim(),
    description: draft.description.trim() || null,
    folders: draft.folders,
    outputDefaults: draft.outputDefaults.map((output) => ({
      outputTypeId: output.outputTypeId.trim(),
      destinationPath: output.destinationPath.trim(),
    })),
  };
}

export function folderRefValue(ref: FolderProfileRef): string {
  if (ref.kind === 'blank') return 'blank';
  if (ref.kind === 'factory') return `factory:${ref.factoryProfileKey}`;
  return `user:${ref.profileId}`;
}

export function parseFolderRef(value: string): FolderProfileRef {
  if (value === 'blank') return { kind: 'blank' };
  if (value.startsWith('factory:')) {
    return { kind: 'factory', factoryProfileKey: value.slice('factory:'.length) };
  }
  return { kind: 'user', profileId: value.slice('user:'.length) };
}

export function validateProjectTypes(types: ProjectType[]): string | null {
  if (!types.some((type) => type.isActive)) return 'At least one project type must remain active.';
  const names = new Set<string>();
  for (const type of types) {
    const name = type.name.trim().toLocaleLowerCase();
    if (!name) return 'Project type names cannot be empty.';
    if (names.has(name)) return 'Project type names must be unique.';
    names.add(name);
  }
  return null;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1_024) return `${bytes} B`;
  if (bytes < 1_048_576) return `${Math.round(bytes / 1_024)} KB`;
  return `${(bytes / 1_048_576).toFixed(bytes < 10_485_760 ? 1 : 0)} MB`;
}

export function initials(value: string): string {
  return value
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();
}
