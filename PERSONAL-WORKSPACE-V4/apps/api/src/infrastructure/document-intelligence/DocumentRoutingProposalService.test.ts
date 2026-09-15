import { DatabaseSync } from 'node:sqlite';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { DataProvider, Project } from '@scli/domain';
import type { PersonalWorkspaceStore } from '../../personal-workspace-store';
import type { ProjectStorageService } from '../../project-storage-service';
import { PRODUCTION_MIGRATIONS } from '../migration/registry/production-migration-registry';
import { DocumentIntelligenceStore } from './DocumentIntelligenceStore';
import { DocumentRoutingProposalService } from './DocumentRoutingProposalService';
import { DocumentSourceAdmission } from './DocumentSourceAdmission';

const projectId = '11111111-1111-4111-8111-111111111111';
const folderId = '22222222-2222-4222-8222-222222222222';
const roots: string[] = [];
function harness() {
  const root = mkdtempSync(path.join(os.tmpdir(), 'p5c-route-'));
  roots.push(root);
  const projectRoot = path.join(root, 'project');
  let verifiedRoot = projectRoot;
  const destination = path.join(projectRoot, 'Documents');
  mkdirSync(destination, { recursive: true });
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys=ON');
  for (const migration of PRODUCTION_MIGRATIONS) {
    db.exec(
      migration.foreignKeyMode === 'DISABLED_DURING_MIGRATION'
        ? 'PRAGMA foreign_keys = OFF'
        : 'PRAGMA foreign_keys = ON',
    );
    db.exec('BEGIN IMMEDIATE; PRAGMA defer_foreign_keys=ON');
    migration.up({
      database: db,
      migrationId: migration.id,
      fromVersion: migration.fromVersion,
      toVersion: migration.toVersion,
      clock: { now: () => new Date() },
    });
    db.exec('COMMIT');
    db.exec('PRAGMA foreign_keys = ON');
  }
  db.prepare(
    `INSERT INTO project_workspaces(project_id,folder_path,folder_profile,services_json,input_mode,created_at,updated_at) VALUES (?,?, 'Standard','[]','Manual',?,?)`,
  ).run(projectId, projectRoot, new Date().toISOString(), new Date().toISOString());
  const project = {
    id: projectId,
    projectCode: 'SYN-001',
    projectName: 'Synthetic',
    clientName: 'Synthetic',
    siteLocation: 'Synthetic',
  } as Project;
  const provider = {
    getProject: async (id: string) => (id === projectId ? project : null),
  } as unknown as DataProvider;
  const workspace = {
    getWorkspace: () => ({
      folderConfigurationFingerprint: 'fixture-fingerprint',
      folderSnapshot: {
        folders: [
          { folderId, parentFolderId: null, name: 'Documents', displayOrder: 0, enabled: true },
        ],
      },
      outputMappings: [],
    }),
  } as unknown as PersonalWorkspaceStore;
  const storage = {
    resolveVerifiedProjectRoot: async () => verifiedRoot,
  } as unknown as ProjectStorageService;
  const admission = new DocumentSourceAdmission(root);
  const store = new DocumentIntelligenceStore(db);
  const bytes = Buffer.from('%PDF-1.4\nsynthetic route\n%%EOF');
  const admitted = store.createAdmission({
    bytes: admission.admitBuffer(bytes, 'Controlled.pdf'),
    admissionMechanism: 'PROJECT_SELECT',
    projectContextId: projectId,
    idempotencyKey: 'routing-doc',
  });
  store.applyDecision(
    admitted.documentId,
    {
      action: 'CONFIRM_PROJECT_ASSOCIATION',
      expectedRowVersion: 1,
      reason: 'Synthetic controlled Project.',
      projectId,
    },
    { id: 'owner', name: 'Owner' },
  );
  store.applyDecision(
    admitted.documentId,
    { action: 'ACCEPT_DOCUMENT', expectedRowVersion: 2, reason: 'Synthetic review complete.' },
    { id: 'owner', name: 'Owner' },
  );
  const service = new DocumentRoutingProposalService(
    db,
    store,
    admission,
    provider,
    workspace,
    storage,
  );
  return {
    db,
    root,
    projectRoot,
    destination,
    bytes,
    store,
    service,
    admission,
    documentId: admitted.documentId,
    setVerifiedRoot: (value: string) => {
      verifiedRoot = value;
    },
  };
}
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('DocumentRoutingProposalService', () => {
  it('persists fingerprinted proposal, audited approval, no-replace copy, and operational document/artifact links without Revision mutation', async () => {
    const h = harness();
    writeFileSync(path.join(h.destination, 'Controlled.pdf'), 'existing');
    const proposal = await h.service.create(h.documentId, 3, folderId);
    const approved = await h.service.approve(
      h.documentId,
      proposal.id,
      1,
      proposal.eligibilityFingerprint,
      'Owner approved controlled routing.',
      { id: 'owner', name: 'Owner' },
    );
    const completed = await h.service.execute(h.documentId, proposal.id, approved.rowVersion);
    expect(completed.state).toBe('COMPLETED');
    expect(completed.projectDocumentId).toMatch(/^[0-9a-f-]{36}$/);
    expect(completed.artifactVersionId).toMatch(/^[0-9a-f-]{36}$/);
    expect(readFileSync(path.join(h.destination, 'Controlled.pdf'), 'utf8')).toBe('existing');
    expect(readFileSync(path.join(h.destination, 'Controlled (1).pdf'))).toEqual(h.bytes);
    expect(h.db.prepare('SELECT COUNT(*) count FROM canonical_revisions').get()).toEqual({
      count: 0,
    });
    expect(h.store.decisions(h.documentId).map((item) => item.action)).toContain('APPROVE_ROUTING');
    h.db.close();
  });
  it('recomputes authority at approval and marks stale proposals with a blocking finding', async () => {
    const h = harness();
    const proposal = await h.service.create(h.documentId, 3, folderId);
    h.store.applyDecision(
      h.documentId,
      {
        action: 'OVERRIDE_CLASSIFICATION',
        expectedRowVersion: 3,
        reason: 'Classification changed.',
        classification: 'REFERENCE_DOCUMENT',
      },
      { id: 'owner', name: 'Owner' },
    );
    await expect(
      h.service.approve(
        h.documentId,
        proposal.id,
        1,
        proposal.eligibilityFingerprint,
        'Approve stale.',
        { id: 'owner', name: 'Owner' },
      ),
    ).rejects.toThrow(/eligibility changed/i);
    expect(h.service.list(h.documentId)[0]?.state).toBe('STALE');
    expect(h.store.findings(h.documentId).map((item) => item.code)).toContain(
      'ROUTING_PROPOSAL_STALE',
    );
    expect(existsSync(path.join(h.destination, 'Controlled.pdf'))).toBe(false);
    h.db.close();
  });
  it('refuses changed source bytes and verified Project-root drift after approval', async () => {
    const hash = harness();
    const proposal = await hash.service.create(hash.documentId, 3, folderId);
    const approved = await hash.service.approve(
      hash.documentId,
      proposal.id,
      1,
      proposal.eligibilityFingerprint,
      'Approve hash fixture.',
      { id: 'owner', name: 'Owner' },
    );
    const source = hash.store.sourceForDocument(hash.documentId);
    writeFileSync(hash.admission.resolveManagedLocator(source.managedLocator!), 'corrupt');
    await expect(
      hash.service.execute(hash.documentId, proposal.id, approved.rowVersion),
    ).rejects.toThrow(/hash changed/i);
    expect(hash.service.list(hash.documentId)[0]?.state).toBe('STALE');
    hash.db.close();

    const root = harness();
    const rootProposal = await root.service.create(root.documentId, 3, folderId);
    const rootApproved = await root.service.approve(
      root.documentId,
      rootProposal.id,
      1,
      rootProposal.eligibilityFingerprint,
      'Approve root fixture.',
      { id: 'owner', name: 'Owner' },
    );
    const alternate = path.join(root.root, 'alternate-project');
    mkdirSync(path.join(alternate, 'Documents'), { recursive: true });
    root.setVerifiedRoot(alternate);
    await expect(
      root.service.execute(root.documentId, rootProposal.id, rootApproved.rowVersion),
    ).rejects.toThrow(/stale/i);
    expect(root.service.list(root.documentId)[0]?.state).toBe('STALE');
    root.db.close();
  });
});
