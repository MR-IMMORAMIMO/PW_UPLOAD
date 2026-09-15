import { applyV29FinalUiRelations } from './infrastructure/migration/registry/production-v29-final-ui-relations';
import { applyV30OptionalContactEmail } from './infrastructure/migration/registry/production-v30-optional-contact-email';
import { createHash, randomUUID } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';
import { loadConfig } from '@scli/config';
import {
  deriveFolderRelativePath,
  factoryProfileSource,
  folderProfileStructuralFingerprint,
  type AppUser,
  type CanonicalRevisionRecord,
  type FolderProfilePreset,
  type Project,
  type ProjectFolderDraft,
  type ToolContext,
} from '@scli/domain';
import { StandaloneDataProvider } from './standalone-data-provider';
import { PersonalWorkspaceStore, builtInFolderProfiles } from './personal-workspace-store';
import { ProjectService } from './project-service';
import { ProjectStorageService } from './project-storage-service';
import { ManagedArtifactStore } from './infrastructure/managed-artifact/ManagedArtifactStore';
import { CaptureLedgerService } from './infrastructure/managed-artifact/CaptureLedgerService';
import { CaptureStagingService } from './infrastructure/managed-artifact/CaptureStagingService';
import { ToolContextService } from './infrastructure/managed-artifact/ToolContextService';
import { CaptureDestinationResolver } from './infrastructure/automation/CaptureDestinationResolver';
import {
  CaptureFilingService,
  type CaptureFilingInput,
  type CaptureFilingResult,
} from './infrastructure/automation/CaptureFilingService';
import { CaptureInboxCoordinator } from './infrastructure/automation/CaptureInboxCoordinator';
import { contextInboxPath } from './infrastructure/automation/CaptureInboxBoundary';
import { CapturePersistenceService } from './infrastructure/automation/CapturePersistenceService';
import { CaptureRoutingCoordinator } from './infrastructure/automation/CaptureRoutingCoordinator';
import {
  manualAdmissionAuditPath,
  type ManualAdmissionAudit,
} from './infrastructure/automation/ManualCaptureService';
import { CaptureDispositionService } from './infrastructure/automation/CaptureDispositionService';
import { DesktopHandoffService } from './infrastructure/automation/DesktopHandoffService';
import { AutomationContextService } from './infrastructure/automation/AutomationContextService';
import { ToolSessionWorkflowService } from './infrastructure/automation/ToolSessionWorkflowService';
import { ProjectOutputMappingService } from './infrastructure/automation/ProjectOutputMappingService';
import { CanonicalOutputRegistryStore } from './infrastructure/output-registry/CanonicalOutputRegistryStore';
import { RevisionDeleteService } from './infrastructure/output-registry/RevisionDeleteService';
import { RevisionDeliverableService } from './infrastructure/output-registry/RevisionDeliverableService';
import { RevisionReuseService } from './infrastructure/output-registry/RevisionReuseService';
import { VersionedMigrationFixtureBuilder } from './infrastructure/migration/testing/VersionedMigrationFixtureBuilder';
import {
  applyV20AutomationRevisionBindingAudit,
  applyV21OutputPresentationFamily,
  EXTERNALLY_MIGRATED,
} from './infrastructure/migration/registry/production-migration-registry';
import { applyV22LuminaireLibrarySchema } from './infrastructure/migration/registry/production-v22-luminaire-library';
import { applyV23LuminaireLibraryHardening } from './infrastructure/migration/registry/production-v23-luminaire-library-hardening';
import { applyV24SmartImportInspection } from './infrastructure/migration/registry/production-v24-smart-import-inspection';
import { applyV25SmartImportProjectApply } from './infrastructure/migration/registry/production-v25-smart-import-project-apply';
import { applyV26DocumentIntelligence } from './infrastructure/migration/registry/production-v26-document-intelligence';
import { applyV27LuminaireDatasheetVerification } from './infrastructure/migration/registry/production-v27-luminaire-datasheet-verification';
import { applyV28ProjectIntelligenceProductivity } from './infrastructure/migration/registry/production-v28-project-intelligence-productivity';

const AT = '2026-08-24T12:00:00.000Z';
const roots: string[] = [];
const closeables: Array<{ close(): void }> = [];

afterEach(() => {
  for (const closeable of closeables.splice(0).reverse()) closeable.close();
  for (const root of roots.splice(0).reverse()) {
    rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  }
});

interface Harness {
  root: string;
  dataRoot: string;
  database: DatabaseSync;
  provider: StandaloneDataProvider;
  store: PersonalWorkspaceStore;
  project: Project;
  admin: AppUser;
  projectRoot: string;
  registry: CanonicalOutputRegistryStore;
  storage: ProjectStorageService;
  artifacts: ManagedArtifactStore;
  captures: CaptureLedgerService;
  contexts: ToolContextService;
  staging: CaptureStagingService;
  destinations: CaptureDestinationResolver;
  persistence: CapturePersistenceService;
  routing: (
    persistence?: CapturePersistenceService,
    filing?: CaptureFilingService,
  ) => CaptureRoutingCoordinator;
}

async function makeHarness(): Promise<Harness> {
  const root = mkdtempSync(path.join(tmpdir(), 'scli-p4b-routing-'));
  roots.push(root);
  const databasePath = path.join(root, 'workspace.sqlite');
  VersionedMigrationFixtureBuilder.build({ outputPath: databasePath, version: 19 });
  const database = new DatabaseSync(databasePath);
  closeables.push(database);
  database.exec('BEGIN IMMEDIATE');
  applyV20AutomationRevisionBindingAudit(database);
  applyV21OutputPresentationFamily(database, AT);
  applyV22LuminaireLibrarySchema(database);
  applyV23LuminaireLibraryHardening(database);
  applyV24SmartImportInspection(database);
  applyV25SmartImportProjectApply(database);
  applyV26DocumentIntelligence(database);
  applyV27LuminaireDatasheetVerification(database);
  applyV28ProjectIntelligenceProductivity(database);
  applyV29FinalUiRelations(database);
  applyV30OptionalContactEmail(database);
  database.exec('PRAGMA user_version = 30; COMMIT; PRAGMA foreign_keys = ON;');
  const config = loadConfig({
    APP_MODE: 'standalone',
    WORKSPACE_VARIANT: 'personal',
    PERSONAL_AUTO_LOGIN: 'true',
    NODE_ENV: 'test',
    LOG_LEVEL: 'silent',
    STANDALONE_DB_PATH: databasePath,
    STANDALONE_SESSION_SECRET: 'p4b-routing-test-secret-longer-than-thirty-two-characters',
    STANDALONE_ADMIN_NAME: 'P4B Owner',
    STANDALONE_ADMIN_EMAIL: 'p4b-owner@local.test',
    STANDALONE_ADMIN_PASSWORD: 'A-Strong-P4B-Password-2026!',
    PERSONAL_PROJECT_ROOT: path.join(root, 'projects'),
    COMPANY_TIMEZONE: 'Asia/Dubai',
  });
  const provider = new StandaloneDataProvider(config, EXTERNALLY_MIGRATED, database);
  const store = new PersonalWorkspaceStore(config, EXTERNALLY_MIGRATED, database);
  const admin = (await provider.listUsers()).find((user) => user.role === 'Admin');
  if (!admin) throw new Error('Disposable Admin fixture missing.');
  const project = (
    await new ProjectService(
      provider,
      config.COMPANY_TIMEZONE,
      () => new Date(AT),
      'personal',
    ).createProject(admin, {
      projectName: 'P4B Routing Reality',
      clientName: 'Disposable Client',
      projectType: 'Lighting Layout',
      description: 'Disposable P4B routing evidence.',
      collaboratorDesignerIds: [],
      siteLocation: 'Dubai, UAE',
      designStage: 'Concept',
      lightingScope: 'Lighting design.',
      luxRequirements: '500 lux.',
      drawingReference: 'A-101',
      priority: 'Normal',
      complexity: 'Medium',
      estimatedHours: 1,
      requiredDeliveryDate: '2026-08-30',
      projectFolderUrl: null,
      idempotencyKey: randomUUID(),
    })
  ).project;
  const preset = builtInFolderProfiles.find(
    (candidate) => candidate.factoryProfileKey === 'full-lighting-design',
  );
  if (!preset) throw new Error('Full Lighting Design factory profile missing.');
  store.initializeCanonicalProject(
    project.id,
    presetDraft(preset),
    preset.name,
    ['LightingLayout'],
    'Later',
    project.requiredDeliveryDate,
  );
  const projectRoot = path.join(config.PERSONAL_PROJECT_ROOT, project.projectCode);
  mkdirSync(projectRoot, { recursive: true });
  const storage = new ProjectStorageService(provider, store, undefined, () => new Date(AT));
  const connected = await storage.reconnect(project, {
    candidatePath: projectRoot,
    intent: 'INITIAL_BINDING',
    expectedVersion: project.version,
  });
  for (const folder of store.getWorkspace(project.id).folderSnapshot.folders) {
    if (!folder.enabled) continue;
    const relative = deriveFolderRelativePath(
      store.getWorkspace(project.id).folderSnapshot,
      folder.folderId,
    );
    if (relative) mkdirSync(path.join(projectRoot, relative), { recursive: true });
  }
  const registry = new CanonicalOutputRegistryStore(
    database,
    { now: () => new Date(AT) },
    'CANONICAL',
  );
  registry.registerBuiltInTemplateVersions();
  const artifacts = new ManagedArtifactStore(database);
  const captures = new CaptureLedgerService(artifacts);
  const contexts = new ToolContextService(artifacts);
  const dataRoot = root;
  const staging = new CaptureStagingService({
    store: artifacts,
    captures,
    dataRoot,
    stabilizationPolicy: { requiredStableSamples: 3, sampleIntervalMs: 1, timeoutMs: 250 },
  });
  const destinations = new CaptureDestinationResolver(provider, store, storage, registry);
  const persistence = new CapturePersistenceService(store, artifacts, captures, registry);
  const routing = (
    selectedPersistence: CapturePersistenceService = persistence,
    filing: CaptureFilingService = new CaptureFilingService(),
  ) =>
    new CaptureRoutingCoordinator(
      dataRoot,
      contexts,
      captures,
      staging,
      artifacts,
      destinations,
      filing,
      selectedPersistence,
      () => new Date(AT),
    );
  return {
    root,
    dataRoot,
    database,
    provider,
    store,
    project: connected.project,
    admin,
    projectRoot,
    registry,
    storage,
    artifacts,
    captures,
    contexts,
    staging,
    destinations,
    persistence,
    routing,
  };
}

function presetDraft(preset: FolderProfilePreset): ProjectFolderDraft {
  const pathToId = new Map<string, string>();
  const folders: ProjectFolderDraft['folders'][number][] = [];
  const flatten = (
    nodes: FolderProfilePreset['folders'],
    parentPath: string,
    parentId: string | null,
  ): void => {
    nodes.forEach((node, displayOrder) => {
      const id = randomUUID();
      const relative = parentPath ? `${parentPath}/${node.name}` : node.name;
      pathToId.set(relative.toLowerCase(), id);
      folders.push({
        draftFolderId: id,
        parentDraftFolderId: parentId,
        name: node.name,
        displayOrder,
      });
      flatten(node.children, relative, id);
    });
  };
  flatten(preset.folders, '', null);
  const outputMappings: ProjectFolderDraft['outputMappings'][number][] = [];
  for (const [outputTypeId, destinationPath] of Object.entries(preset.outputFolders)) {
    if (!destinationPath) continue;
    const destinationDraftFolderId = pathToId.get(destinationPath.toLowerCase());
    if (destinationDraftFolderId) outputMappings.push({ outputTypeId, destinationDraftFolderId });
  }
  return {
    folders,
    outputMappings,
    sourceProfile: factoryProfileSource(
      preset.factoryProfileKey!,
      preset.name,
      folderProfileStructuralFingerprint(preset.folders, preset.outputFolders),
    ),
  };
}

function prepareRevision(h: Harness): CanonicalRevisionRecord {
  return new RevisionDeliverableService(h.store, h.registry, h.artifacts).prepareRevision(
    h.project,
    h.store.getWorkspace(h.project.id),
    h.admin,
  );
}

function openContext(
  h: Harness,
  artifactType: 'DIALUX_REPORT' | 'CAD_LAYOUT_PDF' | 'CAD_WORKING_DRAWING',
  revisionId: string | null = null,
): ToolContext {
  const context = h.contexts.open({
    projectId: h.project.id,
    targetRevisionId: revisionId,
    tool: artifactType === 'DIALUX_REPORT' ? 'DIALUX' : 'AUTOCAD',
    expectedArtifactType: artifactType,
    mode: 'EXTERNAL_OUTPUT_SESSION',
    channel: 'DEDICATED_SESSION_INBOX',
    openedAt: AT,
  });
  mkdirSync(contextInboxPath(h.dataRoot, context.toolContextId), { recursive: true });
  return context;
}

async function reconcile(h: Harness, context: ToolContext, routing = h.routing()): Promise<void> {
  const inbox = new CaptureInboxCoordinator(h.dataRoot, h.contexts, routing, 60_000);
  inbox.activate(context);
  await inbox.reconcileContext(context.toolContextId);
  await inbox.close();
}

function writeInbox(
  h: Harness,
  context: ToolContext,
  name: string,
  bytes: string | Buffer,
): string {
  const source = path.join(contextInboxPath(h.dataRoot, context.toolContextId), name);
  writeFileSync(source, bytes);
  return source;
}

async function stageOnly(h: Harness, context: ToolContext, source: string): Promise<string> {
  const proof = await h.staging.proveStableCandidate(source);
  const found = h.captures.findOrCreateProvenDetectedCapture({
    projectId: h.project.id,
    targetRevisionId: context.targetRevisionId,
    toolContextId: context.toolContextId,
    sourcePath: source,
    sourceChannel: context.channel,
    expectedArtifactType: context.expectedArtifactType,
    detectedAt: AT,
    contentHash: proof.contentHash,
    sizeBytes: proof.sizeBytes,
  });
  await h.staging.stageCapture(found.entry.captureId, AT);
  return found.entry.captureId;
}

function sha(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function restartedRouting(h: Harness): {
  captures: CaptureLedgerService;
  artifacts: ManagedArtifactStore;
  staging: CaptureStagingService;
  routing: CaptureRoutingCoordinator;
} {
  const artifacts = new ManagedArtifactStore(h.database);
  const captures = new CaptureLedgerService(artifacts);
  const contexts = new ToolContextService(artifacts);
  const staging = new CaptureStagingService({
    store: artifacts,
    captures,
    dataRoot: h.dataRoot,
    stabilizationPolicy: { requiredStableSamples: 3, sampleIntervalMs: 1, timeoutMs: 250 },
  });
  const destinations = new CaptureDestinationResolver(h.provider, h.store, h.storage, h.registry);
  const persistence = new CapturePersistenceService(h.store, artifacts, captures, h.registry);
  return {
    captures,
    artifacts,
    staging,
    routing: new CaptureRoutingCoordinator(
      h.dataRoot,
      contexts,
      captures,
      staging,
      artifacts,
      destinations,
      new CaptureFilingService(),
      persistence,
      () => new Date(AT),
    ),
  };
}

function addBaselineSnapshot(h: Harness, revision: CanonicalRevisionRecord): void {
  const documentId = randomUUID();
  h.database
    .prepare(
      `INSERT INTO project_documents
       (id, project_id, category, document_number, title, revision, status, file_path,
        issued_to, issue_date, notes, created_at, updated_at)
       VALUES (?, ?, 'Drawing', 'BASELINE', 'Baseline', ?, 'InternalReview',
               '00_RECEIVED/baseline.pdf', '', NULL, '', ?, ?)`,
    )
    .run(documentId, h.project.id, revision.revisionLabel, AT, AT);
  h.registry.createDocumentSnapshot({
    projectId: h.project.id,
    revisionId: revision.revisionId,
    sourceDocumentId: documentId,
    category: 'Drawing',
    title: 'Baseline',
    fileName: 'baseline.pdf',
    sourceRelativePath: '00_RECEIVED/baseline.pdf',
    locatorValue: `DELIVERABLES/${revision.revisionLabel}/baseline.pdf`,
    contentHash: sha('baseline'),
    sizeBytes: 8,
    createdBy: null,
  });
}

describe('P4B watcher-to-routing reality', () => {
  it('ignores CAD transient files before creating any capture ledger record', async () => {
    const h = await makeHarness();
    const context = openContext(h, 'CAD_WORKING_DRAWING');
    for (const name of ['save.tmp', 'drawing.dwl', 'drawing.DWL2', 'acad.err'])
      writeInbox(h, context, name, 'temporary');
    await reconcile(h, context);
    expect(h.captures.list(h.project.id)).toHaveLength(0);
    writeInbox(h, context, 'drawing.dwg', 'AC1032 durable drawing');
    await reconcile(h, context);
    expect(h.captures.list(h.project.id)).toHaveLength(1);
    expect(h.captures.list(h.project.id)[0]?.state).toBe('COMPLETED');
  });
  it('updates only a supported enabled output folder under the expected fingerprint', async () => {
    const h = await makeHarness();
    const workspace = h.store.getWorkspace(h.project.id);
    const folder = workspace.folderSnapshot.folders.find((candidate) => candidate.enabled)!;
    const mappings = new ProjectOutputMappingService(h.store);
    expect(() =>
      mappings.update(h.project.id, 'dialuxReport', {
        destinationFolderId: folder.folderId,
        expectedFingerprint: 'stale',
      }),
    ).toThrow(/configuration changed/i);
    const updated = mappings.update(h.project.id, 'dialuxReport', {
      destinationFolderId: folder.folderId,
      expectedFingerprint: workspace.folderConfigurationFingerprint,
    });
    expect(updated.outputMappings).toContainEqual(
      expect.objectContaining({
        outputTypeId: 'dialuxReport',
        destinationFolderId: folder.folderId,
        unresolved: false,
      }),
    );
  });

  it('starts one exact validated Tool Session and reuses its LIVE identity', async () => {
    const h = await makeHarness();
    const documentId = randomUUID();
    const sourcePath = path.join(h.projectRoot, 'source.dwg');
    writeFileSync(sourcePath, 'source');
    h.database
      .prepare(
        `INSERT INTO project_documents
         (id, project_id, category, document_number, title, revision, status, file_path,
          issued_to, issue_date, notes, created_at, updated_at)
         VALUES (?, ?, 'Drawing', 'CAD', 'CAD Source', '', 'Working', ?, '', NULL, '', ?, ?)`,
      )
      .run(documentId, h.project.id, sourcePath, AT, AT);
    const automation = new AutomationContextService(h.database, h.artifacts, () => new Date(AT));
    const workflow = new ToolSessionWorkflowService(
      h.database,
      h.provider,
      h.storage,
      automation,
      new DesktopHandoffService(h.dataRoot, () => new Date(AT)),
      h.dataRoot,
    );
    const input = {
      application: 'AUTOCAD' as const,
      artifactType: 'CAD_WORKING_DRAWING' as const,
      targetRevisionId: null,
      sourceDocumentId: documentId,
    };
    const first = await workflow.start(h.project.id, input);
    const replay = await workflow.start(h.project.id, input);
    expect(first.reusedExisting).toBe(false);
    expect(replay.reusedExisting).toBe(true);
    expect(replay.toolSession.toolContextId).toBe(first.toolSession.toolContextId);
    expect(replay.launchHandoff.handoffId).not.toBe(first.launchHandoff.handoffId);
    expect(automation.list(h.project.id)).toHaveLength(1);
  });

  it('uses USER_CONFIRMED once for manual admission and closes the one-shot context', async () => {
    const h = await makeHarness();
    const context = h.contexts.open({
      projectId: h.project.id,
      targetRevisionId: null,
      tool: 'AUTOCAD',
      expectedArtifactType: 'CAD_WORKING_DRAWING',
      mode: 'MANUAL_EXPLICIT',
      channel: 'MANUAL_PICKER_INBOX',
      openedAt: AT,
    });
    mkdirSync(contextInboxPath(h.dataRoot, context.toolContextId), { recursive: true });
    const audit: ManualAdmissionAudit = {
      actorId: h.admin.id,
      actorName: h.admin.displayName,
      authorizedAt: AT,
    };
    writeFileSync(
      manualAdmissionAuditPath(h.dataRoot, context.toolContextId),
      JSON.stringify(audit),
    );
    writeInbox(h, context, 'manual.dwg', 'manual-working');
    await reconcile(h, context);
    expect(h.captures.list(h.project.id)[0]).toMatchObject({
      state: 'COMPLETED',
      routingDecision: 'USER_CONFIRMED',
      decidedById: h.admin.id,
      decidedByName: h.admin.displayName,
    });
    expect(h.contexts.get(context.toolContextId).state).toBe('CLOSED');
  });

  it('discards Needs Attention without rewriting an existing AUTO_APPROVED decision', async () => {
    const h = await makeHarness();
    const context = openContext(h, 'CAD_WORKING_DRAWING');
    const source = writeInbox(h, context, 'working.dwg', 'post-approved');
    const captureId = await stageOnly(h, context, source);
    h.captures.recordRoutingDecision(captureId, {
      decision: 'AUTO_APPROVED',
      reason: 'ALL_OBJECTIVE_ROUTING_GATES_PASSED',
      decidedAt: AT,
    });
    h.captures.markFailedRecoverable(captureId, 'STORAGE_UNAVAILABLE', AT);
    const disposition = new CaptureDispositionService(
      h.provider,
      h.captures,
      h.artifacts,
      h.storage,
      new DesktopHandoffService(h.dataRoot, () => new Date(AT)),
      () => new Date(AT),
    );
    const discarded = disposition.discard(
      captureId,
      { reason: 'OUTPUT_NO_LONGER_REQUIRED' },
      h.admin,
    );
    expect(discarded).toMatchObject({ state: 'DISCARDED', routingDecision: 'AUTO_APPROVED' });
  });
  it('routes through the exact inbox, retains proofs, and converges duplicate events', async () => {
    const h = await makeHarness();
    const context = openContext(h, 'CAD_WORKING_DRAWING');
    const source = writeInbox(h, context, 'working.dwg', 'working-v1');
    await reconcile(h, context);

    const first = h.captures.list(h.project.id)[0]!;
    expect(first).toMatchObject({ state: 'COMPLETED', routingDecision: 'AUTO_APPROVED' });
    expect(existsSync(source)).toBe(true);
    expect(existsSync(h.staging.finalStagedPathFor(first.captureId))).toBe(true);
    const artifact = h.artifacts.getManagedArtifact(first.finalArtifactId!);
    expect(artifact.canonicalPath).toBe(
      `03_DRAWINGS/WORKING/${h.project.projectCode}_CAD_WORKING.dwg`,
    );
    expect(readFileSync(path.join(h.projectRoot, artifact.canonicalPath), 'utf8')).toBe(
      'working-v1',
    );
    expect(h.artifacts.listArtifactVersions(artifact.artifactId)).toHaveLength(1);
    expect(h.registry.listDocumentSnapshotsForRevision(h.project.id)).toEqual([]);

    await reconcile(h, context);
    expect(h.captures.list(h.project.id)).toHaveLength(1);
  });

  it('allocates base/A02/A03, versions and snapshots without overwrite under concurrent candidates', async () => {
    const h = await makeHarness();
    const revision = prepareRevision(h);
    const context = openContext(h, 'DIALUX_REPORT', revision.revisionId);
    writeInbox(h, context, 'one.pdf', 'dialux-one');
    writeInbox(h, context, 'two.pdf', 'dialux-two');
    await reconcile(h, context);
    writeInbox(h, context, 'three.pdf', 'dialux-three');
    await reconcile(h, context);

    const completed = h.captures
      .list(h.project.id)
      .filter((capture) => capture.state === 'COMPLETED');
    expect(completed).toHaveLength(3);
    const artifact = h.artifacts.getManagedArtifact(completed[0]!.finalArtifactId!);
    expect(
      h.artifacts.listArtifactVersions(artifact.artifactId).map((version) => version.version),
    ).toEqual([1, 2, 3]);
    expect(h.registry.listDocumentSnapshotsForRevision(revision.revisionId)).toHaveLength(3);
    const files = completed
      .map((capture) =>
        path.posix.basename(h.artifacts.getArtifactVersion(capture.finalVersionId!).locatorValue),
      )
      .sort();
    expect(files).toEqual([
      `${h.project.projectCode}_DIALUX_REPORT_${revision.revisionLabel}.pdf`,
      `${h.project.projectCode}_DIALUX_REPORT_${revision.revisionLabel}_A02.pdf`,
      `${h.project.projectCode}_DIALUX_REPORT_${revision.revisionLabel}_A03.pdf`,
    ]);
    await reconcile(h, context);
    expect(h.captures.list(h.project.id)).toHaveLength(3);
  });

  it('keeps FINALIZED targets unresolved and fails recoverably when finalization races after the file', async () => {
    const finalized = await makeHarness();
    const revision = prepareRevision(finalized);
    addBaselineSnapshot(finalized, revision);
    finalized.registry.setRevisionLifecycle(revision.revisionId, 'FINALIZED');
    const context = openContext(finalized, 'CAD_LAYOUT_PDF', revision.revisionId);
    writeInbox(finalized, context, 'layout.pdf', 'finalized-layout');
    await reconcile(finalized, context);
    const unresolved = finalized.captures.list(finalized.project.id)[0]!;
    expect(unresolved).toMatchObject({
      state: 'UNRESOLVED',
      routingDecision: null,
      error: 'TARGET_REVISION_FINALIZED',
    });
    expect(existsSync(finalized.staging.finalStagedPathFor(unresolved.captureId))).toBe(true);
    expect(finalized.registry.listDocumentSnapshotsForRevision(revision.revisionId)).toHaveLength(
      1,
    );

    const raced = await makeHarness();
    const racingRevision = prepareRevision(raced);
    addBaselineSnapshot(raced, racingRevision);
    const racingContext = openContext(raced, 'CAD_LAYOUT_PDF', racingRevision.revisionId);
    writeInbox(raced, racingContext, 'layout.pdf', 'racing-layout');
    const persistence = raced.persistence;
    let finalizedAfterFile = false;
    const racePersistence = {
      admit: (input: Parameters<CapturePersistenceService['admit']>[0]) => {
        const admitted = persistence.admit(input);
        if (!finalizedAfterFile) {
          finalizedAfterFile = true;
          raced.registry.setRevisionLifecycle(racingRevision.revisionId, 'FINALIZED');
        }
        return admitted;
      },
      admitVersion: persistence.admitVersion.bind(persistence),
      admitRevisionSnapshot: persistence.admitRevisionSnapshot.bind(persistence),
    } as CapturePersistenceService;
    await reconcile(raced, racingContext, raced.routing(racePersistence));
    const failed = raced.captures.list(raced.project.id)[0]!;
    expect(failed).toMatchObject({ state: 'FAILED_RECOVERABLE', routingDecision: 'AUTO_APPROVED' });
    expect(raced.registry.listDocumentSnapshotsForRevision(racingRevision.revisionId)).toHaveLength(
      1,
    );
  });

  it('rejects the deleted Revision UUID after canonical sequence reuse without attaching to its replacement', async () => {
    const h = await makeHarness();
    const revisionA = prepareRevision(h);
    const context = openContext(h, 'DIALUX_REPORT', revisionA.revisionId);
    const source = writeInbox(h, context, 'report.pdf', 'stale-report');
    const captureId = await stageOnly(h, context, source);
    const deletion = new RevisionDeleteService(h.store, h.registry, () => new Date(AT));
    const deleted = await deletion.deleteRevision(h.project, revisionA.revisionId, h.admin);
    expect(deleted.outcome).toBe('DELETED');
    const revisionB = new RevisionReuseService(
      h.store,
      h.registry,
      () => new Date(AT),
    ).reuseRevision(h.project, h.admin, {
      deleteOperationId: deleted.operation.operationId,
      reason: 'P4B stale UUID proof',
    });
    expect(revisionB.revisionSequence).toBe(revisionA.revisionSequence);
    expect(revisionB.revisionId).not.toBe(revisionA.revisionId);

    const result = await h.routing().route(captureId);
    expect(result).toMatchObject({
      targetRevisionId: revisionA.revisionId,
      state: 'DISCARDED',
      routingDecision: 'REJECTED',
      routingReason: 'TARGET_REVISION_STALE_OR_DELETED',
    });
    expect(h.registry.listDocumentSnapshotsForRevision(revisionB.revisionId)).toEqual([]);
  });

  it('preserves source/staging while storage is moved and succeeds after exact-marker reconnect', async () => {
    const h = await makeHarness();
    const context = openContext(h, 'CAD_WORKING_DRAWING');
    const source = writeInbox(h, context, 'working.dwg', 'storage-retry');
    const captureId = await stageOnly(h, context, source);
    const moved = path.join(h.root, 'moved-project-root');
    renameSync(h.projectRoot, moved);
    const failed = await h.routing().route(captureId);
    expect(failed.state).toBe('FAILED_RECOVERABLE');
    expect(existsSync(source)).toBe(true);
    expect(existsSync(h.staging.finalStagedPathFor(captureId))).toBe(true);
    expect(existsSync(path.join(moved, `${h.project.projectCode}_CAD_WORKING.dwg`))).toBe(false);

    const latest = await h.provider.getProject(h.project.id);
    if (!latest) throw new Error('Project disappeared from disposable provider.');
    const reconnected = await h.storage.reconnect(latest, {
      candidatePath: moved,
      intent: 'MATCHING_MARKER',
      expectedVersion: latest.version,
    });
    h.project = reconnected.project;
    h.projectRoot = moved;
    const completed = await h.routing().retry(captureId);
    expect(completed.state).toBe('COMPLETED');
    expect(
      existsSync(
        path.join(moved, h.artifacts.getManagedArtifact(completed.finalArtifactId!).canonicalPath),
      ),
    ).toBe(true);
  });

  it('leaves an exact missing mapping unresolved and succeeds only after explicit config repair', async () => {
    const h = await makeHarness();
    const workspace = h.store.getWorkspace(h.project.id);
    const removed = workspace.outputMappings.find(
      (mapping) => mapping.outputTypeId === 'cadWorkingDrawing',
    );
    if (!removed) throw new Error('Factory CAD working mapping missing.');
    h.database
      .prepare('UPDATE project_workspaces SET output_folders_json = ? WHERE project_id = ?')
      .run(
        JSON.stringify({
          schemaVersion: '1.0',
          mappings: workspace.outputMappings.filter(
            (mapping) => mapping.outputTypeId !== 'cadWorkingDrawing',
          ),
        }),
        h.project.id,
      );
    const context = openContext(h, 'CAD_WORKING_DRAWING');
    writeInbox(h, context, 'unmapped.dwg', 'mapping-retry');
    await reconcile(h, context);
    const unresolved = h.captures.list(h.project.id)[0]!;
    expect(unresolved).toMatchObject({
      state: 'UNRESOLVED',
      routingDecision: null,
      error: 'DESTINATION_MAPPING_REQUIRED',
    });
    expect(
      existsSync(
        path.join(
          h.projectRoot,
          '03_DRAWINGS',
          'WORKING',
          `${h.project.projectCode}_CAD_WORKING.dwg`,
        ),
      ),
    ).toBe(false);

    h.database
      .prepare('UPDATE project_workspaces SET output_folders_json = ? WHERE project_id = ?')
      .run(
        JSON.stringify({
          schemaVersion: '1.0',
          mappings: [...h.store.getWorkspace(h.project.id).outputMappings, removed],
        }),
        h.project.id,
      );
    const completed = await h.routing().retry(unresolved.captureId);
    expect(completed.state).toBe('COMPLETED');
  });

  it('retains recovery evidence on a finalization failure and retries without a corrupt final', async () => {
    const h = await makeHarness();
    const context = openContext(h, 'CAD_WORKING_DRAWING');
    const source = writeInbox(h, context, 'working.dwg', 'permission-retry');
    class FailOnceFiling extends CaptureFilingService {
      private failed = false;
      public override async file(input: CaptureFilingInput): Promise<CaptureFilingResult> {
        if (!this.failed) {
          this.failed = true;
          throw Object.assign(new Error('EACCES: injected destination permission failure'), {
            code: 'EACCES',
          });
        }
        return super.file(input);
      }
    }
    const filing = new FailOnceFiling();
    await reconcile(h, context, h.routing(h.persistence, filing));
    const failed = h.captures.list(h.project.id)[0]!;
    expect(failed.state).toBe('FAILED_RECOVERABLE');
    expect(existsSync(source)).toBe(true);
    expect(existsSync(h.staging.finalStagedPathFor(failed.captureId))).toBe(true);
    expect(
      existsSync(
        path.join(
          h.projectRoot,
          '03_DRAWINGS',
          'WORKING',
          `${h.project.projectCode}_CAD_WORKING.dwg`,
        ),
      ),
    ).toBe(false);
    const completed = await h.routing(h.persistence, filing).retry(failed.captureId);
    expect(completed.state).toBe('COMPLETED');
    expect(h.artifacts.getArtifactVersion(completed.finalVersionId!).contentHash).toBe(
      sha('permission-retry'),
    );
  });

  it('recovers a STABILIZING capture after restart', async () => {
    const stabilizingHarness = await makeHarness();
    const stabilizingContext = openContext(stabilizingHarness, 'CAD_WORKING_DRAWING');
    const stabilizingSource = writeInbox(
      stabilizingHarness,
      stabilizingContext,
      'stabilizing.dwg',
      'restart-stabilizing',
    );
    const stabilizingProof =
      await stabilizingHarness.staging.proveStableCandidate(stabilizingSource);
    const stabilizingCapture = stabilizingHarness.captures.findOrCreateProvenDetectedCapture({
      projectId: stabilizingHarness.project.id,
      targetRevisionId: null,
      toolContextId: stabilizingContext.toolContextId,
      sourcePath: stabilizingSource,
      sourceChannel: stabilizingContext.channel,
      expectedArtifactType: stabilizingContext.expectedArtifactType,
      detectedAt: AT,
      contentHash: stabilizingProof.contentHash,
      sizeBytes: stabilizingProof.sizeBytes,
    }).entry;
    stabilizingHarness.captures.advance(stabilizingCapture.captureId, AT);
    const restartedStabilizing = restartedRouting(stabilizingHarness);
    await restartedStabilizing.routing.recoverNonterminal();
    expect(restartedStabilizing.captures.get(stabilizingCapture.captureId).state).toBe('COMPLETED');
  });

  it('recovers an already-staged capture after restart', async () => {
    const stagedHarness = await makeHarness();
    const stagedContext = openContext(stagedHarness, 'CAD_WORKING_DRAWING');
    const stagedSource = writeInbox(stagedHarness, stagedContext, 'staged.dwg', 'restart-staged');
    const stagedProof = await stagedHarness.staging.proveStableCandidate(stagedSource);
    const stagedCapture = stagedHarness.captures.findOrCreateProvenDetectedCapture({
      projectId: stagedHarness.project.id,
      targetRevisionId: null,
      toolContextId: stagedContext.toolContextId,
      sourcePath: stagedSource,
      sourceChannel: stagedContext.channel,
      expectedArtifactType: stagedContext.expectedArtifactType,
      detectedAt: AT,
      contentHash: stagedProof.contentHash,
      sizeBytes: stagedProof.sizeBytes,
    }).entry;
    stagedHarness.captures.advance(stagedCapture.captureId, AT);
    const stagedPath = stagedHarness.staging.finalStagedPathFor(stagedCapture.captureId);
    mkdirSync(path.dirname(stagedPath), { recursive: true });
    writeFileSync(stagedPath, 'restart-staged');
    stagedHarness.artifacts.recordStagedContentProof(
      stagedCapture.captureId,
      stagedProof.contentHash,
      stagedProof.sizeBytes,
    );
    stagedHarness.captures.advance(stagedCapture.captureId, AT);
    const restartedStaged = restartedRouting(stagedHarness);
    await restartedStaged.routing.recoverNonterminal();
    expect(restartedStaged.captures.get(stagedCapture.captureId).state).toBe('COMPLETED');
  });

  it('recovers a verified destination temp after restart', async () => {
    const tempHarness = await makeHarness();
    const tempContext = openContext(tempHarness, 'CAD_WORKING_DRAWING');
    const tempSource = writeInbox(tempHarness, tempContext, 'temp.dwg', 'restart-temp');
    const tempCaptureId = await stageOnly(tempHarness, tempContext, tempSource);
    const destinationFolder = path.join(tempHarness.projectRoot, '03_DRAWINGS', 'WORKING');
    const destinationTemp = path.join(
      destinationFolder,
      `.scli-capture-${tempCaptureId}.route-tmp`,
    );
    writeFileSync(destinationTemp, 'restart-temp');
    const restartedTemp = restartedRouting(tempHarness);
    await restartedTemp.routing.recoverNonterminal();
    expect(restartedTemp.captures.get(tempCaptureId).state).toBe('COMPLETED');
    expect(existsSync(destinationTemp)).toBe(false);
  });

  it('recovers when the final file exists before DB completion', async () => {
    const finalHarness = await makeHarness();
    const finalContext = openContext(finalHarness, 'CAD_WORKING_DRAWING');
    const finalSource = writeInbox(finalHarness, finalContext, 'final.dwg', 'restart-final');
    const finalCaptureId = await stageOnly(finalHarness, finalContext, finalSource);
    const finalPath = path.join(
      finalHarness.projectRoot,
      '03_DRAWINGS',
      'WORKING',
      `${finalHarness.project.projectCode}_CAD_WORKING.dwg`,
    );
    writeFileSync(finalPath, 'restart-final');
    const restartedFinal = restartedRouting(finalHarness);
    await restartedFinal.routing.recoverNonterminal();
    const completedFinal = restartedFinal.captures.get(finalCaptureId);
    expect(completedFinal).toMatchObject({
      state: 'COMPLETED',
      routingDecision: 'AUTO_APPROVED',
    });
    expect(readFileSync(finalPath, 'utf8')).toBe('restart-final');
  });

  it('recovers an existing ArtifactVersion and Snapshot before ledger completion', async () => {
    const partialHarness = await makeHarness();
    const partialRevision = prepareRevision(partialHarness);
    const partialContext = openContext(partialHarness, 'DIALUX_REPORT', partialRevision.revisionId);
    const partialSource = writeInbox(
      partialHarness,
      partialContext,
      'partial.pdf',
      'restart-partial',
    );
    const partialCaptureId = await stageOnly(partialHarness, partialContext, partialSource);
    partialHarness.database.exec(
      `CREATE TRIGGER p4b_crash_before_complete
       BEFORE UPDATE OF state ON capture_ledger
       WHEN NEW.state = 'COMPLETED'
       BEGIN SELECT RAISE(ABORT, 'injected completion crash'); END;`,
    );
    const interrupted = await partialHarness.routing().route(partialCaptureId);
    expect(interrupted.state).toBe('FAILED_RECOVERABLE');
    expect(
      partialHarness.database
        .prepare('SELECT COUNT(*) AS count FROM artifact_versions WHERE capture_id = ?')
        .get(partialCaptureId),
    ).toEqual({ count: 1 });
    expect(
      partialHarness.registry.listDocumentSnapshotsForRevision(partialRevision.revisionId),
    ).toHaveLength(1);
    partialHarness.database.exec('DROP TRIGGER p4b_crash_before_complete');
    const restartedPartial = restartedRouting(partialHarness);
    const recovered = await restartedPartial.routing.retry(partialCaptureId);
    expect(recovered.state).toBe('COMPLETED');
    expect(
      restartedPartial.artifacts.listArtifactVersions(recovered.finalArtifactId!),
    ).toHaveLength(1);
    expect(
      partialHarness.registry.listDocumentSnapshotsForRevision(partialRevision.revisionId),
    ).toHaveLength(1);
  });

  it('recovers a ProjectDocument-only persistence partial after restart', async () => {
    const documentHarness = await makeHarness();
    const documentContext = openContext(documentHarness, 'CAD_WORKING_DRAWING');
    const documentSource = writeInbox(
      documentHarness,
      documentContext,
      'document-partial.dwg',
      'document-partial',
    );
    const documentCaptureId = await stageOnly(documentHarness, documentContext, documentSource);
    documentHarness.database.exec(
      `CREATE TRIGGER p4b_crash_after_document
       BEFORE INSERT ON managed_artifacts
       BEGIN SELECT RAISE(ABORT, 'injected artifact insert crash'); END;`,
    );
    expect((await documentHarness.routing().route(documentCaptureId)).state).toBe(
      'FAILED_RECOVERABLE',
    );
    expect(
      documentHarness.database
        .prepare(
          "SELECT COUNT(*) AS count FROM project_documents WHERE project_id = ? AND notes LIKE 'Automatically captured%'",
        )
        .get(documentHarness.project.id),
    ).toEqual({ count: 1 });
    expect(
      documentHarness.database
        .prepare('SELECT COUNT(*) AS count FROM managed_artifacts WHERE project_id = ?')
        .get(documentHarness.project.id),
    ).toEqual({ count: 0 });
    documentHarness.database.exec('DROP TRIGGER p4b_crash_after_document');
    const restartedDocument = restartedRouting(documentHarness);
    expect((await restartedDocument.routing.retry(documentCaptureId)).state).toBe('COMPLETED');
    expect(
      documentHarness.database
        .prepare(
          "SELECT COUNT(*) AS count FROM project_documents WHERE project_id = ? AND notes LIKE 'Automatically captured%'",
        )
        .get(documentHarness.project.id),
    ).toEqual({ count: 1 });
  });

  it('recovers a ManagedArtifact-only persistence partial after restart', async () => {
    const artifactHarness = await makeHarness();
    const artifactContext = openContext(artifactHarness, 'CAD_WORKING_DRAWING');
    const artifactSource = writeInbox(
      artifactHarness,
      artifactContext,
      'artifact-partial.dwg',
      'artifact-partial',
    );
    const artifactCaptureId = await stageOnly(artifactHarness, artifactContext, artifactSource);
    artifactHarness.database.exec(
      `CREATE TRIGGER p4b_crash_before_admitted
       BEFORE UPDATE OF state ON capture_ledger
       WHEN NEW.state = 'ADMITTED'
       BEGIN SELECT RAISE(ABORT, 'injected admitted milestone crash'); END;`,
    );
    expect((await artifactHarness.routing().route(artifactCaptureId)).state).toBe(
      'FAILED_RECOVERABLE',
    );
    expect(
      artifactHarness.database
        .prepare('SELECT COUNT(*) AS count FROM managed_artifacts WHERE project_id = ?')
        .get(artifactHarness.project.id),
    ).toEqual({ count: 1 });
    expect(
      artifactHarness.database
        .prepare('SELECT COUNT(*) AS count FROM artifact_versions WHERE capture_id = ?')
        .get(artifactCaptureId),
    ).toEqual({ count: 0 });
    artifactHarness.database.exec('DROP TRIGGER p4b_crash_before_admitted');
    const restartedArtifact = restartedRouting(artifactHarness);
    expect((await restartedArtifact.routing.retry(artifactCaptureId)).state).toBe('COMPLETED');
    expect(
      artifactHarness.database
        .prepare('SELECT COUNT(*) AS count FROM managed_artifacts WHERE project_id = ?')
        .get(artifactHarness.project.id),
    ).toEqual({ count: 1 });
  });

  it('routes an approximately 8 MiB fixture with streaming hashes and retained byte truth', async () => {
    const h = await makeHarness();
    const context = openContext(h, 'CAD_WORKING_DRAWING');
    const bytes = Buffer.alloc(8 * 1024 * 1024, 0x5a);
    const source = writeInbox(h, context, 'large.dwg', bytes);
    await reconcile(h, context);
    const completed = h.captures.list(h.project.id)[0]!;
    expect(completed).toMatchObject({
      state: 'COMPLETED',
      sizeBytes: bytes.length,
      contentHash: createHash('sha256').update(bytes).digest('hex'),
    });
    expect(existsSync(source)).toBe(true);
    expect(readFileSync(h.staging.finalStagedPathFor(completed.captureId)).byteLength).toBe(
      bytes.length,
    );
  });

  it('resolves managed relative Project Files only through the matching verified root marker', async () => {
    const h = await makeHarness();
    const context = openContext(h, 'CAD_WORKING_DRAWING');
    writeInbox(h, context, 'managed-relative.dwg', 'managed-relative');
    await reconcile(h, context);
    const document = h.store
      .getWorkspace(h.project.id)
      .documents.find((candidate) => candidate.notes.startsWith('Automatically captured'));
    expect(document?.filePath).not.toMatch(/^[A-Za-z]:[\\/]/);
    expect(
      h.store
        .getWorkspace(h.project.id)
        .fileCenter.find((item) => item.documentId === document?.id),
    ).toMatchObject({ state: 'Current', filePath: document?.filePath });

    writeFileSync(
      path.join(h.projectRoot, '.scli-project.json'),
      JSON.stringify({
        schemaVersion: 1,
        projectId: randomUUID(),
        projectCodeSnapshot: h.project.projectCode,
        createdAt: AT,
      }),
    );
    expect(
      h.store
        .getWorkspace(h.project.id)
        .fileCenter.find((item) => item.documentId === document?.id),
    ).toMatchObject({ state: 'Missing', filePath: document?.filePath });
  });
});
