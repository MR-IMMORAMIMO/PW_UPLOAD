import { createHash, randomUUID } from 'node:crypto';
import { constants, createReadStream } from 'node:fs';
import { copyFile, link, lstat, mkdir, rm, unlink } from 'node:fs/promises';
import path from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import type { DocumentActor } from '@scli/domain';
import { deriveFolderRelativePath, DomainError, isFolderEffectivelyEnabled } from '@scli/domain';
import type { DocumentRoutingProposalRead } from '@scli/contracts';
import type { DataProvider } from '@scli/domain';
import type { PersonalWorkspaceStore } from '../../personal-workspace-store.js';
import type { ProjectStorageService } from '../../project-storage-service.js';
import type { DocumentIntelligenceStore } from './DocumentIntelligenceStore.js';
import type { DocumentSourceAdmission } from './DocumentSourceAdmission.js';

type Row = Record<string, unknown>;
const read = (row: Row, key: string) => String(row[key]);

export class DocumentRoutingProposalService {
  public constructor(
    private readonly database: DatabaseSync,
    private readonly store: DocumentIntelligenceStore,
    private readonly admission: DocumentSourceAdmission,
    private readonly provider: DataProvider,
    private readonly workspace: PersonalWorkspaceStore,
    private readonly projectStorage: ProjectStorageService,
    private readonly now: () => Date = () => new Date(),
  ) {}

  public async create(
    documentId: string,
    expectedRowVersion: number,
    destinationMappingId: string,
  ): Promise<DocumentRoutingProposalRead> {
    const authority = await this.authority(documentId, destinationMappingId);
    if (authority.document.rowVersion !== expectedRowVersion)
      throw new DomainError('CONFLICT', 'Document review changed. Refresh before routing.', 409);
    const existing = this.database
      .prepare(`SELECT proposal_id FROM document_routing_proposals WHERE idempotency_key=?`)
      .get(authority.fingerprint) as Row | undefined;
    if (existing) return this.readProposal(read(existing, 'proposal_id'));
    const id = randomUUID();
    const at = this.now().toISOString();
    this.database
      .prepare(
        `INSERT INTO document_routing_proposals (proposal_id,document_id,version_id,destination_mapping_id,state,eligibility_fingerprint,source_hash,project_id,folder_fingerprint,idempotency_key,row_version,created_at,updated_at) VALUES (?,?,?,?,'PROPOSED',?,?,?,?,?,1,?,?)`,
      )
      .run(
        id,
        documentId,
        authority.document.activeVersionId,
        destinationMappingId,
        authority.fingerprint,
        authority.source.sha256,
        authority.projectId,
        authority.folderFingerprint,
        authority.fingerprint,
        at,
        at,
      );
    return this.readProposal(id);
  }

  public async approve(
    documentId: string,
    proposalId: string,
    expectedRowVersion: number,
    expectedFingerprint: string,
    reason: string,
    actor: DocumentActor,
  ): Promise<DocumentRoutingProposalRead> {
    const proposal = this.proposalRow(documentId, proposalId);
    if (
      Number(proposal.row_version) !== expectedRowVersion ||
      read(proposal, 'eligibility_fingerprint') !== expectedFingerprint
    )
      throw new DomainError('CONFLICT', 'Routing proposal changed. Refresh before approval.', 409);
    let authority: Awaited<ReturnType<DocumentRoutingProposalService['authority']>>;
    try {
      authority = await this.authority(documentId, read(proposal, 'destination_mapping_id'));
    } catch {
      this.markStale(proposalId, documentId);
      throw new DomainError(
        'CONFLICT',
        'Routing eligibility changed. A new proposal is required.',
        409,
      );
    }
    if (authority.fingerprint !== expectedFingerprint) {
      this.markStale(proposalId, documentId);
      throw new DomainError(
        'CONFLICT',
        'Routing eligibility changed. A new proposal is required.',
        409,
      );
    }
    const document = this.store.getDocument(documentId);
    const decisionId = randomUUID();
    const at = this.now().toISOString();
    this.database.exec('BEGIN IMMEDIATE');
    try {
      this.database
        .prepare(
          `INSERT INTO document_owner_decisions (decision_id,document_id,action_type,target_id,actor_id,actor_name,reason,before_projection_json,after_projection_json,evidence_fingerprint,expected_row_version,decided_at) VALUES (?,?,'APPROVE_ROUTING',?,?,?,?,?,?,?,?,?)`,
        )
        .run(
          decisionId,
          documentId,
          proposalId,
          actor.id,
          actor.name,
          reason,
          JSON.stringify({ state: read(proposal, 'state') }),
          JSON.stringify({ state: 'APPROVED' }),
          expectedFingerprint,
          document.rowVersion,
          at,
        );
      const result = this.database
        .prepare(
          `UPDATE document_routing_proposals SET state='APPROVED',approved_decision_id=?,row_version=row_version+1,updated_at=? WHERE proposal_id=? AND row_version=? AND state='PROPOSED'`,
        )
        .run(decisionId, at, proposalId, expectedRowVersion);
      if (result.changes !== 1)
        throw new DomainError(
          'CONFLICT',
          'Routing proposal changed. Refresh before approval.',
          409,
        );
      this.database.exec('COMMIT');
    } catch (error) {
      try {
        this.database.exec('ROLLBACK');
      } catch {
        // The transaction may already have been closed by SQLite.
      }
      throw error;
    }
    return this.readProposal(proposalId);
  }

  public async execute(
    documentId: string,
    proposalId: string,
    expectedRowVersion: number,
  ): Promise<DocumentRoutingProposalRead> {
    const proposal = this.proposalRow(documentId, proposalId);
    if (
      Number(proposal.row_version) !== expectedRowVersion ||
      read(proposal, 'state') !== 'APPROVED'
    )
      throw new DomainError(
        'CONFLICT',
        'Only the current approved routing proposal can execute.',
        409,
      );
    let authority: Awaited<ReturnType<DocumentRoutingProposalService['authority']>>;
    try {
      authority = await this.authority(documentId, read(proposal, 'destination_mapping_id'));
    } catch {
      this.markStale(proposalId, documentId);
      throw new DomainError('CONFLICT', 'Routing proposal is stale.', 409);
    }
    if (authority.fingerprint !== read(proposal, 'eligibility_fingerprint')) {
      this.markStale(proposalId, documentId);
      throw new DomainError('CONFLICT', 'Routing proposal is stale.', 409);
    }
    const sourcePath = this.admission.resolveManagedLocator(authority.source.managedLocator!);
    if ((await hashFile(sourcePath)) !== authority.source.sha256) {
      this.markStale(proposalId, documentId);
      throw new DomainError('CONFLICT', 'Document source hash changed.', 409);
    }
    await mkdir(authority.destinationFolder, { recursive: false }).catch(
      (error: NodeJS.ErrnoException) => {
        if (error.code !== 'EEXIST') throw error;
      },
    );
    const folderStat = await lstat(authority.destinationFolder);
    if (!folderStat.isDirectory() || folderStat.isSymbolicLink())
      throw new DomainError(
        'CONFLICT',
        'Routing destination is not a regular Project folder.',
        409,
      );
    const base = safeFileName(authority.source.originalFileName);
    let destination = '';
    for (let suffix = 0; suffix < 1000; suffix += 1) {
      const candidate = path.join(
        authority.destinationFolder,
        suffix === 0 ? base : `${path.basename(base, '.pdf')} (${suffix}).pdf`,
      );
      try {
        await lstat(candidate);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
          destination = candidate;
          break;
        }
        throw error;
      }
    }
    if (!destination)
      throw new DomainError('CONFLICT', 'Routing destination name limit reached.', 409);
    const temp = path.join(authority.destinationFolder, `.scli-document-${proposalId}.route-tmp`);
    let linked = false;
    try {
      await copyFile(sourcePath, temp, constants.COPYFILE_EXCL);
      if ((await hashFile(temp)) !== authority.source.sha256)
        throw new DomainError('CONFLICT', 'Routed copy hash verification failed.', 409);
      const refreshed = await this.authority(documentId, read(proposal, 'destination_mapping_id'));
      if (refreshed.fingerprint !== authority.fingerprint)
        throw new DomainError('CONFLICT', 'Project root or routing authority changed.', 409);
      await link(temp, destination);
      linked = true;
      await unlink(temp);
      const relative = path.relative(authority.verifiedRoot, destination).replaceAll('\\', '/');
      const at = this.now().toISOString();
      const projectDocumentId = randomUUID();
      const artifactId = randomUUID();
      const artifactVersionId = randomUUID();
      this.database.exec('BEGIN IMMEDIATE');
      try {
        const projectDocumentNumber = path.basename(destination, '.pdf');
        this.database
          .prepare(
            `INSERT INTO project_documents (id,project_id,category,document_number,title,revision,status,file_path,issued_to,issue_date,notes,created_at,updated_at) VALUES (?,?,'Reference',?,?, 'WORKING','Current',?,'',NULL,?,?,?)`,
          )
          .run(
            projectDocumentId,
            authority.projectId,
            projectDocumentNumber,
            projectDocumentNumber,
            relative,
            'Routed from accepted Document Intelligence evidence. No Revision was created.',
            at,
            at,
          );
        this.database
          .prepare(
            `INSERT INTO managed_artifacts (artifact_id,project_id,artifact_type,source_tool,canonical_path,status,current_working_version,project_document_id,created_at,updated_at) VALUES (?,?,'DOCUMENT_INTELLIGENCE_SOURCE','DOCUMENT_INTELLIGENCE',?,'ACTIVE',1,?,?,?)`,
          )
          .run(artifactId, authority.projectId, relative, projectDocumentId, at, at);
        this.database
          .prepare(
            `INSERT INTO artifact_versions (version_id,artifact_id,version,content_hash,size_bytes,locator_kind,locator_value,capture_id,created_at) VALUES (?,?,1,?,?,'PROJECT_RELATIVE',?,NULL,?)`,
          )
          .run(
            artifactVersionId,
            artifactId,
            authority.source.sha256,
            authority.source.sizeBytes,
            relative,
            at,
          );
        const changed = this.database
          .prepare(
            `UPDATE document_routing_proposals SET state='COMPLETED',project_document_id=?,artifact_version_id=?,row_version=row_version+1,updated_at=? WHERE proposal_id=? AND row_version=? AND state='APPROVED'`,
          )
          .run(projectDocumentId, artifactVersionId, at, proposalId, expectedRowVersion);
        if (changed.changes !== 1)
          throw new DomainError(
            'CONFLICT',
            'Routing approval became stale before persistence.',
            409,
          );
        this.database
          .prepare(
            `INSERT INTO workspace_activity (id,project_id,entity_type,entity_id,action,title,detail,created_at) VALUES (?,?,'Document',?,'Created',?,?,?)`,
          )
          .run(
            randomUUID(),
            authority.projectId,
            projectDocumentId,
            projectDocumentNumber,
            relative,
            at,
          );
        this.database.exec('COMMIT');
      } catch (error) {
        try {
          this.database.exec('ROLLBACK');
        } catch {
          // The transaction may already have been closed by SQLite.
        }
        throw error;
      }
      return this.readProposal(proposalId);
    } catch (error) {
      if (linked) await rm(destination, { force: true }).catch(() => undefined);
      throw error;
    } finally {
      await rm(temp, { force: true }).catch(() => undefined);
    }
  }

  public list(documentId: string) {
    return this.store.routingProposals(documentId);
  }
  private proposalRow(documentId: string, id: string): Row {
    const row = this.database
      .prepare(`SELECT * FROM document_routing_proposals WHERE proposal_id=? AND document_id=?`)
      .get(id, documentId) as Row | undefined;
    if (!row) throw new DomainError('NOT_FOUND', 'Routing proposal was not found.', 404);
    return row;
  }
  private readProposal(id: string): DocumentRoutingProposalRead {
    const row = this.database
      .prepare(`SELECT document_id FROM document_routing_proposals WHERE proposal_id=?`)
      .get(id) as Row | undefined;
    if (!row) throw new DomainError('NOT_FOUND', 'Routing proposal was not found.', 404);
    const found = this.store
      .routingProposals(read(row, 'document_id'))
      .find((item) => item.id === id);
    if (!found) throw new DomainError('NOT_FOUND', 'Routing proposal was not found.', 404);
    return found;
  }
  private markStale(id: string, documentId: string) {
    const at = this.now().toISOString();
    this.database
      .prepare(
        `UPDATE document_routing_proposals SET state='STALE',error_code='ROUTING_PROPOSAL_STALE',row_version=row_version+1,updated_at=? WHERE proposal_id=? AND state IN ('PROPOSED','APPROVED')`,
      )
      .run(at, id);
    const source = this.store.sourceForDocument(documentId);
    this.store.addFinding(
      documentId,
      source.versionId,
      'ROUTING_PROPOSAL_STALE',
      'BLOCKING',
      'Routing proposal is stale',
      'Document or Project routing authority changed after proposal creation.',
      'Create and review a new routing proposal.',
      { proposalId: id },
      { proposalId: id, at },
    );
  }
  private async authority(documentId: string, destinationMappingId: string) {
    const document = this.store.getDocument(documentId);
    if (
      document.lifecycle !== 'ACCEPTED' ||
      document.associationState !== 'CONFIRMED' ||
      !document.confirmedProjectId
    )
      throw new DomainError(
        'CONFLICT',
        'Routing requires an accepted document with confirmed Project association.',
        409,
      );
    const source = this.store.sourceForDocument(documentId);
    if (!source.managedLocator)
      throw new DomainError(
        'CONFLICT',
        'Existing managed artifacts are already routed and are not copied again.',
        409,
      );
    const blocking = this.database
      .prepare(
        `SELECT 1 FROM document_quality_findings WHERE document_id=? AND severity='BLOCKING' AND state IN ('OPEN','ACKNOWLEDGED') LIMIT 1`,
      )
      .get(documentId);
    if (blocking)
      throw new DomainError('CONFLICT', 'Blocking document findings prevent routing.', 409);
    const unsettled = this.database
      .prepare(
        `SELECT 1 FROM document_relationships r JOIN document_versions v ON v.version_id IN (r.left_version_id,r.right_version_id) WHERE v.document_id=? AND r.state='PROPOSED' LIMIT 1`,
      )
      .get(documentId);
    if (unsettled)
      throw new DomainError(
        'CONFLICT',
        'Document relationships must be settled before routing.',
        409,
      );
    const project = await this.provider.getProject(document.confirmedProjectId);
    if (!project) throw new DomainError('NOT_FOUND', 'Confirmed Project was not found.', 404);
    const verifiedRoot = await this.projectStorage.resolveVerifiedProjectRoot(project);
    const workspace = this.workspace.getWorkspace(project.id);
    const folder = workspace.folderSnapshot.folders.find(
      (item) => item.folderId === destinationMappingId,
    );
    if (!folder || !isFolderEffectivelyEnabled(workspace.folderSnapshot, folder.folderId))
      throw new DomainError('CONFLICT', 'Routing destination mapping is unavailable.', 409);
    const relative = deriveFolderRelativePath(workspace.folderSnapshot, folder.folderId);
    if (!relative)
      throw new DomainError('CONFLICT', 'Routing destination mapping is invalid.', 409);
    const destinationFolder = path.resolve(verifiedRoot, relative);
    const inside = path.relative(verifiedRoot, destinationFolder);
    if (!inside || inside === '..' || inside.startsWith(`..${path.sep}`) || path.isAbsolute(inside))
      throw new DomainError(
        'CONFLICT',
        'Routing destination escaped the verified Project root.',
        409,
      );
    const folderFingerprint = createHash('sha256')
      .update(`${workspace.folderConfigurationFingerprint}:${folder.folderId}:${relative}`)
      .digest('hex');
    const verifiedRootFingerprint = createHash('sha256')
      .update(path.resolve(verifiedRoot).toLocaleLowerCase('en'))
      .digest('hex');
    const fingerprint = createHash('sha256')
      .update(
        JSON.stringify({
          documentId,
          versionId: document.activeVersionId,
          rowVersion: document.rowVersion,
          projectId: project.id,
          classification: document.classification,
          sourceHash: source.sha256,
          folderFingerprint,
          verifiedRootFingerprint,
        }),
      )
      .digest('hex');
    return {
      document,
      source,
      projectId: project.id,
      verifiedRoot,
      destinationFolder,
      folderFingerprint,
      fingerprint,
    };
  }
}

function safeFileName(value: string) {
  const base = path
    .basename(value)
    .replace(/[<>:"/\\|?*]/g, '_')
    .replace(/\p{Cc}/gu, '_')
    .trim();
  return base.toLowerCase().endsWith('.pdf') ? base.slice(0, 240) : `${base.slice(0, 236)}.pdf`;
}
async function hashFile(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256');
    const stream = createReadStream(filePath);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('end', () => resolve(hash.digest('hex')));
    stream.on('error', reject);
  });
}
