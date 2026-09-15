import { randomUUID } from 'node:crypto';
import type { PersonalWorkflowTransitionCoordinator } from './personal-workflow-transition-coordinator';
import type {
  AddCommentInput,
  AssignProjectInput,
  ChangeProjectReferenceInput,
  ChangeStatusInput,
  CreateProjectInput,
  UpdateSettingsInput,
  UpdateProjectInput,
} from '@scli/contracts';
import {
  assertPermission,
  assertStatusTransition,
  calculateAllDesignerWorkloads,
  calculateReportSummary,
  canAssignProject,
  canChangeProjectReference,
  canCommentOnProject,
  canCreateProjectFor,
  canEditProjectField,
  canManageSettings,
  canPersonalTransition,
  canViewProject,
  DomainError,
  formatProjectCode,
  isManager,
  isProjectDesigner,
  requireFound,
  validateProjectReferenceInput,
  type AppNotification,
  type AppSettings,
  type AppUser,
  type DataProvider,
  type Project,
  type ProjectActivity,
  type ProjectComment,
  type ProjectQuery,
  type ReportSummary,
  type WorkloadMetrics,
  type WorkspaceVariant,
} from '@scli/domain';

export interface ProjectCreationResult {
  project: Project;
  workflow: Array<{
    key: 'validate' | 'code' | 'save' | 'notifications' | 'workspace' | 'folders';
    label: string;
    completedAt: string;
  }>;
}

export interface PreparedReferenceChange {
  project: Project;
  newCode: string;
  now: string;
  changed: boolean;
}

export interface PreparedProjectUpdate {
  project: Project;
  patch: Partial<Project>;
  activities: ProjectActivity[];
}

export interface ReferenceCommitInput {
  previousProject: Project;
  newCode: string;
  newFolderPath: string | null;
  folderIndexedAt: string | null;
  folderFileCount: number | null;
  now: string;
  auditReason?: string;
}

type Clock = () => Date;

type PersonalCreationFields = Pick<
  CreateProjectInput,
  | 'createFolders'
  | 'connectFolderPath'
  | 'folderProfile'
  | 'folderStructure'
  | 'outputFolders'
  | 'services'
  | 'luminaireInputMode'
>;
type ProjectCreationInput = Omit<CreateProjectInput, keyof PersonalCreationFields> &
  Partial<PersonalCreationFields>;

interface CommercialValueInput {
  commercialValueMinor?: number | null | undefined;
  commercialCurrency?: string | null | undefined;
}

function hasCommercialValueInput(input: CommercialValueInput): boolean {
  return input.commercialValueMinor !== undefined || input.commercialCurrency !== undefined;
}

function assertCommercialValuePair(input: CommercialValueInput): void {
  const amountState =
    input.commercialValueMinor === undefined
      ? 'omitted'
      : input.commercialValueMinor === null
        ? 'null'
        : 'populated';
  const currencyState =
    input.commercialCurrency === undefined
      ? 'omitted'
      : input.commercialCurrency === null
        ? 'null'
        : 'populated';
  if (amountState !== currencyState) {
    throw new DomainError(
      'VALIDATION_ERROR',
      'Commercial value and currency must both be omitted, both be null, or both be populated.',
      400,
    );
  }
}

function audit(
  actor: AppUser,
  projectId: string,
  actionType: ProjectActivity['actionType'],
  message: string,
  createdAt: string,
  fieldName: string | null = null,
  oldValue: string | null = null,
  newValue: string | null = null,
): ProjectActivity {
  return {
    id: randomUUID(),
    projectId,
    actionType,
    fieldName,
    oldValue,
    newValue,
    message,
    changedById: actor.id,
    changedByNameSnapshot: actor.displayName,
    createdAt,
  };
}

function notification(
  recipientUserId: string,
  type: AppNotification['type'],
  title: string,
  message: string,
  projectId: string,
  createdAt: string,
): AppNotification {
  return {
    id: randomUUID(),
    recipientUserId,
    type,
    title,
    message,
    projectId,
    isRead: false,
    createdAt,
  };
}

function stringifyAuditValue(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  return typeof value === 'string' ? value : JSON.stringify(value);
}

function actionForField(field: keyof Project): ProjectActivity['actionType'] {
  if (field === 'salesOwnerId') return 'SalesOwnerChanged';
  if (field === 'priority') return 'PriorityChanged';
  if (field === 'requiredDeliveryDate') return 'DeadlineChanged';
  if (field === 'progressPercent') return 'ProgressChanged';
  if (field === 'estimatedHours' || field === 'actualHours') return 'HoursChanged';
  if (field === 'projectFolderUrl') return 'FolderLinkChanged';
  return 'ProjectUpdated';
}

export class ProjectService {
  public constructor(
    private readonly provider: DataProvider,
    private readonly companyTimezone: string,
    private readonly clock: Clock = () => new Date(),
    private readonly workspaceVariant: WorkspaceVariant = 'team',
    private readonly personalWorkflowCoordinator?: PersonalWorkflowTransitionCoordinator,
    private readonly findProjectManager?: (id: string) => { isActive: boolean } | undefined,
  ) {}

  public async listProjects(actor: AppUser, query: ProjectQuery = {}): Promise<Project[]> {
    const projects = await this.provider.listProjects(query);
    return projects.filter((project) => canViewProject(actor, project));
  }

  public async getProject(actor: AppUser, projectId: string): Promise<Project> {
    const project = requireFound(await this.provider.getProject(projectId), 'Project not found.');
    assertPermission(canViewProject(actor, project), 'You do not have access to this project.');
    return project;
  }

  private async assertActiveProjectTypeTarget(projectType: string): Promise<void> {
    const catalogue = (await this.provider.getSettings()).projectTypes;
    const configured = catalogue.find((candidate) => candidate.name === projectType);
    if (!configured) {
      throw new DomainError(
        'VALIDATION_ERROR',
        'Select an active Project Type configured in Settings.',
        400,
      );
    }
    if (!configured.isActive) {
      throw new DomainError(
        'VALIDATION_ERROR',
        'That Project Type is no longer active. Refresh the project and choose an active type.',
        400,
      );
    }
  }

  public async archiveProject(actor: AppUser, projectId: string): Promise<Project> {
    assertPermission(isManager(actor), 'Only the workspace owner can archive projects.');
    const project = await this.getProject(actor, projectId);
    if (project.status === 'Archived') return project;
    const now = this.clock().toISOString();
    const updated = await this.provider.updateProject(project.id, {
      status: 'Archived',
      statusBeforeArchive: project.status,
      updatedAt: now,
      version: project.version + 1,
    });
    await this.provider.appendActivities([
      audit(
        actor,
        project.id,
        'ProjectArchived',
        `Project archived by ${actor.displayName}. The linked folder was not changed.`,
        now,
        'status',
        project.status,
        'Archived',
      ),
    ]);
    return updated;
  }

  public async restoreProject(actor: AppUser, projectId: string): Promise<Project> {
    assertPermission(isManager(actor), 'Only the workspace owner can restore projects.');
    const project = await this.getProject(actor, projectId);
    if (project.status !== 'Archived') {
      throw new DomainError('CONFLICT', 'Only archived projects can be restored.', 409);
    }
    const restoredStatus =
      project.statusBeforeArchive && project.statusBeforeArchive !== 'Archived'
        ? project.statusBeforeArchive
        : 'Planning';
    const now = this.clock().toISOString();
    const updated = await this.provider.updateProject(project.id, {
      status: restoredStatus,
      statusBeforeArchive: null,
      updatedAt: now,
      version: project.version + 1,
    });
    await this.provider.appendActivities([
      audit(
        actor,
        project.id,
        'ProjectRestored',
        `Project restored by ${actor.displayName}.`,
        now,
        'status',
        'Archived',
        restoredStatus,
      ),
    ]);
    return updated;
  }

  public async removeProjectFromWorkspace(
    actor: AppUser,
    projectId: string,
    confirmation: string,
  ): Promise<Project> {
    assertPermission(isManager(actor), 'Only the workspace owner can remove projects.');
    const project = await this.getProject(actor, projectId);
    if (project.status !== 'Archived') {
      throw new DomainError('CONFLICT', 'Archive the project before removing it.', 409);
    }
    if (confirmation !== project.projectCode) {
      throw new DomainError('VALIDATION_ERROR', 'Type the exact project code to confirm.', 400);
    }
    if (!this.provider.deleteProject) {
      throw new DomainError('NOT_FOUND', 'Project removal is not available in this mode.', 404);
    }
    await this.provider.deleteProject(project.id);
    return project;
  }

  public async createProject(
    actor: AppUser,
    input: ProjectCreationInput,
  ): Promise<ProjectCreationResult> {
    const startedAt = this.clock();
    const personal = this.workspaceVariant === 'personal';
    if (input.finalSetup) {
      assertPermission(
        personal,
        'Final setup metadata is available only in the Personal workspace.',
      );
      assertPermission(canCreateProjectFor(actor, actor), 'You cannot create a project.');
      if (input.finalSetup.managerId) {
        assertPermission(
          canAssignProject(actor),
          'Only a manager or Admin can select the Project manager.',
        );
        const manager = requireFound(
          (await this.provider.getUser(input.finalSetup.managerId)) ??
            this.findProjectManager?.(input.finalSetup.managerId),
          'Project manager not found.',
        );
        if (!manager.isActive)
          throw new DomainError('VALIDATION_ERROR', 'Project manager must be active.', 400);
      }
      if (input.finalSetup.schedule.completionDate !== input.requiredDeliveryDate)
        throw new DomainError(
          'VALIDATION_ERROR',
          'Completion date must match the Project delivery date.',
          400,
        );
    }
    const commercialMutation = hasCommercialValueInput(input);
    if (commercialMutation && !personal) {
      throw new DomainError(
        'VALIDATION_ERROR',
        'Commercial value metadata is available only in the Personal workspace.',
        400,
      );
    }
    if (commercialMutation) assertCommercialValuePair(input);
    const ownerId = input.salesOwnerId ?? actor.id;
    const owner = requireFound(await this.provider.getUser(ownerId), 'Sales Owner not found.');
    if (personal && input.salesOwnerId && (!owner.isActive || owner.role !== 'Sales')) {
      throw new DomainError(
        'VALIDATION_ERROR',
        'The selected Sales contact must be active in the Sales Directory.',
        400,
      );
    }
    if (commercialMutation) {
      assertPermission(
        canCreateProjectFor(actor, owner),
        'Only an active manager, Admin, or owning Sales user can set commercial value metadata.',
      );
    }
    if (!personal) {
      assertPermission(
        canCreateProjectFor(actor, owner),
        'You cannot create a project for this user.',
      );
    }

    let designer: AppUser | null = null;
    let collaborators: AppUser[] = [];
    if (!personal && input.assignedDesignerId) {
      assertPermission(
        canAssignProject(actor),
        'Only a Line Manager or Admin can assign a Lighting Designer.',
      );
      designer = requireFound(
        await this.provider.getUser(input.assignedDesignerId),
        'Lighting Designer not found.',
      );
      if (!designer.isActive || designer.role !== 'Designer') {
        throw new DomainError(
          'VALIDATION_ERROR',
          'Assigned Lighting Designer must be active.',
          400,
        );
      }
      const collaboratorIds = [...new Set(input.collaboratorDesignerIds)].filter(
        (id) => id !== designer?.id,
      );
      collaborators = await Promise.all(
        collaboratorIds.map(async (id) => {
          const collaborator = requireFound(
            await this.provider.getUser(id),
            'Collaborating Lighting Designer not found.',
          );
          if (!collaborator.isActive || collaborator.role !== 'Designer') {
            throw new DomainError(
              'VALIDATION_ERROR',
              'Every collaborating Lighting Designer must be active.',
              400,
            );
          }
          return collaborator;
        }),
      );
    } else if (!personal && input.collaboratorDesignerIds.length) {
      throw new DomainError(
        'VALIDATION_ERROR',
        'Select a Primary Lighting Designer before adding collaborators.',
        400,
      );
    }

    const today = startedAt.toISOString().slice(0, 10);
    if (
      (!input.requiredDeliveryDate && !personal) ||
      (input.requiredDeliveryDate && input.requiredDeliveryDate < today)
    ) {
      throw new DomainError(
        'VALIDATION_ERROR',
        'Required delivery date cannot be in the past.',
        400,
      );
    }

    const sequence = await this.provider.allocateProjectNumber();
    const createdAt = this.clock().toISOString();
    const projectId = randomUUID();
    const project: Project = {
      id: projectId,
      projectCode: formatProjectCode(sequence, startedAt, input.projectName, this.companyTimezone),
      projectName: input.projectName,
      clientName: input.clientName,
      crmReference: input.crmReference?.trim() || null,
      projectType: input.projectType,
      description: input.description,
      salesOwnerId: owner.id,
      salesOwnerNameSnapshot: owner.displayName,
      salesOwnerEmailSnapshot: owner.email,
      createdById: actor.id,
      createdByNameSnapshot: actor.displayName,
      createdByEmailSnapshot: actor.email,
      assignedDesignerId: designer?.id ?? null,
      assignedDesignerNameSnapshot: designer?.displayName ?? null,
      collaboratorDesignerIds: collaborators.map((item) => item.id),
      collaboratorDesignerNameSnapshots: collaborators.map((item) => item.displayName),
      siteLocation: input.siteLocation,
      designStage: input.designStage,
      lightingScope: input.lightingScope,
      luxRequirements: input.luxRequirements,
      drawingReference: input.drawingReference,
      status: personal ? 'Planning' : designer ? 'Assigned' : 'Unassigned',
      priority: input.priority,
      complexity: input.complexity,
      estimatedHours: input.estimatedHours,
      actualHours: 0,
      progressPercent: 0,
      requiredDeliveryDate: input.requiredDeliveryDate,
      projectFolderUrl: input.projectFolderUrl ?? null,
      projectFolderPath: null,
      folderProfile: input.folderProfile ?? 'Full Lighting Design',
      services: input.services ?? ['LuminaireSchedule', 'TechnicalBoq', 'Datasheets'],
      revisionNumber: 0,
      createdAt,
      updatedAt: createdAt,
      completedAt: null,
      cancelledAt: null,
      version: 1,
    };
    if (input.finalSetup) project.finalSetup = structuredClone(input.finalSetup);
    if (commercialMutation) {
      project.commercialValueMinor = input.commercialValueMinor ?? null;
      project.commercialCurrency = input.commercialCurrency ?? null;
    }
    if (input.luminaireInputMode !== undefined) {
      project.luminaireInputMode = input.luminaireInputMode;
    }

    const activities: ProjectActivity[] = [
      audit(
        actor,
        projectId,
        'ProjectCreated',
        `Project created by ${actor.displayName}.`,
        createdAt,
        null,
        null,
        project.status,
      ),
    ];
    if (owner.id !== actor.id) {
      activities.push(
        audit(
          actor,
          projectId,
          'CreatedOnBehalf',
          `Created on behalf of ${owner.displayName} by ${actor.displayName}.`,
          createdAt,
          'salesOwnerId',
          null,
          owner.id,
        ),
      );
    }
    if (designer) {
      activities.push(
        audit(
          actor,
          projectId,
          'DesignerAssigned',
          `${designer.displayName} assigned by ${actor.displayName}.`,
          createdAt,
          'assignedDesignerId',
          null,
          designer.id,
        ),
      );
    }
    if (collaborators.length) {
      activities.push(
        audit(
          actor,
          projectId,
          'ProjectTeamChanged',
          `${collaborators.length} collaborating Lighting Designer${collaborators.length === 1 ? '' : 's'} added by ${actor.displayName}.`,
          createdAt,
          'collaboratorDesignerIds',
          null,
          JSON.stringify(collaborators.map((item) => item.id)),
        ),
      );
    }

    const allUsers = personal ? [] : await this.provider.listUsers();
    const managerRecipients = allUsers.filter(
      (user) => user.isActive && (user.role === 'LineManager' || user.role === 'Admin'),
    );
    const notifications: AppNotification[] = managerRecipients
      .filter((user) => user.id !== actor.id)
      .map((user) =>
        notification(
          user.id,
          'ProjectCreated',
          designer ? 'New project created' : 'New request needs assignment',
          `${project.projectCode} was created by ${actor.displayName}.`,
          projectId,
          createdAt,
        ),
      );
    if (owner.id !== actor.id) {
      notifications.push(
        notification(
          owner.id,
          'ProjectCreated',
          'Project created for you',
          `${actor.displayName} created ${project.projectCode} on your behalf.`,
          projectId,
          createdAt,
        ),
      );
    }
    if (designer) {
      notifications.push(
        notification(
          designer.id,
          'Assignment',
          'New project assigned',
          `${project.projectCode} has been assigned to you.`,
          projectId,
          createdAt,
        ),
      );
    }
    notifications.push(
      ...collaborators.map((collaborator) =>
        notification(
          collaborator.id,
          'Assignment',
          'Added as project collaborator',
          `${project.projectCode} has been shared with you as a Lighting Designer collaborator.`,
          projectId,
          createdAt,
        ),
      ),
    );

    const saved = await this.provider.createProject({
      project,
      activities,
      notifications,
      idempotencyKey: input.idempotencyKey,
    });
    const finishedAt = this.clock().toISOString();
    return {
      project: saved,
      workflow: [
        {
          key: 'validate',
          label: 'Validating project information',
          completedAt: startedAt.toISOString(),
        },
        { key: 'code', label: 'Generating project code', completedAt: createdAt },
        { key: 'save', label: 'Saving project request', completedAt: finishedAt },
        { key: 'notifications', label: 'Sending notifications', completedAt: finishedAt },
      ],
    };
  }

  public async updateProject(
    actor: AppUser,
    projectId: string,
    input: UpdateProjectInput,
  ): Promise<Project> {
    const prepared = await this.prepareProjectUpdate(actor, projectId, input);
    const updated = await this.provider.updateProject(prepared.project.id, prepared.patch);
    if (prepared.activities.length) await this.provider.appendActivities(prepared.activities);
    return updated;
  }

  /**
   * Validates and materializes one Project metadata patch without mutating it.
   * Personal configuration coordination uses this preflight before entering its
   * shared SQLite transaction, so metadata + scope + input mode commit together.
   */
  public async prepareProjectUpdate(
    actor: AppUser,
    projectId: string,
    input: UpdateProjectInput & {
      scopeStandards?: string[] | undefined;
      scopeNotes?: string | undefined;
      responsibilityNotes?: string | undefined;
    },
  ): Promise<PreparedProjectUpdate> {
    const commercialMutation = hasCommercialValueInput(input);
    if (commercialMutation && this.workspaceVariant !== 'personal') {
      throw new DomainError(
        'VALIDATION_ERROR',
        'Commercial value metadata is available only in the Personal workspace.',
        400,
      );
    }
    if (commercialMutation) assertCommercialValuePair(input);
    const project = await this.getProject(actor, projectId);
    if (project.status === 'Cancelled' || project.status === 'Completed') {
      throw new DomainError(
        'INVALID_TRANSITION',
        'Completed or cancelled projects must be reopened before they can be edited.',
        409,
      );
    }
    if (input.expectedVersion !== undefined && input.expectedVersion !== project.version) {
      throw new DomainError(
        'CONFLICT',
        'This project changed after you opened it. Refresh and review the latest values.',
        409,
        { expectedVersion: input.expectedVersion, latestVersion: project.version },
      );
    }
    // Project.projectType is a historical name snapshot, not a catalogue foreign key.
    // Existing inactive or missing values remain valid while unchanged. A deliberate
    // replacement must be revalidated against the current catalogue at save time so
    // a stale screen cannot select a type that Settings has since deactivated.
    if (input.projectType !== undefined && input.projectType !== project.projectType) {
      await this.assertActiveProjectTypeTarget(input.projectType);
    }
    // P2.8C — Personal closure: actualHours is no longer directly editable via
    // the ordinary project-metadata path. For the Personal workspace,
    // WorkSession rows are the source for NEW tracked time and actualHours is a
    // compatibility aggregate updated only internally by the WorkSession
    // coordinator when a session closes. Reject a direct actualHours write for
    // Personal while leaving the Team workspace (which has its own
    // TimeTrackingService) unchanged.
    if (this.workspaceVariant === 'personal' && input.actualHours !== undefined) {
      throw new DomainError(
        'PERMISSION_DENIED',
        'Actual Hours are tracked automatically from completed work sessions and cannot be edited directly.',
        403,
      );
    }
    const {
      auditReason,
      expectedVersion,
      scopeStandards,
      scopeNotes,
      responsibilityNotes,
      ...requestedPatch
    } = input;
    void expectedVersion;
    const patch: Partial<Project> = {};
    const activities: ProjectActivity[] = [];
    const now = this.clock().toISOString();

    if (responsibilityNotes !== undefined) {
      assertPermission(
        this.workspaceVariant === 'personal' &&
          canEditProjectField(actor, project, 'lightingScope'),
        'You cannot edit this project responsibility notes.',
      );
      patch.responsibilityNotes = responsibilityNotes;
      if (responsibilityNotes !== (project.responsibilityNotes ?? ''))
        activities.push(
          audit(
            actor,
            project.id,
            'ProjectUpdated',
            `Responsibility notes updated by ${actor.displayName}.`,
            now,
            'responsibilityNotes',
            project.responsibilityNotes ?? '',
            responsibilityNotes,
          ),
        );
    }

    if (scopeStandards !== undefined) {
      if (this.workspaceVariant !== 'personal' || !project.finalSetup) {
        throw new DomainError(
          'VALIDATION_ERROR',
          'Project setup is required to edit its standards.',
          400,
        );
      }
      assertPermission(
        canEditProjectField(actor, project, 'lightingScope'),
        'You cannot edit this project scope.',
      );
      patch.finalSetup = { ...project.finalSetup, standards: [...scopeStandards] };
      if (JSON.stringify(scopeStandards) !== JSON.stringify(project.finalSetup.standards)) {
        activities.push(
          audit(
            actor,
            project.id,
            'ProjectUpdated',
            `Scope standards updated by ${actor.displayName}.`,
            now,
            'standards',
            project.finalSetup.standards.join(', '),
            scopeStandards.join(', '),
          ),
        );
      }
    }

    if (scopeNotes !== undefined) {
      if (this.workspaceVariant !== 'personal' || !project.finalSetup)
        throw new DomainError(
          'VALIDATION_ERROR',
          'Project setup is required to edit its scope notes.',
          400,
        );
      assertPermission(
        canEditProjectField(actor, project, 'lightingScope'),
        'You cannot edit this project scope.',
      );
      patch.finalSetup = { ...(patch.finalSetup ?? project.finalSetup), notes: scopeNotes };
      if (scopeNotes !== project.finalSetup.notes)
        activities.push(
          audit(
            actor,
            project.id,
            'ProjectUpdated',
            `Scope notes updated by ${actor.displayName}.`,
            now,
            'scopeNotes',
            project.finalSetup.notes,
            scopeNotes,
          ),
        );
    }
    for (const [rawField, value] of Object.entries(requestedPatch)) {
      const field = rawField as keyof Project;
      if (value === undefined) continue;
      assertPermission(
        canEditProjectField(actor, project, field),
        `You cannot update ${String(field)} on this project.`,
      );
      if (field === 'salesOwnerId') {
        if (!auditReason) {
          throw new DomainError(
            'VALIDATION_ERROR',
            'An audited reason is required to change the Sales Owner.',
            400,
          );
        }
        const owner = requireFound(
          await this.provider.getUser(String(value)),
          'New Sales Owner not found.',
        );
        if (!owner.isActive || owner.role !== 'Sales') {
          throw new DomainError(
            'VALIDATION_ERROR',
            'New Sales Owner must be an active Sales user.',
            400,
          );
        }
        Object.assign(patch, {
          salesOwnerId: owner.id,
          salesOwnerNameSnapshot: owner.displayName,
          salesOwnerEmailSnapshot: owner.email,
        });
      } else {
        Object.assign(patch, { [field]: value });
      }
      const currentValue = project[field];
      if (stringifyAuditValue(currentValue) !== stringifyAuditValue(value)) {
        const reasonSuffix =
          field === 'salesOwnerId' && auditReason ? ` Reason: ${auditReason}` : '';
        activities.push(
          audit(
            actor,
            project.id,
            actionForField(field),
            `${String(field)} updated by ${actor.displayName}.${reasonSuffix}`,
            now,
            String(field),
            stringifyAuditValue(currentValue),
            stringifyAuditValue(value),
          ),
        );
      }
    }
    if (
      this.workspaceVariant === 'personal' &&
      project.finalSetup &&
      input.requiredDeliveryDate !== undefined
    ) {
      if (
        input.requiredDeliveryDate &&
        project.finalSetup.schedule.startDate &&
        input.requiredDeliveryDate < project.finalSetup.schedule.startDate
      ) {
        throw new DomainError('VALIDATION_ERROR', 'Completion must follow the start date.', 400);
      }
      patch.finalSetup = {
        ...(patch.finalSetup ?? project.finalSetup),
        schedule: { ...project.finalSetup.schedule, completionDate: input.requiredDeliveryDate },
      };
    }
    patch.updatedAt = now;
    patch.version = project.version + 1;
    return { project, patch, activities };
  }

  /**
   * Preflight for the controlled project-reference update: authorization,
   * version check, reference validation, no-op detection, and duplicate
   * protection. Nothing is mutated here, so every preflight failure leaves the
   * project, its folder, PROJECT_INFO.txt and the file index untouched.
   */
  public async prepareProjectReferenceChange(
    actor: AppUser,
    projectId: string,
    input: ChangeProjectReferenceInput,
  ): Promise<PreparedReferenceChange> {
    const project = await this.getProject(actor, projectId);
    assertPermission(
      canChangeProjectReference(actor, project),
      'You cannot change this project reference.',
    );
    if (project.status === 'Cancelled' || project.status === 'Completed') {
      throw new DomainError(
        'INVALID_TRANSITION',
        'Completed or cancelled projects must be reopened before their reference can be changed.',
        409,
      );
    }
    if (input.expectedVersion !== undefined && input.expectedVersion !== project.version) {
      throw new DomainError(
        'CONFLICT',
        'This project changed after you opened it. Refresh and review the latest values.',
        409,
        { expectedVersion: input.expectedVersion, latestVersion: project.version },
      );
    }
    const newCode = validateProjectReferenceInput(input.projectCode);
    if (newCode === project.projectCode) {
      return { project, newCode, now: this.clock().toISOString(), changed: false };
    }
    const existing = await this.provider.listProjects();
    const collision = existing.some(
      (candidate) => candidate.id !== project.id && candidate.projectCode.toUpperCase() === newCode,
    );
    if (collision) {
      throw new DomainError('CONFLICT', 'Another project already uses this reference.', 409);
    }
    return { project, newCode, now: this.clock().toISOString(), changed: true };
  }

  /**
   * Persist a prepared reference change and append the immutable audit record.
   * The route coordinates the managed folder rename and calls this only after
   * the filesystem rename succeeded.
   */
  public async commitProjectReferenceChange(
    actor: AppUser,
    projectId: string,
    input: ReferenceCommitInput,
  ): Promise<Project> {
    const previous = input.previousProject;
    const updated = await this.provider.updateProject(projectId, {
      projectCode: input.newCode,
      ...(input.newFolderPath ? { projectFolderPath: input.newFolderPath } : {}),
      ...(input.folderIndexedAt !== null ? { folderIndexedAt: input.folderIndexedAt } : {}),
      ...(input.folderFileCount !== null ? { folderFileCount: input.folderFileCount } : {}),
      updatedAt: input.now,
      version: previous.version + 1,
    });
    const folderNote = input.newFolderPath
      ? ' The managed project folder was renamed to match.'
      : ' No managed project folder was renamed.';
    const reasonSuffix = input.auditReason ? ` Reason: ${input.auditReason}` : '';
    await this.provider.appendActivities([
      audit(
        actor,
        projectId,
        'ProjectReferenceChanged',
        `Project reference changed from ${previous.projectCode} to ${input.newCode} by ${actor.displayName}.${folderNote}${reasonSuffix}`,
        input.now,
        'projectCode',
        previous.projectCode,
        input.newCode,
      ),
    ]);
    return updated;
  }

  /**
   * Restore the provider record to a pre-change snapshot. Used only as
   * compensation when a coordinated reference update fails after the
   * filesystem rename. No audit record is written for compensation.
   */
  public async restoreProjectReferenceSnapshot(
    projectId: string,
    snapshot: Project,
  ): Promise<Project> {
    return this.provider.updateProject(projectId, {
      projectCode: snapshot.projectCode,
      ...(snapshot.projectFolderPath !== undefined
        ? { projectFolderPath: snapshot.projectFolderPath }
        : {}),
      ...(snapshot.folderIndexedAt !== undefined
        ? { folderIndexedAt: snapshot.folderIndexedAt }
        : {}),
      ...(snapshot.folderFileCount !== undefined
        ? { folderFileCount: snapshot.folderFileCount }
        : {}),
      updatedAt: snapshot.updatedAt,
      version: snapshot.version,
    });
  }

  public async assignProject(
    actor: AppUser,
    projectId: string,
    input: AssignProjectInput,
  ): Promise<Project> {
    assertPermission(canAssignProject(actor), 'Only a Line Manager or Admin can assign projects.');
    const project = await this.getProject(actor, projectId);
    if (project.status === 'Completed' || project.status === 'Cancelled') {
      throw new DomainError('INVALID_TRANSITION', 'Reopen this project before assignment.', 409);
    }
    const designer = requireFound(
      await this.provider.getUser(input.designerId),
      'Lighting Designer not found.',
    );
    if (!designer.isActive || designer.role !== 'Designer') {
      throw new DomainError('VALIDATION_ERROR', 'Assigned Lighting Designer must be active.', 400);
    }
    const collaboratorIds = [...new Set(input.collaboratorDesignerIds)].filter(
      (id) => id !== designer.id,
    );
    const collaborators = await Promise.all(
      collaboratorIds.map(async (id) => {
        const collaborator = requireFound(
          await this.provider.getUser(id),
          'Collaborating Lighting Designer not found.',
        );
        if (!collaborator.isActive || collaborator.role !== 'Designer') {
          throw new DomainError(
            'VALIDATION_ERROR',
            'Every collaborating Lighting Designer must be active.',
            400,
          );
        }
        return collaborator;
      }),
    );
    const projects = await this.provider.listProjects();
    const workload = calculateAllDesignerWorkloads(
      await this.provider.listUsers(),
      projects,
      this.clock(),
    ).find((item) => item.designer.id === designer.id);
    if (
      workload &&
      (workload.classification === 'FullyLoaded' || workload.classification === 'Unavailable') &&
      !input.overrideReason
    ) {
      throw new DomainError(
        'VALIDATION_ERROR',
        `Confirm the assignment with a reason because ${designer.displayName} is ${workload.classification}.`,
        400,
        { requiresOverride: true, classification: workload.classification },
      );
    }
    const now = this.clock().toISOString();
    const status = ['NewRequest', 'UnderReview', 'Unassigned'].includes(project.status)
      ? 'Assigned'
      : project.status;
    const updated = await this.provider.updateProject(project.id, {
      assignedDesignerId: designer.id,
      assignedDesignerNameSnapshot: designer.displayName,
      collaboratorDesignerIds: collaborators.map((item) => item.id),
      collaboratorDesignerNameSnapshots: collaborators.map((item) => item.displayName),
      status,
      updatedAt: now,
      version: project.version + 1,
    });
    const action = project.assignedDesignerId ? 'DesignerReassigned' : 'DesignerAssigned';
    const override = input.overrideReason ? ` Override: ${input.overrideReason}` : '';
    await this.provider.appendActivities([
      audit(
        actor,
        project.id,
        action,
        `${designer.displayName} assigned by ${actor.displayName}.${override}`,
        now,
        'assignedDesignerId',
        project.assignedDesignerId,
        designer.id,
      ),
      audit(
        actor,
        project.id,
        'ProjectTeamChanged',
        `Project collaborators updated by ${actor.displayName}.`,
        now,
        'collaboratorDesignerIds',
        JSON.stringify(project.collaboratorDesignerIds),
        JSON.stringify(collaborators.map((item) => item.id)),
      ),
    ]);
    await this.provider.addNotifications([
      notification(
        designer.id,
        'Assignment',
        'New project assigned',
        `${project.projectCode} has been assigned to you.`,
        project.id,
        now,
      ),
      ...collaborators.map((collaborator) =>
        notification(
          collaborator.id,
          'Assignment',
          'Added as project collaborator',
          `${project.projectCode} has been shared with you.`,
          project.id,
          now,
        ),
      ),
    ]);
    return updated;
  }

  public async changeStatus(
    actor: AppUser,
    projectId: string,
    input: ChangeStatusInput,
  ): Promise<Project> {
    const project = await this.getProject(actor, projectId);
    const personal = this.workspaceVariant === 'personal';
    const target = input.status;

    // Retry-safe replay: a network response may be lost after a successful
    // transition. If the server already reached the requested target, treat
    // the request as an idempotent successful replay and return the current
    // project unchanged (no duplicate activity, no re-applied timestamps).
    if (project.status === target) {
      return project;
    }

    // Stale-state protection: when the caller supplies an expected current
    // status that no longer matches the server, reject with a 409 conflict
    // before any mutation.
    if (
      input.expectedCurrentStatus !== undefined &&
      project.status !== input.expectedCurrentStatus
    ) {
      throw new DomainError(
        'CONFLICT',
        'This project changed after you opened it. Refresh and review the latest status.',
        409,
        {
          expectedCurrentStatus: input.expectedCurrentStatus,
          currentStatus: project.status,
        },
      );
    }

    if (personal) {
      if (!canPersonalTransition(project, target)) {
        throw new DomainError(
          'INVALID_TRANSITION',
          `Transition from ${project.status} to ${target} is not allowed for this personal project.`,
          409,
          { from: project.status, to: target },
        );
      }
      // A Personal cancellation must carry a meaningful reason. The web UI
      // alone is not enough: the requirement holds at the controlled API
      // boundary even if the caller bypasses the Personal UI.
      if (target === 'Cancelled' && !(input.reason ?? '').trim()) {
        throw new DomainError(
          'VALIDATION_ERROR',
          'A cancellation reason is required for personal projects.',
          400,
        );
      }
      // A Personal ClientReview -> RevisionRequired must carry a meaningful
      // feedback summary (the `reason` field is the ONE canonical text source).
      // The web UI alone is not enough: the requirement holds at the controlled
      // API boundary even if the caller bypasses the Personal UI.
      if (
        project.status === 'ClientReview' &&
        target === 'RevisionRequired' &&
        !(input.reason ?? '').trim()
      ) {
        throw new DomainError(
          'VALIDATION_ERROR',
          'A feedback summary is required when requesting client changes.',
          400,
        );
      }
    } else {
      assertStatusTransition(actor.role, project.status, target);
      if (actor.role === 'Designer') {
        assertPermission(
          isProjectDesigner(actor, project),
          'Only an assigned Lighting Designer can update this project.',
        );
      }
    }

    const now = this.clock().toISOString();
    const patch: Partial<Project> = {
      status: target,
      updatedAt: now,
      version: project.version + 1,
    };
    if (
      personal &&
      project.status === 'Planning' &&
      target === 'InProgress' &&
      project.finalSetup &&
      !project.finalSetup.schedule.startDate
    ) {
      const settings = await this.provider.getSettings();
      const startDate = new Intl.DateTimeFormat('en-CA', {
        timeZone: settings.companyTimezone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      }).format(new Date(now));
      patch.finalSetup = {
        ...project.finalSetup,
        schedule: { ...project.finalSetup.schedule, startDate },
      };
    }
    let action: ProjectActivity['actionType'] = 'StatusChanged';

    if (target === 'OnHold') {
      patch.statusBeforeHold = project.status;
    } else if (project.status === 'OnHold') {
      // Resuming from OnHold restores the recorded status (or a safe
      // InProgress fallback for legacy holds) and clears the hold metadata.
      patch.statusBeforeHold = null;
    }

    if (target === 'Completed') {
      patch.progressPercent = 100;
      patch.completedAt = now;
      patch.cancelledAt = null;
      patch.statusBeforeHold = null;
      action = 'ProjectCompleted';
    } else if (target === 'Cancelled') {
      patch.cancelledAt = now;
      patch.statusBeforeHold = null;
      action = 'ProjectCancelled';
    } else if (target === 'RevisionRequired') {
      // For Personal projects RevisionRequired is an operational workflow
      // condition only: it must not create or increment a document Revision
      // identity merely because client feedback arrived. Team behavior that
      // relies on the counter is preserved.
      if (!personal) {
        patch.revisionNumber = project.revisionNumber + 1;
      }
      patch.completedAt = null;
      action = 'RevisionRequested';
    } else if (project.status === 'Completed' || project.status === 'Cancelled') {
      patch.completedAt = null;
      patch.cancelledAt = null;
      patch.statusBeforeHold = null;
      action = 'ProjectReopened';
    }

    let updated: Project;
    let replayed = false;
    if (personal && this.personalWorkflowCoordinator) {
      // TransitionId-aware same-ID replay detection. A conflicting payload
      // throws 409 before any durable write; a matching replay returns the
      // current project with no side effects.
      if (input.transitionId) {
        const replay = this.personalWorkflowCoordinator.resolveReplay(
          project,
          target,
          input.reason ?? null,
          input.transitionId,
        );
        if (replay.replayed) {
          return project;
        }
      }
      // Atomic durable core: project mutation + ProjectActivity +
      // WorkflowTransitionRecord commit (or roll back) together. RevisionCycle
      // side effects are intentionally NOT part of B2A.
      const commit = this.personalWorkflowCoordinator.commitTransition({
        project,
        actor,
        target,
        now,
        patch,
        action,
        activityMessage: `Status changed from ${project.status} to ${target} by ${actor.displayName}.${input.reason ? ` Reason: ${input.reason}` : ''}`,
        reason: input.reason ?? null,
        transitionId: input.transitionId,
      });
      updated = commit.updated;
      replayed = commit.replayed;
    } else {
      updated = await this.provider.updateProject(project.id, patch);
      const reason = input.reason ? ` Reason: ${input.reason}` : '';
      await this.provider.appendActivities([
        audit(
          actor,
          project.id,
          action,
          `Status changed from ${project.status} to ${target} by ${actor.displayName}.${reason}`,
          now,
          'status',
          project.status,
          target,
        ),
      ]);
    }

    if (!replayed) {
      const recipients = new Set<string>([project.salesOwnerId]);
      if (project.assignedDesignerId) recipients.add(project.assignedDesignerId);
      project.collaboratorDesignerIds.forEach((id) => recipients.add(id));
      recipients.delete(actor.id);
      await this.provider.addNotifications(
        [...recipients].map((recipient) =>
          notification(
            recipient,
            target === 'RevisionRequired' ? 'Revision' : 'ProjectUpdated',
            `Project is now ${target}`,
            `${project.projectCode} was updated by ${actor.displayName}.`,
            project.id,
            now,
          ),
        ),
      );
    }
    return updated;
  }

  public async addComment(
    actor: AppUser,
    projectId: string,
    input: AddCommentInput,
  ): Promise<ProjectComment> {
    const project = await this.getProject(actor, projectId);
    assertPermission(canCommentOnProject(actor, project), 'You cannot comment on this project.');
    const now = this.clock().toISOString();
    const comment: ProjectComment = {
      id: randomUUID(),
      projectId: project.id,
      body: input.body,
      authorId: actor.id,
      authorNameSnapshot: actor.displayName,
      attachmentUrl: input.attachmentUrl ?? null,
      createdAt: now,
      updatedAt: now,
    };
    const saved = await this.provider.addComment(comment);
    await this.provider.appendActivities([
      audit(actor, project.id, 'CommentAdded', `Comment added by ${actor.displayName}.`, now),
    ]);
    const recipients = new Set<string>([project.salesOwnerId]);
    if (project.assignedDesignerId) recipients.add(project.assignedDesignerId);
    project.collaboratorDesignerIds.forEach((id) => recipients.add(id));
    recipients.delete(actor.id);
    await this.provider.addNotifications(
      [...recipients].map((recipient) =>
        notification(
          recipient,
          'Comment',
          'New project comment',
          `${actor.displayName} commented on ${project.projectCode}.`,
          project.id,
          now,
        ),
      ),
    );
    return saved;
  }

  public async listActivities(actor: AppUser, projectId: string): Promise<ProjectActivity[]> {
    await this.getProject(actor, projectId);
    return this.provider.listActivities(projectId);
  }

  public async listComments(actor: AppUser, projectId: string): Promise<ProjectComment[]> {
    await this.getProject(actor, projectId);
    return this.provider.listComments(projectId);
  }

  public async workloads(actor: AppUser): Promise<WorkloadMetrics[]> {
    assertPermission(
      isManager(actor) || actor.role === 'Designer',
      'Designer workload is not available for this role.',
    );
    const values = calculateAllDesignerWorkloads(
      await this.provider.listUsers(),
      await this.provider.listProjects(),
      this.clock(),
    );
    return actor.role === 'Designer'
      ? values.filter((item) => item.designer.id === actor.id)
      : values;
  }

  public async reports(actor: AppUser): Promise<ReportSummary> {
    assertPermission(isManager(actor), 'Reports are available to Line Managers and Admins.');
    return calculateReportSummary(
      await this.provider.listProjects(),
      await this.provider.listUsers(),
      this.clock(),
    );
  }

  public async getSettings(actor: AppUser): Promise<AppSettings> {
    assertPermission(canManageSettings(actor), 'Settings are available to Admins only.');
    return this.provider.getSettings();
  }

  public async updateSettings(actor: AppUser, input: UpdateSettingsInput): Promise<AppSettings> {
    assertPermission(canManageSettings(actor), 'Settings are available to Admins only.');
    const current = await this.provider.getSettings();
    const settings: AppSettings = {
      ...current,
      ...(input.companyTimezone !== undefined ? { companyTimezone: input.companyTimezone } : {}),
      ...(input.teamsNotificationsEnabled !== undefined
        ? { teamsNotificationsEnabled: input.teamsNotificationsEnabled }
        : {}),
      ...(input.projectTypes !== undefined ? { projectTypes: input.projectTypes } : {}),
      updatedAt: this.clock().toISOString(),
      updatedById: actor.id,
    };
    return this.provider.updateSettings(settings);
  }
}
