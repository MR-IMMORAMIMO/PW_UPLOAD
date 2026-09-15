const { spawn } = require('node:child_process');
const {
  constants,
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  renameSync,
  statSync,
  writeFileSync,
  unlinkSync,
} = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');

const CONTEXT_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const APPLICATIONS = Object.freeze({
  AUTOCAD: Object.freeze({
    executableNames: Object.freeze(['acad.exe']),
    sourceExtensions: Object.freeze(['.dwg', '.dwt', '.dxf']),
  }),
  DIALUX: Object.freeze({
    executableNames: Object.freeze(['dialux.exe', 'dialux evo.exe']),
    sourceExtensions: Object.freeze(['.evo', '.dlx']),
  }),
});

function integrationConfigPath(dataRoot) {
  return path.join(dataRoot, 'integrations.json');
}

function readConfiguration(dataRoot) {
  try {
    const parsed = JSON.parse(readFileSync(integrationConfigPath(dataRoot), 'utf8'));
    if (!parsed || parsed.schemaVersion !== 1 || typeof parsed.applications !== 'object') {
      return { schemaVersion: 1, applications: {} };
    }
    return { schemaVersion: 1, applications: parsed.applications };
  } catch {
    return { schemaVersion: 1, applications: {} };
  }
}

function isSupportedExecutable(application, candidate) {
  if (!path.isAbsolute(candidate) || !existsSync(candidate)) return false;
  try {
    if (!statSync(candidate).isFile()) return false;
  } catch {
    return false;
  }
  return APPLICATIONS[application].executableNames.includes(path.basename(candidate).toLowerCase());
}

function boundedDiscoveryCandidates(application, environment = process.env) {
  const roots = [environment.ProgramFiles, environment['ProgramFiles(x86)']].filter(
    (value) => typeof value === 'string' && path.isAbsolute(value),
  );
  const candidates = [];
  if (application === 'AUTOCAD') {
    for (const root of roots) {
      const autodesk = path.join(root, 'Autodesk');
      if (!existsSync(autodesk)) continue;
      for (const entry of readdirSync(autodesk, { withFileTypes: true })) {
        if (entry.isDirectory() && /^AutoCAD\s/i.test(entry.name)) {
          candidates.push(path.join(autodesk, entry.name, 'acad.exe'));
        }
      }
    }
  } else {
    for (const root of roots) {
      candidates.push(
        path.join(root, 'DIAL GmbH', 'DIALux', 'DIALux.exe'),
        path.join(root, 'DIAL GmbH', 'DIALux evo', 'DIALux.exe'),
        path.join(root, 'DIAL GmbH', 'DIALux evo', 'DIALux evo.exe'),
      );
    }
  }
  return candidates;
}

function discoveredApplications(application, environment = process.env) {
  return [
    ...new Set(
      boundedDiscoveryCandidates(application, environment).map((candidate) =>
        path.resolve(candidate),
      ),
    ),
  ]
    .filter((candidate) => isSupportedExecutable(application, candidate))
    .map((executablePath) => ({
      executablePath,
      version:
        path
          .basename(path.dirname(executablePath))
          .match(/(?:AutoCAD|DIALux(?: evo)?)\s*(.*)$/i)?.[1]
          ?.trim() || null,
    }));
}

function resolveApplication(application, dataRoot, environment = process.env) {
  if (!Object.hasOwn(APPLICATIONS, application)) throw new Error('Unsupported application.');
  const configured = readConfiguration(dataRoot).applications[application];
  const discoveries = discoveredApplications(application, environment);
  if (typeof configured === 'string' && isSupportedExecutable(application, configured)) {
    return {
      application,
      available: true,
      executablePath: configured,
      selectedPath: configured,
      source: 'CONFIGURED',
      health: 'CONFIGURED',
      discoveries,
    };
  }
  if (typeof configured === 'string') {
    return {
      application,
      available: false,
      executablePath: null,
      selectedPath: configured,
      source: 'SELECTED_MISSING',
      health: 'SELECTED_VERSION_MISSING',
      discoveries,
    };
  }
  return discoveries.length > 0
    ? {
        application,
        available: false,
        executablePath: null,
        selectedPath: null,
        source: 'DISCOVERED',
        health: 'DISCOVERED_SELECTION_REQUIRED',
        discoveries,
      }
    : {
        application,
        available: false,
        executablePath: null,
        selectedPath: null,
        source: 'NOT_FOUND',
        health: 'NOT_FOUND',
        discoveries,
      };
}

function listApplicationStatus(dataRoot, environment = process.env) {
  return Object.keys(APPLICATIONS).map((application) =>
    resolveApplication(application, dataRoot, environment),
  );
}

function configureApplication(application, executablePath, dataRoot) {
  if (!Object.hasOwn(APPLICATIONS, application)) throw new Error('Unsupported application.');
  if (typeof executablePath !== 'string' || !isSupportedExecutable(application, executablePath)) {
    throw new Error('The selected executable is not valid for this application.');
  }
  mkdirSync(dataRoot, { recursive: true });
  const current = readConfiguration(dataRoot);
  const next = {
    schemaVersion: 1,
    applications: { ...current.applications, [application]: path.resolve(executablePath) },
  };
  const target = integrationConfigPath(dataRoot);
  const temporary = `${target}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(next, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  renameSync(temporary, target);
  return resolveApplication(application, dataRoot);
}

function prepareSessionInbox(dataRoot, toolContextId) {
  if (typeof toolContextId !== 'string' || !CONTEXT_ID_PATTERN.test(toolContextId)) {
    throw new Error('A valid Tool Context UUID is required.');
  }
  const inbox = path.join(dataRoot, 'automation-sessions', toolContextId, 'inbox');
  mkdirSync(inbox, { recursive: true });
  return inbox;
}

function verifiedProjectRoot(input) {
  if (
    !input ||
    typeof input.projectId !== 'string' ||
    !CONTEXT_ID_PATTERN.test(input.projectId) ||
    typeof input.authorizedProjectRoot !== 'string' ||
    !path.isAbsolute(input.authorizedProjectRoot)
  ) {
    throw new Error('A verified Project UUID and root are required.');
  }
  const root = path.resolve(input.authorizedProjectRoot);
  try {
    if (
      !statSync(root).isDirectory() ||
      realpathSync.native(root).toLowerCase() !== root.toLowerCase()
    ) {
      throw new Error('unverified');
    }
    const marker = JSON.parse(readFileSync(path.join(root, '.scli-project.json'), 'utf8'));
    if (marker.schemaVersion !== 1 || marker.projectId !== input.projectId) {
      throw new Error('unverified');
    }
  } catch {
    throw new Error('The Project storage root is not verified for this Project UUID.');
  }
  return root;
}

function pathInsideRoot(root, candidate) {
  const relative = path.relative(root, candidate);
  return (
    relative !== '' &&
    relative !== '..' &&
    !relative.startsWith(`..${path.sep}`) &&
    !path.isAbsolute(relative)
  );
}

function launchApplication(input, dataRoot, spawnProcess = spawn) {
  if (!input || !Object.hasOwn(APPLICATIONS, input.application)) {
    throw new Error('Unsupported application.');
  }
  const projectRoot = verifiedProjectRoot(input);
  const resolved = resolveApplication(input.application, dataRoot);
  if (!resolved.available) throw new Error(`${input.application} is not configured or installed.`);
  const args = [];
  if (input.sourcePath !== null && input.sourcePath !== undefined) {
    if (typeof input.sourcePath !== 'string' || !path.isAbsolute(input.sourcePath)) {
      throw new Error('The source file path must be absolute.');
    }
    const extension = path.extname(input.sourcePath).toLowerCase();
    const sourcePath = path.resolve(input.sourcePath);
    if (
      !APPLICATIONS[input.application].sourceExtensions.includes(extension) ||
      !pathInsideRoot(projectRoot, sourcePath) ||
      !existsSync(sourcePath) ||
      !lstatSync(sourcePath).isFile() ||
      lstatSync(sourcePath).isSymbolicLink() ||
      realpathSync.native(sourcePath).toLowerCase() !== sourcePath.toLowerCase()
    ) {
      throw new Error('The source file is not an eligible file for this application.');
    }
    args.push(sourcePath);
  }
  const inboxPath = prepareSessionInbox(dataRoot, input.toolContextId);
  const child = spawnProcess(resolved.executablePath, args, {
    cwd: inboxPath,
    detached: true,
    windowsHide: false,
    stdio: 'ignore',
  });
  child.unref?.();
  return { application: input.application, launched: true, inboxPath };
}

function launchTestApplication(application, dataRoot, spawnProcess = spawn) {
  const resolved = resolveApplication(application, dataRoot);
  if (!resolved.available) throw new Error(`${application} requires an explicit valid selection.`);
  const child = spawnProcess(resolved.executablePath, [], {
    cwd: dataRoot,
    detached: true,
    windowsHide: false,
    stdio: 'ignore',
  });
  child.unref?.();
  return { application, launchRequested: true };
}

function handoffPath(dataRoot, handoffId) {
  if (typeof handoffId !== 'string' || !CONTEXT_ID_PATTERN.test(handoffId)) {
    throw new Error('Invalid Desktop handoff.');
  }
  return path.join(dataRoot, 'desktop-handoffs', 'pending', `${handoffId}.json`);
}

function consumeHandoffRecord(dataRoot, handoffId, expectedAction, now = () => new Date()) {
  const pending = handoffPath(dataRoot, handoffId);
  const consuming = `${pending}.${process.pid}.${Date.now()}.consuming`;
  try {
    renameSync(pending, consuming);
  } catch {
    throw new Error('Desktop handoff is invalid, expired, or already consumed.');
  }
  try {
    const record = JSON.parse(readFileSync(consuming, 'utf8'));
    if (
      record?.schemaVersion !== 1 ||
      record.handoffId !== handoffId ||
      record.action !== expectedAction ||
      record.payload?.action !== expectedAction ||
      typeof record.expiresAt !== 'string' ||
      Date.parse(record.expiresAt) <= now().getTime()
    ) {
      throw new Error('Desktop handoff is invalid, expired, or has the wrong action.');
    }
    return record.payload;
  } finally {
    try {
      unlinkSync(consuming);
    } catch {
      // A consumed handoff is never restored to pending, even after failure.
    }
  }
}

function validatedInbox(dataRoot, toolContextId, candidate) {
  const expected = path.resolve(prepareSessionInbox(dataRoot, toolContextId));
  if (
    typeof candidate !== 'string' ||
    path.resolve(candidate).toLowerCase() !== expected.toLowerCase()
  ) {
    throw new Error('Desktop handoff Tool Session inbox does not match.');
  }
  const metadata = lstatSync(expected);
  if (!metadata.isDirectory() || metadata.isSymbolicLink())
    throw new Error('Tool Session inbox is invalid.');
  return expected;
}

function validatedImportInbox(dataRoot, importSessionId, candidate) {
  if (typeof importSessionId !== 'string' || !CONTEXT_ID_PATTERN.test(importSessionId)) {
    throw new Error('A valid Import Session UUID is required.');
  }
  const expected = path.resolve(dataRoot, 'import-stage', importSessionId, 'desktop-inbox');
  if (
    typeof candidate !== 'string' ||
    path.resolve(candidate).toLowerCase() !== expected.toLowerCase()
  ) {
    throw new Error('Desktop handoff Import Session inbox does not match.');
  }
  const metadata = lstatSync(expected);
  if (!metadata.isDirectory() || metadata.isSymbolicLink())
    throw new Error('Import Session inbox is invalid.');
  return expected;
}

function validatedDocumentInbox(dataRoot, admissionId, candidate) {
  if (typeof admissionId !== 'string' || !CONTEXT_ID_PATTERN.test(admissionId)) {
    throw new Error('A valid Document Admission UUID is required.');
  }
  const expected = path.resolve(
    dataRoot,
    'document-store',
    'staging',
    admissionId,
    'desktop-inbox',
  );
  if (
    typeof candidate !== 'string' ||
    path.resolve(candidate).toLowerCase() !== expected.toLowerCase()
  ) {
    throw new Error('Desktop handoff Document Admission inbox does not match.');
  }
  const metadata = lstatSync(expected);
  if (!metadata.isDirectory() || metadata.isSymbolicLink()) {
    throw new Error('Document Admission inbox is invalid.');
  }
  return expected;
}

function validatedProjectSourceInbox(dataRoot, admissionId, candidate) {
  if (typeof admissionId !== 'string' || !CONTEXT_ID_PATTERN.test(admissionId)) {
    throw new Error('A valid Project Source Admission UUID is required.');
  }
  const expected = path.resolve(dataRoot, 'project-sources', 'pending', admissionId);
  if (
    typeof candidate !== 'string' ||
    path.resolve(candidate).toLowerCase() !== expected.toLowerCase()
  ) {
    throw new Error('Desktop handoff Project Source inbox does not match.');
  }
  const metadata = lstatSync(expected);
  if (!metadata.isDirectory() || metadata.isSymbolicLink()) {
    throw new Error('Project Source inbox is invalid.');
  }
  return expected;
}

async function executeDesktopHandoff(input, dataRoot, handlers = {}) {
  if (!input || typeof input.expectedAction !== 'string')
    throw new Error('A bounded Desktop action is required.');
  const allowed = new Set([
    'LAUNCH_TOOL',
    'OPEN_EXPORT_FOLDER',
    'TEST_LAUNCH',
    'MANUAL_FILE_PICK',
    'SELECT_IMPORT_SOURCE',
    'SELECT_DOCUMENT_PDF',
    'SELECT_PROJECT_SOURCE',
    'OPEN_CAPTURE_FILE',
    'REVEAL_CAPTURE_FILE',
    'OPEN_LUMINAIRE_ASSET',
    'OPEN_REVISION_DELIVERABLE',
    'OPEN_PACKAGE_DELIVERABLE',
    'OPEN_LIBRARY_ASSET',
    'SAVE_LUMINAIRE_ASSET_COPY',
  ]);
  if (!allowed.has(input.expectedAction)) throw new Error('Unsupported Desktop handoff action.');
  const payload = consumeHandoffRecord(
    dataRoot,
    input.handoffId,
    input.expectedAction,
    handlers.now,
  );
  if (
    [
      'OPEN_LUMINAIRE_ASSET',
      'OPEN_REVISION_DELIVERABLE',
      'OPEN_PACKAGE_DELIVERABLE',
      'OPEN_LIBRARY_ASSET',
      'SAVE_LUMINAIRE_ASSET_COPY',
    ].includes(payload.action)
  ) {
    const root = payload.managed ? realpathSync.native(dataRoot) : verifiedProjectRoot(payload);
    if (path.resolve(payload.authorizedProjectRoot).toLowerCase() !== root.toLowerCase())
      throw new Error('Asset storage authority does not match.');
    const target = path.resolve(payload.targetPath);
    const canonical = realpathSync.native(target);
    const stat = lstatSync(target);
    if (
      !pathInsideRoot(root, canonical) ||
      canonical.toLowerCase() !== target.toLowerCase() ||
      !stat.isFile() ||
      stat.isSymbolicLink() ||
      stat.size > 50_000_000
    )
      throw new Error('The asset file is unavailable.');
    const bytes = readFileSync(target);
    if (createHash('sha256').update(bytes).digest('hex') !== payload.fileHash)
      throw new Error('The file no longer matches this asset version.');
    if (
      payload.action === 'OPEN_LUMINAIRE_ASSET' ||
      payload.action === 'OPEN_REVISION_DELIVERABLE' ||
      payload.action === 'OPEN_PACKAGE_DELIVERABLE' ||
      payload.action === 'OPEN_LIBRARY_ASSET'
    ) {
      if (!handlers.openPath) throw new Error('Opening files is unavailable.');
      const error = await handlers.openPath(target);
      if (error) throw new Error('The asset could not be opened.');
      return { action: payload.action, opened: true };
    }
    const selected = await handlers.saveFile?.(path.basename(payload.fileName));
    if (!selected) return { action: payload.action, saved: false };
    const destination = path.resolve(selected);
    if (
      !path.isAbsolute(selected) ||
      destination.toLowerCase() === target.toLowerCase() ||
      pathInsideRoot(realpathSync.native(dataRoot), destination)
    )
      throw new Error('Choose a new file outside managed application storage.');
    // A copy may never overwrite the source or another saved file, including hard links.
    writeFileSync(destination, bytes, { flag: 'wx' });
    return { action: payload.action, saved: true };
  }
  if (payload.action === 'LAUNCH_TOOL') {
    launchApplication(payload, dataRoot, handlers.spawnProcess ?? spawn);
    return { action: payload.action, application: payload.application, launchRequested: true };
  }
  if (payload.action === 'TEST_LAUNCH') {
    return launchTestApplication(payload.application, dataRoot, handlers.spawnProcess ?? spawn);
  }
  if (payload.action === 'OPEN_EXPORT_FOLDER') {
    const inbox = validatedInbox(dataRoot, payload.toolContextId, payload.inboxPath);
    const error = await handlers.openPath?.(inbox);
    if (error) throw new Error('The Tool Session Export Folder could not be opened.');
    return { action: payload.action, opened: true };
  }
  if (payload.action === 'MANUAL_FILE_PICK') {
    const inbox = validatedInbox(dataRoot, payload.toolContextId, payload.inboxPath);
    const selected = await handlers.pickFile?.(payload.allowedExtensions);
    if (!selected) return { action: payload.action, accepted: false };
    const selectedPath = path.resolve(selected);
    const extension = path.extname(selectedPath).toLowerCase();
    const metadata = lstatSync(selectedPath);
    if (
      !Array.isArray(payload.allowedExtensions) ||
      !payload.allowedExtensions.includes(extension) ||
      !metadata.isFile() ||
      metadata.isSymbolicLink() ||
      realpathSync.native(selectedPath).toLowerCase() !== selectedPath.toLowerCase()
    ) {
      throw new Error('The selected file is not eligible for this manual capture.');
    }
    copyFileSync(
      selectedPath,
      path.join(inbox, path.basename(selectedPath)),
      constants.COPYFILE_EXCL,
    );
    return { action: payload.action, accepted: true };
  }
  if (payload.action === 'SELECT_IMPORT_SOURCE') {
    const inbox = validatedImportInbox(dataRoot, payload.importSessionId, payload.inboxPath);
    const selected = await handlers.pickFile?.(payload.allowedExtensions);
    if (!selected) return { action: payload.action, accepted: false };
    const selectedPath = path.resolve(selected);
    const extension = path.extname(selectedPath).toLowerCase();
    const metadata = lstatSync(selectedPath);
    const maximumBytes = extension === '.xlsx' ? 25 * 1024 * 1024 : 10 * 1024 * 1024;
    if (
      !Array.isArray(payload.allowedExtensions) ||
      !payload.allowedExtensions.includes(extension) ||
      !metadata.isFile() ||
      metadata.isSymbolicLink() ||
      metadata.size <= 0 ||
      metadata.size > maximumBytes ||
      realpathSync.native(selectedPath).toLowerCase() !== selectedPath.toLowerCase()
    ) {
      throw new Error('The selected file is not eligible for Smart Import.');
    }
    copyFileSync(
      selectedPath,
      path.join(inbox, path.basename(selectedPath)),
      constants.COPYFILE_EXCL,
    );
    return { action: payload.action, accepted: true };
  }
  if (payload.action === 'SELECT_DOCUMENT_PDF') {
    const inbox = validatedDocumentInbox(dataRoot, payload.admissionId, payload.inboxPath);
    const selected = await handlers.pickFile?.(payload.allowedExtensions);
    if (!selected) return { action: payload.action, accepted: false };
    const selectedPath = path.resolve(selected);
    const metadata = lstatSync(selectedPath);
    if (
      path.extname(selectedPath).toLowerCase() !== '.pdf' ||
      !metadata.isFile() ||
      metadata.isSymbolicLink() ||
      metadata.size <= 0 ||
      metadata.size > 50 * 1024 * 1024 ||
      realpathSync.native(selectedPath).toLowerCase() !== selectedPath.toLowerCase()
    ) {
      throw new Error('The selected file is not an eligible PDF document.');
    }
    copyFileSync(
      selectedPath,
      path.join(inbox, path.basename(selectedPath)),
      constants.COPYFILE_EXCL,
    );
    return { action: payload.action, accepted: true };
  }
  if (payload.action === 'SELECT_PROJECT_SOURCE') {
    // P5D — governed Project source picker. The selected file must be a
    // regular, non-symlink file INSIDE the verified Project root, with an
    // allowed extension and within the controlled size bound. The file is
    // copied into the admission inbox; the API moves it to its governed
    // project-relative location and fingerprints it server-side.
    const root = verifiedProjectRoot(payload);
    const inbox = validatedProjectSourceInbox(dataRoot, payload.admissionId, payload.inboxPath);
    const selected = await handlers.pickFile?.(payload.allowedExtensions);
    if (!selected) return { action: payload.action, accepted: false };
    const selectedPath = path.resolve(selected);
    const metadata = lstatSync(selectedPath);
    if (
      !Array.isArray(payload.allowedExtensions) ||
      !payload.allowedExtensions.includes(path.extname(selectedPath).toLowerCase()) ||
      !metadata.isFile() ||
      metadata.isSymbolicLink() ||
      metadata.size <= 0 ||
      metadata.size > payload.maximumBytes ||
      realpathSync.native(selectedPath).toLowerCase() !== selectedPath.toLowerCase() ||
      !pathInsideRoot(root, selectedPath)
    ) {
      throw new Error('The selected file is not an eligible controlled Project source.');
    }
    copyFileSync(
      selectedPath,
      path.join(inbox, path.basename(selectedPath)),
      constants.COPYFILE_EXCL,
    );
    return { action: payload.action, accepted: true };
  }
  const root = verifiedProjectRoot(payload);
  const target = path.resolve(payload.targetPath);
  if (!pathInsideRoot(root, target))
    throw new Error('Capture file is outside verified Project storage.');
  const metadata = lstatSync(target);
  if (!metadata.isFile() || metadata.isSymbolicLink())
    throw new Error('Capture file is unavailable.');
  if (payload.action === 'OPEN_CAPTURE_FILE') {
    const error = await handlers.openPath?.(target);
    if (error) throw new Error('The capture file could not be opened.');
  } else {
    handlers.reveal?.(target);
  }
  return { action: payload.action, opened: true };
}

module.exports = {
  APPLICATIONS,
  configureApplication,
  discoveredApplications,
  executeDesktopHandoff,
  launchApplication,
  launchTestApplication,
  listApplicationStatus,
  prepareSessionInbox,
  resolveApplication,
};
