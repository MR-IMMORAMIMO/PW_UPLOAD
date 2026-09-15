import { createHash, randomUUID } from 'node:crypto';
import { ContactPresentationStore } from './infrastructure/final-ui/ContactPresentationStore.js';
import { applyV30OptionalContactEmail } from './infrastructure/migration/registry/production-v30-optional-contact-email.js';
import type { DatabaseSync } from 'node:sqlite';
import type {
  MicrosoftCalendarEventInput,
  MicrosoftConnectionSettingsInput,
  ProjectActionItemInput,
  ProjectChecklistItemInput,
  ProjectContactInput,
  ProjectDocumentInput,
  ProjectMeetingInput,
  MeetingNoteInput,
  MeetingActionLinkInput,
  CreateActionFromMeetingInput,
  ProjectRequirementInput,
  ProjectReviewItemInput,
  CreateProjectReviewThreadInput,
  CreateProjectReviewReplyInput,
  ProjectRevisionInput,
  CreateProjectTagInput,
  UpdateProjectTagInput,
  CreateScopeNoteInput,
  UpdateScopeNoteInput,
  CreateActionCategoryInput,
  UpdateActionCategoryInput,
} from '@scli/contracts';
import {
  DomainError,
  type MicrosoftConnection,
  type PersonalPortfolioOperations,
  type Project,
  type ProjectActionItem,
  type ProjectChecklistItem,
  type ProjectCommunication,
  type ProjectContact,
  type ProjectDocument,
  type ProjectHealth,
  type ProjectMeeting,
  type MeetingParticipant,
  type MeetingAgendaItem,
  type MeetingNote,
  type MeetingActionLink,
  type MeetingListItem,
  type MeetingDetail,
  type MeetingActionRelationType,
  type ProjectRequirement,
  type ProjectTag,
  type ActionCategory,
  normalizeProjectTagLabel,
  normalizeCatalogLabel,
  normalizedCatalogIdentity,
  type ScopeNote,
  type ProjectReviewItem,
  type ProjectReviewReply,
  type ProjectReviewAttachment,
  type ProjectReviewThreadContext,
  type AppUser,
  type ProjectRevision,
  type ProjectServiceCode,
  type WorkspaceActivity,
  type WorkspaceSearchResult,
} from '@scli/domain';
import {
  DEFAULT_SCHEMA_MANAGEMENT_MODE,
  EXTERNALLY_MIGRATED,
  PRODUCTION_V7_ACTION_CATEGORY_DEFAULTS,
  verifyExternalSchemaReadiness,
  type SchemaManagementMode,
} from './infrastructure/migration/registry/production-migration-registry';

type Database = InstanceType<typeof DatabaseSync>;
type Row = Record<string, unknown>;

export interface ProjectOperationsData {
  requirements: ProjectRequirement[];
  tags: ProjectTag[];
  scopeNotes: ScopeNote[];
  checklist: ProjectChecklistItem[];
  actions: ProjectActionItem[];
  meetings: ProjectMeeting[];
  reviewItems: ProjectReviewItem[];
  revisions: ProjectRevision[];
  documents: ProjectDocument[];
  contacts: ProjectContact[];
  communications: ProjectCommunication[];
  activity: WorkspaceActivity[];
  health: ProjectHealth;
}

export type ReviewMutationActor = Pick<AppUser, 'id' | 'displayName' | 'jobTitle'>;

export interface SyncedCommunicationInput {
  externalId: string;
  kind: 'Email' | 'Calendar';
  conversationId: string;
  subject: string;
  sender: string;
  participants: string[];
  occurredAt: string;
  endAt: string | null;
  preview: string;
  webLink: string;
  hasAttachments: boolean;
  projectId?: string | null;
}

const coreChecklist: Array<[string, string, ProjectServiceCode | null]> = [
  ['Project Information', 'Latest approved architectural drawings received', null],
  ['Project Information', 'Room names, functions and dimensions confirmed', null],
  ['Project Information', 'Ceiling heights and reflected ceiling plan confirmed', null],
  ['Project Information', 'Client brief and design stage confirmed', null],
  ['Project Information', 'Project delivery date confirmed', null],
  ['Pre-Issue QA', 'All client and consultant comments are resolved', null],
  ['Pre-Issue QA', 'Drawing and document revision numbers match', null],
  ['Pre-Issue QA', 'All required deliverables are present in the issue package', null],
];

const serviceChecklist: Partial<
  Record<ProjectServiceCode, Array<[string, string, ProjectServiceCode]>>
> = {
  LightingLayout: [
    ['Layout Inputs', 'Furniture layout received and coordinated', 'LightingLayout'],
    ['Layout QA', 'Luminaire tags match the schedule', 'LightingLayout'],
  ],
  LightingDesign: [
    ['Design Inputs', 'Interior concept, materials and finishes received', 'LightingDesign'],
    ['Design QA', 'Lighting intent reviewed for every space', 'LightingDesign'],
  ],
  DialuxCalculation: [
    [
      'Calculation Inputs',
      'Target lux levels and applicable standard confirmed',
      'DialuxCalculation',
    ],
    ['Calculation Inputs', 'Reflectance and maintenance factor confirmed', 'DialuxCalculation'],
  ],
  DialuxReport: [
    ['Report QA', 'Calculation scenes and false-colour views checked', 'DialuxReport'],
    ['Report QA', 'Report room names match the drawings', 'DialuxReport'],
  ],
  Visualization3D: [
    ['Visualization Inputs', '3D model, materials and camera views received', 'Visualization3D'],
    ['Visualization QA', 'Final views and image resolution approved', 'Visualization3D'],
  ],
  Presentation: [
    [
      'Presentation QA',
      'Project story, visuals and specifications are coordinated',
      'Presentation',
    ],
  ],
  LuminaireSchedule: [
    [
      'Schedule QA',
      'Manufacturer and model are complete for selected luminaires',
      'LuminaireSchedule',
    ],
    ['Schedule QA', 'Visible schedule columns reviewed before issue', 'LuminaireSchedule'],
  ],
  TechnicalBoq: [['BOQ QA', 'Units and quantities are reviewed', 'TechnicalBoq']],
  Datasheets: [
    ['Datasheet QA', 'Every issued luminaire has the correct official datasheet', 'Datasheets'],
  ],
};

function text(value: unknown): string {
  return value === null || value === undefined ? '' : String(value);
}

function nullableText(value: unknown): string | null {
  return value === null || value === undefined || value === '' ? null : String(value);
}

function jsonArray(value: unknown): string[] {
  if (typeof value !== 'string' || !value) return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === 'string')
      : [];
  } catch {
    return [];
  }
}

function requirementFromRow(row: Row): ProjectRequirement {
  return {
    id: text(row.id),
    projectId: text(row.project_id),
    category: text(row.category),
    title: text(row.title),
    details: text(row.details),
    requestedFrom: text(row.requested_from),
    requestedAt: nullableText(row.requested_at),
    dueDate: nullableText(row.due_date),
    status: text(row.status) as ProjectRequirement['status'],
    impact: text(row.impact) as ProjectRequirement['impact'],
    sourceType: text(row.source_type) as ProjectRequirement['sourceType'],
    sourceReference: text(row.source_reference),
    notes: text(row.notes),
    sortOrder: Number(row.sort_order),
    createdAt: text(row.created_at),
    updatedAt: text(row.updated_at),
  };
}
function tagFromRow(row: Row): ProjectTag {
  return {
    id: text(row.id),
    projectId: text(row.project_id),
    label: text(row.label),
    colorKey: text(row.color_key) as ProjectTag['colorKey'],
    createdAt: text(row.created_at),
    updatedAt: text(row.updated_at),
  };
}
function actionCategoryFromRow(row: Row): ActionCategory {
  return {
    id: text(row.id),
    label: text(row.label),
    iconKey: text(row.icon_key) as ActionCategory['iconKey'],
    colorKey: text(row.color_key) as ActionCategory['colorKey'],
    sortOrder: Number(row.sort_order),
    createdAt: text(row.created_at),
    updatedAt: text(row.updated_at),
  };
}
function scopeNoteFromRow(row: Row): ScopeNote {
  return {
    id: text(row.id),
    projectId: text(row.project_id),
    type: text(row.type) as ScopeNote['type'],
    text: text(row.text),
    sortOrder: Number(row.sort_order),
    createdAt: text(row.created_at),
    updatedAt: text(row.updated_at),
  };
}

function checklistFromRow(row: Row): ProjectChecklistItem {
  return {
    id: text(row.id),
    projectId: text(row.project_id),
    category: text(row.category),
    title: text(row.title),
    serviceCode: nullableText(row.service_code) as ProjectServiceCode | null,
    required: Boolean(row.required),
    completed: Boolean(row.completed),
    waived: Boolean(row.waived),
    waiverReason: text(row.waiver_reason),
    sortOrder: Number(row.sort_order),
    createdAt: text(row.created_at),
    updatedAt: text(row.updated_at),
  };
}

function actionFromRow(row: Row): ProjectActionItem {
  return {
    id: text(row.id),
    projectId: text(row.project_id),
    title: text(row.title),
    details: text(row.details),
    owner: text(row.owner),
    ownerRole: text(row.owner_role),
    dueDate: nullableText(row.due_date),
    status: text(row.status) as ProjectActionItem['status'],
    priority: text(row.priority) as ProjectActionItem['priority'],
    sourceType: text(row.source_type) as ProjectActionItem['sourceType'],
    sourceId: nullableText(row.source_id),
    revisionId: nullableText(row.revision_id),
    categoryId: nullableText(row.category_id),
    notes: text(row.notes),
    area: text(row.area),
    luminaireId: nullableText(row.luminaire_id),
    reviewItemId: nullableText(row.review_item_id),
    completedAt: nullableText(row.completed_at),
    createdAt: text(row.created_at),
    updatedAt: text(row.updated_at),
    // P5D — v28 additive columns; absent columns read as safe defaults.
    blocksIssue: row.blocks_issue === undefined ? false : Number(row.blocks_issue) === 1,
    rowVersion: row.row_version === undefined ? 1 : Number(row.row_version),
    createdById: nullableText(row.created_by_id),
    createdByName: nullableText(row.created_by_name),
    updatedById: nullableText(row.updated_by_id),
    updatedByName: nullableText(row.updated_by_name),
  };
}

function meetingFromRow(row: Row): ProjectMeeting {
  return {
    id: text(row.id),
    projectId: text(row.project_id),
    title: text(row.title),
    purpose: text(row.purpose),
    startAt: text(row.start_at),
    endAt: text(row.end_at),
    location: text(row.location),
    attendees: jsonArray(row.attendees_json),
    agenda: text(row.agenda),
    notes: text(row.notes),
    decisions: text(row.decisions),
    onlineMeetingUrl: text(row.online_meeting_url),
    externalEventId: nullableText(row.external_event_id),
    status: text(row.status) as ProjectMeeting['status'],
    createdAt: text(row.created_at),
    updatedAt: text(row.updated_at),
  };
}

function meetingParticipantFromRow(row: Row): MeetingParticipant {
  return {
    id: text(row.id),
    meetingId: text(row.meeting_id),
    name: text(row.name),
    role: text(row.role),
    sortOrder: Number(row.sort_order),
    createdAt: text(row.created_at),
    updatedAt: text(row.updated_at),
  };
}
function meetingAgendaItemFromRow(row: Row): MeetingAgendaItem {
  return {
    id: text(row.id),
    meetingId: text(row.meeting_id),
    content: text(row.content),
    sortOrder: Number(row.sort_order),
    createdAt: text(row.created_at),
    updatedAt: text(row.updated_at),
  };
}
function meetingNoteFromRow(row: Row): MeetingNote {
  return {
    id: text(row.id),
    meetingId: text(row.meeting_id),
    content: text(row.content),
    authorName: text(row.author_name),
    createdAt: text(row.created_at),
    updatedAt: text(row.updated_at),
  };
}
function meetingActionLinkFromRow(row: Row): MeetingActionLink {
  return {
    id: text(row.id),
    projectId: text(row.project_id),
    meetingId: text(row.meeting_id),
    actionId: text(row.action_id),
    relationType: text(row.relation_type) as MeetingActionRelationType,
    createdAt: text(row.created_at),
  };
}

function reviewFromRow(row: Row): ProjectReviewItem {
  return {
    id: text(row.id),
    projectId: text(row.project_id),
    reference: text(row.reference),
    title: text(row.title),
    description: text(row.description),
    area: text(row.area),
    luminaireTag: text(row.luminaire_tag),
    drawingReference: text(row.drawing_reference),
    sourceType: text(row.source_type) as ProjectReviewItem['sourceType'],
    sourceId: nullableText(row.source_id),
    status: text(row.status) as ProjectReviewItem['status'],
    response: text(row.response),
    revisionId: nullableText(row.revision_id),
    origin: nullableText(row.origin) as ProjectReviewItem['origin'],
    authorId: nullableText(row.author_id),
    authorNameSnapshot: nullableText(row.author_name_snapshot),
    authorRoleSnapshot: nullableText(row.author_role_snapshot),
    luminaireId: nullableText(row.luminaire_id),
    receivedAt: text(row.received_at),
    dueDate: nullableText(row.due_date),
    createdAt: text(row.created_at),
    updatedAt: text(row.updated_at),
  };
}

function reviewReplyFromRow(row: Row): ProjectReviewReply {
  return {
    id: text(row.id),
    projectId: text(row.project_id),
    reviewItemId: text(row.review_item_id),
    body: text(row.body),
    authorId: text(row.author_id),
    authorNameSnapshot: text(row.author_name_snapshot),
    authorRoleSnapshot: text(row.author_role_snapshot),
    origin: text(row.origin) as ProjectReviewReply['origin'],
    createdAt: text(row.created_at),
    updatedAt: text(row.updated_at),
  };
}

function reviewAttachmentFromRow(row: Row): ProjectReviewAttachment {
  return {
    id: text(row.id),
    projectId: text(row.project_id),
    documentId: text(row.document_id),
    reviewItemId: nullableText(row.review_item_id),
    replyId: nullableText(row.reply_id),
    createdById: text(row.created_by_id),
    createdByNameSnapshot: text(row.created_by_name_snapshot),
    createdAt: text(row.created_at),
  };
}

function revisionFromRow(row: Row): ProjectRevision {
  return {
    id: text(row.id),
    projectId: text(row.project_id),
    revisionNumber: Number(row.revision_number),
    title: text(row.title),
    status: text(row.status) as ProjectRevision['status'],
    receivedAt: nullableText(row.received_at),
    dueDate: nullableText(row.due_date),
    issuedAt: nullableText(row.issued_at),
    summary: text(row.summary),
    changeLog: text(row.change_log),
    sourceType: text(row.source_type) as ProjectRevision['sourceType'],
    sourceReference: text(row.source_reference),
    locked: Boolean(row.locked),
    snapshotHash: text(row.snapshot_hash),
    reissueNumber: Number(row.reissue_number ?? 0),
    createdAt: text(row.created_at),
    updatedAt: text(row.updated_at),
  };
}

function documentFromRow(row: Row): ProjectDocument {
  return {
    id: text(row.id),
    projectId: text(row.project_id),
    category: text(row.category) as ProjectDocument['category'],
    documentNumber: text(row.document_number),
    title: text(row.title),
    revision: text(row.revision),
    status: text(row.status) as ProjectDocument['status'],
    filePath: text(row.file_path),
    issuedTo: text(row.issued_to),
    issueDate: nullableText(row.issue_date),
    notes: text(row.notes),
    createdAt: text(row.created_at),
    updatedAt: text(row.updated_at),
  };
}

function contactFromRow(row: Row): ProjectContact {
  return {
    id: text(row.id),
    projectId: text(row.project_id),
    name: text(row.name),
    email: text(row.email),
    company: text(row.company),
    role: text(row.role),
    phone: text(row.phone),
    isPrimary: Number(row.is_primary) === 1,
    createdAt: text(row.created_at),
    updatedAt: text(row.updated_at),
  };
}

function communicationFromRow(row: Row): ProjectCommunication {
  return {
    id: text(row.id),
    projectId: nullableText(row.project_id),
    externalId: text(row.external_id),
    kind: text(row.kind) as ProjectCommunication['kind'],
    conversationId: text(row.conversation_id),
    subject: text(row.subject),
    sender: text(row.sender),
    participants: jsonArray(row.participants_json),
    occurredAt: text(row.occurred_at),
    endAt: nullableText(row.end_at),
    preview: text(row.preview),
    webLink: text(row.web_link),
    hasAttachments: Boolean(row.has_attachments),
    manuallyLinked: Boolean(row.manually_linked),
    syncedAt: text(row.synced_at),
  };
}

function activityFromRow(row: Row): WorkspaceActivity {
  return {
    id: text(row.id),
    projectId: text(row.project_id),
    entityType: text(row.entity_type),
    entityId: nullableText(row.entity_id),
    action: text(row.action),
    title: text(row.title),
    detail: text(row.detail),
    createdAt: text(row.created_at),
  };
}

function dateKeyInTimeZone(date: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${value.year}-${value.month}-${value.day}`;
}

function addCalendarDays(dateKey: string, days: number): string {
  const date = new Date(`${dateKey}T12:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export class PersonalOperationsStore {
  private nowProvider: () => string = () => new Date().toISOString();
  private idProvider: () => string = () => randomUUID();
  public constructor(
    private readonly database: Database,
    private readonly companyTimeZone = 'Asia/Dubai',
    schemaManagementMode: SchemaManagementMode = DEFAULT_SCHEMA_MANAGEMENT_MODE,
  ) {
    this.database.exec('PRAGMA foreign_keys = ON');
    if (schemaManagementMode === EXTERNALLY_MIGRATED) {
      // Post-migration readiness assertion: no schema creation, alteration, or repair.
      verifyExternalSchemaReadiness(database, 'PersonalOperationsStore');
    } else {
      this.ensureSchema();
    }
    const now = new Date().toISOString();
    this.database
      .prepare(
        `
        INSERT OR IGNORE INTO microsoft_connection
        (id, tenant_id, client_id, connected, account_name, account_email,
         mail_sync_enabled, calendar_sync_enabled, sync_interval_minutes,
         last_sync_at, last_error, token_blob, token_expires_at, updated_at)
        VALUES (1, 'organizations', '', 0, '', '', 1, 1, 15, NULL, NULL, '', NULL, ?)
      `,
      )
      .run(now);
  }

  /** Internal server-time scope for deterministic canonical fixture operations. */
  public withServerClock<T>(now: () => string, operation: () => T): T {
    const previous = this.nowProvider;
    this.nowProvider = now;
    try {
      return operation();
    } finally {
      this.nowProvider = previous;
    }
  }

  /** Internal server-identity scope for deterministic canonical fixture operations. */
  public withServerIdentity<T>(ids: readonly string[], operation: () => T): T {
    const previous = this.idProvider;
    let index = 0;
    this.idProvider = () => {
      const id = ids[index];
      if (!id) throw new Error('Deterministic server identity sequence was exhausted.');
      index += 1;
      return id;
    };
    try {
      return operation();
    } finally {
      this.idProvider = previous;
    }
  }

  private ensureSchema(): void {
    const actionCategoriesExisted = Boolean(
      this.database
        .prepare(
          "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'action_categories'",
        )
        .get(),
    );
    this.database.exec(`
      CREATE TABLE IF NOT EXISTS project_requirements (
        id TEXT PRIMARY KEY, project_id TEXT NOT NULL, category TEXT NOT NULL,
        title TEXT NOT NULL, details TEXT NOT NULL, requested_from TEXT NOT NULL,
        requested_at TEXT, due_date TEXT, status TEXT NOT NULL, impact TEXT NOT NULL,
        source_type TEXT NOT NULL, source_reference TEXT NOT NULL, notes TEXT NOT NULL,
        sort_order INTEGER NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS ix_project_requirements_project ON project_requirements(project_id, status, due_date);
      CREATE TABLE IF NOT EXISTS project_tags (id TEXT PRIMARY KEY, project_id TEXT NOT NULL, label TEXT NOT NULL, normalized_label TEXT NOT NULL, color_key TEXT NOT NULL CHECK(color_key IN ('teal', 'blue', 'purple', 'gold', 'green', 'red', 'slate')), created_at TEXT NOT NULL, updated_at TEXT NOT NULL, UNIQUE(project_id, normalized_label));
      CREATE INDEX IF NOT EXISTS ix_project_tags_project ON project_tags(project_id, created_at);
      CREATE TABLE IF NOT EXISTS project_scope_notes (id TEXT PRIMARY KEY, project_id TEXT NOT NULL, type TEXT NOT NULL CHECK(type IN ('Note', 'Exclusion')), text TEXT NOT NULL, sort_order INTEGER NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS ix_project_scope_notes_project ON project_scope_notes(project_id, sort_order, created_at);

      CREATE TABLE IF NOT EXISTS project_checklist_items (
        id TEXT PRIMARY KEY, project_id TEXT NOT NULL, category TEXT NOT NULL,
        title TEXT NOT NULL, service_code TEXT, required INTEGER NOT NULL,
        completed INTEGER NOT NULL, waived INTEGER NOT NULL, waiver_reason TEXT NOT NULL,
        sort_order INTEGER NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
        UNIQUE(project_id, category, title)
      );

      CREATE TABLE IF NOT EXISTS project_actions (
        id TEXT PRIMARY KEY, project_id TEXT NOT NULL, title TEXT NOT NULL,
        details TEXT NOT NULL, owner TEXT NOT NULL, due_date TEXT, status TEXT NOT NULL,
        priority TEXT NOT NULL, source_type TEXT NOT NULL, source_id TEXT,
        revision_id TEXT, completed_at TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS ix_project_actions_due ON project_actions(project_id, status, due_date);

      CREATE TABLE IF NOT EXISTS action_categories (
        id TEXT PRIMARY KEY, label TEXT NOT NULL, normalized_label TEXT NOT NULL,
        icon_key TEXT NOT NULL, color_key TEXT NOT NULL CHECK(color_key IN ('teal', 'blue', 'purple', 'gold', 'green', 'red', 'slate')),
        sort_order INTEGER NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
        UNIQUE(normalized_label)
      );
      CREATE INDEX IF NOT EXISTS ix_action_categories_sort ON action_categories(sort_order, normalized_label, id);

      CREATE TABLE IF NOT EXISTS project_meetings (
        id TEXT PRIMARY KEY, project_id TEXT NOT NULL, title TEXT NOT NULL,
        start_at TEXT NOT NULL, end_at TEXT NOT NULL, location TEXT NOT NULL,
        attendees_json TEXT NOT NULL, agenda TEXT NOT NULL, notes TEXT NOT NULL,
        decisions TEXT NOT NULL, online_meeting_url TEXT NOT NULL, external_event_id TEXT,
        status TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS ix_project_meetings_start ON project_meetings(project_id, start_at);
      CREATE TABLE IF NOT EXISTS meeting_participants (id TEXT PRIMARY KEY, meeting_id TEXT NOT NULL REFERENCES project_meetings(id) ON DELETE CASCADE, name TEXT NOT NULL, role TEXT NOT NULL, sort_order INTEGER NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, UNIQUE(meeting_id, sort_order));
      CREATE TABLE IF NOT EXISTS meeting_agenda_items (id TEXT PRIMARY KEY, meeting_id TEXT NOT NULL REFERENCES project_meetings(id) ON DELETE CASCADE, content TEXT NOT NULL, sort_order INTEGER NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, UNIQUE(meeting_id, sort_order));
      CREATE TABLE IF NOT EXISTS meeting_notes (id TEXT PRIMARY KEY, meeting_id TEXT NOT NULL REFERENCES project_meetings(id) ON DELETE CASCADE, content TEXT NOT NULL, author_name TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS meeting_action_links (id TEXT PRIMARY KEY, project_id TEXT NOT NULL, meeting_id TEXT NOT NULL REFERENCES project_meetings(id) ON DELETE CASCADE, action_id TEXT NOT NULL REFERENCES project_actions(id) ON DELETE CASCADE, relation_type TEXT NOT NULL CHECK(relation_type IN ('Linked', 'CreatedFromMeeting')), created_at TEXT NOT NULL, UNIQUE(meeting_id, action_id));
      CREATE INDEX IF NOT EXISTS ix_meeting_action_links_meeting_relation ON meeting_action_links(meeting_id, relation_type);
      CREATE INDEX IF NOT EXISTS ix_meeting_action_links_action_relation ON meeting_action_links(action_id, relation_type);

      CREATE TABLE IF NOT EXISTS project_review_items (
        id TEXT PRIMARY KEY, project_id TEXT NOT NULL, reference TEXT NOT NULL,
        title TEXT NOT NULL, description TEXT NOT NULL, area TEXT NOT NULL,
        luminaire_tag TEXT NOT NULL, drawing_reference TEXT NOT NULL,
        source_type TEXT NOT NULL, source_id TEXT, status TEXT NOT NULL,
        response TEXT NOT NULL, revision_id TEXT, received_at TEXT NOT NULL,
        due_date TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS project_revisions (
        id TEXT PRIMARY KEY, project_id TEXT NOT NULL, revision_number INTEGER NOT NULL,
        title TEXT NOT NULL, status TEXT NOT NULL, received_at TEXT, due_date TEXT,
        issued_at TEXT, summary TEXT NOT NULL, change_log TEXT NOT NULL,
        source_type TEXT NOT NULL, source_reference TEXT NOT NULL,
        locked INTEGER NOT NULL DEFAULT 0, snapshot_hash TEXT NOT NULL DEFAULT '',
        reissue_number INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
        UNIQUE(project_id, revision_number)
      );

      CREATE TABLE IF NOT EXISTS project_documents (
        id TEXT PRIMARY KEY, project_id TEXT NOT NULL, category TEXT NOT NULL,
        document_number TEXT NOT NULL, title TEXT NOT NULL, revision TEXT NOT NULL,
        status TEXT NOT NULL, file_path TEXT NOT NULL, issued_to TEXT NOT NULL,
        issue_date TEXT, notes TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS ix_project_documents_project ON project_documents(project_id, status, category);

      CREATE TABLE IF NOT EXISTS project_contacts (
        id TEXT PRIMARY KEY, project_id TEXT NOT NULL, name TEXT NOT NULL,
        email TEXT NOT NULL COLLATE NOCASE, company TEXT NOT NULL, role TEXT NOT NULL,
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
        UNIQUE(project_id, email)
      );

      CREATE TABLE IF NOT EXISTS project_communications (
        id TEXT PRIMARY KEY, project_id TEXT, external_id TEXT NOT NULL,
        kind TEXT NOT NULL, conversation_id TEXT NOT NULL, subject TEXT NOT NULL,
        sender TEXT NOT NULL, participants_json TEXT NOT NULL, occurred_at TEXT NOT NULL,
        end_at TEXT, preview TEXT NOT NULL, web_link TEXT NOT NULL,
        has_attachments INTEGER NOT NULL, manually_linked INTEGER NOT NULL,
        synced_at TEXT NOT NULL, UNIQUE(kind, external_id)
      );
      CREATE INDEX IF NOT EXISTS ix_project_communications_project ON project_communications(project_id, occurred_at DESC);

      CREATE TABLE IF NOT EXISTS workspace_activity (
        id TEXT PRIMARY KEY, project_id TEXT NOT NULL, entity_type TEXT NOT NULL,
        entity_id TEXT, action TEXT NOT NULL, title TEXT NOT NULL, detail TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS ix_workspace_activity_project ON workspace_activity(project_id, created_at DESC);

      CREATE TABLE IF NOT EXISTS microsoft_connection (
        id INTEGER PRIMARY KEY CHECK (id = 1), tenant_id TEXT NOT NULL,
        client_id TEXT NOT NULL, connected INTEGER NOT NULL, account_name TEXT NOT NULL,
        account_email TEXT NOT NULL, mail_sync_enabled INTEGER NOT NULL,
        calendar_sync_enabled INTEGER NOT NULL, sync_interval_minutes INTEGER NOT NULL,
        last_sync_at TEXT, last_error TEXT, token_blob TEXT NOT NULL,
        token_expires_at TEXT, updated_at TEXT NOT NULL
      );
    `);
    this.ensureColumn('project_revisions', 'locked', 'INTEGER NOT NULL DEFAULT 0');
    this.ensureColumn('project_revisions', 'snapshot_hash', "TEXT NOT NULL DEFAULT ''");
    this.ensureColumn('project_revisions', 'reissue_number', 'INTEGER NOT NULL DEFAULT 0');
    this.ensureColumn(
      'project_actions',
      'category_id',
      'TEXT REFERENCES action_categories(id) ON UPDATE RESTRICT ON DELETE SET NULL',
    );
    this.ensureColumn('project_actions', 'owner_role', "TEXT NOT NULL DEFAULT ''");
    this.ensureColumn('project_actions', 'notes', "TEXT NOT NULL DEFAULT ''");
    // P5D — schema v28 additive mirror. The self-managed mirror must stay
    // semantically aligned with the production 27 -> 28 migration.
    this.ensureColumn(
      'project_actions',
      'blocks_issue',
      'INTEGER NOT NULL DEFAULT 0 CHECK (blocks_issue IN (0, 1))',
    );
    this.ensureColumn(
      'project_actions',
      'row_version',
      'INTEGER NOT NULL DEFAULT 1 CHECK (row_version >= 1)',
    );
    this.ensureColumn('project_actions', 'created_by_id', 'TEXT');
    this.ensureColumn('project_actions', 'created_by_name', 'TEXT');
    this.ensureColumn('project_actions', 'updated_by_id', 'TEXT');
    this.ensureColumn('project_actions', 'updated_by_name', 'TEXT');
    this.database.exec(
      `CREATE INDEX IF NOT EXISTS ix_project_actions_issue_blocking
        ON project_actions(project_id, status, blocks_issue)`,
    );
    this.ensureColumn('project_meetings', 'purpose', "TEXT NOT NULL DEFAULT ''");
    this.ensureColumn(
      'project_review_items',
      'origin',
      "TEXT CHECK(origin IS NULL OR origin IN ('Client', 'Internal'))",
    );
    this.ensureColumn('project_review_items', 'author_id', 'TEXT');
    this.ensureColumn('project_review_items', 'author_name_snapshot', 'TEXT');
    this.ensureColumn('project_review_items', 'author_role_snapshot', 'TEXT');
    this.ensureColumn('project_review_items', 'luminaire_id', 'TEXT');
    this.ensureColumn(
      'project_contacts',
      'phone',
      "TEXT NOT NULL DEFAULT '' CHECK(length(phone) <= 64)",
    );
    this.ensureColumn(
      'project_contacts',
      'is_primary',
      'INTEGER NOT NULL DEFAULT 0 CHECK(is_primary IN (0,1))',
    );
    this.ensureColumn(
      'project_actions',
      'area',
      "TEXT NOT NULL DEFAULT '' CHECK(length(area) <= 500)",
    );
    this.ensureColumn('project_actions', 'luminaire_id', 'TEXT');
    this.ensureColumn('project_actions', 'review_item_id', 'TEXT');
    applyV30OptionalContactEmail(this.database);
    this.database.exec(
      `CREATE INDEX IF NOT EXISTS ix_project_actions_category ON project_actions(category_id);
       CREATE UNIQUE INDEX IF NOT EXISTS ux_project_review_items_id_project ON project_review_items(id, project_id);
       CREATE UNIQUE INDEX IF NOT EXISTS ux_project_documents_id_project ON project_documents(id, project_id);
       CREATE TABLE IF NOT EXISTS project_review_replies (
         id TEXT PRIMARY KEY, project_id TEXT NOT NULL, review_item_id TEXT NOT NULL,
         body TEXT NOT NULL CHECK(length(trim(body)) > 0), author_id TEXT NOT NULL,
         author_name_snapshot TEXT NOT NULL, author_role_snapshot TEXT NOT NULL,
         origin TEXT NOT NULL CHECK(origin IN ('Client', 'Internal')),
         created_at TEXT NOT NULL, updated_at TEXT NOT NULL, UNIQUE(id, project_id),
         FOREIGN KEY(review_item_id, project_id) REFERENCES project_review_items(id, project_id)
           ON UPDATE RESTRICT ON DELETE RESTRICT
       );
       CREATE INDEX IF NOT EXISTS ix_project_review_replies_thread_order
         ON project_review_replies(project_id, review_item_id, created_at, id);
       CREATE TABLE IF NOT EXISTS project_review_attachments (
         id TEXT PRIMARY KEY, project_id TEXT NOT NULL, document_id TEXT NOT NULL,
         review_item_id TEXT, reply_id TEXT, created_by_id TEXT NOT NULL,
         created_by_name_snapshot TEXT NOT NULL, created_at TEXT NOT NULL,
         CHECK((review_item_id IS NOT NULL AND reply_id IS NULL) OR
               (review_item_id IS NULL AND reply_id IS NOT NULL)),
         FOREIGN KEY(review_item_id, project_id) REFERENCES project_review_items(id, project_id)
           ON UPDATE RESTRICT ON DELETE RESTRICT,
         FOREIGN KEY(reply_id, project_id) REFERENCES project_review_replies(id, project_id)
           ON UPDATE RESTRICT ON DELETE RESTRICT,
         FOREIGN KEY(document_id, project_id) REFERENCES project_documents(id, project_id)
           ON UPDATE RESTRICT ON DELETE RESTRICT
       );
       CREATE INDEX IF NOT EXISTS ix_project_review_attachments_project_order
         ON project_review_attachments(project_id, created_at, id);
       CREATE UNIQUE INDEX IF NOT EXISTS ux_project_review_root_document
         ON project_review_attachments(review_item_id, document_id) WHERE review_item_id IS NOT NULL;
       CREATE UNIQUE INDEX IF NOT EXISTS ux_project_review_reply_document
         ON project_review_attachments(reply_id, document_id) WHERE reply_id IS NOT NULL;`,
    );
    // Legacy self-managed mode is a compatibility bootstrap, not startup seed repair.
    // Only the first creation of the table receives the deterministic v7 defaults.
    if (!actionCategoriesExisted) {
      const insert = this.database.prepare(
        'INSERT INTO action_categories (id, label, normalized_label, icon_key, color_key, sort_order, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      );
      for (const [id, label, iconKey, colorKey] of PRODUCTION_V7_ACTION_CATEGORY_DEFAULTS) {
        insert.run(
          id,
          label,
          label.toLowerCase(),
          iconKey,
          colorKey,
          Number(id.slice(-2)),
          '2026-08-15T00:00:00.000Z',
          '2026-08-15T00:00:00.000Z',
        );
      }
    }
    this.database
      .prepare(
        `UPDATE project_checklist_items SET title = ?, updated_at = ?
         WHERE title = ? AND service_code = 'TechnicalBoq'`,
      )
      .run(
        'Units and quantities are reviewed',
        new Date().toISOString(),
        'Units and quantities are reviewed without price fields',
      );
  }

  public ensureProjectDefaults(projectId: string, services: ProjectServiceCode[]): void {
    const now = new Date().toISOString();
    const insert = this.database.prepare(`
      INSERT OR IGNORE INTO project_checklist_items
      (id, project_id, category, title, service_code, required, completed, waived,
       waiver_reason, sort_order, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, 1, 0, 0, '', ?, ?, ?)
    `);
    const templates = [
      ...coreChecklist,
      ...services.flatMap((service) => serviceChecklist[service] ?? []),
    ];
    templates.forEach(([category, title, serviceCode], sortOrder) =>
      insert.run(randomUUID(), projectId, category, title, serviceCode, sortOrder, now, now),
    );
    this.seedExistingExports(projectId);
  }

  private seedExistingExports(projectId: string): void {
    const rows = this.database
      .prepare('SELECT * FROM project_exports WHERE project_id = ? ORDER BY revision')
      .all(projectId) as Row[];
    for (const row of rows) {
      const revisionNumber = Number(row.revision);
      const createdAt = text(row.created_at);
      this.database
        .prepare(
          `
          INSERT OR IGNORE INTO project_revisions
          (id, project_id, revision_number, title, status, received_at, due_date, issued_at,
           summary, change_log, source_type, source_reference, created_at, updated_at)
          VALUES (?, ?, ?, ?, 'InternalReview', NULL, NULL, NULL, ?, '', 'Manual', '', ?, ?)
        `,
        )
        .run(
          randomUUID(),
          projectId,
          revisionNumber,
          `Revision ${String(revisionNumber).padStart(2, '0')}`,
          'Luminaire Schedule and Technical BOQ export.',
          createdAt,
          createdAt,
        );
      const files: Array<[ProjectDocument['category'], string, unknown]> = [
        [
          'LuminaireSchedule',
          'Luminaire Schedule Excel',
          row.schedule_excel_path || row.excel_path,
        ],
        ['LuminaireSchedule', 'Luminaire Schedule PDF', row.schedule_pdf_path || row.pdf_path],
        ['TechnicalBoq', 'Technical BOQ Excel', row.boq_excel_path],
        ['TechnicalBoq', 'Technical BOQ PDF', row.boq_pdf_path],
      ];
      for (const [category, title, rawPath] of files) {
        const filePath = text(rawPath);
        if (!filePath) continue;
        const exists = this.database
          .prepare('SELECT id FROM project_documents WHERE project_id = ? AND file_path = ?')
          .get(projectId, filePath) as Row | undefined;
        if (exists) continue;
        this.database
          .prepare(
            `
            INSERT INTO project_documents
            (id, project_id, category, document_number, title, revision, status, file_path,
             issued_to, issue_date, notes, created_at, updated_at)
            VALUES (?, ?, ?, '', ?, ?, 'InternalReview', ?, '', NULL, 'Generated by SCT Workspace.', ?, ?)
          `,
          )
          .run(
            randomUUID(),
            projectId,
            category,
            title,
            `REV_${String(revisionNumber).padStart(2, '0')}`,
            filePath,
            createdAt,
            createdAt,
          );
      }
    }
  }

  public getProjectData(
    projectId: string,
    services: ProjectServiceCode[],
    folderPath: string | null,
    luminaires: Array<{
      manufacturer: string;
      model: string;
      datasheetPath: string;
      quantity: number;
    }>,
    hasExports: boolean,
  ): ProjectOperationsData {
    this.ensureProjectDefaults(projectId, services);
    const requirements = (
      this.database
        .prepare(
          'SELECT * FROM project_requirements WHERE project_id = ? ORDER BY sort_order, created_at',
        )
        .all(projectId) as Row[]
    ).map(requirementFromRow);
    const tags = (
      this.database
        .prepare('SELECT * FROM project_tags WHERE project_id = ? ORDER BY created_at')
        .all(projectId) as Row[]
    ).map(tagFromRow);
    const scopeNotes = (
      this.database
        .prepare(
          'SELECT * FROM project_scope_notes WHERE project_id = ? ORDER BY sort_order, created_at',
        )
        .all(projectId) as Row[]
    ).map(scopeNoteFromRow);
    const checklist = (
      this.database
        .prepare(
          'SELECT * FROM project_checklist_items WHERE project_id = ? ORDER BY sort_order, created_at',
        )
        .all(projectId) as Row[]
    ).map(checklistFromRow);
    const actions = (
      this.database
        .prepare(
          `SELECT * FROM project_actions WHERE project_id = ?
                  ORDER BY CASE status WHEN 'Completed' THEN 1 WHEN 'Cancelled' THEN 2 ELSE 0 END,
                  CASE WHEN due_date IS NULL THEN 1 ELSE 0 END, due_date, created_at DESC`,
        )
        .all(projectId) as Row[]
    ).map(actionFromRow);
    const meetings = (
      this.database
        .prepare('SELECT * FROM project_meetings WHERE project_id = ? ORDER BY start_at DESC')
        .all(projectId) as Row[]
    ).map(meetingFromRow);
    const reviewItems = (
      this.database
        .prepare(
          'SELECT * FROM project_review_items WHERE project_id = ? ORDER BY received_at DESC, created_at DESC',
        )
        .all(projectId) as Row[]
    ).map(reviewFromRow);
    const revisions = (
      this.database
        .prepare(
          'SELECT * FROM project_revisions WHERE project_id = ? ORDER BY revision_number DESC',
        )
        .all(projectId) as Row[]
    ).map(revisionFromRow);
    const documents = (
      this.database
        .prepare('SELECT * FROM project_documents WHERE project_id = ? ORDER BY updated_at DESC')
        .all(projectId) as Row[]
    ).map(documentFromRow);
    const contacts = (
      this.database
        .prepare('SELECT * FROM project_contacts WHERE project_id = ? ORDER BY name COLLATE NOCASE')
        .all(projectId) as Row[]
    ).map((row) => ({
      ...contactFromRow(row),
      ...new ContactPresentationStore(this.database).read(projectId, text(row.id)),
    }));
    const communications = (
      this.database
        .prepare(
          'SELECT * FROM project_communications WHERE project_id = ? ORDER BY occurred_at DESC LIMIT 250',
        )
        .all(projectId) as Row[]
    ).map(communicationFromRow);
    const activity = (
      this.database
        .prepare(
          'SELECT * FROM workspace_activity WHERE project_id = ? ORDER BY created_at DESC LIMIT 250',
        )
        .all(projectId) as Row[]
    ).map(activityFromRow);
    const health = this.calculateHealth(
      folderPath,
      requirements,
      checklist,
      actions,
      reviewItems,
      luminaires,
      hasExports,
    );
    return {
      requirements,
      tags,
      scopeNotes,
      checklist,
      actions,
      meetings,
      reviewItems,
      revisions,
      documents,
      contacts,
      communications,
      activity,
      health,
    };
  }

  private calculateHealth(
    folderPath: string | null,
    requirements: ProjectRequirement[],
    checklist: ProjectChecklistItem[],
    actions: ProjectActionItem[],
    reviews: ProjectReviewItem[],
    luminaires: Array<{
      manufacturer: string;
      model: string;
      datasheetPath: string;
      quantity: number;
    }>,
    hasExports: boolean,
  ): ProjectHealth {
    const today = dateKeyInTimeZone(new Date(), this.companyTimeZone);
    const applicableChecklist = checklist.filter((item) => item.required && !item.waived);
    const completeChecklist = applicableChecklist.filter((item) => item.completed).length;
    const checklistPercent = applicableChecklist.length
      ? Math.round((completeChecklist / applicableChecklist.length) * 100)
      : 100;
    const openRequirements = requirements.filter(
      (item) => item.status !== 'Received' && item.status !== 'NotRequired',
    );
    const blockingRequirements = openRequirements.filter((item) => item.impact === 'Blocking');
    const overdueActions = actions.filter(
      (item) =>
        item.dueDate !== null &&
        item.dueDate < today &&
        item.status !== 'Completed' &&
        item.status !== 'Cancelled',
    );
    const unresolvedReviews = reviews.filter(
      (item) => item.status !== 'Resolved' && item.status !== 'Rejected',
    );
    const missingDatasheets = luminaires.filter((item) => !item.datasheetPath).length;
    const incompleteSpecification = luminaires.filter(
      (item) => !item.manufacturer || !item.model,
    ).length;
    const checks: ProjectHealth['checks'] = [
      {
        key: 'folder',
        label: 'Project folder',
        detail: folderPath ? 'Project folder is available.' : 'Create or link the project folder.',
        severity: 'Blocking',
        passed: Boolean(folderPath),
      },
      {
        key: 'requirements',
        label: 'Blocking information',
        detail: blockingRequirements.length
          ? `${blockingRequirements.length} blocking information item(s) remain open.`
          : 'No blocking information is open.',
        severity: 'Blocking',
        passed: blockingRequirements.length === 0,
      },
      {
        key: 'actions',
        label: 'Overdue actions',
        detail: overdueActions.length
          ? `${overdueActions.length} action(s) are overdue.`
          : 'No overdue actions.',
        severity: 'Warning',
        passed: overdueActions.length === 0,
      },
      {
        key: 'reviews',
        label: 'Open comments',
        detail: unresolvedReviews.length
          ? `${unresolvedReviews.length} review item(s) are unresolved.`
          : 'All comments are resolved.',
        severity: 'Warning',
        passed: unresolvedReviews.length === 0,
      },
      {
        key: 'datasheets',
        label: 'Datasheet coverage',
        detail: missingDatasheets
          ? `${missingDatasheets} luminaire(s) have no datasheet.`
          : 'All entered luminaires have datasheets.',
        severity: 'Warning',
        passed: missingDatasheets === 0,
      },
      {
        key: 'specification',
        label: 'Luminaire specification',
        detail: incompleteSpecification
          ? `${incompleteSpecification} luminaire(s) are missing manufacturer or model.`
          : 'Manufacturer and model fields are complete.',
        severity: 'Warning',
        passed: incompleteSpecification === 0,
      },
      {
        key: 'outputs',
        label: 'Issued outputs',
        detail: hasExports
          ? 'At least one output revision exists.'
          : 'No output revision exists yet.',
        severity: 'Info',
        passed: hasExports,
      },
    ];
    const penalties = checks.reduce((sum, check) => {
      if (check.passed) return sum;
      return sum + (check.severity === 'Blocking' ? 18 : check.severity === 'Warning' ? 8 : 3);
    }, 0);
    const score = Math.max(0, Math.min(100, Math.round(checklistPercent * 0.45 + 55 - penalties)));
    return {
      score,
      checklistPercent,
      openRequirements: openRequirements.length,
      blockingRequirements: blockingRequirements.length,
      overdueActions: overdueActions.length,
      unresolvedReviews: unresolvedReviews.length,
      checks,
    };
  }

  public createProjectTag(projectId: string, input: CreateProjectTagInput): ProjectTag {
    const id = randomUUID();
    const now = new Date().toISOString();
    const label = normalizeProjectTagLabel(input.label);
    try {
      this.database
        .prepare(
          'INSERT INTO project_tags (id, project_id, label, normalized_label, color_key, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
        )
        .run(id, projectId, label, label.toLowerCase(), input.colorKey, now, now);
    } catch (error) {
      throw new DomainError(
        'CONFLICT',
        'A tag with this label already exists for this project.',
        409,
        { cause: error },
      );
    }
    this.activity(projectId, 'ProjectTag', id, 'Created', label, input.colorKey, now);
    return this.getProjectTag(projectId, id);
  }

  public listActionCategories(): ActionCategory[] {
    return (
      this.database
        .prepare(
          'SELECT * FROM action_categories ORDER BY sort_order ASC, normalized_label ASC, id ASC',
        )
        .all() as Row[]
    ).map(actionCategoryFromRow);
  }

  public createActionCategory(input: CreateActionCategoryInput): ActionCategory {
    const id = randomUUID();
    const now = new Date().toISOString();
    const label = normalizeCatalogLabel(input.label);
    const normalizedLabel = normalizedCatalogIdentity(label);
    try {
      this.database.exec('BEGIN IMMEDIATE');
      const next = this.database
        .prepare('SELECT COALESCE(MAX(sort_order), 0) + 1 AS value FROM action_categories')
        .get() as Row;
      this.database
        .prepare(
          'INSERT INTO action_categories (id, label, normalized_label, icon_key, color_key, sort_order, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        )
        .run(
          id,
          label,
          normalizedLabel,
          input.iconKey,
          input.colorKey,
          Number(next.value),
          now,
          now,
        );
      this.database.exec('COMMIT');
    } catch (error) {
      try {
        this.database.exec('ROLLBACK');
      } catch {
        /* no active transaction */
      }
      throw new DomainError('CONFLICT', 'An action category with this label already exists.', 409, {
        cause: error,
      });
    }
    return this.getActionCategory(id);
  }

  public updateActionCategory(id: string, input: UpdateActionCategoryInput): ActionCategory {
    this.getActionCategory(id);
    const now = new Date().toISOString();
    const label = normalizeCatalogLabel(input.label);
    try {
      this.database
        .prepare(
          'UPDATE action_categories SET label = ?, normalized_label = ?, icon_key = ?, color_key = ?, updated_at = ? WHERE id = ?',
        )
        .run(label, normalizedCatalogIdentity(label), input.iconKey, input.colorKey, now, id);
    } catch (error) {
      throw new DomainError('CONFLICT', 'An action category with this label already exists.', 409, {
        cause: error,
      });
    }
    return this.getActionCategory(id);
  }

  public deleteActionCategory(id: string, replacementId: string | null = null): void {
    const category = this.getActionCategory(id);
    if (replacementId === id)
      throw new DomainError('VALIDATION_ERROR', 'Choose a different replacement category.', 400);
    const replacement = replacementId ? this.getActionCategory(replacementId) : null;
    this.database.exec('SAVEPOINT replace_action_category');
    try {
      const affected = this.database
        .prepare('SELECT id, project_id, title FROM project_actions WHERE category_id = ?')
        .all(id) as Row[];
      const now = this.nowProvider();
      this.database
        .prepare(
          'UPDATE project_actions SET category_id = ?, row_version = row_version + 1, updated_at = ? WHERE category_id = ?',
        )
        .run(replacementId, now, id);
      const result = this.database.prepare('DELETE FROM action_categories WHERE id = ?').run(id);
      this.requireChange(result.changes, 'Action category');
      for (const row of affected)
        this.activity(
          text(row.project_id),
          'Action',
          text(row.id),
          'Updated',
          text(row.title),
          `Category: ${category.label} → ${replacement?.label ?? 'Uncategorized'}`,
          now,
        );
      this.database.exec('RELEASE replace_action_category');
    } catch (error) {
      this.database.exec('ROLLBACK TO replace_action_category; RELEASE replace_action_category');
      throw error;
    }
  }

  private getActionCategory(id: string): ActionCategory {
    const row = this.database.prepare('SELECT * FROM action_categories WHERE id = ?').get(id) as
      Row | undefined;
    if (!row) throw new DomainError('NOT_FOUND', 'Action category not found.', 404);
    return actionCategoryFromRow(row);
  }
  public updateProjectTag(projectId: string, id: string, input: UpdateProjectTagInput): ProjectTag {
    const existing = this.getProjectTag(projectId, id);
    const now = new Date().toISOString();
    this.database
      .prepare(
        'UPDATE project_tags SET color_key = ?, updated_at = ? WHERE id = ? AND project_id = ?',
      )
      .run(input.colorKey, now, id, projectId);
    this.activity(projectId, 'ProjectTag', id, 'Updated', existing.label, input.colorKey, now);
    return this.getProjectTag(projectId, id);
  }
  public deleteProjectTag(projectId: string, id: string): void {
    const existing = this.getProjectTag(projectId, id);
    const now = new Date().toISOString();
    this.database
      .prepare('DELETE FROM project_tags WHERE id = ? AND project_id = ?')
      .run(id, projectId);
    this.activity(projectId, 'ProjectTag', id, 'Deleted', existing.label, existing.colorKey, now);
  }
  private getProjectTag(projectId: string, id: string): ProjectTag {
    const row = this.database
      .prepare('SELECT * FROM project_tags WHERE id = ? AND project_id = ?')
      .get(id, projectId) as Row | undefined;
    if (!row) throw new DomainError('NOT_FOUND', 'Project tag not found.', 404);
    return tagFromRow(row);
  }
  public createScopeNote(projectId: string, input: CreateScopeNoteInput): ScopeNote {
    const id = randomUUID();
    const now = new Date().toISOString();
    this.database
      .prepare(
        'INSERT INTO project_scope_notes (id, project_id, type, text, sort_order, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      )
      .run(id, projectId, input.type, input.text, input.sortOrder, now, now);
    this.activity(projectId, 'ScopeNote', id, 'Created', input.type, input.text, now);
    return this.getScopeNote(projectId, id);
  }
  public updateScopeNote(projectId: string, id: string, input: UpdateScopeNoteInput): ScopeNote {
    const now = new Date().toISOString();
    const result = this.database
      .prepare(
        'UPDATE project_scope_notes SET type=?, text=?, sort_order=?, updated_at=? WHERE id=? AND project_id=?',
      )
      .run(input.type, input.text, input.sortOrder, now, id, projectId);
    this.requireChange(result.changes, 'Scope note');
    this.activity(projectId, 'ScopeNote', id, 'Updated', input.type, input.text, now);
    return this.getScopeNote(projectId, id);
  }
  public deleteScopeNote(projectId: string, id: string): void {
    const existing = this.getScopeNote(projectId, id);
    const now = new Date().toISOString();
    this.database
      .prepare('DELETE FROM project_scope_notes WHERE id=? AND project_id=?')
      .run(id, projectId);
    this.activity(projectId, 'ScopeNote', id, 'Deleted', existing.type, existing.text, now);
  }
  private getScopeNote(projectId: string, id: string): ScopeNote {
    const row = this.database
      .prepare('SELECT * FROM project_scope_notes WHERE id=? AND project_id=?')
      .get(id, projectId) as Row | undefined;
    if (!row) throw new DomainError('NOT_FOUND', 'Scope note not found.', 404);
    return scopeNoteFromRow(row);
  }

  public createRequirement(projectId: string, input: ProjectRequirementInput): ProjectRequirement {
    const id = randomUUID();
    const now = new Date().toISOString();
    this.database
      .prepare(
        `INSERT INTO project_requirements
        (id, project_id, category, title, details, requested_from, requested_at, due_date,
         status, impact, source_type, source_reference, notes, sort_order, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        projectId,
        input.category,
        input.title,
        input.details,
        input.requestedFrom,
        input.requestedAt,
        input.dueDate,
        input.status,
        input.impact,
        input.sourceType,
        input.sourceReference,
        input.notes,
        input.sortOrder,
        now,
        now,
      );
    this.activity(projectId, 'Requirement', id, 'Created', input.title, input.details, now);
    return this.getRequirement(projectId, id);
  }

  public updateRequirement(
    projectId: string,
    id: string,
    input: ProjectRequirementInput,
  ): ProjectRequirement {
    const now = new Date().toISOString();
    const result = this.database
      .prepare(
        `UPDATE project_requirements SET category = ?, title = ?, details = ?,
        requested_from = ?, requested_at = ?, due_date = ?, status = ?, impact = ?,
        source_type = ?, source_reference = ?, notes = ?, sort_order = ?, updated_at = ?
        WHERE id = ? AND project_id = ?`,
      )
      .run(
        input.category,
        input.title,
        input.details,
        input.requestedFrom,
        input.requestedAt,
        input.dueDate,
        input.status,
        input.impact,
        input.sourceType,
        input.sourceReference,
        input.notes,
        input.sortOrder,
        now,
        id,
        projectId,
      );
    this.requireChange(result.changes, 'Requirement');
    this.activity(projectId, 'Requirement', id, 'Updated', input.title, input.status, now);
    return this.getRequirement(projectId, id);
  }

  /**
   * Permanently removes a Requirement from the canonical project workspace. This is a
   * true delete (not a soft-hide or status conversion): the row is removed from
   * `project_requirements` and the requirement disappears from every view derived from
   * canonical workspace requirements (Requirements, Notes / Exclusions, health counts).
   * A `Requirement Deleted` activity record is appended for auditability.
   */
  public deleteRequirement(projectId: string, id: string): void {
    const now = new Date().toISOString();
    const existing = this.getRequirement(projectId, id);
    const result = this.database
      .prepare('DELETE FROM project_requirements WHERE id = ? AND project_id = ?')
      .run(id, projectId);
    this.requireChange(result.changes, 'Requirement');
    this.activity(projectId, 'Requirement', id, 'Deleted', existing.title, existing.status, now);
  }

  private getRequirement(projectId: string, id: string): ProjectRequirement {
    const row = this.database
      .prepare('SELECT * FROM project_requirements WHERE id = ? AND project_id = ?')
      .get(id, projectId) as Row | undefined;
    if (!row) throw new DomainError('NOT_FOUND', 'Requirement not found.', 404);
    return requirementFromRow(row);
  }

  public createChecklistItem(
    projectId: string,
    input: ProjectChecklistItemInput,
  ): ProjectChecklistItem {
    const id = randomUUID();
    const now = new Date().toISOString();
    this.database
      .prepare(
        `INSERT INTO project_checklist_items
        (id, project_id, category, title, service_code, required, completed, waived,
         waiver_reason, sort_order, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        projectId,
        input.category,
        input.title,
        input.serviceCode,
        input.required ? 1 : 0,
        input.completed ? 1 : 0,
        input.waived ? 1 : 0,
        input.waiverReason,
        input.sortOrder,
        now,
        now,
      );
    this.activity(projectId, 'Checklist', id, 'Created', input.title, input.category, now);
    return this.getChecklistItem(projectId, id);
  }

  public updateChecklistItem(
    projectId: string,
    id: string,
    input: ProjectChecklistItemInput,
  ): ProjectChecklistItem {
    const now = new Date().toISOString();
    const result = this.database
      .prepare(
        `UPDATE project_checklist_items SET category = ?, title = ?, service_code = ?,
        required = ?, completed = ?, waived = ?, waiver_reason = ?, sort_order = ?, updated_at = ?
        WHERE id = ? AND project_id = ?`,
      )
      .run(
        input.category,
        input.title,
        input.serviceCode,
        input.required ? 1 : 0,
        input.completed ? 1 : 0,
        input.waived ? 1 : 0,
        input.waiverReason,
        input.sortOrder,
        now,
        id,
        projectId,
      );
    this.requireChange(result.changes, 'Checklist item');
    this.activity(
      projectId,
      'Checklist',
      id,
      input.completed ? 'Completed' : 'Updated',
      input.title,
      input.waived ? input.waiverReason : input.category,
      now,
    );
    return this.getChecklistItem(projectId, id);
  }

  private getChecklistItem(projectId: string, id: string): ProjectChecklistItem {
    const row = this.database
      .prepare('SELECT * FROM project_checklist_items WHERE id = ? AND project_id = ?')
      .get(id, projectId) as Row | undefined;
    if (!row) throw new DomainError('NOT_FOUND', 'Checklist item not found.', 404);
    return checklistFromRow(row);
  }

  public createAction(
    projectId: string,
    input: ProjectActionItemInput,
    actor?: { id: string; name: string },
  ): ProjectActionItem {
    this.validateActionContext(projectId, input);
    const id = randomUUID();
    const now = new Date().toISOString();
    this.database
      .prepare(
        `INSERT INTO project_actions
        (id, project_id, title, details, owner, owner_role, due_date, status, priority, source_type,
         source_id, revision_id, category_id, notes, completed_at, created_at, updated_at,
         blocks_issue, created_by_id, created_by_name, area, luminaire_id, review_item_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        projectId,
        input.title,
        input.details,
        input.owner,
        input.ownerRole,
        input.dueDate,
        input.status,
        input.priority,
        input.sourceType,
        input.sourceId,
        input.revisionId,
        this.validatedActionCategoryId(input.categoryId ?? null),
        input.notes,
        input.status === 'Completed' ? now : null,
        now,
        now,
        input.blocksIssue === true ? 1 : 0,
        actor?.id ?? null,
        actor?.name ?? null,
        input.area ?? '',
        input.luminaireId ?? null,
        input.reviewItemId ?? null,
      );
    this.activity(projectId, 'Action', id, 'Created', input.title, input.owner, now);
    return this.getAction(projectId, id);
  }

  /**
   * P5D — sparse Action patch with optimistic concurrency (row_version).
   *
   * Updates ONLY the fields present in the patch. A stale row_version is
   * rejected with CONFLICT — no last-write-wins. The authenticated actor is
   * snapshotted; the row_version advances on every accepted write.
   */
  public patchAction(
    projectId: string,
    id: string,
    patch: {
      title?: string | undefined;
      details?: string | undefined;
      owner?: string | undefined;
      ownerRole?: string | undefined;
      dueDate?: string | null | undefined;
      status?: ProjectActionItem['status'] | undefined;
      priority?: ProjectActionItem['priority'] | undefined;
      notes?: string | undefined;
      blocksIssue?: boolean | undefined;
      revisionId?: string | null | undefined;
      sourceType?: ProjectActionItem['sourceType'] | undefined;
      sourceId?: string | null | undefined;
      categoryId?: string | null | undefined;
      area?: string | undefined;
      luminaireId?: string | null | undefined;
      reviewItemId?: string | null | undefined;
    },
    expectedRowVersion: number,
    actor: { id: string; name: string },
  ): ProjectActionItem {
    const now = new Date().toISOString();
    const existing = this.getAction(projectId, id);
    if (!Number.isInteger(expectedRowVersion) || expectedRowVersion < 1) {
      throw new DomainError('VALIDATION_ERROR', 'A valid Action row version is required.', 400);
    }
    this.validateActionContext(projectId, patch, existing);
    const assignments: string[] = [];
    const values: Array<string | number | null> = [];
    const assign = (column: string, value: string | number | null): void => {
      assignments.push(`${column} = ?`);
      values.push(value);
    };
    if (patch.title !== undefined) assign('title', patch.title);
    if (patch.details !== undefined) assign('details', patch.details);
    if (patch.owner !== undefined) assign('owner', patch.owner);
    if (patch.ownerRole !== undefined) assign('owner_role', patch.ownerRole);
    if (patch.dueDate !== undefined) assign('due_date', patch.dueDate);
    if (patch.status !== undefined) {
      assign('status', patch.status);
      assign('completed_at', patch.status === 'Completed' ? (existing.completedAt ?? now) : null);
    }
    if (patch.priority !== undefined) assign('priority', patch.priority);
    if (patch.notes !== undefined) assign('notes', patch.notes);
    if (patch.area !== undefined) assign('area', patch.area);
    if (patch.luminaireId !== undefined) assign('luminaire_id', patch.luminaireId);
    if (patch.reviewItemId !== undefined) assign('review_item_id', patch.reviewItemId);
    if (patch.blocksIssue !== undefined) assign('blocks_issue', patch.blocksIssue ? 1 : 0);
    if (patch.revisionId !== undefined) assign('revision_id', patch.revisionId);
    if (patch.sourceType !== undefined) assign('source_type', patch.sourceType);
    if (patch.sourceId !== undefined) assign('source_id', patch.sourceId);
    if (patch.categoryId !== undefined) {
      assign('category_id', this.validatedActionCategoryId(patch.categoryId));
    }
    if (assignments.length === 0) {
      throw new DomainError('VALIDATION_ERROR', 'At least one Action field is required.', 400);
    }
    assignments.push('updated_by_id = ?', 'updated_by_name = ?', 'updated_at = ?');
    values.push(actor.id, actor.name, now);
    this.database.exec('SAVEPOINT action_patch');
    try {
      const result = this.database
        .prepare(
          `UPDATE project_actions SET ${assignments.join(', ')}, row_version = row_version + 1
         WHERE id = ? AND project_id = ? AND row_version = ?`,
        )
        .run(...values, id, projectId, expectedRowVersion);
      if (result.changes !== 1) {
        throw new DomainError(
          'CONFLICT',
          'This Action was changed by another edit. Refresh and retry.',
          409,
        );
      }
      this.activity(
        projectId,
        'Action',
        id,
        'Updated',
        patch.title ?? existing.title,
        patch.status ?? existing.status,
        now,
      );
      const updated = this.getAction(projectId, id);
      this.database.exec('RELEASE action_patch');
      return updated;
    } catch (error) {
      this.database.exec('ROLLBACK TO action_patch');
      this.database.exec('RELEASE action_patch');
      throw error;
    }
  }

  public updateAction(
    projectId: string,
    id: string,
    input: ProjectActionItemInput,
  ): ProjectActionItem {
    const now = new Date().toISOString();
    const existing = this.getAction(projectId, id);
    this.validateActionContext(projectId, input, existing);
    const categoryId =
      input.categoryId === undefined
        ? existing.categoryId
        : this.validatedActionCategoryId(input.categoryId);
    const completedAt =
      input.status === 'Completed'
        ? (existing.completedAt ?? now)
        : input.status === 'Cancelled'
          ? null
          : null;
    const result = this.database
      .prepare(
        `UPDATE project_actions SET title = ?, details = ?, owner = ?, owner_role = ?, due_date = ?,
        status = ?, priority = ?, source_type = ?, source_id = ?, revision_id = ?, category_id = ?,
        notes = ?, completed_at = ?, updated_at = ?, area = ?, luminaire_id = ?, review_item_id = ?, row_version = row_version + 1 WHERE id = ? AND project_id = ?`,
      )
      .run(
        input.title,
        input.details,
        input.owner,
        input.ownerRole,
        input.dueDate,
        input.status,
        input.priority,
        input.sourceType,
        input.sourceId,
        input.revisionId,
        categoryId,
        input.notes,
        completedAt,
        now,
        input.area ?? existing.area ?? '',
        input.luminaireId === undefined ? (existing.luminaireId ?? null) : input.luminaireId,
        input.reviewItemId === undefined ? (existing.reviewItemId ?? null) : input.reviewItemId,
        id,
        projectId,
      );
    this.requireChange(result.changes, 'Action');
    this.activity(projectId, 'Action', id, input.status, input.title, input.owner, now);
    return this.getAction(projectId, id);
  }

  private getAction(projectId: string, id: string): ProjectActionItem {
    const row = this.database
      .prepare('SELECT * FROM project_actions WHERE id = ? AND project_id = ?')
      .get(id, projectId) as Row | undefined;
    if (!row) throw new DomainError('NOT_FOUND', 'Action not found.', 404);
    return actionFromRow(row);
  }

  private validateActionContext(
    projectId: string,
    input: { luminaireId?: string | null | undefined; reviewItemId?: string | null | undefined },
    existing?: ProjectActionItem,
  ): void {
    if (input.luminaireId && input.luminaireId !== existing?.luminaireId)
      this.validateReviewRelations(projectId, null, input.luminaireId);
    if (input.reviewItemId && input.reviewItemId !== existing?.reviewItemId)
      this.getReview(projectId, input.reviewItemId);
  }

  private validatedActionCategoryId(categoryId: string | null): string | null {
    if (categoryId !== null) this.getActionCategory(categoryId);
    return categoryId;
  }

  public createMeeting(projectId: string, input: ProjectMeetingInput): ProjectMeeting {
    const id = randomUUID();
    const now = this.nowProvider();
    this.database.exec('BEGIN IMMEDIATE');
    try {
      this.insertMeeting(projectId, id, input, now);
      if (input.participants !== undefined) this.reconcileParticipants(id, input.participants, now);
      if (input.agendaItems !== undefined) this.reconcileAgendaItems(id, input.agendaItems, now);
      this.activity(projectId, 'Meeting', id, 'Created', input.title, input.startAt, now);
      this.database.exec('COMMIT');
    } catch (error) {
      this.rollback();
      throw error;
    }
    return this.getMeeting(projectId, id);
  }

  public updateMeeting(projectId: string, id: string, input: ProjectMeetingInput): ProjectMeeting {
    const existing = this.getMeeting(projectId, id);
    const now = this.nowProvider();
    this.database.exec('BEGIN IMMEDIATE');
    try {
      this.updateMeetingRow(
        projectId,
        id,
        { ...input, purpose: input.purpose ?? existing.purpose },
        now,
      );
      if (input.participants !== undefined) this.reconcileParticipants(id, input.participants, now);
      if (input.agendaItems !== undefined) this.reconcileAgendaItems(id, input.agendaItems, now);
      this.activity(projectId, 'Meeting', id, input.status, input.title, input.startAt, now);
      this.database.exec('COMMIT');
    } catch (error) {
      this.rollback();
      throw error;
    }
    return this.getMeeting(projectId, id);
  }

  public createMeetingFromMicrosoftEvent(
    input: MicrosoftCalendarEventInput,
    externalEventId: string,
    onlineMeetingUrl: string,
  ): ProjectMeeting {
    return this.createMeeting(input.projectId, {
      title: input.subject,
      purpose: '',
      startAt: input.startAt,
      endAt: input.endAt,
      location: input.location,
      attendees: input.attendees,
      agenda: input.agenda,
      notes: '',
      decisions: '',
      onlineMeetingUrl,
      externalEventId,
      status: 'Planned',
    });
  }

  private insertMeeting(
    projectId: string,
    id: string,
    input: ProjectMeetingInput,
    now: string,
  ): void {
    this.database
      .prepare(
        `INSERT INTO project_meetings
        (id, project_id, title, purpose, start_at, end_at, location, attendees_json, agenda,
         notes, decisions, online_meeting_url, external_event_id, status, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        projectId,
        input.title,
        input.purpose ?? '',
        input.startAt,
        input.endAt,
        input.location,
        JSON.stringify(input.attendees),
        input.agenda,
        input.notes,
        input.decisions,
        input.onlineMeetingUrl,
        input.externalEventId,
        input.status,
        now,
        now,
      );
  }

  private updateMeetingRow(
    projectId: string,
    id: string,
    input: ProjectMeetingInput,
    now: string,
  ): void {
    const result = this.database
      .prepare(
        `UPDATE project_meetings SET title = ?, purpose = ?, start_at = ?, end_at = ?, location = ?, attendees_json = ?, agenda = ?, notes = ?, decisions = ?, online_meeting_url = ?, external_event_id = ?, status = ?, updated_at = ? WHERE id = ? AND project_id = ?`,
      )
      .run(
        input.title,
        input.purpose ?? '',
        input.startAt,
        input.endAt,
        input.location,
        JSON.stringify(input.attendees),
        input.agenda,
        input.notes,
        input.decisions,
        input.onlineMeetingUrl,
        input.externalEventId,
        input.status,
        now,
        id,
        projectId,
      );
    this.requireChange(result.changes, 'Meeting');
  }

  private reconcileParticipants(
    meetingId: string,
    inputs: NonNullable<ProjectMeetingInput['participants']>,
    now: string,
  ): void {
    const existing = new Set(
      (
        this.database
          .prepare('SELECT id FROM meeting_participants WHERE meeting_id = ?')
          .all(meetingId) as Row[]
      ).map((row) => text(row.id)),
    );
    const sortOrders = new Set<number>();
    for (const item of inputs) {
      if (sortOrders.has(item.sortOrder))
        throw new DomainError('VALIDATION_ERROR', 'Participant sort order must be unique.', 400);
      sortOrders.add(item.sortOrder);
    }
    this.database
      .prepare(
        'UPDATE meeting_participants SET sort_order = sort_order + 1000000 WHERE meeting_id = ?',
      )
      .run(meetingId);
    const submitted = new Set<string>();
    for (const item of inputs) {
      const id = item.id ?? randomUUID();
      if (item.id && !existing.has(id)) {
        const owner = this.database
          .prepare('SELECT meeting_id FROM meeting_participants WHERE id = ?')
          .get(id) as Row | undefined;
        if (owner)
          throw new DomainError(
            'VALIDATION_ERROR',
            'Participant does not belong to this Meeting.',
            400,
          );
      }
      submitted.add(id);
      if (existing.has(id))
        this.database
          .prepare(
            'UPDATE meeting_participants SET name = ?, role = ?, sort_order = ?, updated_at = ? WHERE id = ? AND meeting_id = ?',
          )
          .run(item.name, item.role, item.sortOrder, now, id, meetingId);
      else
        this.database
          .prepare(
            'INSERT INTO meeting_participants (id, meeting_id, name, role, sort_order, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
          )
          .run(id, meetingId, item.name, item.role, item.sortOrder, now, now);
    }
    for (const id of existing)
      if (!submitted.has(id))
        this.database
          .prepare('DELETE FROM meeting_participants WHERE id = ? AND meeting_id = ?')
          .run(id, meetingId);
  }

  private reconcileAgendaItems(
    meetingId: string,
    inputs: NonNullable<ProjectMeetingInput['agendaItems']>,
    now: string,
  ): void {
    const existing = new Set(
      (
        this.database
          .prepare('SELECT id FROM meeting_agenda_items WHERE meeting_id = ?')
          .all(meetingId) as Row[]
      ).map((row) => text(row.id)),
    );
    const sortOrders = new Set<number>();
    for (const item of inputs) {
      if (sortOrders.has(item.sortOrder))
        throw new DomainError('VALIDATION_ERROR', 'Agenda item sort order must be unique.', 400);
      sortOrders.add(item.sortOrder);
    }
    this.database
      .prepare(
        'UPDATE meeting_agenda_items SET sort_order = sort_order + 1000000 WHERE meeting_id = ?',
      )
      .run(meetingId);
    const submitted = new Set<string>();
    for (const item of inputs) {
      const id = item.id ?? randomUUID();
      if (item.id && !existing.has(id)) {
        const owner = this.database
          .prepare('SELECT meeting_id FROM meeting_agenda_items WHERE id = ?')
          .get(id) as Row | undefined;
        if (owner)
          throw new DomainError(
            'VALIDATION_ERROR',
            'Agenda item does not belong to this Meeting.',
            400,
          );
      }
      submitted.add(id);
      if (existing.has(id))
        this.database
          .prepare(
            'UPDATE meeting_agenda_items SET content = ?, sort_order = ?, updated_at = ? WHERE id = ? AND meeting_id = ?',
          )
          .run(item.content, item.sortOrder, now, id, meetingId);
      else
        this.database
          .prepare(
            'INSERT INTO meeting_agenda_items (id, meeting_id, content, sort_order, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
          )
          .run(id, meetingId, item.content, item.sortOrder, now, now);
    }
    for (const id of existing)
      if (!submitted.has(id))
        this.database
          .prepare('DELETE FROM meeting_agenda_items WHERE id = ? AND meeting_id = ?')
          .run(id, meetingId);
  }

  private rollback(): void {
    try {
      this.database.exec('ROLLBACK');
    } catch {
      /* no active transaction */
    }
  }

  private getMeeting(projectId: string, id: string): ProjectMeeting {
    const row = this.database
      .prepare('SELECT * FROM project_meetings WHERE id = ? AND project_id = ?')
      .get(id, projectId) as Row | undefined;
    if (!row) throw new DomainError('NOT_FOUND', 'Meeting not found.', 404);
    return meetingFromRow(row);
  }

  public listMeetingParticipants(projectId: string, meetingId: string): MeetingParticipant[] {
    this.getMeeting(projectId, meetingId);
    return (
      this.database
        .prepare('SELECT * FROM meeting_participants WHERE meeting_id = ? ORDER BY sort_order, id')
        .all(meetingId) as Row[]
    ).map(meetingParticipantFromRow);
  }

  /** Purpose-built collection authority with batched child reads (no per-Meeting preview/note queries). */
  public listMeetingReadModels(projectId: string): MeetingListItem[] {
    const rows = this.database
      .prepare(
        `SELECT m.*,
          (SELECT COUNT(*) FROM meeting_participants p WHERE p.meeting_id = m.id) AS participants_count,
          (SELECT COUNT(*) FROM meeting_notes n WHERE n.meeting_id = m.id) AS notes_count,
          (SELECT COUNT(*) FROM meeting_action_links l WHERE l.meeting_id = m.id) AS linked_actions_count,
          (SELECT COUNT(*) FROM meeting_action_links l WHERE l.meeting_id = m.id AND l.relation_type = 'CreatedFromMeeting') AS actions_created_count
         FROM project_meetings m WHERE m.project_id = ? ORDER BY m.start_at DESC, m.id DESC`,
      )
      .all(projectId) as Row[];
    if (rows.length === 0) return [];
    const meetingIds = rows.map((row) => text(row.id));
    const placeholders = meetingIds.map(() => '?').join(', ');
    const participantsByMeeting = new Map<string, MeetingParticipant[]>();
    for (const participant of (
      this.database
        .prepare(
          `SELECT * FROM meeting_participants WHERE meeting_id IN (${placeholders}) ORDER BY meeting_id, sort_order ASC, id ASC`,
        )
        .all(...meetingIds) as Row[]
    ).map(meetingParticipantFromRow)) {
      const entries = participantsByMeeting.get(participant.meetingId) ?? [];
      entries.push(participant);
      participantsByMeeting.set(participant.meetingId, entries);
    }
    const notesByMeeting = new Map<string, MeetingNote[]>();
    for (const note of (
      this.database
        .prepare(
          `SELECT * FROM meeting_notes WHERE meeting_id IN (${placeholders}) ORDER BY meeting_id, updated_at DESC, created_at DESC, id DESC`,
        )
        .all(...meetingIds) as Row[]
    ).map(meetingNoteFromRow)) {
      const entries = notesByMeeting.get(note.meetingId) ?? [];
      entries.push(note);
      notesByMeeting.set(note.meetingId, entries);
    }
    return rows.map((row) => {
      const meetingId = text(row.id);
      const participants = participantsByMeeting.get(meetingId) ?? [];
      const notes = notesByMeeting.get(meetingId) ?? [];
      return {
        ...meetingFromRow(row),
        participantsCount: participants.length,
        participantPreview: participants.slice(0, 4),
        notesCount: notes.length,
        latestNoteSummary: notes[0] ?? null,
        linkedActionsCount: Number(row.linked_actions_count),
        actionsCreatedCount: Number(row.actions_created_count),
      };
    });
  }

  public getMeetingDetail(projectId: string, meetingId: string): MeetingDetail {
    const meeting = this.getMeeting(projectId, meetingId);
    const latestRow = this.database
      .prepare(
        'SELECT * FROM meeting_notes WHERE meeting_id = ? ORDER BY updated_at DESC, created_at DESC, id DESC LIMIT 1',
      )
      .get(meetingId) as Row | undefined;
    const counts = this.database
      .prepare(
        `SELECT COUNT(*) AS notes_count,
        (SELECT COUNT(*) FROM meeting_action_links WHERE meeting_id = ? AND relation_type = 'CreatedFromMeeting') AS actions_created_count
       FROM meeting_notes WHERE meeting_id = ?`,
      )
      .get(meetingId, meetingId) as Row;
    const linkedActions = (
      this.database
        .prepare(
          `SELECT a.id, a.title, a.priority, a.owner, a.due_date, a.status, l.relation_type
       FROM meeting_action_links l JOIN project_actions a ON a.id = l.action_id AND a.project_id = l.project_id
       WHERE l.project_id = ? AND l.meeting_id = ?
       ORDER BY CASE WHEN a.due_date IS NULL THEN 1 ELSE 0 END, a.due_date ASC, a.priority DESC, a.id ASC`,
        )
        .all(projectId, meetingId) as Row[]
    ).map((row) => ({
      id: text(row.id),
      title: text(row.title),
      priority: text(row.priority) as ProjectActionItem['priority'],
      owner: text(row.owner),
      dueDate: nullableText(row.due_date),
      status: text(row.status) as ProjectActionItem['status'],
      relationType: text(row.relation_type) as MeetingActionRelationType,
    }));
    return {
      ...meeting,
      participants: this.listMeetingParticipants(projectId, meetingId),
      agendaItems: this.listMeetingAgendaItems(projectId, meetingId),
      notesCount: Number(counts.notes_count),
      latestNote: latestRow ? meetingNoteFromRow(latestRow) : null,
      linkedActions,
      actionsCreatedCount: Number(counts.actions_created_count),
    };
  }

  public listMeetingAgendaItems(projectId: string, meetingId: string): MeetingAgendaItem[] {
    this.getMeeting(projectId, meetingId);
    return (
      this.database
        .prepare('SELECT * FROM meeting_agenda_items WHERE meeting_id = ? ORDER BY sort_order, id')
        .all(meetingId) as Row[]
    ).map(meetingAgendaItemFromRow);
  }

  public listMeetingNotes(projectId: string, meetingId: string): MeetingNote[] {
    this.getMeeting(projectId, meetingId);
    return (
      this.database
        .prepare(
          'SELECT * FROM meeting_notes WHERE meeting_id = ? ORDER BY updated_at DESC, created_at DESC, id DESC',
        )
        .all(meetingId) as Row[]
    ).map(meetingNoteFromRow);
  }

  public createMeetingNote(
    projectId: string,
    meetingId: string,
    input: MeetingNoteInput,
  ): MeetingNote {
    this.getMeeting(projectId, meetingId);
    const id = randomUUID();
    const now = this.nowProvider();
    this.database
      .prepare(
        'INSERT INTO meeting_notes (id, meeting_id, content, author_name, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
      )
      .run(id, meetingId, input.content, input.authorName, now, now);
    this.activity(projectId, 'MeetingNote', id, 'Created', input.authorName, input.content, now);
    return meetingNoteFromRow(
      this.database.prepare('SELECT * FROM meeting_notes WHERE id = ?').get(id) as Row,
    );
  }

  public updateMeetingNote(
    projectId: string,
    meetingId: string,
    noteId: string,
    input: MeetingNoteInput,
  ): MeetingNote {
    this.getMeeting(projectId, meetingId);
    const now = this.nowProvider();
    const result = this.database
      .prepare(
        'UPDATE meeting_notes SET content = ?, author_name = ?, updated_at = ? WHERE id = ? AND meeting_id = ?',
      )
      .run(input.content, input.authorName, now, noteId, meetingId);
    this.requireChange(result.changes, 'Meeting note');
    return meetingNoteFromRow(
      this.database.prepare('SELECT * FROM meeting_notes WHERE id = ?').get(noteId) as Row,
    );
  }

  public deleteMeetingNote(projectId: string, meetingId: string, noteId: string): void {
    this.getMeeting(projectId, meetingId);
    const result = this.database
      .prepare('DELETE FROM meeting_notes WHERE id = ? AND meeting_id = ?')
      .run(noteId, meetingId);
    this.requireChange(result.changes, 'Meeting note');
  }

  public linkMeetingAction(
    projectId: string,
    meetingId: string,
    input: MeetingActionLinkInput,
  ): MeetingActionLink {
    this.getMeeting(projectId, meetingId);
    this.getAction(projectId, input.actionId);
    const existing = this.database
      .prepare('SELECT * FROM meeting_action_links WHERE meeting_id = ? AND action_id = ?')
      .get(meetingId, input.actionId) as Row | undefined;
    if (existing) return meetingActionLinkFromRow(existing);
    const id = randomUUID();
    const now = new Date().toISOString();
    this.database
      .prepare(
        'INSERT INTO meeting_action_links (id, project_id, meeting_id, action_id, relation_type, created_at) VALUES (?, ?, ?, ?, ?, ?)',
      )
      .run(id, projectId, meetingId, input.actionId, input.relationType, now);
    return meetingActionLinkFromRow(
      this.database.prepare('SELECT * FROM meeting_action_links WHERE id = ?').get(id) as Row,
    );
  }

  public unlinkMeetingAction(projectId: string, meetingId: string, actionId: string): void {
    this.getMeeting(projectId, meetingId);
    const result = this.database
      .prepare(
        'DELETE FROM meeting_action_links WHERE project_id = ? AND meeting_id = ? AND action_id = ?',
      )
      .run(projectId, meetingId, actionId);
    this.requireChange(result.changes, 'Meeting action link');
  }

  public listMeetingActionLinks(projectId: string, meetingId: string): MeetingActionLink[] {
    this.getMeeting(projectId, meetingId);
    return (
      this.database
        .prepare(
          'SELECT * FROM meeting_action_links WHERE project_id = ? AND meeting_id = ? ORDER BY created_at, id',
        )
        .all(projectId, meetingId) as Row[]
    ).map(meetingActionLinkFromRow);
  }

  public listActionMeetingLinks(projectId: string, actionId: string): MeetingActionLink[] {
    this.getAction(projectId, actionId);
    return (
      this.database
        .prepare(
          'SELECT * FROM meeting_action_links WHERE project_id = ? AND action_id = ? ORDER BY created_at, id',
        )
        .all(projectId, actionId) as Row[]
    ).map(meetingActionLinkFromRow);
  }

  public createActionFromMeeting(
    projectId: string,
    meetingId: string,
    input: CreateActionFromMeetingInput,
  ): ProjectActionItem {
    this.getMeeting(projectId, meetingId);
    this.database.exec('BEGIN IMMEDIATE');
    try {
      const action = this.createAction(projectId, {
        ...input,
        sourceType: 'Meeting',
        sourceId: meetingId,
      });
      this.linkMeetingAction(projectId, meetingId, {
        actionId: action.id,
        relationType: 'CreatedFromMeeting',
      });
      this.database.exec('COMMIT');
      return action;
    } catch (error) {
      this.rollback();
      throw error;
    }
  }

  public createReview(projectId: string, input: ProjectReviewItemInput): ProjectReviewItem {
    this.validateReviewRelations(projectId, input.revisionId, input.luminaireId ?? null);
    return this.insertReview(projectId, input, null, null);
  }

  /** Explicit authored-root authority used by the Comments product surface. */
  public createReviewThread(
    projectId: string,
    input: CreateProjectReviewThreadInput,
    actor: ReviewMutationActor,
  ): ProjectReviewItem {
    this.validateReviewRelations(projectId, input.revisionId, input.luminaireId ?? null);
    const authored = this.newAuthoredSnapshot(input, actor);
    return this.insertReview(projectId, input, authored, actor);
  }

  private insertReview(
    projectId: string,
    input: ProjectReviewItemInput,
    authored: {
      origin: 'Client' | 'Internal';
      authorId: string;
      authorNameSnapshot: string;
      authorRoleSnapshot: string;
    } | null,
    actor: ReviewMutationActor | null,
  ): ProjectReviewItem {
    const id = this.idProvider();
    const now = this.nowProvider();
    this.database
      .prepare(
        `INSERT INTO project_review_items
        (id, project_id, reference, title, description, area, luminaire_tag,
         drawing_reference, source_type, source_id, status, response, revision_id,
         origin, author_id, author_name_snapshot, author_role_snapshot, luminaire_id,
         received_at, due_date, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        projectId,
        input.reference,
        input.title,
        input.description,
        input.area,
        input.luminaireTag,
        input.drawingReference,
        input.sourceType,
        input.sourceId,
        input.status,
        input.response,
        input.revisionId,
        authored?.origin ?? null,
        authored?.authorId ?? null,
        authored?.authorNameSnapshot ?? null,
        authored?.authorRoleSnapshot ?? null,
        input.luminaireId ?? null,
        input.receivedAt,
        input.dueDate,
        now,
        now,
      );
    this.activity(
      projectId,
      'Review',
      id,
      'Created',
      input.title,
      this.auditDetail(actor, input.sourceType),
      now,
    );
    return this.getReview(projectId, id);
  }

  public updateReview(
    projectId: string,
    id: string,
    input: ProjectReviewItemInput,
    actor: ReviewMutationActor | null = null,
  ): ProjectReviewItem {
    const existing = this.getReview(projectId, id);
    const luminaireId = input.luminaireId === undefined ? existing.luminaireId : input.luminaireId;
    this.validateReviewRelations(
      projectId,
      input.revisionId !== existing.revisionId ? input.revisionId : null,
      luminaireId,
    );
    const now = this.nowProvider();
    const result = this.database
      .prepare(
        `UPDATE project_review_items SET reference = ?, title = ?, description = ?,
        area = ?, luminaire_tag = ?, drawing_reference = ?, source_type = ?, source_id = ?,
        status = ?, response = ?, revision_id = ?, luminaire_id = ?,
        received_at = ?, due_date = ?, updated_at = ?
        WHERE id = ? AND project_id = ?`,
      )
      .run(
        input.reference,
        input.title,
        input.description,
        input.area,
        input.luminaireTag,
        input.drawingReference,
        input.sourceType,
        input.sourceId,
        input.status,
        input.response,
        input.revisionId,
        luminaireId,
        input.receivedAt,
        input.dueDate,
        now,
        id,
        projectId,
      );
    this.requireChange(result.changes, 'Review item');
    this.activity(
      projectId,
      'Review',
      id,
      input.status,
      input.title,
      this.auditDetail(actor, input.response),
      now,
    );
    return this.getReview(projectId, id);
  }

  private getReview(projectId: string, id: string): ProjectReviewItem {
    const row = this.database
      .prepare('SELECT * FROM project_review_items WHERE id = ? AND project_id = ?')
      .get(id, projectId) as Row | undefined;
    if (!row) throw new DomainError('NOT_FOUND', 'Review item not found.', 404);
    return reviewFromRow(row);
  }

  public listReviewThreadContext(projectId: string): ProjectReviewThreadContext {
    const replies = (
      this.database
        .prepare(
          `SELECT * FROM project_review_replies
           WHERE project_id = ? ORDER BY created_at ASC, id ASC`,
        )
        .all(projectId) as Row[]
    ).map(reviewReplyFromRow);
    const attachments = (
      this.database
        .prepare(
          `SELECT * FROM project_review_attachments
           WHERE project_id = ? ORDER BY created_at ASC, id ASC`,
        )
        .all(projectId) as Row[]
    ).map(reviewAttachmentFromRow);
    return { replies, attachments };
  }

  public createReviewReply(
    projectId: string,
    reviewItemId: string,
    input: CreateProjectReviewReplyInput,
    actor: ReviewMutationActor,
  ): ProjectReviewReply {
    const review = this.getReview(projectId, reviewItemId);
    const authored = this.reviewReplyAuthoredSnapshot(projectId, reviewItemId, input, actor);
    const id = this.idProvider();
    const now = this.nowProvider();
    this.database
      .prepare(
        `INSERT INTO project_review_replies
         (id, project_id, review_item_id, body, author_id, author_name_snapshot,
          author_role_snapshot, origin, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        projectId,
        reviewItemId,
        input.body,
        authored.authorId,
        authored.authorNameSnapshot,
        authored.authorRoleSnapshot,
        authored.origin,
        now,
        now,
      );
    this.activity(
      projectId,
      'ReviewReply',
      id,
      'Created',
      review.title,
      this.auditDetail(actor, 'Reply added'),
      now,
    );
    return this.getReviewReply(projectId, reviewItemId, id);
  }

  public updateReviewReply(
    projectId: string,
    reviewItemId: string,
    replyId: string,
    input: { body: string; expectedUpdatedAt: string },
    actor: ReviewMutationActor,
  ): ProjectReviewReply {
    const review = this.getReview(projectId, reviewItemId);
    const current = this.getReviewReply(projectId, reviewItemId, replyId);
    const now = new Date(
      Math.max(Date.parse(this.nowProvider()), Date.parse(current.updatedAt) + 1),
    ).toISOString();
    this.database.exec('SAVEPOINT edit_review_reply');
    try {
      const result = this.database
        .prepare(
          `UPDATE project_review_replies SET body = ?, updated_at = ?
      WHERE id = ? AND project_id = ? AND review_item_id = ? AND updated_at = ?`,
        )
        .run(input.body, now, replyId, projectId, reviewItemId, input.expectedUpdatedAt);
      if (result.changes !== 1)
        throw new DomainError('CONFLICT', 'This reply changed. Reopen it before editing.', 409);
      this.activity(
        projectId,
        'ReviewReply',
        replyId,
        'Updated',
        review.title,
        this.auditDetail(actor, `Reply edited: ${current.body} → ${input.body}`),
        now,
      );
      this.database.exec('RELEASE SAVEPOINT edit_review_reply');
    } catch (error) {
      this.database.exec(
        'ROLLBACK TO SAVEPOINT edit_review_reply; RELEASE SAVEPOINT edit_review_reply',
      );
      throw error;
    }
    return this.getReviewReply(projectId, reviewItemId, replyId);
  }

  public linkReviewItemDocument(
    projectId: string,
    reviewItemId: string,
    documentId: string,
    actor: ReviewMutationActor,
  ): ProjectReviewAttachment {
    this.getReview(projectId, reviewItemId);
    return this.linkReviewDocument(projectId, documentId, reviewItemId, null, actor);
  }

  public linkReviewReplyDocument(
    projectId: string,
    reviewItemId: string,
    replyId: string,
    documentId: string,
    actor: ReviewMutationActor,
  ): ProjectReviewAttachment {
    this.getReviewReply(projectId, reviewItemId, replyId);
    return this.linkReviewDocument(projectId, documentId, null, replyId, actor);
  }

  private linkReviewDocument(
    projectId: string,
    documentId: string,
    reviewItemId: string | null,
    replyId: string | null,
    actor: ReviewMutationActor,
  ): ProjectReviewAttachment {
    this.getDocument(projectId, documentId);
    const existing = this.database
      .prepare(
        reviewItemId
          ? `SELECT * FROM project_review_attachments
             WHERE project_id = ? AND review_item_id = ? AND document_id = ?`
          : `SELECT * FROM project_review_attachments
             WHERE project_id = ? AND reply_id = ? AND document_id = ?`,
      )
      .get(projectId, reviewItemId ?? replyId, documentId) as Row | undefined;
    if (existing) return reviewAttachmentFromRow(existing);
    const id = this.idProvider();
    const now = this.nowProvider();
    this.database
      .prepare(
        `INSERT INTO project_review_attachments
         (id, project_id, document_id, review_item_id, reply_id,
          created_by_id, created_by_name_snapshot, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(id, projectId, documentId, reviewItemId, replyId, actor.id, actor.displayName, now);
    this.activity(
      projectId,
      'ReviewAttachment',
      id,
      'Linked',
      documentId,
      this.auditDetail(actor, 'Registered document linked'),
      now,
    );
    const row = this.database
      .prepare('SELECT * FROM project_review_attachments WHERE id = ? AND project_id = ?')
      .get(id, projectId) as Row;
    return reviewAttachmentFromRow(row);
  }

  private getReviewReply(
    projectId: string,
    reviewItemId: string,
    replyId: string,
  ): ProjectReviewReply {
    const row = this.database
      .prepare(
        `SELECT * FROM project_review_replies
         WHERE id = ? AND review_item_id = ? AND project_id = ?`,
      )
      .get(replyId, reviewItemId, projectId) as Row | undefined;
    if (!row) throw new DomainError('NOT_FOUND', 'Review reply not found.', 404);
    return reviewReplyFromRow(row);
  }

  private validateReviewRelations(
    projectId: string,
    revisionId: string | null,
    luminaireId: string | null,
  ): void {
    if (revisionId) this.getRevision(projectId, revisionId);
    if (luminaireId) {
      const luminaire = this.database
        .prepare('SELECT id FROM project_luminaires WHERE id = ? AND project_id = ?')
        .get(luminaireId, projectId);
      if (!luminaire) throw new DomainError('NOT_FOUND', 'Luminaire not found.', 404);
    }
  }

  private newAuthoredSnapshot(
    input:
      | CreateProjectReviewThreadInput
      | Extract<CreateProjectReviewReplyInput, { origin: 'Internal' }>
      | Extract<CreateProjectReviewReplyInput, { authorName: string }>,
    actor: ReviewMutationActor,
  ): {
    origin: 'Client' | 'Internal';
    authorId: string;
    authorNameSnapshot: string;
    authorRoleSnapshot: string;
  } {
    if (input.origin === 'Internal') {
      return {
        origin: 'Internal',
        authorId: actor.id,
        authorNameSnapshot: actor.displayName,
        authorRoleSnapshot: actor.jobTitle,
      };
    }
    return {
      origin: 'Client',
      authorId: this.idProvider(),
      authorNameSnapshot: input.authorName,
      authorRoleSnapshot: input.authorRole,
    };
  }

  private reviewReplyAuthoredSnapshot(
    projectId: string,
    reviewItemId: string,
    input: CreateProjectReviewReplyInput,
    actor: ReviewMutationActor,
  ): {
    origin: 'Client' | 'Internal';
    authorId: string;
    authorNameSnapshot: string;
    authorRoleSnapshot: string;
  } {
    if (input.origin === 'Internal') {
      return this.newAuthoredSnapshot(input, actor);
    }
    const authorId = 'existingClientAuthorId' in input ? input.existingClientAuthorId : undefined;
    if (authorId === undefined) {
      if (!('authorName' in input)) {
        throw new DomainError('VALIDATION_ERROR', 'Client author snapshot is required.', 400);
      }
      return {
        origin: 'Client',
        authorId: this.idProvider(),
        authorNameSnapshot: input.authorName,
        authorRoleSnapshot: input.authorRole,
      };
    }
    const root = this.getReview(projectId, reviewItemId);
    if (
      root.origin === 'Client' &&
      root.authorId === authorId &&
      root.authorNameSnapshot !== null &&
      root.authorRoleSnapshot !== null
    ) {
      return {
        origin: 'Client',
        authorId,
        authorNameSnapshot: root.authorNameSnapshot,
        authorRoleSnapshot: root.authorRoleSnapshot,
      };
    }
    const reply = this.database
      .prepare(
        `SELECT author_id, author_name_snapshot, author_role_snapshot
         FROM project_review_replies
         WHERE project_id = ? AND review_item_id = ? AND origin = 'Client' AND author_id = ?
         ORDER BY created_at ASC, id ASC LIMIT 1`,
      )
      .get(projectId, reviewItemId, authorId) as Row | undefined;
    if (!reply) {
      throw new DomainError('NOT_FOUND', 'Client author not found in this review thread.', 404);
    }
    return {
      origin: 'Client',
      authorId: text(reply.author_id),
      authorNameSnapshot: text(reply.author_name_snapshot),
      authorRoleSnapshot: text(reply.author_role_snapshot),
    };
  }

  private auditDetail(actor: ReviewMutationActor | null, detail: string): string {
    return actor ? `${detail} | mutation actor: ${actor.displayName} (${actor.id})` : detail;
  }

  public createRevision(projectId: string, input: ProjectRevisionInput): ProjectRevision {
    const id = randomUUID();
    const now = new Date().toISOString();
    this.database
      .prepare(
        `INSERT INTO project_revisions
        (id, project_id, revision_number, reissue_number, title, status, received_at, due_date, issued_at,
         summary, change_log, source_type, source_reference, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        projectId,
        input.revisionNumber,
        input.reissueNumber,
        input.title,
        input.status,
        input.receivedAt,
        input.dueDate,
        input.issuedAt,
        input.summary,
        input.changeLog,
        input.sourceType,
        input.sourceReference,
        now,
        now,
      );
    this.applyIssuedRevision(projectId, id, input.status);
    this.activity(
      projectId,
      'Revision',
      id,
      'Created',
      `REV_${String(input.revisionNumber).padStart(2, '0')} · ${input.title}`,
      input.summary,
      now,
    );
    return this.getRevision(projectId, id);
  }

  public updateRevision(
    projectId: string,
    id: string,
    input: ProjectRevisionInput,
  ): ProjectRevision {
    const current = this.getRevision(projectId, id);
    if (current.locked) {
      throw new DomainError(
        'CONFLICT',
        'Issued revisions are locked. Create a reissue or a new revision instead.',
        409,
      );
    }
    const now = new Date().toISOString();
    const result = this.database
      .prepare(
        `UPDATE project_revisions SET revision_number = ?, reissue_number = ?, title = ?, status = ?,
        received_at = ?, due_date = ?, issued_at = ?, summary = ?, change_log = ?,
        source_type = ?, source_reference = ?, updated_at = ? WHERE id = ? AND project_id = ?`,
      )
      .run(
        input.revisionNumber,
        input.reissueNumber,
        input.title,
        input.status,
        input.receivedAt,
        input.dueDate,
        input.issuedAt,
        input.summary,
        input.changeLog,
        input.sourceType,
        input.sourceReference,
        now,
        id,
        projectId,
      );
    this.requireChange(result.changes, 'Revision');
    this.applyIssuedRevision(projectId, id, input.status);
    this.activity(projectId, 'Revision', id, input.status, input.title, input.changeLog, now);
    return this.getRevision(projectId, id);
  }

  private applyIssuedRevision(
    projectId: string,
    id: string,
    status: ProjectRevision['status'],
  ): void {
    if (status !== 'Issued') return;
    const row = this.database
      .prepare('SELECT * FROM project_revisions WHERE id = ? AND project_id = ?')
      .get(id, projectId) as Row | undefined;
    const snapshotHash = createHash('sha256')
      .update(JSON.stringify(row ?? {}))
      .digest('hex');
    this.database
      .prepare(
        `UPDATE project_revisions SET locked = 1, snapshot_hash = ?,
         issued_at = COALESCE(issued_at, ?), updated_at = ? WHERE id = ? AND project_id = ?`,
      )
      .run(snapshotHash, new Date().toISOString(), new Date().toISOString(), id, projectId);
    this.database
      .prepare(
        `UPDATE project_revisions SET status = 'Superseded', updated_at = ?
                WHERE project_id = ? AND id <> ? AND status = 'Issued'`,
      )
      .run(new Date().toISOString(), projectId, id);
  }

  private ensureColumn(table: string, column: string, definition: string): void {
    const columns = this.database.prepare(`PRAGMA table_info(${table})`).all() as Row[];
    if (!columns.some((item) => item.name === column)) {
      this.database.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
    }
  }

  private getRevision(projectId: string, id: string): ProjectRevision {
    const row = this.database
      .prepare('SELECT * FROM project_revisions WHERE id = ? AND project_id = ?')
      .get(id, projectId) as Row | undefined;
    if (!row) throw new DomainError('NOT_FOUND', 'Revision not found.', 404);
    return revisionFromRow(row);
  }

  public createDocument(projectId: string, input: ProjectDocumentInput): ProjectDocument {
    const id = randomUUID();
    const now = new Date().toISOString();
    this.database
      .prepare(
        `INSERT INTO project_documents
        (id, project_id, category, document_number, title, revision, status, file_path,
         issued_to, issue_date, notes, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        projectId,
        input.category,
        input.documentNumber,
        input.title,
        input.revision,
        input.status,
        input.filePath,
        input.issuedTo,
        input.issueDate,
        input.notes,
        now,
        now,
      );
    this.activity(projectId, 'Document', id, 'Created', input.title, input.filePath, now);
    return this.getDocument(projectId, id);
  }

  public updateDocument(
    projectId: string,
    id: string,
    input: ProjectDocumentInput,
  ): ProjectDocument {
    const now = new Date().toISOString();
    const result = this.database
      .prepare(
        `UPDATE project_documents SET category = ?, document_number = ?, title = ?,
        revision = ?, status = ?, file_path = ?, issued_to = ?, issue_date = ?, notes = ?,
        updated_at = ? WHERE id = ? AND project_id = ?`,
      )
      .run(
        input.category,
        input.documentNumber,
        input.title,
        input.revision,
        input.status,
        input.filePath,
        input.issuedTo,
        input.issueDate,
        input.notes,
        now,
        id,
        projectId,
      );
    this.requireChange(result.changes, 'Document');
    this.activity(projectId, 'Document', id, input.status, input.title, input.filePath, now);
    return this.getDocument(projectId, id);
  }

  private getDocument(projectId: string, id: string): ProjectDocument {
    const row = this.database
      .prepare('SELECT * FROM project_documents WHERE id = ? AND project_id = ?')
      .get(id, projectId) as Row | undefined;
    if (!row) throw new DomainError('NOT_FOUND', 'Document not found.', 404);
    return documentFromRow(row);
  }

  /**
   * Remove a working-file registration from the project register.
   *
   * This removes ONLY the mutable ProjectDocument registration row. It never
   * deletes the user's physical source file from disk, and it never touches
   * immutable historical authority (DocumentSnapshots / issued packages).
   *
   * Fail-closed policy: if this ProjectDocument is referenced by any immutable
   * DocumentSnapshot (revision_document_snapshots.source_document_id) or by a
   * review attachment (project_review_attachments.document_id), removal is
   * rejected with a truthful CONFLICT so historical provenance and review
   * references are never broken. The database FKs (ON DELETE RESTRICT) are the
   * final backstop, not the first user-facing error mechanism.
   */
  public removeDocument(projectId: string, id: string): { removed: boolean } {
    const existing = this.getDocument(projectId, id);
    // The immutable snapshot table may not exist in a legacy/mock database that
    // has not applied the v13 deliverable DDL. If the table is absent there can
    // be no snapshots, so the reference check is vacuously safe.
    const snapshotTable = this.database
      .prepare(
        "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'revision_document_snapshots'",
      )
      .get() as Row | undefined;
    if (snapshotTable) {
      const referenced = this.database
        .prepare('SELECT 1 FROM revision_document_snapshots WHERE source_document_id = ? LIMIT 1')
        .get(id) as Row | undefined;
      if (referenced) {
        throw new DomainError(
          'CONFLICT',
          'This working file is referenced by an immutable Revision deliverable and cannot be removed from the register.',
          409,
        );
      }
    }
    // project_review_attachments is part of the store's own DDL, so it always
    // exists in a store-managed database.
    const reviewReferenced = this.database
      .prepare(
        'SELECT 1 FROM project_review_attachments WHERE document_id = ? AND project_id = ? LIMIT 1',
      )
      .get(id, projectId) as Row | undefined;
    if (reviewReferenced) {
      throw new DomainError(
        'CONFLICT',
        'This working file is referenced by a review attachment and cannot be removed from the register.',
        409,
      );
    }
    const result = this.database
      .prepare('DELETE FROM project_documents WHERE id = ? AND project_id = ?')
      .run(id, projectId);
    this.requireChange(result.changes, 'Document');
    this.activity(
      projectId,
      'Document',
      id,
      'Removed',
      existing.title,
      existing.filePath,
      new Date().toISOString(),
    );
    return { removed: true };
  }

  public createContact(projectId: string, input: ProjectContactInput): ProjectContact {
    const id = randomUUID();
    const now = this.nowProvider();
    this.database.exec('SAVEPOINT contact_write');
    try {
      this.updateContactPresentation(projectId, id, input, now);
      this.database
        .prepare(
          `INSERT INTO project_contacts
        (id,project_id,name,email,company,role,phone,is_primary,created_at,updated_at)
        VALUES (?,?,?,?,?,?,?,?,?,?)`,
        )
        .run(
          id,
          projectId,
          input.name,
          input.email,
          input.company,
          input.role,
          input.phone ?? '',
          input.isPrimary ? 1 : 0,
          now,
          now,
        );
      this.activity(projectId, 'Contact', id, 'Created', input.name, input.email, now);
      this.database.exec('RELEASE contact_write');
    } catch (error) {
      this.database.exec('ROLLBACK TO contact_write; RELEASE contact_write');
      throw error;
    }
    return this.getContact(projectId, id);
  }

  public updateContact(projectId: string, id: string, input: ProjectContactInput): ProjectContact {
    const now = this.nowProvider();
    this.database.exec('SAVEPOINT contact_write');
    try {
      const existing = this.getContact(projectId, id);
      this.updateContactPresentation(projectId, id, { ...existing, ...input }, now);
      const result = this.database
        .prepare(
          `UPDATE project_contacts SET name=?,email=?,company=?,role=?,phone=?,is_primary=?,updated_at=?
        WHERE id=? AND project_id=?`,
        )
        .run(
          input.name,
          input.email,
          input.company,
          input.role,
          input.phone ?? existing.phone ?? '',
          (input.isPrimary ?? existing.isPrimary) ? 1 : 0,
          now,
          id,
          projectId,
        );
      this.requireChange(result.changes, 'Contact');
      this.activity(projectId, 'Contact', id, 'Updated', input.name, input.email, now);
      this.database.exec('RELEASE contact_write');
    } catch (error) {
      this.database.exec('ROLLBACK TO contact_write; RELEASE contact_write');
      throw error;
    }
    return this.getContact(projectId, id);
  }

  private getContact(projectId: string, id: string): ProjectContact {
    const row = this.database
      .prepare('SELECT * FROM project_contacts WHERE id = ? AND project_id = ?')
      .get(id, projectId) as Row | undefined;
    if (!row) throw new DomainError('NOT_FOUND', 'Contact not found.', 404);
    return {
      ...contactFromRow(row),
      ...new ContactPresentationStore(this.database).read(projectId, id),
    };
  }

  private updateContactPresentation(
    projectId: string,
    id: string,
    input: ProjectContactInput,
    now: string,
  ) {
    const presentation = new ContactPresentationStore(this.database);
    presentation.save(
      projectId,
      id,
      { group: input.group, notes: input.notes, archived: input.archived },
      now,
    );
    if (input.isPrimary && !input.archived) {
      const group = (input.group || input.role || 'Unspecified').trim().toLowerCase();
      const others = this.database
        .prepare('SELECT * FROM project_contacts WHERE project_id=? AND is_primary=1 AND id<>?')
        .all(projectId, id) as Row[];
      for (const row of others) {
        const metadata = presentation.read(projectId, text(row.id));
        if ((metadata.group || text(row.role) || 'Unspecified').trim().toLowerCase() !== group)
          continue;
        this.database
          .prepare(
            'UPDATE project_contacts SET is_primary=0,updated_at=? WHERE project_id=? AND id=?',
          )
          .run(now, projectId, text(row.id));
        this.activity(
          projectId,
          'Contact',
          text(row.id),
          'Updated',
          text(row.name),
          'Primary contact replaced in group',
          now,
        );
      }
    }
  }

  /**
   * Compatibility projection for a Revision identity already allocated by the canonical registry.
   * This method never chooses a UUID or sequence; conflicts fail closed instead of creating a
   * second authority.
   */
  public recordCanonicalRevisionProjection(
    projectId: string,
    revisionId: string,
    revisionNumber: number,
    input: ProjectRevisionInput,
    canonicalCreatedAt: string,
  ): ProjectRevision {
    const sequenceOwner = this.database
      .prepare('SELECT id FROM project_revisions WHERE project_id = ? AND revision_number = ?')
      .get(projectId, revisionNumber) as Row | undefined;
    if (sequenceOwner && text(sequenceOwner.id) !== revisionId) {
      throw new DomainError(
        'CONFLICT',
        'The canonical Revision sequence conflicts with an existing compatibility record.',
        409,
      );
    }
    const existing = this.database
      .prepare('SELECT * FROM project_revisions WHERE id = ?')
      .get(revisionId) as Row | undefined;
    if (existing) {
      if (
        text(existing.project_id) !== projectId ||
        Number(existing.revision_number) !== revisionNumber
      ) {
        throw new DomainError(
          'CONFLICT',
          'The canonical Revision compatibility identity is already owned by another record.',
          409,
        );
      }
      const now = new Date().toISOString();
      this.database
        .prepare(
          `UPDATE project_revisions SET reissue_number = ?, title = ?, status = ?,
           received_at = ?, due_date = ?, issued_at = ?, summary = ?, change_log = ?,
           source_type = ?, source_reference = ?, updated_at = ? WHERE id = ?`,
        )
        .run(
          input.reissueNumber,
          input.title,
          input.status,
          input.receivedAt,
          input.dueDate,
          input.issuedAt,
          input.summary,
          input.changeLog,
          input.sourceType,
          input.sourceReference,
          now,
          revisionId,
        );
      this.applyIssuedRevision(projectId, revisionId, input.status);
      return this.getRevision(projectId, revisionId);
    }

    this.database
      .prepare(
        `INSERT INTO project_revisions
         (id, project_id, revision_number, reissue_number, title, status, received_at, due_date,
          issued_at, summary, change_log, source_type, source_reference, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        revisionId,
        projectId,
        revisionNumber,
        input.reissueNumber,
        input.title,
        input.status,
        input.receivedAt,
        input.dueDate,
        input.issuedAt,
        input.summary,
        input.changeLog,
        input.sourceType,
        input.sourceReference,
        canonicalCreatedAt,
        canonicalCreatedAt,
      );
    this.applyIssuedRevision(projectId, revisionId, input.status);
    this.activity(
      projectId,
      'Revision',
      revisionId,
      'Created',
      `REV_${String(revisionNumber).padStart(2, '0')} · ${input.title}`,
      input.summary,
      canonicalCreatedAt,
    );
    return this.getRevision(projectId, revisionId);
  }

  /**
   * Legacy compatibility projection for project_revisions. Numeric matching is intentionally not
   * promoted to canonical provenance by P2-FND-04 and must not dual-write the canonical registry.
   */
  public recordExport(
    projectId: string,
    revisionNumber: number,
    issueStatus: string,
    issueDate: string,
  ): void {
    const existing = this.database
      .prepare('SELECT id FROM project_revisions WHERE project_id = ? AND revision_number = ?')
      .get(projectId, revisionNumber) as Row | undefined;
    const status: ProjectRevision['status'] = /issued/i.test(issueStatus)
      ? 'Issued'
      : 'InternalReview';
    if (existing) {
      this.database
        .prepare(
          `UPDATE project_revisions SET status = ?, issued_at = ?, updated_at = ? WHERE id = ?`,
        )
        .run(
          status,
          status === 'Issued' ? issueDate : null,
          new Date().toISOString(),
          text(existing.id),
        );
      this.applyIssuedRevision(projectId, text(existing.id), status);
    } else {
      this.createRevision(projectId, {
        revisionNumber,
        reissueNumber: 0,
        title: `Luminaire package REV_${String(revisionNumber).padStart(2, '0')}`,
        status,
        receivedAt: null,
        dueDate: null,
        issuedAt: status === 'Issued' ? issueDate : null,
        summary: 'Luminaire Schedule, Technical BOQ and Datasheets package.',
        changeLog: '',
        sourceType: 'Manual',
        sourceReference: '',
      });
    }
    this.seedExistingExports(projectId);
  }

  public getMicrosoftConnection(): MicrosoftConnection {
    const row = this.database
      .prepare('SELECT * FROM microsoft_connection WHERE id = 1')
      .get() as Row;
    return {
      tenantId: text(row.tenant_id) || 'organizations',
      clientId: text(row.client_id),
      connected: Boolean(row.connected) && Boolean(row.token_blob),
      accountName: text(row.account_name),
      accountEmail: text(row.account_email),
      mailSyncEnabled: Boolean(row.mail_sync_enabled),
      calendarSyncEnabled: Boolean(row.calendar_sync_enabled),
      syncIntervalMinutes: Number(row.sync_interval_minutes),
      lastSyncAt: nullableText(row.last_sync_at),
      lastError: nullableText(row.last_error),
      updatedAt: text(row.updated_at),
    };
  }

  public updateMicrosoftSettings(input: MicrosoftConnectionSettingsInput): MicrosoftConnection {
    const now = new Date().toISOString();
    const current = this.database
      .prepare('SELECT client_id FROM microsoft_connection WHERE id = 1')
      .get() as Row;
    const clientChanged = text(current.client_id) && text(current.client_id) !== input.clientId;
    this.database
      .prepare(
        `UPDATE microsoft_connection SET tenant_id = ?, client_id = ?,
        mail_sync_enabled = ?, calendar_sync_enabled = ?, sync_interval_minutes = ?,
        connected = CASE WHEN ? THEN 0 ELSE connected END,
        token_blob = CASE WHEN ? THEN '' ELSE token_blob END,
        token_expires_at = CASE WHEN ? THEN NULL ELSE token_expires_at END,
        account_name = CASE WHEN ? THEN '' ELSE account_name END,
        account_email = CASE WHEN ? THEN '' ELSE account_email END,
        updated_at = ? WHERE id = 1`,
      )
      .run(
        input.tenantId,
        input.clientId,
        input.mailSyncEnabled ? 1 : 0,
        input.calendarSyncEnabled ? 1 : 0,
        input.syncIntervalMinutes,
        clientChanged ? 1 : 0,
        clientChanged ? 1 : 0,
        clientChanged ? 1 : 0,
        clientChanged ? 1 : 0,
        clientChanged ? 1 : 0,
        now,
      );
    return this.getMicrosoftConnection();
  }

  public getMicrosoftToken(): { blob: string; expiresAt: string | null } | null {
    const row = this.database
      .prepare('SELECT token_blob, token_expires_at FROM microsoft_connection WHERE id = 1')
      .get() as Row;
    const blob = text(row.token_blob);
    return blob ? { blob, expiresAt: nullableText(row.token_expires_at) } : null;
  }

  public saveMicrosoftToken(
    blob: string,
    expiresAt: string,
    accountName: string,
    accountEmail: string,
  ): MicrosoftConnection {
    const now = new Date().toISOString();
    this.database
      .prepare(
        `UPDATE microsoft_connection SET connected = 1, token_blob = ?,
        token_expires_at = ?, account_name = ?, account_email = ?, last_error = NULL,
        updated_at = ? WHERE id = 1`,
      )
      .run(blob, expiresAt, accountName, accountEmail, now);
    return this.getMicrosoftConnection();
  }

  public updateMicrosoftSyncStatus(lastError: string | null): MicrosoftConnection {
    const now = new Date().toISOString();
    this.database
      .prepare(
        `UPDATE microsoft_connection SET last_sync_at = ?, last_error = ?, updated_at = ? WHERE id = 1`,
      )
      .run(lastError ? null : now, lastError, now);
    return this.getMicrosoftConnection();
  }

  public disconnectMicrosoft(): MicrosoftConnection {
    const now = new Date().toISOString();
    this.database
      .prepare(
        `UPDATE microsoft_connection SET connected = 0, account_name = '', account_email = '',
        token_blob = '', token_expires_at = NULL, last_error = NULL, updated_at = ? WHERE id = 1`,
      )
      .run(now);
    return this.getMicrosoftConnection();
  }

  public upsertCommunication(input: SyncedCommunicationInput): ProjectCommunication {
    const now = new Date().toISOString();
    const existing = this.database
      .prepare(
        'SELECT id, project_id, manually_linked FROM project_communications WHERE kind = ? AND external_id = ?',
      )
      .get(input.kind, input.externalId) as Row | undefined;
    const id = existing ? text(existing.id) : randomUUID();
    const projectId = existing?.manually_linked
      ? nullableText(existing?.project_id)
      : (input.projectId ?? nullableText(existing?.project_id));
    this.database
      .prepare(
        `INSERT INTO project_communications
        (id, project_id, external_id, kind, conversation_id, subject, sender,
         participants_json, occurred_at, end_at, preview, web_link, has_attachments,
         manually_linked, synced_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(kind, external_id) DO UPDATE SET
          project_id = excluded.project_id, conversation_id = excluded.conversation_id,
          subject = excluded.subject, sender = excluded.sender,
          participants_json = excluded.participants_json, occurred_at = excluded.occurred_at,
          end_at = excluded.end_at, preview = excluded.preview, web_link = excluded.web_link,
          has_attachments = excluded.has_attachments, synced_at = excluded.synced_at`,
      )
      .run(
        id,
        projectId,
        input.externalId,
        input.kind,
        input.conversationId,
        input.subject,
        input.sender,
        JSON.stringify(input.participants),
        input.occurredAt,
        input.endAt,
        input.preview,
        input.webLink,
        input.hasAttachments ? 1 : 0,
        existing?.manually_linked ? 1 : 0,
        now,
      );
    return this.getCommunication(id);
  }

  public listCommunications(filter: {
    kind?: 'Email' | 'Calendar';
    projectId?: string;
    linked?: boolean;
    search?: string;
  }): ProjectCommunication[] {
    const where: string[] = [];
    const params: string[] = [];
    if (filter.kind) {
      where.push('kind = ?');
      params.push(filter.kind);
    }
    if (filter.projectId) {
      where.push('project_id = ?');
      params.push(filter.projectId);
    }
    if (filter.linked !== undefined)
      where.push(filter.linked ? 'project_id IS NOT NULL' : 'project_id IS NULL');
    if (filter.search) {
      where.push('(subject LIKE ? OR sender LIKE ? OR preview LIKE ?)');
      const pattern = `%${filter.search.replaceAll('%', '\\%').replaceAll('_', '\\_')}%`;
      params.push(pattern, pattern, pattern);
    }
    const rows = this.database
      .prepare(
        `SELECT * FROM project_communications ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
                ORDER BY occurred_at DESC LIMIT 500`,
      )
      .all(...params) as Row[];
    return rows.map(communicationFromRow);
  }

  public linkCommunication(id: string, projectId: string | null): ProjectCommunication {
    const result = this.database
      .prepare('UPDATE project_communications SET project_id = ?, manually_linked = 1 WHERE id = ?')
      .run(projectId, id);
    this.requireChange(result.changes, 'Communication');
    const communication = this.getCommunication(id);
    if (projectId) {
      this.activity(
        projectId,
        'Communication',
        id,
        'Linked',
        communication.subject,
        communication.sender,
        new Date().toISOString(),
      );
    }
    return communication;
  }

  private getCommunication(id: string): ProjectCommunication {
    const row = this.database
      .prepare('SELECT * FROM project_communications WHERE id = ?')
      .get(id) as Row | undefined;
    if (!row) throw new DomainError('NOT_FOUND', 'Communication not found.', 404);
    return communicationFromRow(row);
  }

  public autoProjectId(input: SyncedCommunicationInput, projects: Project[]): string | null {
    const haystack = `${input.subject} ${input.preview}`.toLowerCase();
    const codeMatch = projects.find((project) =>
      haystack.includes(project.projectCode.toLowerCase()),
    );
    if (codeMatch) return codeMatch.id;
    const participants = new Set(
      [input.sender, ...input.participants]
        .map((value) => value.trim().toLowerCase())
        .filter(Boolean),
    );
    const matches = this.database
      .prepare(
        `SELECT DISTINCT project_id FROM project_contacts WHERE lower(email) IN
        (${Array.from(participants, () => '?').join(',') || "''"})`,
      )
      .all(...participants) as Row[];
    return matches.length === 1 ? text(matches[0]?.project_id) : null;
  }

  public portfolioOperations(): PersonalPortfolioOperations {
    const today = dateKeyInTimeZone(new Date(), this.companyTimeZone);
    const now = new Date().toISOString();
    const end = addCalendarDays(today, 14);
    const overdueActions = (
      this.database
        .prepare(
          `SELECT * FROM project_actions WHERE due_date < ?
                  AND status NOT IN ('Completed', 'Cancelled') ORDER BY due_date`,
        )
        .all(today) as Row[]
    ).map(actionFromRow);
    const upcomingActions = (
      this.database
        .prepare(
          `SELECT * FROM project_actions WHERE due_date >= ? AND due_date <= ?
                  AND status NOT IN ('Completed', 'Cancelled') ORDER BY due_date`,
        )
        .all(today, end) as Row[]
    ).map(actionFromRow);
    const upcomingMeetings = (
      this.database
        .prepare(
          `SELECT * FROM project_meetings WHERE start_at >= ? AND status = 'Planned'
                  ORDER BY start_at LIMIT 30`,
        )
        .all(now) as Row[]
    ).map(meetingFromRow);
    const blockingRequirements = (
      this.database
        .prepare(
          `SELECT * FROM project_requirements WHERE impact = 'Blocking'
                  AND status NOT IN ('Received', 'NotRequired') ORDER BY due_date, created_at`,
        )
        .all() as Row[]
    ).map(requirementFromRow);
    const openReviews = (
      this.database
        .prepare(
          `SELECT * FROM project_review_items WHERE status NOT IN ('Resolved', 'Rejected')
                  ORDER BY due_date, received_at DESC LIMIT 100`,
        )
        .all() as Row[]
    ).map(reviewFromRow);
    return {
      overdueActions,
      upcomingActions,
      upcomingMeetings,
      blockingRequirements,
      openReviews,
    };
  }

  public search(query: string, projects: Project[]): WorkspaceSearchResult[] {
    if (!projects.length) return [];
    const allowedProjects = JSON.stringify(projects.map((project) => project.id));
    const normalized = query.toLowerCase();
    const results: WorkspaceSearchResult[] = projects
      .filter((project) =>
        [
          project.projectCode,
          project.projectName,
          project.clientName,
          project.crmReference ?? '',
          project.siteLocation,
        ]
          .join(' ')
          .toLowerCase()
          .includes(normalized),
      )
      .map((project) => ({
        id: project.id,
        projectId: project.id,
        type: 'Project',
        title: project.projectName,
        detail: `${project.projectCode} · ${project.clientName}`,
        date: project.updatedAt,
      }));
    const pattern = `%${query.replaceAll('\\', '\\\\').replaceAll('%', '\\%').replaceAll('_', '\\_')}%`;
    const sources: Array<{
      sql: string;
      type: WorkspaceSearchResult['type'];
      map: (row: Row) => WorkspaceSearchResult;
    }> = [
      {
        sql: `SELECT id, project_id, title, details AS detail, updated_at AS date
              FROM project_actions WHERE project_id IN (SELECT value FROM json_each(?))
              AND (title LIKE ? ESCAPE '\\' OR details LIKE ? ESCAPE '\\') ORDER BY date DESC, id ASC LIMIT 40`,
        type: 'Action',
        map: (row) => ({
          id: text(row.id),
          projectId: text(row.project_id),
          type: 'Action',
          title: text(row.title),
          detail: text(row.detail),
          date: text(row.date),
        }),
      },
      {
        sql: `SELECT id, project_id, title, description AS detail, updated_at AS date
              FROM project_review_items WHERE project_id IN (SELECT value FROM json_each(?))
              AND (title LIKE ? ESCAPE '\\' OR description LIKE ? ESCAPE '\\') ORDER BY date DESC, id ASC LIMIT 40`,
        type: 'Review',
        map: (row) => ({
          id: text(row.id),
          projectId: text(row.project_id),
          type: 'Review',
          title: text(row.title),
          detail: text(row.detail),
          date: text(row.date),
        }),
      },
      {
        sql: `SELECT id, project_id, title, agenda AS detail, start_at AS date
              FROM project_meetings WHERE project_id IN (SELECT value FROM json_each(?))
              AND (title LIKE ? ESCAPE '\\' OR agenda LIKE ? ESCAPE '\\') ORDER BY date DESC, id ASC LIMIT 40`,
        type: 'Meeting',
        map: (row) => ({
          id: text(row.id),
          projectId: text(row.project_id),
          type: 'Meeting',
          title: text(row.title),
          detail: text(row.detail),
          date: text(row.date),
        }),
      },
      {
        sql: `SELECT id, project_id, title, file_path AS detail, updated_at AS date
              FROM project_documents WHERE project_id IN (SELECT value FROM json_each(?))
              AND (title LIKE ? ESCAPE '\\' OR file_path LIKE ? ESCAPE '\\') ORDER BY date DESC, id ASC LIMIT 40`,
        type: 'Document',
        map: (row) => ({
          id: text(row.id),
          projectId: text(row.project_id),
          type: 'Document',
          title: text(row.title),
          detail: text(row.detail),
          date: text(row.date),
        }),
      },
    ];
    for (const source of sources) {
      void source.type;
      results.push(
        ...(this.database.prepare(source.sql).all(allowedProjects, pattern, pattern) as Row[]).map(
          source.map,
        ),
      );
    }
    const luminaires = this.database
      .prepare(
        `
      SELECT id, project_id, tag, manufacturer, model, updated_at
      FROM project_luminaires WHERE project_id IN (SELECT value FROM json_each(?))
      AND (tag LIKE ? ESCAPE '\\' OR manufacturer LIKE ? ESCAPE '\\' OR model LIKE ? ESCAPE '\\')
      ORDER BY updated_at DESC, id ASC LIMIT 40
    `,
      )
      .all(allowedProjects, pattern, pattern, pattern) as Row[];
    results.push(
      ...luminaires.map((row): WorkspaceSearchResult => ({
        id: text(row.id),
        projectId: text(row.project_id),
        type: 'Luminaire',
        title: text(row.tag),
        detail: [text(row.manufacturer), text(row.model)].filter(Boolean).join(' · '),
        date: text(row.updated_at),
      })),
    );
    return results.sort((a, b) => b.date.localeCompare(a.date)).slice(0, 120);
  }

  private activity(
    projectId: string,
    entityType: string,
    entityId: string | null,
    action: string,
    title: string,
    detail: string,
    createdAt: string,
  ): void {
    this.database
      .prepare(
        `INSERT INTO workspace_activity
        (id, project_id, entity_type, entity_id, action, title, detail, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(this.idProvider(), projectId, entityType, entityId, action, title, detail, createdAt);
    this.database
      .prepare('UPDATE project_workspaces SET updated_at = ? WHERE project_id = ?')
      .run(createdAt, projectId);
  }

  /**
   * Appends a workspace activity record using the same convention as every
   * other workspace mutation. Used by scope edits so the change is auditable.
   */
  public recordWorkspaceActivity(
    projectId: string,
    entityType: string,
    entityId: string | null,
    action: string,
    title: string,
    detail: string,
    createdAt: string,
  ): void {
    this.activity(projectId, entityType, entityId, action, title, detail, createdAt);
  }

  private requireChange(changes: number | bigint, label: string): void {
    if (!Number(changes)) throw new DomainError('NOT_FOUND', `${label} not found.`, 404);
  }
}
