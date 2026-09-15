import type { FolderNodePreset, FolderProfilePreset, ProjectFolderDraft } from '@scli/domain';
import { addBusinessCalendarDays, businessTodayKey } from '../../date-time/businessDateTime';

export type FolderMode = 'Create' | 'Connect' | 'Later';
export { parseCommercialValue } from '../../components/project/projectFormModel';

export function todayInDubai(now = new Date()): string {
  return businessTodayKey(now);
}

export function defaultDeliveryDate(now = new Date()): string {
  return addBusinessCalendarDays(businessTodayKey(now), 14);
}

export function draftFromPreset(preset: FolderProfilePreset): ProjectFolderDraft {
  const folders: ProjectFolderDraft['folders'] = [];
  const pathIds = new Map<string, string>();
  const visit = (nodes: FolderNodePreset[], parentId: string | null, parentPath: string) => {
    nodes.forEach((node, index) => {
      const id = crypto.randomUUID();
      const path = parentPath ? `${parentPath}/${node.name}` : node.name;
      pathIds.set(path.toLowerCase(), id);
      folders.push({
        draftFolderId: id,
        parentDraftFolderId: parentId,
        name: node.name,
        displayOrder: index,
      });
      visit(node.children, id, path);
    });
  };
  visit(preset.folders, null, '');
  const outputMappings = Object.entries(preset.outputFolders).flatMap(([outputTypeId, path]) => {
    const destinationDraftFolderId = pathIds.get(path.toLowerCase());
    return destinationDraftFolderId ? [{ outputTypeId, destinationDraftFolderId }] : [];
  });
  return { folders, outputMappings, sourceProfile: null };
}

export function folderPath(draft: ProjectFolderDraft, id: string): string {
  const byId = new Map(draft.folders.map((folder) => [folder.draftFolderId, folder]));
  const names: string[] = [];
  let current = byId.get(id);
  while (current) {
    names.unshift(current.name);
    current = current.parentDraftFolderId ? byId.get(current.parentDraftFolderId) : undefined;
  }
  return names.join('/');
}

export function profileCreateBody(draft: ProjectFolderDraft, name: string) {
  const children = (parent: string | null): FolderNodePreset[] =>
    draft.folders
      .filter((folder) => folder.parentDraftFolderId === parent)
      .sort((a, b) => a.displayOrder - b.displayOrder)
      .map((folder) => ({ name: folder.name, children: children(folder.draftFolderId) }));
  const outputDefaults = draft.outputMappings.map((mapping) => ({
    outputTypeId: mapping.outputTypeId,
    destinationPath: folderPath(draft, mapping.destinationDraftFolderId),
  }));
  return {
    name,
    description: 'Custom project folder structure.',
    folders: children(null),
    outputDefaults,
  };
}
