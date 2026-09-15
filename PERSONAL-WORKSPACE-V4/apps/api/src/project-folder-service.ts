import path from 'node:path';
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { randomUUID } from 'node:crypto';
import {
  CURRENT_PROJECT_PREFIX,
  DomainError,
  folderStructureFromSnapshot,
  validateFolderSnapshot,
  validateProjectOutputMappings,
  validateProjectReferenceInput,
  type FolderNodePreset,
  type FolderProfilePreset,
  type OutputMapping,
  type Project,
  type ProjectFolderSnapshot,
  type ProjectOutputFolders,
} from '@scli/domain';

export interface FolderCreationResult {
  folderPath: string;
  folderName: string;
  projectNumber: number;
  createdFolderCount: number;
  projectInfoPath: string;
}

const activeRoots = new Set<string>();

function cleanProjectName(projectName: string): string {
  const printable = [...projectName].filter((character) => character.charCodeAt(0) >= 32).join('');
  return printable
    .normalize('NFKC')
    .trim()
    .replace(/[<>:"/\\|?*\s]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^[_. ]+|[_. ]+$/g, '')
    .toUpperCase();
}

function dateCode(date: Date): string {
  const year = String(date.getFullYear()).slice(-2);
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}${month}${day}`;
}

function validateNodeName(name: string): void {
  const hasControlCharacter = [...name].some((character) => character.charCodeAt(0) < 32);
  if (
    !name.trim() ||
    name === '.' ||
    name === '..' ||
    hasControlCharacter ||
    /[<>:"/\\|?*]/.test(name)
  ) {
    throw new DomainError('VALIDATION_ERROR', `Invalid folder name: ${name}`, 400);
  }
}

function normalizedRelativePath(value: string): string {
  const normalized = value.trim().replaceAll('\\', '/');
  const segments = normalized.split('/');
  if (
    /^[a-zA-Z]:\//.test(normalized) ||
    normalized.startsWith('/') ||
    segments.some((segment) => !segment || segment === '.' || segment === '..')
  ) {
    throw new DomainError(
      'VALIDATION_ERROR',
      `Output folder must stay inside the project: ${value}`,
      400,
    );
  }
  segments.forEach(validateNodeName);
  return segments.join('/');
}

export function listFolderPaths(folders: FolderNodePreset[]): string[] {
  let count = 0;
  const visit = (nodes: FolderNodePreset[], parent: string, depth: number): string[] => {
    if (depth > 8) {
      throw new DomainError('VALIDATION_ERROR', 'Folder nesting cannot exceed 8 levels.', 400);
    }
    const names = new Set<string>();
    return nodes.flatMap((node) => {
      validateNodeName(node.name);
      const key = node.name.trim().toLowerCase();
      if (names.has(key)) {
        throw new DomainError(
          'VALIDATION_ERROR',
          `Duplicate folder name at the same level: ${node.name}`,
          400,
        );
      }
      names.add(key);
      count += 1;
      if (count > 300) {
        throw new DomainError('VALIDATION_ERROR', 'A project can contain up to 300 folders.', 400);
      }
      const current = parent ? `${parent}/${node.name.trim()}` : node.name.trim();
      return [current, ...visit(node.children, current, depth + 1)];
    });
  };
  return visit(folders, '', 1);
}

export function validateFolderConfiguration(
  folders: FolderNodePreset[],
  outputFolders: ProjectOutputFolders,
): ProjectOutputFolders {
  if (!folders.length) {
    throw new DomainError('VALIDATION_ERROR', 'Add at least one project folder.', 400);
  }
  const available = new Set(listFolderPaths(folders).map((value) => value.toLowerCase()));
  return Object.fromEntries(
    Object.entries(outputFolders).map(([key, value]) => {
      const normalized = normalizedRelativePath(value);
      if (!available.has(normalized.toLowerCase())) {
        throw new DomainError(
          'VALIDATION_ERROR',
          `The ${key} output must point to a folder in the project structure.`,
          400,
        );
      }
      return [key, normalized];
    }),
  ) as ProjectOutputFolders;
}

function createTree(parent: string, node: FolderNodePreset): number {
  validateNodeName(node.name);
  const destination = path.resolve(parent, node.name);
  const safeParent = `${path.resolve(parent)}${path.sep}`.toLowerCase();
  if (!`${destination}${path.sep}`.toLowerCase().startsWith(safeParent)) {
    throw new DomainError('VALIDATION_ERROR', 'A folder resolved outside the project.', 400);
  }
  mkdirSync(destination);
  return 1 + node.children.reduce((count, child) => count + createTree(destination, child), 0);
}

function projectInfoLine(lines: string[], label: string): string | null {
  const pattern = new RegExp(`^${label}\\s*:`, 'i');
  const line = lines.find((candidate) => pattern.test(candidate));
  return line ? line.replace(/^[^:]*:\s*/, '').trim() : null;
}

function canonicalPath(value: string): string {
  return path.resolve(value).toLowerCase();
}

interface ProjectInfoContent {
  projectNumber: string;
  companyCode: string;
  projectCode: string;
  projectName: string;
  clientName: string;
  location: string;
  designStage: string;
  services: string[];
  date: string;
  dateCode: string;
  folderProfile: string;
  folderName: string;
}

function renderProjectInfo(content: ProjectInfoContent): string {
  return [
    'SCT LIGHTING PROJECT',
    '=====================',
    `Project Number : ${content.projectNumber}`,
    `Company Code   : ${content.companyCode}`,
    `Project Code   : ${content.projectCode}`,
    `Project Name   : ${content.projectName}`,
    `Client         : ${content.clientName}`,
    `Location       : ${content.location}`,
    `Stage          : ${content.designStage}`,
    `Services       : ${content.services.join(', ')}`,
    `Date           : ${content.date}`,
    `Date Code      : ${content.dateCode}`,
    `Folder Profile : ${content.folderProfile}`,
    `Folder Name    : ${content.folderName}`,
    `Created        : ${new Date().toISOString()}`,
    '',
  ].join('\r\n');
}

export class ProjectFolderService {
  public ensureStructure(folderPath: string, folders: FolderNodePreset[]): number {
    const root = this.connectExisting(folderPath);
    let created = 0;
    for (const relativePath of listFolderPaths(folders)) {
      const destination = path.resolve(root, relativePath);
      const safeRoot = `${root}${path.sep}`.toLowerCase();
      if (!`${destination}${path.sep}`.toLowerCase().startsWith(safeRoot)) {
        throw new DomainError('VALIDATION_ERROR', 'A folder resolved outside the project.', 400);
      }
      if (!existsSync(destination)) {
        mkdirSync(destination, { recursive: true });
        created += 1;
      } else if (!statSync(destination).isDirectory()) {
        throw new DomainError(
          'CONFLICT',
          `A file already uses the required folder path: ${destination}`,
          409,
        );
      }
    }
    return created;
  }

  public connectExisting(folderPath: string): string {
    if (!folderPath.trim()) {
      throw new DomainError('VALIDATION_ERROR', 'Select an existing project folder.', 400);
    }
    const resolved = path.resolve(folderPath);
    if (!existsSync(resolved) || !statSync(resolved).isDirectory()) {
      throw new DomainError(
        'VALIDATION_ERROR',
        `Existing project folder was not found: ${resolved}`,
        400,
      );
    }
    if (resolved.length > 220) {
      throw new DomainError(
        'VALIDATION_ERROR',
        'This folder path is too long for reliable AutoCAD, DIALux and OneDrive workflows.',
        400,
      );
    }
    return resolved;
  }

  public create(
    basePath: string,
    project: Project,
    profile: FolderProfilePreset,
    creationDate = new Date(),
  ): FolderCreationResult {
    validateFolderConfiguration(profile.folders, profile.outputFolders);
    return this.createPhysicalTree(basePath, project, profile.folders, profile.name, creationDate);
  }

  /**
   * P2.4B3B2A - creates the physical descendant tree from the SAME persisted
   * canonical snapshot, never from a re-fetched profile, preset lookup, or old
   * raw client tree. Blank canonical snapshots create only the managed root.
   */
  public createCanonical(
    basePath: string,
    project: Project,
    snapshot: ProjectFolderSnapshot,
    outputMappings: readonly OutputMapping[],
    creationDate = new Date(),
  ): FolderCreationResult {
    validateFolderSnapshot(snapshot);
    const folders = folderStructureFromSnapshot(snapshot);
    listFolderPaths(folders);
    validateProjectOutputMappings(outputMappings, snapshot);
    return this.createPhysicalTree(
      basePath,
      project,
      folders,
      project.folderProfile ?? 'Full Lighting Design',
      creationDate,
    );
  }

  private createPhysicalTree(
    basePath: string,
    project: Project,
    folders: FolderNodePreset[],
    folderProfileName: string,
    creationDate: Date,
  ): FolderCreationResult {
    if (!basePath.trim()) {
      throw new DomainError('VALIDATION_ERROR', 'Select the projects base folder first.', 400);
    }
    const resolvedBase = path.resolve(basePath);
    if (!existsSync(resolvedBase)) {
      throw new DomainError(
        'VALIDATION_ERROR',
        `Projects base folder was not found: ${resolvedBase}`,
        400,
      );
    }
    if (activeRoots.has(resolvedBase.toLowerCase())) {
      throw new DomainError(
        'CONFLICT',
        'Another project is being created in this base folder.',
        409,
      );
    }
    activeRoots.add(resolvedBase.toLowerCase());
    let temporaryPath = '';
    try {
      const codeNumber = Number.parseInt(project.projectCode, 10);
      if (!Number.isFinite(codeNumber)) {
        throw new DomainError(
          'VALIDATION_ERROR',
          'The project code does not carry a valid project number.',
          400,
        );
      }
      const projectNumber = codeNumber;
      const formattedNumber =
        projectNumber < 1_000 ? String(projectNumber).padStart(3, '0') : String(projectNumber);
      const cleanName = cleanProjectName(project.projectName);
      if (!cleanName) throw new DomainError('VALIDATION_ERROR', 'Enter a valid project name.', 400);
      const folderName = project.projectCode;
      validateNodeName(folderName);
      const folderPath = path.join(resolvedBase, folderName);
      if (existsSync(folderPath)) {
        throw new DomainError('CONFLICT', `The project folder already exists: ${folderPath}`, 409);
      }
      temporaryPath = path.join(resolvedBase, `.scli_creating_${randomUUID().replaceAll('-', '')}`);
      mkdirSync(temporaryPath);
      const createdFolderCount = folders.reduce(
        (count, node) => count + createTree(temporaryPath, node),
        0,
      );
      const projectInfo = renderProjectInfo({
        projectNumber: formattedNumber,
        companyCode: CURRENT_PROJECT_PREFIX,
        projectCode: project.projectCode,
        projectName: cleanName,
        clientName: project.clientName.trim(),
        location: project.siteLocation.trim(),
        designStage: project.designStage,
        services: project.services ?? [],
        date: creationDate.toISOString().slice(0, 10),
        dateCode: dateCode(creationDate),
        folderProfile: folderProfileName,
        folderName,
      });
      writeFileSync(path.join(temporaryPath, 'PROJECT_INFO.txt'), projectInfo, 'utf8');
      renameSync(temporaryPath, folderPath);
      temporaryPath = '';
      return {
        folderPath,
        folderName,
        projectNumber,
        createdFolderCount,
        projectInfoPath: path.join(folderPath, 'PROJECT_INFO.txt'),
      };
    } finally {
      activeRoots.delete(resolvedBase.toLowerCase());
      if (temporaryPath) {
        const resolvedTemporary = path.resolve(temporaryPath);
        const safeBase = `${resolvedBase}${path.sep}`.toLowerCase();
        if (
          `${resolvedTemporary}${path.sep}`.toLowerCase().startsWith(safeBase) &&
          path.basename(resolvedTemporary).startsWith('.scli_creating_') &&
          existsSync(resolvedTemporary)
        ) {
          rmSync(resolvedTemporary, { recursive: true, force: true });
        }
      }
    }
  }

  /**
   * Prove that the managed folder at the recorded path belongs to this project
   * and rename it to the new controlled reference.
   *
   * Ownership is proven only when ALL of the following hold:
   * - the provider-persisted projectFolderPath and the workspace folder mapping
   *   resolve to the same folder;
   * - the folder basename equals the current projectCode;
   * - PROJECT_INFO.txt (when present) confirms the current projectCode, or the
   *   project is a legacy import whose legacyFolderName matches the basename.
   *
   * The rename is a same-parent atomic renameSync; it never copies or deletes
   * content, never overwrites an existing folder, and never touches an
   * arbitrary user-selected folder. On failure nothing has been changed.
   */
  public renameManagedProjectFolder(
    project: Project,
    workspaceFolderPath: string,
    newCode: string,
  ): { oldPath: string; newPath: string } {
    const targetCode = validateProjectReferenceInput(newCode);
    const stored = path.resolve(project.projectFolderPath ?? '');
    const workspace = path.resolve(workspaceFolderPath);
    if (!project.projectFolderPath || !workspaceFolderPath.trim()) {
      throw new DomainError(
        'CONFLICT',
        'Project folder ownership is ambiguous. No managed folder mapping exists.',
        409,
      );
    }
    if (canonicalPath(stored) !== canonicalPath(workspace)) {
      throw new DomainError(
        'CONFLICT',
        'Project folder ownership is ambiguous. The recorded folder path does not match the workspace mapping.',
        409,
      );
    }
    const currentBasename = path.basename(stored);
    if (currentBasename !== project.projectCode) {
      throw new DomainError(
        'CONFLICT',
        'Project folder ownership is ambiguous. The folder name does not match the project reference.',
        409,
      );
    }
    if (!existsSync(stored) || !statSync(stored).isDirectory()) {
      throw new DomainError(
        'CONFLICT',
        'The managed project folder is missing and cannot be renamed.',
        409,
      );
    }
    const infoPath = path.join(stored, 'PROJECT_INFO.txt');
    let projectInfoCode: string | null = null;
    if (existsSync(infoPath)) {
      try {
        const lines = readFileSync(infoPath, 'utf8').split(/\r?\n/);
        projectInfoCode = projectInfoLine(lines, 'Project Code');
      } catch {
        throw new DomainError(
          'CONFLICT',
          'Project folder ownership could not be verified because PROJECT_INFO.txt cannot be read.',
          409,
        );
      }
      if (projectInfoCode?.toUpperCase() !== project.projectCode.toUpperCase()) {
        throw new DomainError(
          'CONFLICT',
          'Project folder ownership is ambiguous. PROJECT_INFO.txt does not match the project reference.',
          409,
        );
      }
    } else if (project.legacyFolderName !== currentBasename) {
      throw new DomainError(
        'CONFLICT',
        'Project folder ownership is ambiguous. The folder cannot be linked to this project.',
        409,
      );
    }
    const parent = path.dirname(stored);
    const target = path.join(parent, targetCode);
    if (
      path.basename(target) !== targetCode ||
      canonicalPath(path.dirname(target)) !== canonicalPath(parent)
    ) {
      throw new DomainError('VALIDATION_ERROR', 'The target folder path is not safe.', 400);
    }
    if (existsSync(target)) {
      throw new DomainError('CONFLICT', 'A folder with the target reference already exists.', 409);
    }
    if (target.length > 220) {
      throw new DomainError(
        'VALIDATION_ERROR',
        'The target folder path is too long for reliable AutoCAD, DIALux and OneDrive workflows.',
        400,
      );
    }
    try {
      renameSync(stored, target);
    } catch {
      throw new DomainError(
        'CONFLICT',
        'The project folder could not be renamed. No project data was changed.',
        409,
      );
    }
    return { oldPath: stored, newPath: target };
  }

  /**
   * Restore a renamed managed folder to its previous name. Used only as
   * compensation for a failed coordinated reference update.
   */
  public restoreManagedProjectFolder(renamedTo: string, renamedFrom: string): void {
    const current = path.resolve(renamedTo);
    const previous = path.resolve(renamedFrom);
    if (canonicalPath(path.dirname(current)) !== canonicalPath(path.dirname(previous))) {
      throw new DomainError('VALIDATION_ERROR', 'Cannot restore: folders are not siblings.', 400);
    }
    if (!existsSync(current) || existsSync(previous)) {
      throw new DomainError(
        'CONFLICT',
        'The project folder could not be restored because the current folder state is unexpected.',
        409,
      );
    }
    try {
      renameSync(current, previous);
    } catch {
      throw new DomainError(
        'CONFLICT',
        'The project folder could not be restored automatically. Manual recovery is required.',
        409,
        { recoveryRequired: true },
      );
    }
  }

  /**
   * Prove that the managed project root at the workspace folder path belongs
   * to this project. Ownership is proven through PROJECT_INFO.txt when present,
   * otherwise through the legacy folder name or the controlled project code.
   * Returns the resolved root path.
   */
  public assertManagedRootOwned(project: Project, workspaceFolderPath: string): string {
    const resolved = path.resolve(workspaceFolderPath);
    if (!existsSync(resolved) || !statSync(resolved).isDirectory()) {
      throw new DomainError(
        'CONFLICT',
        'The managed project folder is missing or out of sync.',
        409,
        { code: 'FOLDER_OUT_OF_SYNC' },
      );
    }
    const basename = path.basename(resolved);
    const infoPath = path.join(resolved, 'PROJECT_INFO.txt');
    if (existsSync(infoPath)) {
      let projectInfoCode: string | null = null;
      try {
        projectInfoCode = projectInfoLine(
          readFileSync(infoPath, 'utf8').split(/\r?\n/),
          'Project Code',
        );
      } catch {
        throw new DomainError(
          'CONFLICT',
          'Project folder ownership could not be verified because PROJECT_INFO.txt cannot be read.',
          409,
        );
      }
      if (projectInfoCode?.toUpperCase() !== project.projectCode.toUpperCase()) {
        throw new DomainError(
          'CONFLICT',
          'Project folder ownership is ambiguous. PROJECT_INFO.txt does not match the project reference.',
          409,
        );
      }
    } else if (project.legacyFolderName) {
      if (basename !== project.legacyFolderName) {
        throw new DomainError(
          'CONFLICT',
          'Project folder ownership is ambiguous. The folder cannot be linked to this project.',
          409,
        );
      }
    } else if (basename !== project.projectCode) {
      throw new DomainError(
        'CONFLICT',
        'Project folder ownership is ambiguous. The folder name does not match the project reference.',
        409,
      );
    }
    return resolved;
  }

  /**
   * Fail closed when any managed node between the root and the target is a
   * symbolic link, junction, or other reparse-point-like entry. Never follow a
   * managed link into an external location.
   */
  public assertNoReparsePoint(root: string, target: string): void {
    const resolvedRoot = path.resolve(root);
    const resolvedTarget = path.resolve(target);
    const relative = path.relative(resolvedRoot, resolvedTarget);
    if (relative.startsWith('..') || path.isAbsolute(relative)) {
      throw new DomainError(
        'VALIDATION_ERROR',
        'The folder resolved outside the managed project root.',
        400,
      );
    }
    const check = (candidate: string): void => {
      let stats;
      try {
        stats = lstatSync(candidate);
      } catch {
        throw new DomainError('CONFLICT', 'A managed folder could not be inspected safely.', 409, {
          code: 'FOLDER_OUT_OF_SYNC',
        });
      }
      if (stats.isSymbolicLink()) {
        throw new DomainError(
          'CONFLICT',
          'Folder structure contains a symbolic link or junction and cannot be edited safely.',
          409,
          { code: 'LINK_SAFETY' },
        );
      }
      try {
        const real = realpathSync(candidate);
        if (real.toLowerCase() !== path.resolve(candidate).toLowerCase()) {
          throw new DomainError(
            'CONFLICT',
            'Folder structure contains a symbolic link or junction and cannot be edited safely.',
            409,
            { code: 'LINK_SAFETY' },
          );
        }
      } catch (error) {
        if (error instanceof DomainError) throw error;
        throw new DomainError('CONFLICT', 'A managed folder could not be resolved safely.', 409, {
          code: 'LINK_SAFETY',
        });
      }
    };
    check(resolvedRoot);
    const segments = relative.split(path.sep).filter(Boolean);
    let current = resolvedRoot;
    for (const segment of segments) {
      current = path.join(current, segment);
      check(current);
    }
  }

  /** Resolves a canonical relative path inside the managed root and proves it is a directory. */
  public resolveManagedDescendant(root: string, relativePath: string): string {
    const resolved = path.resolve(root, relativePath);
    const safeRoot = `${path.resolve(root)}${path.sep}`.toLowerCase();
    if (!`${resolved}${path.sep}`.toLowerCase().startsWith(safeRoot)) {
      throw new DomainError(
        'VALIDATION_ERROR',
        'A folder resolved outside the managed project root.',
        400,
      );
    }
    if (!existsSync(resolved) || !statSync(resolved).isDirectory()) {
      throw new DomainError(
        'CONFLICT',
        'The folder is out of sync with the managed structure.',
        409,
        { code: 'FOLDER_OUT_OF_SYNC' },
      );
    }
    return resolved;
  }

  /**
   * Keep PROJECT_INFO.txt consistent with the current project reference after a
   * controlled reference/folder rename. Existing unrelated lines are preserved;
   * when the file is missing it is regenerated from the project record.
   */
  public updateProjectInfo(project: Project, folderPath: string): void {
    const resolved = path.resolve(folderPath);
    if (!existsSync(resolved) || !statSync(resolved).isDirectory()) {
      throw new DomainError('CONFLICT', 'The managed project folder is missing.', 409);
    }
    const infoPath = path.join(resolved, 'PROJECT_INFO.txt');
    const folderName = path.basename(resolved);
    const companyCode = project.projectCode.match(/^(\d+)_(SCT|SCLI)/i)?.[2]?.toUpperCase();
    const infoLines = [
      'SCT LIGHTING PROJECT',
      '=====================',
      `Project Number : ${project.projectCode.split('_')[0] ?? project.projectCode}`,
      `Company Code   : ${companyCode ?? CURRENT_PROJECT_PREFIX}`,
      `Project Code   : ${project.projectCode}`,
      `Project Name   : ${cleanProjectName(project.projectName)}`,
      `Client         : ${project.clientName.trim()}`,
      `Location       : ${project.siteLocation.trim()}`,
      `Stage          : ${project.designStage}`,
      `Services       : ${(project.services ?? []).join(', ')}`,
      `Date           : ${new Date(project.createdAt).toISOString().slice(0, 10)}`,
      `Date Code      : ${dateCode(new Date(project.createdAt))}`,
      `Folder Profile : ${project.folderProfile ?? 'Full Lighting Design'}`,
      `Folder Name    : ${folderName}`,
      `Created        : ${new Date().toISOString()}`,
      '',
    ];
    if (existsSync(infoPath)) {
      const existing = readFileSync(infoPath, 'utf8').split(/\r?\n/);
      const updated = existing.map((line) => {
        if (/^Project Number\s*:/i.test(line)) return infoLines[2]!;
        if (/^Company Code\s*:/i.test(line)) return infoLines[3]!;
        if (/^Project Code\s*:/i.test(line)) return infoLines[4]!;
        if (/^Folder Name\s*:/i.test(line)) return infoLines[13]!;
        return line;
      });
      writeFileSync(infoPath, updated.join('\r\n'), 'utf8');
      return;
    }
    writeFileSync(infoPath, infoLines.join('\r\n'), 'utf8');
  }
}
