import { useEffect, useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import {
  ArrowDown,
  ArrowLeftFromLine,
  ArrowRightFromLine,
  ArrowUp,
  FolderPlus,
  FolderTree,
  Pencil,
  Plus,
  Save,
  Trash2,
  X,
} from 'lucide-react';
import type {
  FolderNode,
  FolderNodePreset,
  FolderProfile,
  FolderProfilePreset,
  FolderProfileSource,
  OutputMapping,
  ProfileFolderNodeDraft,
  ProfileOutputDefaultDraft,
  Project,
  ProjectFolderDraft,
  ProjectFolderDraftNode,
  ProjectFolderDraftOutputMapping,
  ProjectFolderSnapshot,
  ProjectOutputFolders,
} from '@scli/domain';
import { apiRequest } from '../api';
import { useToast } from './toast';

const outputLabels: Array<[keyof ProjectOutputFolders, string]> = [
  ['scheduleExcel', 'Luminaire Schedule · Excel'],
  ['schedulePdf', 'Luminaire Schedule · PDF'],
  ['boqExcel', 'Technical BOQ · Excel'],
  ['boqPdf', 'Technical BOQ · PDF'],
  ['datasheets', 'Datasheets package'],
];

function siblingsAt<T extends { children: T[] }>(root: T[], parentPath: number[]): T[] {
  let siblings = root;
  for (const index of parentPath) siblings = siblings[index]!.children;
  return siblings;
}

function folderPaths(nodes: FolderNodePreset[], parent = ''): string[] {
  return nodes.flatMap((node) => {
    const current = parent ? `${parent}/${node.name}` : node.name;
    return [current, ...folderPaths(node.children, current)];
  });
}

function cleanName(value: string): string {
  return value.replace(/[<>:"/\\|?*]/g, '').slice(0, 120);
}

export function FolderStructureEditor({
  folders,
  outputFolders,
  disabled,
  saving,
  onFoldersChange,
  onOutputFoldersChange,
  onSaveProfile,
}: {
  folders: FolderNodePreset[];
  outputFolders: ProjectOutputFolders;
  disabled?: boolean;
  saving?: boolean;
  onFoldersChange: (folders: FolderNodePreset[]) => void;
  onOutputFoldersChange: (folders: ProjectOutputFolders) => void;
  onSaveProfile: (name: string, description: string) => void;
}) {
  const [profileName, setProfileName] = useState('');
  const [profileDescription, setProfileDescription] = useState('Custom project folder structure.');
  const paths = useMemo(() => folderPaths(folders), [folders]);

  const commit = (next: FolderNodePreset[]) => {
    const nextPaths = folderPaths(next);
    const fallback = nextPaths[0] ?? '';
    const valid = new Set(nextPaths.map((value) => value.toLowerCase()));
    const nextOutputs = Object.fromEntries(
      Object.entries(outputFolders).map(([key, value]) => [
        key,
        valid.has(value.toLowerCase()) ? value : fallback,
      ]),
    ) as ProjectOutputFolders;
    onFoldersChange(next);
    onOutputFoldersChange(nextOutputs);
  };

  const mutate = (
    path: number[],
    action: (siblings: FolderNodePreset[], index: number) => void,
  ) => {
    const next = structuredClone(folders);
    const siblings = siblingsAt(next, path.slice(0, -1));
    action(siblings, path.at(-1)!);
    commit(next);
  };

  const rename = (path: number[], value: string) =>
    mutate(path, (siblings, index) => {
      siblings[index]!.name = cleanName(value);
    });

  const renderNodes = (nodes: FolderNodePreset[], parentPath: number[] = []) => (
    <div className={parentPath.length ? 'folder-tree-children' : 'folder-tree-root'}>
      {nodes.map((node, index) => {
        const path = [...parentPath, index];
        return (
          <div className="folder-tree-node" key={path.join('.')}>
            <div className="folder-node-row">
              <span className="folder-depth" style={{ width: `${parentPath.length * 18}px` }} />
              <input
                aria-label="Folder name"
                value={node.name}
                disabled={disabled}
                onChange={(event) => rename(path, event.target.value)}
              />
              <div className="folder-node-actions">
                <button
                  type="button"
                  title="Add child folder"
                  disabled={disabled}
                  onClick={() =>
                    mutate(path, (siblings, current) =>
                      siblings[current]!.children.push({ name: 'NEW_FOLDER', children: [] }),
                    )
                  }
                >
                  <FolderPlus />
                </button>
                <button
                  type="button"
                  title="Move up"
                  disabled={disabled || index === 0}
                  onClick={() =>
                    mutate(path, (siblings, current) => {
                      [siblings[current - 1], siblings[current]] = [
                        siblings[current]!,
                        siblings[current - 1]!,
                      ];
                    })
                  }
                >
                  <ArrowUp />
                </button>
                <button
                  type="button"
                  title="Move down"
                  disabled={disabled || index === nodes.length - 1}
                  onClick={() =>
                    mutate(path, (siblings, current) => {
                      [siblings[current], siblings[current + 1]] = [
                        siblings[current + 1]!,
                        siblings[current]!,
                      ];
                    })
                  }
                >
                  <ArrowDown />
                </button>
                <button
                  type="button"
                  title="Move inside previous folder"
                  disabled={disabled || index === 0}
                  onClick={() =>
                    mutate(path, (siblings, current) => {
                      const [moving] = siblings.splice(current, 1);
                      siblings[current - 1]!.children.push(moving!);
                    })
                  }
                >
                  <ArrowRightFromLine />
                </button>
                <button
                  type="button"
                  title="Move one level out"
                  disabled={disabled || parentPath.length === 0}
                  onClick={() => {
                    const next = structuredClone(folders);
                    const parentSiblings = siblingsAt(next, parentPath.slice(0, -1));
                    const parentIndex = parentPath.at(-1)!;
                    const childSiblings = parentSiblings[parentIndex]!.children;
                    const [moving] = childSiblings.splice(index, 1);
                    parentSiblings.splice(parentIndex + 1, 0, moving!);
                    commit(next);
                  }}
                >
                  <ArrowLeftFromLine />
                </button>
                <button
                  type="button"
                  title="Delete folder"
                  disabled={disabled || paths.length === 1}
                  onClick={() => mutate(path, (siblings, current) => siblings.splice(current, 1))}
                >
                  <Trash2 />
                </button>
              </div>
            </div>
            {node.children.length ? renderNodes(node.children, path) : null}
          </div>
        );
      })}
    </div>
  );

  return (
    <div className="folder-editor">
      <div className="folder-editor-heading">
        <div>
          <strong>Customize this project</strong>
          <span>Rename, add, delete, reorder or nest any folder.</span>
        </div>
        <button
          className="button secondary"
          type="button"
          disabled={disabled}
          onClick={() => commit([...folders, { name: 'NEW_FOLDER', children: [] }])}
        >
          <Plus /> Add root folder
        </button>
      </div>
      {renderNodes(folders)}

      <div className="output-folder-mapping">
        <div>
          <strong>Automatic file locations</strong>
          <span>Each new revision is saved inside these project folders.</span>
        </div>
        <div className="output-mapping-grid">
          {outputLabels.map(([key, label]) => (
            <label className="field" key={key}>
              {label}
              <span className="select-wrap">
                <select
                  value={outputFolders[key]}
                  disabled={disabled}
                  onChange={(event) =>
                    onOutputFoldersChange({ ...outputFolders, [key]: event.target.value })
                  }
                >
                  {paths.map((folderPath) => (
                    <option key={folderPath} value={folderPath}>
                      {folderPath}
                    </option>
                  ))}
                </select>
              </span>
            </label>
          ))}
        </div>
      </div>

      <div className="save-folder-profile">
        <div>
          <strong>Reuse this structure</strong>
          <span>Save a named custom profile for future projects.</span>
        </div>
        <input
          aria-label="Folder profile name"
          value={profileName}
          disabled={disabled}
          onChange={(event) => setProfileName(event.target.value)}
          placeholder="Profile name"
        />
        <input
          aria-label="Folder profile description"
          value={profileDescription}
          disabled={disabled}
          onChange={(event) => setProfileDescription(event.target.value)}
          placeholder="Short description"
        />
        <button
          className="button secondary"
          type="button"
          disabled={disabled || saving || !profileName.trim() || !paths.length}
          onClick={() => onSaveProfile(profileName.trim(), profileDescription.trim())}
        >
          <Save /> {saving ? 'Saving…' : 'Save profile'}
        </button>
      </div>
    </div>
  );
}

// ===========================================================================
// P2.4B2 - Manage Structure drawer (controlled ID-aware folder editor)
// ===========================================================================

export interface ManageStructureWorkspace {
  folderPath: string | null;
  folderSnapshot: ProjectFolderSnapshot;
  outputMappings: OutputMapping[];
  folderConfigurationFingerprint: string;
}

interface FolderActionPreviewData {
  action: 'rename' | 'move' | 'delete-empty';
  folderId: string;
  currentRelativePath: string;
  proposedRelativePath: string | null;
  containsEntries: boolean;
  indexedFileCount: number;
  affectedDescendantCount: number;
  outputMappings: string[];
  warnings: string[];
  folderConfigurationFingerprint: string;
}

interface FolderActionResultData {
  action: string;
  folderId: string | null;
  folderConfigurationFingerprint: string;
  workspace: ManageStructureWorkspace;
}

interface StructureTreeNode {
  node: FolderNode;
  children: StructureTreeNode[];
}

const outputRoleLabels: Record<string, string> = {
  scheduleExcel: 'Schedule ? Excel',
  schedulePdf: 'Schedule ? PDF',
  boqExcel: 'BOQ ? Excel',
  boqPdf: 'BOQ ? PDF',
  datasheets: 'Datasheets',
};

function buildStructureTree(snapshot: ProjectFolderSnapshot): StructureTreeNode[] {
  const byParent = new Map<string | null, FolderNode[]>();
  for (const node of snapshot.folders) {
    const siblings = byParent.get(node.parentFolderId) ?? [];
    siblings.push(node);
    byParent.set(node.parentFolderId, siblings);
  }
  for (const siblings of byParent.values()) {
    siblings.sort((left, right) => left.displayOrder - right.displayOrder);
  }
  const build = (parentFolderId: string | null): StructureTreeNode[] =>
    (byParent.get(parentFolderId) ?? []).map((node) => ({
      node,
      children: build(node.folderId),
    }));
  return build(null);
}

function structureRelativePath(snapshot: ProjectFolderSnapshot, folderId: string): string {
  const byId = new Map(snapshot.folders.map((folder) => [folder.folderId, folder]));
  const segments: string[] = [];
  let current = byId.get(folderId);
  const seen = new Set<string>();
  while (current) {
    if (seen.has(current.folderId)) return '';
    seen.add(current.folderId);
    segments.unshift(current.name);
    current = current.parentFolderId ? byId.get(current.parentFolderId) : undefined;
  }
  return segments.join('/');
}

function structureEffectivelyEnabled(snapshot: ProjectFolderSnapshot, folderId: string): boolean {
  const byId = new Map(snapshot.folders.map((folder) => [folder.folderId, folder]));
  let current = byId.get(folderId);
  if (!current) return false;
  const seen = new Set<string>();
  while (current) {
    if (seen.has(current.folderId)) return false;
    seen.add(current.folderId);
    if (!current.enabled) return false;
    current = current.parentFolderId ? byId.get(current.parentFolderId) : undefined;
  }
  return true;
}

function structureSiblingIndex(snapshot: ProjectFolderSnapshot, folderId: string): number {
  const node = snapshot.folders.find((folder) => folder.folderId === folderId);
  if (!node) return 0;
  const siblings = snapshot.folders
    .filter((folder) => folder.parentFolderId === node.parentFolderId)
    .sort((left, right) => left.displayOrder - right.displayOrder);
  return siblings.findIndex((folder) => folder.folderId === folderId);
}

function structureSiblingCount(snapshot: ProjectFolderSnapshot, folderId: string): number {
  const node = snapshot.folders.find((folder) => folder.folderId === folderId);
  if (!node) return 0;
  return snapshot.folders.filter((folder) => folder.parentFolderId === node.parentFolderId).length;
}

function structureIsDescendant(
  snapshot: ProjectFolderSnapshot,
  folderId: string,
  candidateId: string,
): boolean {
  const byParent = new Map<string | null, FolderNode[]>();
  for (const node of snapshot.folders) {
    const siblings = byParent.get(node.parentFolderId) ?? [];
    siblings.push(node);
    byParent.set(node.parentFolderId, siblings);
  }
  const visit = (parentId: string): boolean => {
    for (const child of byParent.get(parentId) ?? []) {
      if (child.folderId === candidateId) return true;
      if (visit(child.folderId)) return true;
    }
    return false;
  };
  return visit(folderId);
}

function rootBasename(value: string | null): string {
  if (!value) return 'Not connected';
  return value.split(/[\\/]/).filter(Boolean).at(-1) ?? value;
}

export function ManageStructureDrawer({
  projectId,
  project,
  workspace,
  onClose,
  onChanged,
}: {
  projectId: string;
  project: Project;
  workspace: ManageStructureWorkspace;
  onClose: () => void;
  onChanged: () => Promise<void>;
}) {
  const { showToast } = useToast();
  const [selectedFolderId, setSelectedFolderId] = useState<string | null>(null);
  const [fingerprint, setFingerprint] = useState(workspace.folderConfigurationFingerprint);
  const [mode, setMode] = useState<
    null | 'add' | 'rename' | 'move' | 'disable' | 'enable' | 'delete-empty'
  >(null);
  const [nameInput, setNameInput] = useState('');
  const [moveParentId, setMoveParentId] = useState('');
  const [preview, setPreview] = useState<FolderActionPreviewData | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setFingerprint(workspace.folderConfigurationFingerprint);
  }, [workspace.folderConfigurationFingerprint]);

  const tree = useMemo(
    () => buildStructureTree(workspace.folderSnapshot),
    [workspace.folderSnapshot],
  );
  const selected =
    selectedFolderId === null
      ? null
      : (workspace.folderSnapshot.folders.find((folder) => folder.folderId === selectedFolderId) ??
        null);
  const selectedPath = selectedFolderId
    ? structureRelativePath(workspace.folderSnapshot, selectedFolderId)
    : '';
  const mappedByFolder = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const mapping of workspace.outputMappings) {
      if (mapping.destinationFolderId) {
        const list = map.get(mapping.destinationFolderId) ?? [];
        list.push(mapping.outputTypeId);
        map.set(mapping.destinationFolderId, list);
      }
    }
    return map;
  }, [workspace.outputMappings]);

  const reportError = (error: unknown) =>
    showToast(error instanceof Error ? error.message : 'The folder action failed.', 'error');

  const runAction = async (body: unknown) => {
    setBusy(true);
    try {
      const result = await apiRequest<FolderActionResultData>(
        `/api/projects/${projectId}/folder-actions`,
        { method: 'POST', body },
      );
      setFingerprint(result.folderConfigurationFingerprint);
      setPreview(null);
      setMode(null);
      setNameInput('');
      setBusy(false);
      await onChanged();
      showToast('Folder structure updated.');
    } catch (error) {
      setBusy(false);
      reportError(error);
    }
  };

  const runPreview = async (body: unknown) => {
    setBusy(true);
    try {
      const result = await apiRequest<FolderActionPreviewData>(
        `/api/projects/${projectId}/folder-actions/preview`,
        { method: 'POST', body },
      );
      setPreview(result);
      setFingerprint(result.folderConfigurationFingerprint);
      setBusy(false);
    } catch (error) {
      setBusy(false);
      reportError(error);
    }
  };

  const reorder = (folderId: string, direction: -1 | 1) => {
    const index = structureSiblingIndex(workspace.folderSnapshot, folderId);
    const target = index + direction;
    if (target < 0 || target >= structureSiblingCount(workspace.folderSnapshot, folderId)) return;
    void runAction({
      action: 'reorder',
      folderId,
      newDisplayOrder: target,
      expectedFolderConfigurationFingerprint: fingerprint,
    });
  };

  const openMode = (next: typeof mode) => {
    setMode(next);
    setPreview(null);
    if (next === 'rename' && selected) setNameInput(selected.name);
    if (next === 'move' && selected) setMoveParentId(selected.parentFolderId ?? '');
  };

  const renderNodes = (nodes: StructureTreeNode[], depth = 0) => (
    <ul className="structure-tree-list" role="tree">
      {nodes.map(({ node, children }) => {
        const effective = structureEffectivelyEnabled(workspace.folderSnapshot, node.folderId);
        const mapped = mappedByFolder.get(node.folderId) ?? [];
        const isSelected = node.folderId === selectedFolderId;
        const index = structureSiblingIndex(workspace.folderSnapshot, node.folderId);
        const count = structureSiblingCount(workspace.folderSnapshot, node.folderId);
        return (
          <li key={node.folderId} role="treeitem" aria-selected={isSelected}>
            <div
              className={`structure-tree-row ${isSelected ? 'selected' : ''} ${effective ? '' : 'disabled'}`}
              style={{ paddingLeft: `${depth * 18 + 8}px` }}
            >
              <button
                type="button"
                className="structure-tree-select"
                onClick={() => {
                  setSelectedFolderId(node.folderId);
                  setMode(null);
                  setPreview(null);
                }}
              >
                <span className="structure-tree-name">{node.name}</span>
                {!effective ? (
                  <span className="structure-badge disabled-badge">Disabled</span>
                ) : null}
                {mapped.map((output) => (
                  <span key={output} className="structure-badge output-badge">
                    {outputRoleLabels[output] ?? output}
                  </span>
                ))}
              </button>
              <div className="structure-tree-actions">
                <button
                  type="button"
                  title="Move up among siblings"
                  aria-label={`Move ${node.name} up`}
                  disabled={index <= 0}
                  onClick={() => reorder(node.folderId, -1)}
                >
                  <ArrowUp size={14} />
                </button>
                <button
                  type="button"
                  title="Move down among siblings"
                  aria-label={`Move ${node.name} down`}
                  disabled={index < 0 || index >= count - 1}
                  onClick={() => reorder(node.folderId, 1)}
                >
                  <ArrowDown size={14} />
                </button>
              </div>
            </div>
            {children.length ? renderNodes(children, depth + 1) : null}
          </li>
        );
      })}
    </ul>
  );

  const moveParentOptions = workspace.folderSnapshot.folders.filter(
    (folder) =>
      folder.folderId !== selectedFolderId &&
      (selectedFolderId === null ||
        !structureIsDescendant(workspace.folderSnapshot, selectedFolderId, folder.folderId)),
  );

  return (
    <AnimatePresence>
      <motion.button
        className="drawer-backdrop"
        type="button"
        aria-label="Close Manage Structure"
        onClick={onClose}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
      />
      <motion.aside
        className="assignment-drawer manage-structure-drawer"
        role="dialog"
        aria-modal="true"
        aria-label="Manage Structure"
        initial={{ x: '100%' }}
        animate={{ x: 0 }}
        exit={{ x: '100%' }}
        transition={{ duration: 0.24 }}
      >
        <header className="drawer-header">
          <div>
            <h2>Manage Structure</h2>
            <p>
              Project root: {rootBasename(workspace.folderPath)} ? {project.projectCode}
            </p>
          </div>
          <button className="icon-button" type="button" aria-label="Close" onClick={onClose}>
            <X size={18} />
          </button>
        </header>
        <div className="drawer-body">
          <div className="structure-root-row">
            <FolderTree size={16} />
            <span>{rootBasename(workspace.folderPath)}</span>
            <span className="structure-root-note">Read-only project root</span>
          </div>
          <div className="structure-tree">{renderNodes(tree)}</div>

          {selected ? (
            <section className="structure-selection" aria-label="Selected folder">
              <div className="structure-selection-heading">
                <h3>{selected.name}</h3>
                <span className="structure-selection-path">{selectedPath}</span>
              </div>
              <div className="structure-selection-actions">
                <button
                  type="button"
                  className="button secondary"
                  disabled={busy}
                  onClick={() => openMode('add')}
                >
                  <FolderPlus size={15} /> Add child
                </button>
                <button
                  type="button"
                  className="button secondary"
                  disabled={busy}
                  onClick={() => openMode('rename')}
                >
                  <Pencil size={15} /> Rename
                </button>
                <button
                  type="button"
                  className="button secondary"
                  disabled={busy}
                  onClick={() => openMode('move')}
                >
                  <ArrowRightFromLine size={15} /> Move
                </button>
                {selected.enabled ? (
                  <button
                    type="button"
                    className="button secondary"
                    disabled={busy}
                    onClick={() => openMode('disable')}
                  >
                    Disable
                  </button>
                ) : (
                  <button
                    type="button"
                    className="button secondary"
                    disabled={busy}
                    onClick={() => openMode('enable')}
                  >
                    Enable
                  </button>
                )}
                <button
                  type="button"
                  className="button secondary"
                  disabled={busy}
                  onClick={() => openMode('delete-empty')}
                >
                  <Trash2 size={15} /> Delete empty
                </button>
              </div>
            </section>
          ) : (
            <p className="structure-select-hint">Select a folder to edit it.</p>
          )}

          {mode ? (
            <section className="structure-action-panel" aria-label="Folder action">
              {mode === 'add' ? (
                <div className="structure-action-form">
                  <h3>Add folder</h3>
                  <p className="structure-action-context">
                    Parent: {selected ? selectedPath : 'Project root'}
                  </p>
                  <label className="field">
                    Folder name
                    <input
                      aria-label="New folder name"
                      value={nameInput}
                      onChange={(event) => setNameInput(event.target.value)}
                      placeholder="e.g. 06_MOCKUPS"
                    />
                  </label>
                  <div className="structure-action-buttons">
                    <button className="button ghost" type="button" onClick={() => setMode(null)}>
                      Cancel
                    </button>
                    <button
                      className="button primary"
                      type="button"
                      disabled={busy || !nameInput.trim()}
                      onClick={() =>
                        void runAction({
                          action: 'add',
                          parentFolderId: selectedFolderId,
                          name: nameInput.trim(),
                          expectedFolderConfigurationFingerprint: fingerprint,
                        })
                      }
                    >
                      Add folder
                    </button>
                  </div>
                </div>
              ) : null}

              {mode === 'rename' ? (
                <div className="structure-action-form">
                  <h3>Rename {selected?.name}</h3>
                  <label className="field">
                    New name
                    <input
                      aria-label="New folder name"
                      value={nameInput}
                      onChange={(event) => setNameInput(event.target.value)}
                    />
                  </label>
                  {preview ? (
                    <div className="structure-preview">
                      <p>
                        <strong>Current:</strong> {preview.currentRelativePath}
                      </p>
                      <p>
                        <strong>Proposed:</strong> {preview.proposedRelativePath}
                      </p>
                      {preview.containsEntries ? (
                        <p>
                          Contains {preview.indexedFileCount} indexed file(s) and{' '}
                          {preview.affectedDescendantCount} subfolder(s).
                        </p>
                      ) : null}
                      {preview.warnings.map((warning) => (
                        <p className="structure-warning" key={warning}>
                          {warning}
                        </p>
                      ))}
                    </div>
                  ) : (
                    <button
                      className="button secondary"
                      type="button"
                      disabled={busy || !nameInput.trim()}
                      onClick={() =>
                        void runPreview({
                          action: 'rename',
                          folderId: selectedFolderId,
                          name: nameInput.trim(),
                        })
                      }
                    >
                      Preview changes
                    </button>
                  )}
                  <div className="structure-action-buttons">
                    <button
                      className="button ghost"
                      type="button"
                      onClick={() => {
                        setMode(null);
                        setPreview(null);
                      }}
                    >
                      Cancel
                    </button>
                    {preview ? (
                      <button
                        className="button primary"
                        type="button"
                        disabled={busy}
                        onClick={() =>
                          void runAction({
                            action: 'rename',
                            folderId: selectedFolderId,
                            name: nameInput.trim(),
                            expectedFolderConfigurationFingerprint: fingerprint,
                          })
                        }
                      >
                        Confirm rename
                      </button>
                    ) : null}
                  </div>
                </div>
              ) : null}

              {mode === 'move' ? (
                <div className="structure-action-form">
                  <h3>Move {selected?.name}</h3>
                  <label className="field">
                    New parent
                    <select
                      aria-label="New parent folder"
                      value={moveParentId}
                      onChange={(event) => setMoveParentId(event.target.value)}
                    >
                      <option value="">Project root</option>
                      {moveParentOptions.map((folder) => (
                        <option key={folder.folderId} value={folder.folderId}>
                          {structureRelativePath(workspace.folderSnapshot, folder.folderId)}
                        </option>
                      ))}
                    </select>
                  </label>
                  {preview ? (
                    <div className="structure-preview">
                      <p>
                        <strong>Current:</strong> {preview.currentRelativePath}
                      </p>
                      <p>
                        <strong>Proposed:</strong> {preview.proposedRelativePath}
                      </p>
                      {preview.containsEntries ? (
                        <p>
                          Contains {preview.indexedFileCount} indexed file(s) and{' '}
                          {preview.affectedDescendantCount} subfolder(s).
                        </p>
                      ) : null}
                      {preview.warnings.map((warning) => (
                        <p className="structure-warning" key={warning}>
                          {warning}
                        </p>
                      ))}
                    </div>
                  ) : (
                    <button
                      className="button secondary"
                      type="button"
                      disabled={busy}
                      onClick={() =>
                        void runPreview({
                          action: 'move',
                          folderId: selectedFolderId,
                          newParentFolderId: moveParentId || null,
                        })
                      }
                    >
                      Preview changes
                    </button>
                  )}
                  <div className="structure-action-buttons">
                    <button
                      className="button ghost"
                      type="button"
                      onClick={() => {
                        setMode(null);
                        setPreview(null);
                      }}
                    >
                      Cancel
                    </button>
                    {preview ? (
                      <button
                        className="button primary"
                        type="button"
                        disabled={busy}
                        onClick={() =>
                          void runAction({
                            action: 'move',
                            folderId: selectedFolderId,
                            newParentFolderId: moveParentId || null,
                            expectedFolderConfigurationFingerprint: fingerprint,
                          })
                        }
                      >
                        Confirm move
                      </button>
                    ) : null}
                  </div>
                </div>
              ) : null}

              {mode === 'disable' ? (
                <div className="structure-action-form">
                  <h3>Disable {selected?.name}</h3>
                  <p className="structure-action-context">
                    Files remain on disk. The folder and its files are not deleted or moved.
                  </p>
                  <div className="structure-action-buttons">
                    <button className="button ghost" type="button" onClick={() => setMode(null)}>
                      Cancel
                    </button>
                    <button
                      className="button primary"
                      type="button"
                      disabled={busy}
                      onClick={() =>
                        void runAction({
                          action: 'disable',
                          folderId: selectedFolderId,
                          expectedFolderConfigurationFingerprint: fingerprint,
                        })
                      }
                    >
                      Disable folder
                    </button>
                  </div>
                </div>
              ) : null}

              {mode === 'enable' ? (
                <div className="structure-action-form">
                  <h3>Enable {selected?.name}</h3>
                  <p className="structure-action-context">
                    The folder becomes available again. Child folders keep their own settings.
                  </p>
                  <div className="structure-action-buttons">
                    <button className="button ghost" type="button" onClick={() => setMode(null)}>
                      Cancel
                    </button>
                    <button
                      className="button primary"
                      type="button"
                      disabled={busy}
                      onClick={() =>
                        void runAction({
                          action: 'enable',
                          folderId: selectedFolderId,
                          expectedFolderConfigurationFingerprint: fingerprint,
                        })
                      }
                    >
                      Enable folder
                    </button>
                  </div>
                </div>
              ) : null}

              {mode === 'delete-empty' ? (
                <div className="structure-action-form">
                  <h3>Delete empty folder</h3>
                  <p className="structure-action-context">
                    Only an empty folder with no subfolders can be deleted. Files are never deleted.
                  </p>
                  {preview ? (
                    <div className="structure-preview">
                      <p>
                        <strong>Path:</strong> {preview.currentRelativePath}
                      </p>
                      <p>
                        <strong>Contains entries:</strong> {preview.containsEntries ? 'Yes' : 'No'}
                      </p>
                      {preview.warnings.map((warning) => (
                        <p className="structure-warning" key={warning}>
                          {warning}
                        </p>
                      ))}
                    </div>
                  ) : (
                    <button
                      className="button secondary"
                      type="button"
                      disabled={busy}
                      onClick={() =>
                        void runPreview({ action: 'delete-empty', folderId: selectedFolderId })
                      }
                    >
                      Check folder
                    </button>
                  )}
                  <div className="structure-action-buttons">
                    <button
                      className="button ghost"
                      type="button"
                      onClick={() => {
                        setMode(null);
                        setPreview(null);
                      }}
                    >
                      Cancel
                    </button>
                    {preview &&
                    !preview.containsEntries &&
                    preview.affectedDescendantCount === 0 &&
                    preview.outputMappings.length === 0 ? (
                      <button
                        className="button primary"
                        type="button"
                        disabled={busy}
                        onClick={() =>
                          void runAction({
                            action: 'delete-empty',
                            folderId: selectedFolderId,
                            expectedFolderConfigurationFingerprint: fingerprint,
                          })
                        }
                      >
                        Delete empty folder
                      </button>
                    ) : null}
                  </div>
                </div>
              ) : null}
            </section>
          ) : null}
        </div>
        <footer className="drawer-footer">
          <button className="button ghost" type="button" onClick={onClose}>
            Close
          </button>
        </footer>
      </motion.aside>
    </AnimatePresence>
  );
}

// ===========================================================================
// P2.4B3B1B - Folder Profile TEMPLATE presentation/editing (pure JSON)
//
// Profile management edits template JSON only. It never touches the filesystem,
// never invokes project Folder Actions, and never performs a physical mkdir/
// rename/move/delete. These components reuse the pure folder-tree/output
// presentation patterns from FolderStructureEditor without the project
// physical-action behavior. Preview is strictly read-only.
// ===========================================================================

export interface ProfileTemplateNode extends FolderNodePreset {
  profileFolderId?: string;
}

export interface ProfileTemplateOutputDraft {
  outputTypeId: string;
  destinationPath: string;
}

export interface FolderProfileTemplateDraft {
  name: string;
  description: string;
  folders: ProfileTemplateNode[];
  outputDefaults: ProfileTemplateOutputDraft[];
}

/** Known UI-editable system output types. Unknown/custom outputs are preserved. */
export const profileOutputLabels: Array<[string, string]> = [
  ['scheduleExcel', 'Luminaire Schedule · Excel'],
  ['schedulePdf', 'Luminaire Schedule · PDF'],
  ['boqExcel', 'Technical BOQ · Excel'],
  ['boqPdf', 'Technical BOQ · PDF'],
  ['datasheets', 'Datasheets package'],
];

function normalizeDestination(value: string): string {
  return value.trim().replaceAll('\\', '/').toLowerCase();
}

/** Normalizes a draft tree node id by stable relative path (never display name alone). */
function profileNodeStableKey(node: FolderNodePreset): string {
  return node.name.trim().toLowerCase();
}

/**
 * Shared pure template folder-tree editor. Every mutation is local JSON only.
 * Deleting a template node is blocked while any output default (known or
 * custom) targets that node, so canonical profiles never end up with
 * unresolved output mappings.
 */
export function FolderProfileTemplateEditor({
  draft,
  disabled,
  onChange,
}: {
  draft: FolderProfileTemplateDraft;
  disabled?: boolean;
  onChange: (next: FolderProfileTemplateDraft) => void;
}) {
  const paths = useMemo(() => folderPaths(draft.folders), [draft.folders]);
  const knownKeys = new Set(profileOutputLabels.map(([key]) => key));
  const unknownOutputs = draft.outputDefaults.filter(
    (output) => !knownKeys.has(output.outputTypeId),
  );

  const commit = (
    nextFolders: ProfileTemplateNode[],
    nextOutputs?: ProfileTemplateOutputDraft[],
  ) => {
    onChange({
      ...draft,
      folders: nextFolders,
      outputDefaults: nextOutputs ?? draft.outputDefaults,
    });
  };

  /** Rewrites output destinations that targeted a renamed/moved subtree. */
  const remapOutputsForPathChange = (
    oldFolders: ProfileTemplateNode[],
    nextFolders: ProfileTemplateNode[],
    outputs: ProfileTemplateOutputDraft[],
  ): ProfileTemplateOutputDraft[] => {
    const oldNodes = collectNodePaths(oldFolders);
    const newNodes = collectNodePaths(nextFolders);
    const newPathById = new Map<string, string>();
    for (const { path, node } of newNodes) {
      if (node.profileFolderId) newPathById.set(node.profileFolderId, path);
    }
    return outputs.map((output) => {
      const current = normalizeDestination(output.destinationPath);
      let best: { id?: string; oldPath: string } | null = null;
      for (const { path, node } of oldNodes) {
        const normalized = normalizeDestination(path);
        if (current === normalized || current.startsWith(`${normalized}/`)) {
          if (!best || normalized.length > normalizeDestination(best.oldPath).length) {
            best = node.profileFolderId
              ? { id: node.profileFolderId, oldPath: path }
              : { oldPath: path };
          }
        }
      }
      if (!best) return output;
      if (best.id) {
        const newPath = newPathById.get(best.id);
        if (newPath) {
          const suffix = current.slice(normalizeDestination(best.oldPath).length);
          return { ...output, destinationPath: `${newPath}${suffix}` };
        }
        return output;
      }
      const from = normalizeDestination(best.oldPath);
      const to = newNodes.find(({ path }) => normalizeDestination(path) === from)?.path;
      if (!to || from.endsWith('/') || normalizeDestination(to).endsWith('/')) return output;
      const suffix = current.slice(from.length);
      return { ...output, destinationPath: `${to}${suffix}` };
    });
  };

  const mutate = (
    path: number[],
    action: (siblings: ProfileTemplateNode[], index: number) => void,
  ) => {
    const next = structuredClone(draft.folders);
    const siblings = siblingsAt(next, path.slice(0, -1));
    action(siblings, path.at(-1)!);
    commit(next, draft.outputDefaults);
  };

  const rename = (path: number[], value: string) => {
    const next = structuredClone(draft.folders);
    const siblings = siblingsAt(next, path.slice(0, -1));
    siblings[path.at(-1)!]!.name = cleanName(value);
    commit(next, remapOutputsForPathChange(draft.folders, next, draft.outputDefaults));
  };

  const isTargeted = (nodePath: number[]): boolean => {
    const target = folderPathsOf(draft.folders, nodePath);
    const normalized = normalizeDestination(target);
    return draft.outputDefaults.some(
      (output) => normalizeDestination(output.destinationPath) === normalized,
    );
  };

  const renderNodes = (nodes: ProfileTemplateNode[], parentPath: number[] = []) => (
    <div className={parentPath.length ? 'folder-tree-children' : 'folder-tree-root'}>
      {nodes.map((node, index) => {
        const path = [...parentPath, index];
        const targeted = isTargeted(path);
        return (
          <div
            className="folder-tree-node"
            key={`${profileNodeStableKey(node)}.${path.join('.')}`}
            data-profile-folder-id={node.profileFolderId ?? ''}
          >
            <div className="folder-node-row">
              <span className="folder-depth" style={{ width: `${parentPath.length * 18}px` }} />
              <input
                aria-label="Folder name"
                value={node.name}
                disabled={disabled}
                onChange={(event) => rename(path, event.target.value)}
              />
              <div className="folder-node-actions">
                <button
                  type="button"
                  title="Add child folder"
                  disabled={disabled}
                  onClick={() =>
                    mutate(path, (siblings, current) =>
                      siblings[current]!.children.push({ name: 'NEW_FOLDER', children: [] }),
                    )
                  }
                >
                  <FolderPlus />
                </button>
                <button
                  type="button"
                  title="Move up"
                  disabled={disabled || index === 0}
                  onClick={() =>
                    mutate(path, (siblings, current) => {
                      [siblings[current - 1], siblings[current]] = [
                        siblings[current]!,
                        siblings[current - 1]!,
                      ];
                    })
                  }
                >
                  <ArrowUp />
                </button>
                <button
                  type="button"
                  title="Move down"
                  disabled={disabled || index === nodes.length - 1}
                  onClick={() =>
                    mutate(path, (siblings, current) => {
                      [siblings[current], siblings[current + 1]] = [
                        siblings[current + 1]!,
                        siblings[current]!,
                      ];
                    })
                  }
                >
                  <ArrowDown />
                </button>
                <button
                  type="button"
                  title="Move inside previous folder"
                  disabled={disabled || index === 0}
                  onClick={() => {
                    const next = structuredClone(draft.folders);
                    const siblings = siblingsAt(next, path.slice(0, -1));
                    const current = path.at(-1)!;
                    const [moving] = siblings.splice(current, 1);
                    siblings[current - 1]!.children.push(moving!);
                    commit(
                      next,
                      remapOutputsForPathChange(draft.folders, next, draft.outputDefaults),
                    );
                  }}
                >
                  <ArrowRightFromLine />
                </button>
                <button
                  type="button"
                  title="Move one level out"
                  disabled={disabled || parentPath.length === 0}
                  onClick={() => {
                    const next = structuredClone(draft.folders);
                    const parentSiblings = siblingsAt(next, parentPath.slice(0, -1));
                    const parentIndex = parentPath.at(-1)!;
                    const childSiblings = parentSiblings[parentIndex]!.children;
                    const [moving] = childSiblings.splice(index, 1);
                    parentSiblings.splice(parentIndex + 1, 0, moving!);
                    commit(
                      next,
                      remapOutputsForPathChange(draft.folders, next, draft.outputDefaults),
                    );
                  }}
                >
                  <ArrowLeftFromLine />
                </button>
                <button
                  type="button"
                  title="Delete folder"
                  disabled={disabled || paths.length === 1 || targeted}
                  onClick={() => mutate(path, (siblings, current) => siblings.splice(current, 1))}
                >
                  <Trash2 />
                </button>
              </div>
            </div>
            {targeted ? (
              <span className="template-targeted-note">
                Targeted by an output default — move or remove that mapping first.
              </span>
            ) : null}
            {node.children.length ? renderNodes(node.children, path) : null}
          </div>
        );
      })}
    </div>
  );

  const setKnownOutput = (key: string, value: string) => {
    const without = draft.outputDefaults.filter((output) => output.outputTypeId !== key);
    onChange({
      ...draft,
      outputDefaults: [...without, { outputTypeId: key, destinationPath: value }],
    });
  };

  return (
    <div className="folder-editor">
      <div className="folder-editor-heading">
        <div>
          <strong>Template folder structure</strong>
          <span>Add, rename, reorder or nest folders. No project files are changed.</span>
        </div>
        <button
          className="button secondary"
          type="button"
          disabled={disabled}
          onClick={() => commit([...draft.folders, { name: 'NEW_FOLDER', children: [] }])}
        >
          <Plus /> Add root folder
        </button>
      </div>
      {renderNodes(draft.folders)}

      <div className="output-folder-mapping">
        <div>
          <strong>Known output defaults</strong>
          <span>Map generated outputs to template folders.</span>
        </div>
        <div className="output-mapping-grid">
          {profileOutputLabels.map(([key, label]) => (
            <label className="field" key={key}>
              {label}
              <span className="select-wrap">
                <select
                  value={
                    draft.outputDefaults.find((output) => output.outputTypeId === key)
                      ?.destinationPath ?? ''
                  }
                  disabled={disabled}
                  onChange={(event) => setKnownOutput(key, event.target.value)}
                >
                  <option value="" disabled>
                    Not mapped
                  </option>
                  {paths.map((folderPath) => (
                    <option key={folderPath} value={folderPath}>
                      {folderPath}
                    </option>
                  ))}
                </select>
              </span>
            </label>
          ))}
        </div>
        {unknownOutputs.length ? (
          <div className="profile-unknown-outputs">
            Additional preserved output mappings: {unknownOutputs.length}
          </div>
        ) : null}
      </div>
    </div>
  );
}

/** Returns the relative path for a nested node addressed by its index path. */
function folderPathsOf(nodes: FolderNodePreset[], indexPath: number[]): string {
  let segments: string[] = [];
  let current = nodes;
  for (const index of indexPath) {
    const node = current[index]!;
    segments = [...segments, node.name];
    current = node.children;
  }
  return segments.join('/');
}

function collectNodePaths(
  nodes: ProfileTemplateNode[],
  parent = '',
): Array<{ path: string; node: ProfileTemplateNode }> {
  return nodes.flatMap((node) => {
    const current = parent ? `${parent}/${node.name}` : node.name;
    return [{ path: current, node }, ...collectNodePaths(node.children, current)];
  });
}

/**
 * Read-only profile preview. Shows the hierarchical folder tree, output default
 * destinations, the description, and the source class (Factory/User/Legacy).
 * Never invokes Folder Actions and performs no filesystem mutation.
 */
export function FolderProfilePreview({
  profile,
  sourceClass,
  outputDefaults,
}: {
  profile: FolderProfilePreset;
  sourceClass: 'Factory' | 'User' | 'Legacy';
  outputDefaults?: ProfileTemplateOutputDraft[];
}) {
  const outputs = outputDefaults ?? toTemplateOutputDrafts(profile);
  const unknownOutputs = outputs.filter(
    (output) => !new Set(profileOutputLabels.map(([key]) => key)).has(output.outputTypeId),
  );

  const renderNodes = (nodes: FolderNodePreset[], depth = 0) => (
    <ul className="profile-preview-tree" role="tree">
      {nodes.map((node) => (
        <li
          key={node.name}
          role="treeitem"
          aria-selected="false"
          style={{ paddingLeft: `${depth * 16 + 4}px` }}
        >
          <FolderTree size={14} aria-hidden="true" />
          <span>{node.name}</span>
          {node.children.length ? renderNodes(node.children, depth + 1) : null}
        </li>
      ))}
    </ul>
  );

  return (
    <div className="profile-preview">
      <div className="profile-preview-header">
        <div>
          <strong>{profile.name}</strong>
          <span className="profile-source-class">{sourceClass}</span>
        </div>
        {profile.description ? <p>{profile.description}</p> : null}
      </div>
      {renderNodes(profile.folders)}
      <div className="profile-preview-outputs">
        {outputs.map((output) => (
          <span key={output.outputTypeId} className="profile-preview-output">
            <strong>{output.outputTypeId}</strong> → {output.destinationPath}
          </span>
        ))}
        {unknownOutputs.length ? (
          <span className="profile-preview-unknown">
            Additional preserved output mappings: {unknownOutputs.length}
          </span>
        ) : null}
      </div>
    </div>
  );
}

function toTemplateOutputDrafts(profile: FolderProfilePreset): ProfileTemplateOutputDraft[] {
  return (Object.entries(profile.outputFolders) as Array<[string, string]>).map(
    ([outputTypeId, destinationPath]) => ({
      outputTypeId,
      destinationPath,
    }),
  );
}

/**
 * Derives a relative path for a flat profile folder node by walking parents.
 * Returns null on cycles or missing parents.
 */
function profileNodePath(nodes: FolderProfile['folders'], profileFolderId: string): string | null {
  const byId = new Map(nodes.map((node) => [node.profileFolderId, node]));
  const segments: string[] = [];
  let current = byId.get(profileFolderId);
  const seen = new Set<string>();
  while (current) {
    if (seen.has(current.profileFolderId)) return null;
    seen.add(current.profileFolderId);
    segments.unshift(current.name);
    current = current.parentProfileFolderId ? byId.get(current.parentProfileFolderId) : undefined;
  }
  return segments.length ? segments.join('/') : null;
}

/** Converts a canonical FolderProfile (flat nodes) into the template editor tree draft. */
export function canonicalProfileToTemplateDraft(
  profile: FolderProfile,
): FolderProfileTemplateDraft {
  const byParent = new Map<string | null, FolderProfile['folders'][number][]>();
  for (const node of profile.folders) {
    const siblings = byParent.get(node.parentProfileFolderId) ?? [];
    siblings.push(node);
    byParent.set(node.parentProfileFolderId, siblings);
  }
  const build = (parent: string | null): ProfileTemplateNode[] =>
    (byParent.get(parent) ?? [])
      .sort((left, right) => left.displayOrder - right.displayOrder)
      .map((node) => ({
        profileFolderId: node.profileFolderId,
        name: node.name,
        children: build(node.profileFolderId),
      }));
  const outputDefaults = profile.outputDefaults
    .map((output) => {
      const destinationPath = profileNodePath(profile.folders, output.destinationProfileFolderId);
      return destinationPath ? { outputTypeId: output.outputTypeId, destinationPath } : null;
    })
    .filter((output): output is ProfileTemplateOutputDraft => output !== null);
  return {
    name: profile.name,
    description: profile.description ?? '',
    folders: build(null),
    outputDefaults,
  };
}

/** Derives a flat tree from a canonical profile for preview use (source class aware). */
export function canonicalProfileToPreset(profile: FolderProfile): FolderProfilePreset {
  const draft = canonicalProfileToTemplateDraft(profile);
  const outputFolders = draft.outputDefaults.reduce<ProjectOutputFolders>(
    (acc, output) => {
      if (
        output.outputTypeId === 'scheduleExcel' ||
        output.outputTypeId === 'schedulePdf' ||
        output.outputTypeId === 'boqExcel' ||
        output.outputTypeId === 'boqPdf' ||
        output.outputTypeId === 'datasheets'
      ) {
        (acc as Record<string, string>)[output.outputTypeId] = output.destinationPath;
      }
      return acc;
    },
    {
      scheduleExcel: '',
      schedulePdf: '',
      boqExcel: '',
      boqPdf: '',
      datasheets: '',
    },
  );
  return {
    name: profile.name,
    description: profile.description ?? '',
    folders: draft.folders,
    outputFolders,
    builtIn: false,
    source: 'user',
    profileId: profile.profileId,
  };
}

// ===========================================================================
// P2.4B3B2B - Canonical project folder draft (New Project Step 3)
//
// The draft is the authoritative reviewed structure for ONE project creation.
// It is a flat ProjectFolderDraft with transient draftFolderIds. Profile
// folder IDs never become project folder IDs. Editing the draft never mutates
// the selected source profile. No filesystem action happens here.
// ===========================================================================

/** Nested tree view of a draft used by the focused draft editor. */
export interface DraftTreeNode {
  draftFolderId: string;
  name: string;
  sourceProfileFolderId?: string | null;
  children: DraftTreeNode[];
}

/** Flattens a nested draft tree into canonical flat draft nodes (parents first). */
export function draftTreeToFlat(tree: DraftTreeNode[]): ProjectFolderDraftNode[] {
  const nodes: ProjectFolderDraftNode[] = [];
  const visit = (list: DraftTreeNode[], parentDraftFolderId: string | null): void => {
    list.forEach((node, index) => {
      nodes.push({
        draftFolderId: node.draftFolderId,
        parentDraftFolderId,
        name: node.name,
        displayOrder: index,
        ...(node.sourceProfileFolderId
          ? { sourceProfileFolderId: node.sourceProfileFolderId }
          : {}),
      });
      visit(node.children, node.draftFolderId);
    });
  };
  visit(tree, null);
  return nodes;
}

/** Builds a nested draft tree from flat canonical draft nodes. */
export function flatToDraftTree(nodes: ProjectFolderDraftNode[]): DraftTreeNode[] {
  const byParent = new Map<string | null, ProjectFolderDraftNode[]>();
  for (const node of nodes) {
    const siblings = byParent.get(node.parentDraftFolderId) ?? [];
    siblings.push(node);
    byParent.set(node.parentDraftFolderId, siblings);
  }
  for (const siblings of byParent.values()) {
    siblings.sort((left, right) => left.displayOrder - right.displayOrder);
  }
  const build = (parentDraftFolderId: string | null): DraftTreeNode[] =>
    (byParent.get(parentDraftFolderId) ?? []).map((node) => ({
      draftFolderId: node.draftFolderId,
      name: node.name,
      ...(node.sourceProfileFolderId ? { sourceProfileFolderId: node.sourceProfileFolderId } : {}),
      children: build(node.draftFolderId),
    }));
  return build(null);
}

/** Relative path for a draft folder by walking parents. */
export function draftFolderPath(draft: ProjectFolderDraft, draftFolderId: string): string | null {
  const byId = new Map(draft.folders.map((node) => [node.draftFolderId, node]));
  const segments: string[] = [];
  let current = byId.get(draftFolderId);
  const seen = new Set<string>();
  while (current) {
    if (seen.has(current.draftFolderId)) return null;
    seen.add(current.draftFolderId);
    segments.unshift(current.name);
    current = current.parentDraftFolderId ? byId.get(current.parentDraftFolderId) : undefined;
  }
  return segments.length ? segments.join('/') : null;
}

/** All draft folder relative paths, ordered parents-first. */
export function draftFolderPaths(draft: ProjectFolderDraft): string[] {
  return draft.folders
    .map((node) => draftFolderPath(draft, node.draftFolderId))
    .filter((path): path is string => path !== null);
}

/** True when every output mapping targets an existing draft folder. */
export function draftOutputsValid(draft: ProjectFolderDraft): boolean {
  const ids = new Set(draft.folders.map((node) => node.draftFolderId));
  return draft.outputMappings.every((mapping) => ids.has(mapping.destinationDraftFolderId));
}

/** Output mappings whose destination folder no longer exists in the draft. */
export function draftInvalidOutputMappings(
  draft: ProjectFolderDraft,
): ProjectFolderDraftOutputMapping[] {
  const ids = new Set(draft.folders.map((node) => node.draftFolderId));
  return draft.outputMappings.filter((mapping) => !ids.has(mapping.destinationDraftFolderId));
}

/** Builds a canonical draft from a legacy preset (factory/user/legacy) tree. */
export function draftFromPreset(
  preset: FolderProfilePreset,
  sourceProfile: FolderProfileSource | null,
  generateId: () => string,
): ProjectFolderDraft {
  const tree: DraftTreeNode[] = [];
  const pathToId = new Map<string, string>();
  const visit = (list: FolderNodePreset[], parentPath: string): DraftTreeNode[] =>
    list.map((node) => {
      const id = generateId();
      const relativePath = parentPath ? `${parentPath}/${node.name}` : node.name;
      pathToId.set(relativePath.toLowerCase(), id);
      return {
        draftFolderId: id,
        name: node.name,
        children: visit(node.children, relativePath),
      };
    });
  tree.push(...visit(preset.folders, ''));
  const outputMappings: ProjectFolderDraftOutputMapping[] = [];
  for (const [outputTypeId, destinationPath] of Object.entries(preset.outputFolders)) {
    if (!destinationPath) continue;
    const destinationDraftFolderId = pathToId.get(destinationPath.toLowerCase());
    if (destinationDraftFolderId) {
      outputMappings.push({ outputTypeId, destinationDraftFolderId });
    }
  }
  return { folders: draftTreeToFlat(tree), outputMappings, sourceProfile };
}

/** Builds a canonical draft from a canonical FolderProfile (flat nodes). */
export function draftFromCanonicalProfile(
  profile: FolderProfile,
  sourceProfile: FolderProfileSource | null,
  generateId: () => string,
): ProjectFolderDraft {
  const idMap = new Map<string, string>();
  for (const node of profile.folders) idMap.set(node.profileFolderId, generateId());
  const folders: ProjectFolderDraftNode[] = profile.folders.map((node) => ({
    draftFolderId: idMap.get(node.profileFolderId)!,
    parentDraftFolderId: node.parentProfileFolderId ? idMap.get(node.parentProfileFolderId)! : null,
    name: node.name,
    displayOrder: node.displayOrder,
    ...(node.semanticRole ? { semanticRole: node.semanticRole } : {}),
    sourceProfileFolderId: node.profileFolderId,
  }));
  const outputMappings: ProjectFolderDraftOutputMapping[] = profile.outputDefaults
    .map((output) => {
      const destinationDraftFolderId = idMap.get(output.destinationProfileFolderId);
      return destinationDraftFolderId
        ? { outputTypeId: output.outputTypeId, destinationDraftFolderId }
        : null;
    })
    .filter((mapping): mapping is ProjectFolderDraftOutputMapping => mapping !== null);
  return { folders, outputMappings, sourceProfile };
}

/** Canonical empty draft (managed root only, no injected folders/outputs). */
export function blankDraft(): ProjectFolderDraft {
  return { folders: [], outputMappings: [], sourceProfile: null };
}

/** Nested-name signature of a draft tree used for meaningful-customization checks. */
function draftTreeSignature(tree: DraftTreeNode[]): string {
  return JSON.stringify(
    tree.map((node) => ({ name: node.name, children: draftTreeSignature(node.children) })),
  );
}

/** Nested-name signature of a preset folder tree. */
function presetTreeSignature(nodes: FolderNodePreset[]): string {
  return JSON.stringify(
    nodes.map((node) => ({ name: node.name, children: presetTreeSignature(node.children) })),
  );
}

/**
 * True when the draft structure differs meaningfully from the selected source
 * profile (folder names/hierarchy or known output destinations). Used to decide
 * the "Customized for this project" state and to gate destructive profile
 * switches. Unknown/custom output mappings preserved from the source are not
 * treated as customization. A null source (Blank) is customized as soon as any
 * folder is added.
 */
export function draftMeaningfullyCustomized(
  draft: ProjectFolderDraft,
  sourcePreset: FolderProfilePreset | null,
): boolean {
  const tree = flatToDraftTree(draft.folders);
  if (sourcePreset) {
    if (draftTreeSignature(tree) !== presetTreeSignature(sourcePreset.folders)) return true;
  } else if (tree.length > 0) {
    return true;
  }
  const knownKeys = new Set(draftOutputLabels.map(([key]) => key));
  const sourceMappings = new Map<string, string | null>(
    Object.entries(sourcePreset?.outputFolders ?? {}).map(([outputTypeId, destinationPath]) => [
      outputTypeId,
      destinationPath || null,
    ]),
  );
  for (const mapping of draft.outputMappings) {
    if (!knownKeys.has(mapping.outputTypeId)) continue;
    const sourcePath = sourceMappings.get(mapping.outputTypeId);
    const draftPath = draftFolderPath(draft, mapping.destinationDraftFolderId);
    if (sourcePath !== draftPath) return true;
  }
  for (const key of knownKeys) {
    const hasDraft = draft.outputMappings.some((mapping) => mapping.outputTypeId === key);
    const hasSource = sourceMappings.has(key);
    if (hasDraft !== hasSource) return true;
  }
  return false;
}

/** Converts a draft into a canonical CreateFolderProfileInput (Save as New Profile). */
export function draftToProfileCreateInput(
  draft: ProjectFolderDraft,
  name: string,
  description: string,
): {
  name: string;
  description: string;
  folders: ProfileFolderNodeDraft[];
  outputDefaults: ProfileOutputDefaultDraft[];
} {
  const tree = flatToDraftTree(draft.folders);
  const build = (list: DraftTreeNode[]): ProfileFolderNodeDraft[] =>
    list.map((node) => ({
      name: node.name,
      children: build(node.children),
    }));
  const outputDefaults: ProfileOutputDefaultDraft[] = draft.outputMappings
    .map((mapping) => {
      const destinationPath = draftFolderPath(draft, mapping.destinationDraftFolderId);
      return destinationPath ? { outputTypeId: mapping.outputTypeId, destinationPath } : null;
    })
    .filter((output): output is ProfileOutputDefaultDraft => output !== null);
  return { name, description, folders: build(tree), outputDefaults };
}

/** Known UI-editable output keys for a project draft. */
export const draftOutputLabels: Array<[string, string]> = [
  ['scheduleExcel', 'Luminaire Schedule · Excel'],
  ['schedulePdf', 'Luminaire Schedule · PDF'],
  ['boqExcel', 'Technical BOQ · Excel'],
  ['boqPdf', 'Technical BOQ · PDF'],
  ['datasheets', 'Datasheets package'],
];

/**
 * Focused draft editor for one project. Operates on the flat canonical draft,
 * preserving draftFolderId across rename/reorder/hierarchy moves. New nodes get
 * fresh draftFolderId. Unknown/custom output mappings are preserved verbatim.
 * No filesystem action and no ProjectFolderStructureService call.
 */
export function ProjectFolderDraftEditor({
  draft,
  disabled,
  onChange,
}: {
  draft: ProjectFolderDraft;
  disabled?: boolean;
  onChange: (next: ProjectFolderDraft) => void;
}) {
  const tree = useMemo(() => flatToDraftTree(draft.folders), [draft.folders]);
  const paths = useMemo(() => draftFolderPaths(draft), [draft.folders]);
  const knownKeys = new Set(draftOutputLabels.map(([key]) => key));
  const unknownOutputs = draft.outputMappings.filter(
    (mapping) => !knownKeys.has(mapping.outputTypeId),
  );
  const invalidMappings = draftInvalidOutputMappings(draft);

  const commitTree = (nextTree: DraftTreeNode[]) => {
    onChange({
      ...draft,
      folders: draftTreeToFlat(nextTree),
    });
  };

  const mutate = (path: number[], action: (siblings: DraftTreeNode[], index: number) => void) => {
    const next = structuredClone(tree);
    const siblings = siblingsAt(next, path.slice(0, -1));
    action(siblings, path.at(-1)!);
    commitTree(next);
  };

  const rename = (path: number[], value: string) =>
    mutate(path, (siblings, index) => {
      siblings[index]!.name = cleanName(value);
    });

  const renderNodes = (nodes: DraftTreeNode[], parentPath: number[] = []) => (
    <div className={parentPath.length ? 'folder-tree-children' : 'folder-tree-root'}>
      {nodes.map((node, index) => {
        const path = [...parentPath, index];
        return (
          <div className="folder-tree-node" key={node.draftFolderId}>
            <div className="folder-node-row">
              <span className="folder-depth" style={{ width: `${parentPath.length * 18}px` }} />
              <input
                aria-label="Folder name"
                value={node.name}
                disabled={disabled}
                onChange={(event) => rename(path, event.target.value)}
              />
              <div className="folder-node-actions">
                <button
                  type="button"
                  title="Add child folder"
                  disabled={disabled}
                  onClick={() =>
                    mutate(path, (siblings, current) =>
                      siblings[current]!.children.push({
                        draftFolderId: crypto.randomUUID(),
                        name: 'NEW_FOLDER',
                        children: [],
                      }),
                    )
                  }
                >
                  <FolderPlus />
                </button>
                <button
                  type="button"
                  title="Move up"
                  disabled={disabled || index === 0}
                  onClick={() =>
                    mutate(path, (siblings, current) => {
                      [siblings[current - 1], siblings[current]] = [
                        siblings[current]!,
                        siblings[current - 1]!,
                      ];
                    })
                  }
                >
                  <ArrowUp />
                </button>
                <button
                  type="button"
                  title="Move down"
                  disabled={disabled || index === nodes.length - 1}
                  onClick={() =>
                    mutate(path, (siblings, current) => {
                      [siblings[current], siblings[current + 1]] = [
                        siblings[current + 1]!,
                        siblings[current]!,
                      ];
                    })
                  }
                >
                  <ArrowDown />
                </button>
                <button
                  type="button"
                  title="Move inside previous folder"
                  disabled={disabled || index === 0}
                  onClick={() =>
                    mutate(path, (siblings, current) => {
                      const [moving] = siblings.splice(current, 1);
                      siblings[current - 1]!.children.push(moving!);
                    })
                  }
                >
                  <ArrowRightFromLine />
                </button>
                <button
                  type="button"
                  title="Move one level out"
                  disabled={disabled || parentPath.length === 0}
                  onClick={() => {
                    const next = structuredClone(tree);
                    const parentSiblings = siblingsAt(next, parentPath.slice(0, -1));
                    const parentIndex = parentPath.at(-1)!;
                    const childSiblings = parentSiblings[parentIndex]!.children;
                    const [moving] = childSiblings.splice(index, 1);
                    parentSiblings.splice(parentIndex + 1, 0, moving!);
                    commitTree(next);
                  }}
                >
                  <ArrowLeftFromLine />
                </button>
                <button
                  type="button"
                  title="Delete folder"
                  disabled={disabled || paths.length === 1}
                  onClick={() => mutate(path, (siblings, current) => siblings.splice(current, 1))}
                >
                  <Trash2 />
                </button>
              </div>
            </div>
            {node.children.length ? renderNodes(node.children, path) : null}
          </div>
        );
      })}
    </div>
  );

  const setKnownOutput = (key: string, value: string) => {
    const without = draft.outputMappings.filter((mapping) => mapping.outputTypeId !== key);
    onChange({
      ...draft,
      outputMappings: [...without, { outputTypeId: key, destinationDraftFolderId: value }],
    });
  };

  const removeMapping = (outputTypeId: string) => {
    onChange({
      ...draft,
      outputMappings: draft.outputMappings.filter(
        (mapping) => mapping.outputTypeId !== outputTypeId,
      ),
    });
  };

  return (
    <div className="folder-editor">
      <div className="folder-editor-heading">
        <div>
          <strong>Customize this project</strong>
          <span>
            Rename, add, delete, reorder or nest any folder. The source profile is unchanged.
          </span>
        </div>
        <button
          className="button secondary"
          type="button"
          disabled={disabled}
          onClick={() =>
            commitTree([
              ...tree,
              { draftFolderId: crypto.randomUUID(), name: 'NEW_FOLDER', children: [] },
            ])
          }
        >
          <Plus /> Add root folder
        </button>
      </div>
      {renderNodes(tree)}

      <div className="output-folder-mapping">
        <div>
          <strong>Automatic file locations</strong>
          <span>Each new revision is saved inside these project folders.</span>
        </div>
        <div className="output-mapping-grid">
          {draftOutputLabels.map(([key, label]) => {
            const mapping = draft.outputMappings.find((item) => item.outputTypeId === key);
            const value = mapping?.destinationDraftFolderId ?? '';
            const invalid =
              Boolean(mapping) && !paths.includes(draftFolderPath(draft, value) ?? '');
            return (
              <label className="field" key={key}>
                {label}
                <span className="select-wrap">
                  <select
                    value={value}
                    disabled={disabled}
                    onChange={(event) => setKnownOutput(key, event.target.value)}
                  >
                    <option value="" disabled>
                      Not mapped
                    </option>
                    {draft.folders.map((folder) => {
                      const folderPath = draftFolderPath(draft, folder.draftFolderId);
                      return folderPath ? (
                        <option key={folder.draftFolderId} value={folder.draftFolderId}>
                          {folderPath}
                        </option>
                      ) : null;
                    })}
                  </select>
                </span>
                {invalid ? (
                  <small className="draft-output-attention">
                    Destination folder was removed — choose a valid folder or remove this mapping.
                  </small>
                ) : null}
              </label>
            );
          })}
        </div>
        {unknownOutputs.length ? (
          <div className="profile-unknown-outputs">
            Additional preserved output mappings: {unknownOutputs.length}
          </div>
        ) : null}
        {invalidMappings.length ? (
          <div className="draft-output-attention-block" role="alert">
            <strong>Output destinations need attention</strong>
            <span>
              {invalidMappings.map((mapping) => mapping.outputTypeId).join(', ')} point to a folder
              that was removed. Select a valid destination or remove the mapping.
            </span>
            <div className="draft-attention-actions">
              {invalidMappings.map((mapping) => (
                <button
                  key={mapping.outputTypeId}
                  className="button ghost"
                  type="button"
                  disabled={disabled}
                  onClick={() => removeMapping(mapping.outputTypeId)}
                >
                  Remove {mapping.outputTypeId} mapping
                </button>
              ))}
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
