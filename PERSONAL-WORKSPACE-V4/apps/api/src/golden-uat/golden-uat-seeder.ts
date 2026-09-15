/**
 * Golden UAT fixture — canonical seeder.
 *
 * Creates ONE guarded canonical Golden Project through the SAME canonical
 * stores/services used by Personal Workspace. Dry-run (PLAN) is the default;
 * applying requires explicit opt-in. The seeder never writes SQLite directly and
 * never touches a non-fixture project.
 *
 * Idempotency: the fixture is identified by a stable crmReference marker. If a
 * project with that marker already exists, the seeder reconciles ONLY fixture-owned
 * entities (idempotent create/update) and never duplicates the project or its
 * children. A project that shares the display name but does NOT carry the marker is
 * refused (collision guard).
 */

import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import type {
  CreateProjectInput,
  ProjectActionItemInput,
  ProjectContactInput,
  ProjectDocumentInput,
  ProjectMeetingInput,
  ProjectRequirementInput,
  ProjectScopeItemInput,
} from '@scli/contracts';
import type {
  AppUser,
  Project,
  ProjectDocument,
  ProjectRevision,
  WorkSession,
  WorkflowTransitionRecord,
} from '@scli/domain';
import type { WorkspaceWithScope } from '../personal-workspace-store';
import type { GoldenUatHarness } from './golden-uat-harness';
import { createGoldenUatAssets } from './golden-uat-assets';
import {
  GOLDEN_COMMENT_IDS,
  GOLDEN_COMMENT_REFERENCES,
  buildGoldenCommentsGraph,
  goldenCommentActorSeeds,
} from './golden-comments-graph-builder';
import {
  GOLDEN_UAT_CRM_REFERENCE,
  GOLDEN_UAT_DEFAULT_ANCHOR_DATE,
  GOLDEN_UAT_FIXTURE_MARKER,
  GOLDEN_UAT_IDEMPOTENCY_KEY,
  GOLDEN_UAT_PROJECT_NAME,
  GOLDEN_UAT_SCENARIO,
  buildAnchorContract,
  buildTimestampSources,
  dateKeyAtUtc,
  type GoldenAnchorContract,
  type GoldenUatManifest,
  type GoldenUatMode,
  type GoldenUatPlanOperation,
  type GoldenUatSeedResult,
} from './golden-uat-types';
import type { GoldenUatPreflight } from './golden-uat-preflight';

// ---------------------------------------------------------------------------
// Fixture scenario data (test-data semantics only; no real client/company data)
// ---------------------------------------------------------------------------

const FIXTURE_CLIENT = 'Boutique Hotel Development Co. (UAT)';
const FIXTURE_PROJECT_TYPE = 'Hospitality Lighting';
const FIXTURE_SITE = 'Downtown, Dubai, UAE (UAT)';
const FIXTURE_DESCRIPTION =
  'Golden UAT fixture: a boutique hotel lighting package used to review every Project Workspace page against known data.';
const FIXTURE_LIGHTING_SCOPE =
  'Interior and exterior lighting design, luminaire selection, DIALux calculations, schedules, and technical BOQ.';
const FIXTURE_LUX_REQUIREMENTS =
  'Lobby 300 lux; guest rooms 200 lux; corridors 100 lux; restaurant 300 lux; façade accent 150 lux; parking 75 lux.';
const FIXTURE_DRAWING_REFERENCE = 'L-101 to L-120 (UAT)';

export function requireUniqueGoldenCommentsProjectDocument(
  documents: readonly ProjectDocument[],
  projectId: string,
  documentNumber: string,
): ProjectDocument {
  const matches = documents.filter(
    (document) => document.projectId === projectId && document.documentNumber === documentNumber,
  );
  if (matches.length !== 1) {
    throw new Error(
      `Golden Comments fixture requires exactly one ProjectDocument "${documentNumber}" in the Golden project; found ${matches.length}.`,
    );
  }
  return matches[0]!;
}

const FIXTURE_SCOPE_ITEMS: ProjectScopeItemInput[] = [
  { code: 'LightingLayout', custom: false },
  { code: 'DialuxCalculation', custom: false },
  { code: 'LuminaireSchedule', custom: false },
  { code: 'TechnicalBoq', custom: false },
  { code: 'Datasheets', custom: false },
  { code: 'LightingDesign', custom: false },
  { label: 'Façade mock-up coordination', custom: true },
  { label: 'Emergency lighting review', custom: true },
];

const FIXTURE_REQUIREMENTS: ProjectRequirementInput[] = [
  {
    category: 'Design',
    title: 'Target lux values per area',
    details: 'Lobby 300 lux, guest rooms 200 lux, corridors 100 lux, restaurant 300 lux.',
    requestedFrom: 'Client',
    requestedAt: null,
    dueDate: null,
    status: 'Received',
    impact: 'High',
    sourceType: 'Manual',
    sourceReference: '',
    notes: 'Confirmed at kickoff.',
    sortOrder: 0,
  },
  {
    category: 'Design',
    title: 'CCT and CRI preferences',
    details: 'Guest rooms 3000K CRI 90; public areas 3000K CRI 90; façade 3000K.',
    requestedFrom: 'Client',
    requestedAt: null,
    dueDate: null,
    status: 'Received',
    impact: 'High',
    sourceType: 'Manual',
    sourceReference: '',
    notes: '',
    sortOrder: 1,
  },
  {
    category: 'Controls',
    title: 'Lighting control programming',
    details: 'Client confirmed lighting control programming is excluded from this package.',
    requestedFrom: 'Client',
    requestedAt: null,
    dueDate: null,
    status: 'NotRequired',
    impact: 'Low',
    sourceType: 'Manual',
    sourceReference: '',
    notes: 'Excluded from scope.',
    sortOrder: 2,
  },
  {
    category: 'Standards',
    title: 'Emergency lighting standard',
    details: 'Confirm applicable emergency lighting standard and exit sign requirements.',
    requestedFrom: 'Consultant',
    requestedAt: null,
    dueDate: null,
    status: 'Requested',
    impact: 'Blocking',
    sourceType: 'Manual',
    sourceReference: '',
    notes: 'Required before finalizing exit luminaires.',
    sortOrder: 3,
  },
];

const FIXTURE_CONTACTS: ProjectContactInput[] = [
  {
    name: 'Aisha Rahman',
    email: 'aisha.rahman@boutique-uat.test',
    company: 'Boutique Hotel Dev (UAT)',
    role: 'Client',
  },
  {
    name: 'Omar Haddad',
    email: 'omar.haddad@boutique-uat.test',
    company: 'Boutique Hotel Dev (UAT)',
    role: 'Client',
  },
  {
    name: 'Lina Farouk',
    email: 'lina.farouk@consult-uat.test',
    company: 'Farouk Lighting Consultants (UAT)',
    role: 'Consultant',
  },
  {
    name: 'Karim Nasser',
    email: 'karim.nasser@contractor-uat.test',
    company: 'Nasser Contracting (UAT)',
    role: 'Contractor',
  },
  {
    name: 'Sara Khalil',
    email: 'sara.khalil@scientechnic-uat.test',
    company: 'Scientechnic (UAT)',
    role: 'Internal Team',
  },
  {
    name: 'Youssef Amin',
    email: 'youssef.amin@scientechnic-uat.test',
    company: 'Scientechnic (UAT)',
    role: 'Internal Team',
  },
];

interface LuminaireSeed {
  tag: string;
  category: string;
  manufacturer: string;
  model: string;
  wattage: string;
  lumens: string;
  lightColor: string;
  cri: string;
  beamAngle: string;
  ipRating: string;
  mounting: string;
  cutout: string;
  driver: string;
  control: string;
  emergency: string;
  location: string;
  unit: string;
  quantity: number;
  notes: string;
  dimensions: string;
  bodyColorFinish: string;
  hasDatasheet: boolean;
  hasImage: boolean;
}

const FIXTURE_LUMINAIRES: LuminaireSeed[] = [
  {
    tag: 'DL01',
    category: 'Downlight',
    manufacturer: 'LumenWorks',
    model: 'LW-DL-3000',
    wattage: '12W',
    lumens: '1100 lm',
    lightColor: '3000K',
    cri: '90',
    beamAngle: '38°',
    ipRating: 'IP20',
    mounting: 'Recessed',
    cutout: 'Ø90mm',
    driver: 'Dimmable',
    control: '0-10V',
    emergency: '',
    location: 'Lobby',
    unit: 'No.',
    quantity: 48,
    notes: 'Complete datasheet and image.',
    dimensions: 'Ø100 x 60mm',
    bodyColorFinish: 'White',
    hasDatasheet: true,
    hasImage: true,
  },
  {
    tag: 'DL02',
    category: 'Downlight',
    manufacturer: 'LumenWorks',
    model: 'LW-DL-4000',
    wattage: '15W',
    lumens: '1400 lm',
    lightColor: '4000K',
    cri: '80',
    beamAngle: '38°',
    ipRating: 'IP20',
    mounting: 'Recessed',
    cutout: 'Ø110mm',
    driver: 'Dimmable',
    control: '0-10V',
    emergency: '',
    location: 'Corridors',
    unit: 'No.',
    quantity: 24,
    notes: 'Image present, datasheet missing.',
    dimensions: 'Ø120 x 70mm',
    bodyColorFinish: 'White',
    hasDatasheet: false,
    hasImage: true,
  },
  {
    tag: 'WL01',
    category: 'Wall Washer',
    manufacturer: 'LumenWorks',
    model: 'LW-WW-3000',
    wattage: '18W',
    lumens: '1600 lm',
    lightColor: '3000K',
    cri: '90',
    beamAngle: '60°',
    ipRating: 'IP65',
    mounting: 'Surface',
    cutout: '',
    driver: 'Dimmable',
    control: '0-10V',
    emergency: '',
    location: 'Façade',
    unit: 'No.',
    quantity: 16,
    notes: 'Datasheet present, image missing.',
    dimensions: '300 x 60 x 40mm',
    bodyColorFinish: 'Dark Bronze',
    hasDatasheet: true,
    hasImage: false,
  },
  {
    tag: 'LN01',
    category: 'Linear',
    manufacturer: 'LumenWorks',
    model: '',
    wattage: '',
    lumens: '',
    lightColor: '3000K',
    cri: '90',
    beamAngle: '120°',
    ipRating: 'IP20',
    mounting: 'Recessed',
    cutout: '',
    driver: '',
    control: '',
    emergency: '',
    location: 'Restaurant',
    unit: 'm',
    quantity: 40,
    notes: 'Incomplete technical data; model and wattage missing.',
    dimensions: '',
    bodyColorFinish: '',
    hasDatasheet: false,
    hasImage: false,
  },
  {
    tag: 'SP01',
    category: 'Spot / Track',
    manufacturer: 'LumenWorks',
    model: 'LW-SP-3000',
    wattage: '9W',
    lumens: '850 lm',
    lightColor: '3000K',
    cri: '90',
    beamAngle: '24°',
    ipRating: 'IP20',
    mounting: 'Track',
    cutout: '',
    driver: 'Dimmable',
    control: 'DALI',
    emergency: '',
    location: 'Meeting Room',
    unit: 'No.',
    quantity: 18,
    notes: 'Complete.',
    dimensions: 'Ø60 x 120mm',
    bodyColorFinish: 'Black',
    hasDatasheet: true,
    hasImage: true,
  },
  {
    tag: 'EX01',
    category: 'Exit Light',
    manufacturer: 'SafeGlow',
    model: 'SG-EX-3000',
    wattage: '3W',
    lumens: '120 lm',
    lightColor: '3000K',
    cri: '80',
    beamAngle: '120°',
    ipRating: 'IP20',
    mounting: 'Surface',
    cutout: '',
    driver: '',
    control: '',
    emergency: 'Battery backup',
    location: 'Emergency / Exit',
    unit: 'No.',
    quantity: 12,
    notes: 'Complete.',
    dimensions: '300 x 120 x 30mm',
    bodyColorFinish: 'White',
    hasDatasheet: true,
    hasImage: true,
  },
  {
    tag: 'FL01',
    category: 'Floodlight',
    manufacturer: 'LumenWorks',
    model: '',
    wattage: '50W',
    lumens: '5000 lm',
    lightColor: '3000K',
    cri: '80',
    beamAngle: '90°',
    ipRating: 'IP66',
    mounting: 'Pole',
    cutout: '',
    driver: '',
    control: '',
    emergency: '',
    location: 'Landscape',
    unit: 'No.',
    quantity: 8,
    notes: 'Manufacturer present, model missing.',
    dimensions: '200 x 200 x 80mm',
    bodyColorFinish: 'Grey',
    hasDatasheet: false,
    hasImage: false,
  },
  {
    tag: 'BL01',
    category: 'Bollard',
    manufacturer: 'SafeGlow',
    model: 'SG-BL-3000',
    wattage: '8W',
    lumens: '600 lm',
    lightColor: '3000K',
    cri: '80',
    beamAngle: '360°',
    ipRating: 'IP65',
    mounting: 'In-ground',
    cutout: '',
    driver: '',
    control: '',
    emergency: '',
    location: 'Parking',
    unit: 'No.',
    quantity: 20,
    notes: 'Complete.',
    dimensions: 'Ø100 x 600mm',
    bodyColorFinish: 'Black',
    hasDatasheet: true,
    hasImage: true,
  },
];

// ---------------------------------------------------------------------------
// Seeder
// ---------------------------------------------------------------------------

export interface GoldenUatSeedOptions {
  mode: GoldenUatMode;
  anchorDate?: string;
  /** Fixture-owned folder root. When omitted, a temp folder is created. */
  fixtureRoot?: string;
}

export class GoldenUatSeeder {
  public constructor(private readonly harness: GoldenUatHarness) {}

  /**
   * Runs the seeder in the requested mode. In PLAN mode no mutation occurs and the
   * manifest is built from the intended fixture. In APPLY mode the fixture is created
   * (or reconciled) through canonical paths and the manifest is read back from the DB.
   */
  public async seed(options: GoldenUatSeedOptions): Promise<GoldenUatSeedResult> {
    const anchorDate = options.anchorDate ?? GOLDEN_UAT_DEFAULT_ANCHOR_DATE;
    const contract = buildAnchorContract(anchorDate);
    const operations: GoldenUatPlanOperation[] = [];

    // Collision guard: find the fixture by marker, never by display name alone. A
    // candidate that shares the display name but does NOT carry the fixture marker
    // is a different real user project and MUST be refused (never modified).
    const projects = await this.harness.provider.listProjects();
    const existing = projects.find((p) => p.crmReference === GOLDEN_UAT_CRM_REFERENCE) ?? null;
    const sameNameNonFixture = projects.find(
      (p) => p.id !== existing?.id && p.projectName === GOLDEN_UAT_PROJECT_NAME,
    );
    if (sameNameNonFixture) {
      throw new Error(
        `Collision guard refused: a project named "${sameNameNonFixture.projectName}" exists but does not carry the ${GOLDEN_UAT_FIXTURE_MARKER} marker.`,
      );
    }
    if (existing && !this.isFixtureProject(existing)) {
      throw new Error(
        `Collision guard refused: a project named "${existing.projectName}" exists but does not carry the ${GOLDEN_UAT_FIXTURE_MARKER} marker.`,
      );
    }

    if (options.mode === 'PLAN') {
      return this.plan(contract, existing, operations);
    }
    return this.apply(contract, existing, options.fixtureRoot, operations);
  }

  /**
   * Builds a PLAN result WITHOUT a harness (zero-mutation). Used by the CLI in PLAN mode so
   * production startup is never entered. The manifest is plan-mode: no persisted read-back,
   * so observedPrecision is UNKNOWN for every timestamp source.
   */
  public seedPlanOnly(anchorDate: string, preflight: GoldenUatPreflight): GoldenUatSeedResult {
    const contract = buildAnchorContract(anchorDate);
    const operations: GoldenUatPlanOperation[] = [];
    this.pushPlanOperations(operations);
    const manifest = this.buildPlanManifest(contract);
    return { mode: 'PLAN', fixtureExisted: preflight.fixtureExists, manifest, operations };
  }

  private pushPlanOperations(operations: GoldenUatPlanOperation[]): void {
    operations.push(
      {
        entity: 'project',
        description: 'Create or reconcile the Golden UAT project',
        mutation: true,
      },
      { entity: 'scope', description: 'Set fixture scope and services', mutation: true },
      {
        entity: 'requirements',
        description: `Seed ${FIXTURE_REQUIREMENTS.length} requirements`,
        mutation: true,
      },
      {
        entity: 'contacts',
        description: `Seed ${FIXTURE_CONTACTS.length} contacts`,
        mutation: true,
      },
      {
        entity: 'luminaires',
        description: `Seed ${FIXTURE_LUMINAIRES.length} luminaires`,
        mutation: true,
      },
      {
        entity: 'assets',
        description: 'Generate synthetic datasheet/image/document assets',
        mutation: true,
      },
      { entity: 'actions', description: 'Seed 12 actions with mixed states', mutation: true },
      { entity: 'meetings', description: 'Seed 4 meetings (3 past, 1 upcoming)', mutation: true },
      { entity: 'reviews', description: 'Seed 3 review items (open + resolved)', mutation: true },
      {
        entity: 'revisions',
        description: 'Create REV01 and REV02 canonical revisions',
        mutation: true,
      },
      {
        entity: 'workflow',
        description: 'Record workflow transitions + revision cycle',
        mutation: true,
      },
      { entity: 'workSessions', description: 'Seed 3 closed work sessions', mutation: true },
      {
        entity: 'documents',
        description: 'Seed register documents + folder index',
        mutation: true,
      },
    );
  }

  private isFixtureProject(project: Project): boolean {
    return project.crmReference === GOLDEN_UAT_CRM_REFERENCE;
  }

  private plan(
    contract: GoldenAnchorContract,
    existing: Project | null,
    operations: GoldenUatPlanOperation[],
  ): GoldenUatSeedResult {
    this.pushPlanOperations(operations);

    const manifest = this.buildManifest(contract, existing);
    return { mode: 'PLAN', fixtureExisted: existing !== null, manifest, operations };
  }

  private async apply(
    contract: GoldenAnchorContract,
    existing: Project | null,
    fixtureRoot: string | undefined,
    operations: GoldenUatPlanOperation[],
  ): Promise<GoldenUatSeedResult> {
    // Active WorkSession preflight (before ANY mutation): the Golden fixture wants
    // historical CLOSED sessions. If an unrelated ACTIVE/PAUSED session already owns
    // the global active slot, refuse the entire APPLY so we can never stop, pause,
    // switch, or overwrite the user's real session. The coordinator would also throw a
    // typed CONFLICT at the seeding step, but that happens AFTER partial mutation; the
    // preflight fails before the project or any asset file is created.
    const activeSession = this.harness.store.getActiveWorkSession();
    if (activeSession) {
      throw new Error(
        'Golden UAT APPLY refused: an unrelated project already has an active WorkSession. Stop or switch it before seeding.',
      );
    }

    const root = fixtureRoot ?? this.createFixtureRoot();
    const assets = createGoldenUatAssets(root);

    // 1) Project (create or reconcile).
    const project = existing ?? (await this.createProject(contract));
    operations.push({
      entity: 'project',
      description: `Project ${project.projectCode} ready`,
      mutation: true,
    });

    // Read the current fixture-owned workspace so seeding is idempotent: each child
    // entity is created only when the fixture has not already populated that group.
    const workspaceBefore = this.harness.store.getWorkspace(project.id);

    // 2) Scope (idempotent: reconciles the same scope on re-run).
    this.harness.store.updateScope(project.id, FIXTURE_SCOPE_ITEMS);
    operations.push({ entity: 'scope', description: 'Scope set', mutation: true });

    // 3) Requirements (skip if already seeded).
    if (workspaceBefore.requirements.length === 0) {
      for (const requirement of FIXTURE_REQUIREMENTS) {
        this.harness.store.operations.createRequirement(project.id, requirement);
      }
    }
    operations.push({
      entity: 'requirements',
      description: `${FIXTURE_REQUIREMENTS.length} requirements`,
      mutation: true,
    });

    // 4) Contacts (idempotent by email uniqueness; only seed when none exist).
    if (workspaceBefore.contacts.length === 0) {
      for (const contact of FIXTURE_CONTACTS) {
        this.harness.store.operations.createContact(project.id, contact);
      }
    }
    operations.push({
      entity: 'contacts',
      description: `${FIXTURE_CONTACTS.length} contacts`,
      mutation: true,
    });

    // 5) Luminaires (idempotent upsert by canonical tag).
    for (const luminaire of FIXTURE_LUMINAIRES) {
      this.harness.store.upsertLuminaire(project.id, this.luminaireInput(luminaire, assets));
    }
    operations.push({
      entity: 'luminaires',
      description: `${FIXTURE_LUMINAIRES.length} luminaires`,
      mutation: true,
    });

    // 6) Actions (skip if already seeded).
    const actionSeeds = this.actionSeeds(contract);
    if (workspaceBefore.actions.length === 0) {
      for (const action of actionSeeds) {
        this.harness.store.operations.createAction(project.id, action);
      }
    }
    operations.push({
      entity: 'actions',
      description: `${actionSeeds.length} actions`,
      mutation: true,
    });

    // 7) Meetings (skip if already seeded).
    const meetingSeeds = this.meetingSeeds(contract);
    if (workspaceBefore.meetings.length === 0) {
      this.harness.store.operations.withServerClock(this.meetingClock(contract), () => {
        for (const meeting of meetingSeeds) {
          this.harness.store.operations.createMeeting(project.id, meeting);
        }
        const seeded = this.harness.store.getWorkspace(project.id);
        const featured = seeded.meetings.find(
          (meeting) => meeting.title === 'Current Revision Review',
        );
        const pastA = seeded.meetings.find((meeting) => meeting.title === 'Client Kickoff');
        const pastB = seeded.meetings.find(
          (meeting) => meeting.title === 'Concept Lighting Review',
        );
        if (!featured || !pastA || !pastB) throw new Error('Golden Meeting graph was not created.');
        // Structured notes and links use the canonical Meeting operations; legacy text stays untouched.
        this.harness.store.operations.createMeetingNote(project.id, featured.id, {
          content: 'Client confirmed the REV02 review agenda and attendee list.',
          authorName: 'Sara Khalil',
        });
        this.harness.store.operations.createMeetingNote(project.id, featured.id, {
          content: 'Technical review pack will be circulated before the meeting.',
          authorName: 'Youssef Amin',
        });
        const pastANotes: Array<{ content: string; authorName: string }> = [
          { content: 'Scope confirmation recorded.', authorName: 'Sara Khalil' },
          { content: 'Programme milestones agreed.', authorName: 'Aisha Rahman' },
          { content: 'Detailed design authorised.', authorName: 'Omar Haddad' },
        ];
        for (const { content, authorName } of pastANotes)
          this.harness.store.operations.createMeetingNote(project.id, pastA.id, {
            content,
            authorName,
          });
        this.harness.store.operations.createMeetingNote(project.id, pastB.id, {
          content: 'Concept direction confirmed at review.',
          authorName: 'Lina Farouk',
        });
        const [
          createdAction,
          linkedAction,
          secondLinkedAction,
          pastAFirst,
          pastASecond,
          pastBAction,
        ] = seeded.actions;
        if (
          !createdAction ||
          !linkedAction ||
          !secondLinkedAction ||
          !pastAFirst ||
          !pastASecond ||
          !pastBAction
        )
          throw new Error('Golden Meeting links require the canonical action fixture.');
        this.harness.store.operations.linkMeetingAction(project.id, featured.id, {
          actionId: linkedAction.id,
          relationType: 'Linked',
        });
        this.harness.store.operations.linkMeetingAction(project.id, featured.id, {
          actionId: secondLinkedAction.id,
          relationType: 'Linked',
        });
        const createFromMeeting = (meetingId: string, source: typeof createdAction) =>
          this.harness.store.operations.createActionFromMeeting(project.id, meetingId, {
            title: source.title,
            details: source.details,
            owner: source.owner,
            ownerRole: source.ownerRole,
            dueDate: source.dueDate,
            status: source.status,
            priority: source.priority,
            revisionId: source.revisionId,
            categoryId: source.categoryId,
            notes: source.notes,
          });
        createFromMeeting(featured.id, createdAction);
        createFromMeeting(pastA.id, pastAFirst);
        createFromMeeting(pastA.id, pastASecond);
        createFromMeeting(pastB.id, pastBAction);
      });
    }
    operations.push({
      entity: 'meetings',
      description: `${meetingSeeds.length} meetings`,
      mutation: true,
    });

    // 8) Revisions (REV01 issued, REV02 current) — skip if already created.
    const revisions =
      workspaceBefore.revisions.length > 0
        ? workspaceBefore.revisions
        : this.createRevisions(project);
    operations.push({
      entity: 'revisions',
      description: `${revisions.length} revisions`,
      mutation: true,
    });

    // 9) Register documents + folder index (skip if already seeded).
    this.seedDocuments(project, assets);
    operations.push({
      entity: 'documents',
      description: 'Register documents + folder index',
      mutation: true,
    });

    // 10) Canonical authored Comments threads, replies, and registered-document links.
    await this.seedCommentThreads(project, contract, revisions);
    operations.push({
      entity: 'reviews',
      description: `${GOLDEN_COMMENT_REFERENCES.length} canonical comment threads`,
      mutation: true,
    });

    // 11) Workflow transitions + revision cycle (idempotent: transitions are unique).
    if (this.harness.store.listWorkflowTransitions(project.id).length === 0) {
      await this.recordWorkflow(project, contract);
    }
    operations.push({
      entity: 'workflow',
      description: 'Workflow transitions + revision cycle',
      mutation: true,
    });

    // 12) Closed work sessions (skip if already seeded).
    const sessions =
      this.harness.store.listWorkSessions(project.id).length > 0
        ? []
        : await this.seedWorkSessions(project, contract);
    operations.push({
      entity: 'workSessions',
      description: `${sessions.length} closed sessions`,
      mutation: true,
    });

    const manifest = this.buildManifest(contract, project);
    return { mode: 'APPLY', fixtureExisted: existing !== null, manifest, operations };
  }

  private createFixtureRoot(): string {
    const root = path.join(process.cwd(), 'data', 'golden-uat-fixture');
    mkdirSync(root, { recursive: true });
    return root;
  }

  private async createProject(contract: GoldenAnchorContract): Promise<Project> {
    const input: CreateProjectInput = {
      projectName: GOLDEN_UAT_PROJECT_NAME,
      clientName: FIXTURE_CLIENT,
      crmReference: GOLDEN_UAT_CRM_REFERENCE,
      commercialValueMinor: 12500000,
      commercialCurrency: 'AED',
      projectType: FIXTURE_PROJECT_TYPE,
      description: FIXTURE_DESCRIPTION,
      siteLocation: FIXTURE_SITE,
      designStage: 'DetailedDesign',
      lightingScope: FIXTURE_LIGHTING_SCOPE,
      luxRequirements: FIXTURE_LUX_REQUIREMENTS,
      drawingReference: FIXTURE_DRAWING_REFERENCE,
      priority: 'High',
      complexity: 'Large',
      estimatedHours: 240,
      requiredDeliveryDate: contract.normalDue,
      collaboratorDesignerIds: [],
      createFolders: false,
      services: [
        'LightingLayout',
        'DialuxCalculation',
        'LuminaireSchedule',
        'TechnicalBoq',
        'Datasheets',
      ],
      scopeItems: FIXTURE_SCOPE_ITEMS,
      luminaireInputMode: 'Manual',
      folderProfile: 'Full Lighting Design',
      idempotencyKey: GOLDEN_UAT_IDEMPOTENCY_KEY,
    };
    const result = await this.harness.service.createProject(this.harness.admin, input);
    // Initialize the canonical workspace (scope + deliverables + folder snapshot).
    this.harness.store.initializeProject(
      result.project.id,
      input.services ?? [],
      input.folderProfile ?? 'Full Lighting Design',
      input.luminaireInputMode ?? 'Manual',
      input.requiredDeliveryDate,
      undefined,
      undefined,
      input.scopeItems,
    );
    return result.project;
  }

  private luminaireInput(
    seed: LuminaireSeed,
    assets: ReturnType<typeof createGoldenUatAssets>,
  ): Parameters<GoldenUatHarness['store']['upsertLuminaire']>[1] {
    return {
      tag: seed.tag,
      category: seed.category,
      imagePath: seed.hasImage ? (assets.imagePaths[seed.tag] ?? '') : '',
      description: seed.notes,
      manufacturer: seed.manufacturer,
      model: seed.model,
      wattage: seed.wattage,
      lumens: seed.lumens,
      lightColor: seed.lightColor,
      cri: seed.cri,
      beamAngle: seed.beamAngle,
      ipRating: seed.ipRating,
      mounting: seed.mounting,
      cutout: seed.cutout,
      driver: seed.driver,
      control: seed.control,
      emergency: seed.emergency,
      datasheetPath: seed.hasDatasheet ? (assets.datasheetPaths[seed.tag] ?? '') : '',
      location: seed.location,
      unit: seed.unit,
      quantity: seed.quantity,
      notes: seed.notes,
      sourceName: 'Golden UAT Seeder',
      dimensions: seed.dimensions,
      bodyColorFinish: seed.bodyColorFinish,
    };
  }

  private actionSeeds(contract: GoldenAnchorContract): ProjectActionItemInput[] {
    return [
      {
        title: 'Update DIALux calculation for guest rooms',
        details: 'Re-run the guest room calculation with the confirmed 3000K luminaires.',
        owner: 'Sara Khalil',
        ownerRole: '',
        dueDate: contract.dueToday,
        status: 'InProgress',
        priority: 'High',
        sourceType: 'Manual',
        sourceId: null,
        revisionId: null,
        notes: '',
      },
      {
        title: 'Request missing DL02 datasheet',
        details: 'Request the DL02 datasheet from the manufacturer.',
        owner: 'Youssef Amin',
        ownerRole: '',
        dueDate: contract.dueSoon,
        status: 'Open',
        priority: 'Normal',
        sourceType: 'Manual',
        sourceId: null,
        revisionId: null,
        notes: '',
      },
      {
        title: 'Revise façade wall washer layout',
        details: 'Revise the WL01 façade layout per client feedback.',
        owner: 'Sara Khalil',
        ownerRole: '',
        dueDate: contract.overdue,
        status: 'Open',
        priority: 'Urgent',
        sourceType: 'Manual',
        sourceId: null,
        revisionId: null,
        notes: '',
      },
      {
        title: 'Prepare current revision package',
        details: 'Assemble the REV02 package for client review.',
        owner: 'Sara Khalil',
        ownerRole: '',
        dueDate: contract.normalDue,
        status: 'Open',
        priority: 'High',
        sourceType: 'Manual',
        sourceId: null,
        revisionId: null,
        notes: '',
      },
      {
        title: 'Confirm landscape CCT',
        details: 'Confirm the landscape bollard CCT with the client.',
        owner: 'Youssef Amin',
        ownerRole: '',
        dueDate: contract.overdue,
        status: 'Completed',
        priority: 'Normal',
        sourceType: 'Manual',
        sourceId: null,
        revisionId: null,
        notes: '',
      },
      {
        title: 'Emergency lighting coordination',
        details: 'Coordinate emergency lighting with the consultant.',
        owner: 'Sara Khalil',
        ownerRole: '',
        dueDate: contract.dueSoon,
        status: 'Open',
        priority: 'High',
        sourceType: 'Meeting',
        sourceId: null,
        revisionId: null,
        notes: '',
      },
      {
        title: 'Glare calculation for lobby',
        details: 'Complete the glare calculation for the lobby downlights.',
        owner: 'Sara Khalil',
        ownerRole: '',
        dueDate: contract.overdue,
        status: 'Completed',
        priority: 'Normal',
        sourceType: 'Manual',
        sourceId: null,
        revisionId: null,
        notes: '',
      },
      {
        title: 'Respond to client CCT feedback',
        details: 'Respond to the client feedback on guest room CCT.',
        owner: 'Youssef Amin',
        ownerRole: '',
        dueDate: contract.dueToday,
        status: 'Open',
        priority: 'Urgent',
        sourceType: 'Email',
        sourceId: null,
        revisionId: null,
        notes: '',
      },
    ];
  }

  /** Fixture-only server clock: deterministic, monotonic, and never client-authored. */
  private meetingClock(contract: GoldenAnchorContract): () => string {
    let tick = 0;
    const start = Date.parse(`${contract.pastMeetingKickoff}T04:00:00.000Z`);
    return () => new Date(start + tick++ * 60_000).toISOString();
  }

  private meetingSeeds(contract: GoldenAnchorContract): ProjectMeetingInput[] {
    return [
      {
        title: 'Client Kickoff',
        purpose: 'Confirm project scope, programme, and decision owners.',
        startAt: dateKeyAtUtc(contract.pastMeetingKickoff, 10),
        endAt: dateKeyAtUtc(contract.pastMeetingKickoff, 11),
        location: 'Client Office (UAT)',
        attendees: ['Aisha Rahman', 'Omar Haddad', 'Sara Khalil'],
        agenda: 'Project scope, schedule, and requirements.',
        notes: 'Kickoff held; scope confirmed.',
        decisions: 'Proceed with detailed design.',
        status: 'Held',
        onlineMeetingUrl: '',
        externalEventId: null,
        participants: [
          {
            id: '90000001-0000-4000-8000-000000000001',
            name: 'Aisha Rahman',
            role: 'Client',
            sortOrder: 0,
          },
          {
            id: '90000001-0000-4000-8000-000000000002',
            name: 'Omar Haddad',
            role: 'Client',
            sortOrder: 1,
          },
        ],
        agendaItems: [
          { id: '91000001-0000-4000-8000-000000000001', content: 'Confirm scope', sortOrder: 0 },
          {
            id: '91000001-0000-4000-8000-000000000002',
            content: 'Confirm programme',
            sortOrder: 1,
          },
        ],
      },
      {
        title: 'Concept Lighting Review',
        purpose: 'Agree the concept direction and colour-temperature strategy.',
        startAt: dateKeyAtUtc(contract.pastMeetingConcept, 14),
        endAt: dateKeyAtUtc(contract.pastMeetingConcept, 15),
        location: 'Video Call (UAT)',
        attendees: ['Aisha Rahman', 'Lina Farouk', 'Sara Khalil'],
        agenda: 'Review concept lighting approach.',
        notes: 'Concept reviewed.',
        decisions: 'Adopt 3000K in guest rooms.',
        status: 'Held',
        onlineMeetingUrl: '',
        externalEventId: null,
      },
      {
        title: 'Technical Coordination',
        purpose: 'Resolve technical coordination decisions before issue.',
        startAt: dateKeyAtUtc(contract.pastMeetingTechnical, 9),
        endAt: dateKeyAtUtc(contract.pastMeetingTechnical, 10),
        location: 'Site (UAT)',
        attendees: ['Karim Nasser', 'Sara Khalil', 'Youssef Amin'],
        agenda: 'Coordinate technical details with contractor.',
        notes: 'Coordination held.',
        decisions: 'Confirm emergency lighting standard.',
        status: 'Held',
        onlineMeetingUrl: '',
        externalEventId: null,
      },
      {
        title: 'Current Revision Review',
        purpose: 'Review the current REV02 package and confirm next actions.',
        startAt: dateKeyAtUtc(contract.upcomingMeeting, 11),
        endAt: dateKeyAtUtc(contract.upcomingMeeting, 12),
        location: 'Video Call (UAT)',
        attendees: ['Aisha Rahman', 'Lina Farouk', 'Sara Khalil'],
        agenda: 'Review REV02 package.',
        notes: '',
        decisions: '',
        status: 'Planned',
        onlineMeetingUrl: '',
        externalEventId: null,
        participants: [
          {
            id: '90000004-0000-4000-8000-000000000001',
            name: 'Aisha Rahman',
            role: 'Client Sponsor',
            sortOrder: 0,
          },
          {
            id: '90000004-0000-4000-8000-000000000002',
            name: 'Lina Farouk',
            role: 'Consultant',
            sortOrder: 1,
          },
          {
            id: '90000004-0000-4000-8000-000000000003',
            name: 'Sara Khalil',
            role: 'Lighting Designer',
            sortOrder: 2,
          },
          {
            id: '90000004-0000-4000-8000-000000000004',
            name: 'Youssef Amin',
            role: 'Technical Lead',
            sortOrder: 3,
          },
          {
            id: '90000004-0000-4000-8000-000000000005',
            name: 'Karim Nasser',
            role: 'Contractor',
            sortOrder: 4,
          },
          {
            id: '90000004-0000-4000-8000-000000000006',
            name: 'Omar Haddad',
            role: 'Client Representative',
            sortOrder: 5,
          },
        ],
        agendaItems: [
          {
            id: '91000004-0000-4000-8000-000000000001',
            content: 'Review REV02 package',
            sortOrder: 0,
          },
          {
            id: '91000004-0000-4000-8000-000000000002',
            content: 'Confirm client decisions',
            sortOrder: 1,
          },
          {
            id: '91000004-0000-4000-8000-000000000003',
            content: 'Coordinate technical actions',
            sortOrder: 2,
          },
          {
            id: '91000004-0000-4000-8000-000000000004',
            content: 'Agree next issue date',
            sortOrder: 3,
          },
        ],
      },
    ];
  }

  private async seedCommentThreads(
    project: Project,
    contract: GoldenAnchorContract,
    revisions: readonly ProjectRevision[],
  ): Promise<void> {
    const workspace = this.harness.store.getWorkspace(project.id);
    const revision = revisions.find((item) => item.revisionNumber === 2);
    const downlight = workspace.luminaires.find((item) => item.tag === 'DL01');
    const wallWasher = workspace.luminaires.find((item) => item.tag === 'WL01');
    if (!revision || !downlight || !wallWasher) {
      throw new Error('Golden Comments graph requires REV02, DL01, and WL01.');
    }
    const drawing = requireUniqueGoldenCommentsProjectDocument(
      workspace.documents,
      project.id,
      'L-101',
    );
    const minutes = requireUniqueGoldenCommentsProjectDocument(
      workspace.documents,
      project.id,
      'MM-01',
    );
    const actors = await this.ensureCommentActors(contract);
    buildGoldenCommentsGraph({
      projectId: project.id,
      contract,
      operations: this.harness.store.operations,
      readReviewItems: () => this.harness.store.getWorkspace(project.id).reviewItems,
      revision,
      downlight,
      wallWasher,
      drawing,
      minutes,
      actors,
    });
  }

  private async ensureCommentActors(
    contract: GoldenAnchorContract,
  ): Promise<{ sara: AppUser; youssef: AppUser }> {
    const seeds = Object.values(goldenCommentActorSeeds(contract));
    const users = await this.harness.provider.listUsers();
    const ensured: AppUser[] = [];
    for (const seed of seeds) {
      const byId = users.find((user) => user.id === seed.id);
      const byEmail = users.find((user) => user.email.toLowerCase() === seed.email.toLowerCase());
      if (byId && byId.email.toLowerCase() !== seed.email.toLowerCase()) {
        throw new Error(`Golden Comments AppUser collision for ${seed.id}.`);
      }
      if (byEmail && byEmail.id !== seed.id) {
        throw new Error(`Golden Comments AppUser email collision for ${seed.email}.`);
      }
      ensured.push(byId ?? (await this.harness.provider.createUser(seed)));
    }
    return { sara: ensured[0]!, youssef: ensured[1]! };
  }

  private createRevisions(project: Project): ProjectRevision[] {
    const workspace = this.harness.store.getWorkspace(project.id);
    const revisions: ProjectRevision[] = [];
    // REV01 — issued (historical).
    const rev01 = this.harness.canonicalGeneration.createRegisterOnlyRevision(
      project,
      workspace,
      this.harness.admin,
      {
        revisionNumber: 1,
        reissueNumber: 0,
        title: 'REV01 — Initial Issue',
        status: 'Issued',
        receivedAt: null,
        dueDate: null,
        issuedAt: null,
        summary: 'Initial lighting package issue.',
        changeLog: 'Initial issue.',
        sourceType: 'Manual',
        sourceReference: '',
      },
    );
    revisions.push(rev01);
    // REV02 — current (Draft/InProgress).
    const rev02 = this.harness.canonicalGeneration.createRegisterOnlyRevision(
      project,
      workspace,
      this.harness.admin,
      {
        revisionNumber: 2,
        reissueNumber: 0,
        title: 'REV02 — Current',
        status: 'InProgress',
        receivedAt: null,
        dueDate: null,
        issuedAt: null,
        summary: 'Current revision incorporating client feedback.',
        changeLog: 'Guest room CCT to 3000K.',
        sourceType: 'Manual',
        sourceReference: '',
      },
    );
    revisions.push(rev02);
    return revisions;
  }

  private async recordWorkflow(project: Project, contract: GoldenAnchorContract): Promise<void> {
    // Project is created in Planning. Drive the canonical workflow:
    // Planning -> InProgress -> ClientReview -> RevisionRequired -> InProgress.
    const transitions: Array<{ target: Project['status']; reason: string | null; at: string }> = [
      { target: 'InProgress', reason: null, at: dateKeyAtUtc(contract.pastMeetingKickoff, 12) },
      { target: 'ClientReview', reason: null, at: dateKeyAtUtc(contract.pastMeetingConcept, 16) },
      {
        target: 'RevisionRequired',
        reason: 'Client requested guest room CCT change to 3000K.',
        at: dateKeyAtUtc(contract.pastMeetingConcept, 17),
      },
      { target: 'InProgress', reason: null, at: dateKeyAtUtc(contract.pastMeetingTechnical, 11) },
    ];
    for (const transition of transitions) {
      await this.harness.service.changeStatus(this.harness.admin, project.id, {
        status: transition.target,
        reason: transition.reason ?? undefined,
        transitionId: randomUUID(),
      });
    }
  }

  private async seedWorkSessions(
    project: Project,
    contract: GoldenAnchorContract,
  ): Promise<Array<{ id: string; startedAt: string; endedAt: string }>> {
    const sessions: Array<{ id: string; startedAt: string; endedAt: string }> = [];
    const specs = [
      {
        start: dateKeyAtUtc(contract.pastMeetingKickoff, 9, 0),
        end: dateKeyAtUtc(contract.pastMeetingKickoff, 10, 24),
      },
      {
        start: dateKeyAtUtc(contract.pastMeetingConcept, 10, 0),
        end: dateKeyAtUtc(contract.pastMeetingConcept, 10, 48),
      },
      {
        start: dateKeyAtUtc(contract.pastMeetingTechnical, 8, 0),
        end: dateKeyAtUtc(contract.pastMeetingTechnical, 10, 11),
      },
    ];
    for (const spec of specs) {
      await this.harness.workSessionCoordinator.start({
        projectId: project.id,
        now: spec.start,
        idempotencyKey: randomUUID(),
      });
      const stopped = await this.harness.workSessionCoordinator.stop({
        now: spec.end,
        idempotencyKey: randomUUID(),
      });
      sessions.push({
        id: stopped.session.id,
        startedAt: stopped.session.startedAt,
        endedAt: stopped.session.endedAt!,
      });
    }
    return sessions;
  }

  private seedDocuments(project: Project, assets: ReturnType<typeof createGoldenUatAssets>): void {
    const existing = this.harness.store.getWorkspace(project.id).documents;
    const documents: ProjectDocumentInput[] = [
      {
        category: 'Drawing',
        documentNumber: 'L-101',
        title: 'Lighting Layout L-101',
        revision: 'REV_01',
        status: 'Working',
        filePath: assets.documentPaths['drawing'],
        issuedTo: 'Client',
        issueDate: null,
        notes: 'Fixture-owned drawing placeholder.',
      },
      {
        category: 'MeetingMinutes',
        documentNumber: 'MM-01',
        title: 'Kickoff Meeting Minutes',
        revision: 'REV_01',
        status: 'Working',
        filePath: assets.documentPaths['meetingMinutes'],
        issuedTo: 'Internal',
        issueDate: null,
        notes: 'Fixture-owned minutes placeholder.',
      },
    ];
    for (const document of documents) {
      const alreadyPresent = existing.some(
        (item) => item.documentNumber === document.documentNumber,
      );
      if (alreadyPresent) continue;
      this.harness.store.operations.createDocument(project.id, document);
    }
    // Folder index (fixture-owned files only).
    const items = Object.values(assets.datasheetPaths).map((filePath) => ({
      id: randomUUID(),
      projectId: project.id,
      category: 'Datasheets' as const,
      fileName: path.basename(filePath),
      relativePath: path.relative(assets.root, filePath),
      filePath,
      extension: path.extname(filePath),
      sizeBytes: existsSync(filePath) ? 1 : 0,
      modifiedAt: null,
      availability: 'Local' as const,
      confidence: 100,
      indexedAt: new Date().toISOString(),
    }));
    this.harness.store.replaceFolderIndex({
      projectId: project.id,
      folderPath: assets.root,
      indexedAt: new Date().toISOString(),
      fileCount: items.length,
      totalBytes: items.length,
      oneDriveManaged: false,
      truncated: false,
      counts: {
        Drawings: 0,
        Dialux: 0,
        Renderings: 0,
        Schedules: 0,
        TechnicalBoq: 0,
        Datasheets: items.length,
        MeetingMinutes: 0,
        Other: 0,
      },
      items,
    });
  }

  private buildPlanManifest(contract: GoldenAnchorContract): GoldenUatManifest {
    return {
      schema: 'golden-uat-manifest/v1',
      fixture: {
        marker: GOLDEN_UAT_FIXTURE_MARKER,
        scenario: GOLDEN_UAT_SCENARIO,
        projectId: '',
        projectCode: '',
        projectName: GOLDEN_UAT_PROJECT_NAME,
        anchorDate: contract.anchorDate,
      },
      expectedCounts: {
        luminaires: FIXTURE_LUMINAIRES.length,
        missingDatasheets: FIXTURE_LUMINAIRES.filter((item) => !item.hasDatasheet).length,
        missingImages: FIXTURE_LUMINAIRES.filter((item) => !item.hasImage).length,
        openActions: 10,
        // Only non-completed, non-cancelled actions with a due date before anchor count as overdue.
        overdueActions: 1,
        meetings: 4,
        commentsOrReviews: GOLDEN_COMMENT_REFERENCES.length,
        reviewReplies: GOLDEN_COMMENT_IDS.replies.length,
        reviewAttachments: GOLDEN_COMMENT_IDS.attachments.length,
        revisions: 2,
        packages: 0,
        workSessions: 3,
        requirements: FIXTURE_REQUIREMENTS.length,
        contacts: FIXTURE_CONTACTS.length,
        documents: 2,
      },
      health: { score: 0, blockingChecks: 0, warningChecks: 0, readyOrInfoChecks: 0, checks: [] },
      revisions: [],
      comments: { roots: [], replies: [], attachments: [] },
      timelineEvidence: [],
      workflow: { transitions: [], revisionCycles: [] },
      entityIds: {
        actions: [],
        meetings: [],
        reviews: [],
        reviewReplies: [],
        reviewAttachments: [],
        luminaires: [],
        revisions: [],
        packages: [],
        workSessions: [],
        requirements: [],
        contacts: [],
        documents: [],
      },
      activeWorkSessionAfterSeed: false,
      unsupportedCanonicalCapabilities: [
        'SUBMISSIONS: NOT_CANONICALLY_SEEDABLE_YET',
        'PHASE_2_V19_GRAPH: seeded by the additive golden:v19 upgrade after this historical baseline',
        'REGISTER: no canonical Register authority exists yet (future 04E gap)',
      ],
      timestampSources: buildTimestampSources('PLAN'),
    };
  }

  private buildManifest(
    contract: GoldenAnchorContract,
    project: Project | null,
  ): GoldenUatManifest {
    if (!project) {
      // PLAN mode with no existing fixture: emit intended counts.
      return {
        schema: 'golden-uat-manifest/v1',
        fixture: {
          marker: GOLDEN_UAT_FIXTURE_MARKER,
          scenario: GOLDEN_UAT_SCENARIO,
          projectId: '',
          projectCode: '',
          projectName: GOLDEN_UAT_PROJECT_NAME,
          anchorDate: contract.anchorDate,
        },
        expectedCounts: {
          luminaires: FIXTURE_LUMINAIRES.length,
          missingDatasheets: FIXTURE_LUMINAIRES.filter((item) => !item.hasDatasheet).length,
          missingImages: FIXTURE_LUMINAIRES.filter((item) => !item.hasImage).length,
          openActions: 10,
          // Only non-completed, non-cancelled actions with a due date before anchor count as overdue.
          overdueActions: 1,
          meetings: 4,
          commentsOrReviews: GOLDEN_COMMENT_REFERENCES.length,
          reviewReplies: GOLDEN_COMMENT_IDS.replies.length,
          reviewAttachments: GOLDEN_COMMENT_IDS.attachments.length,
          revisions: 2,
          packages: 0,
          workSessions: 3,
          requirements: FIXTURE_REQUIREMENTS.length,
          contacts: FIXTURE_CONTACTS.length,
          documents: 2,
        },
        health: { score: 0, blockingChecks: 0, warningChecks: 0, readyOrInfoChecks: 0, checks: [] },
        revisions: [],
        comments: { roots: [], replies: [], attachments: [] },
        timelineEvidence: [],
        workflow: { transitions: [], revisionCycles: [] },
        entityIds: {
          actions: [],
          meetings: [],
          reviews: [],
          reviewReplies: [],
          reviewAttachments: [],
          luminaires: [],
          revisions: [],
          packages: [],
          workSessions: [],
          requirements: [],
          contacts: [],
          documents: [],
        },
        activeWorkSessionAfterSeed: false,
        unsupportedCanonicalCapabilities: [
          'SUBMISSIONS: NOT_CANONICALLY_SEEDABLE_YET',
          'PHASE_2_V19_GRAPH: seeded by the additive golden:v19 upgrade after this historical baseline',
          'REGISTER: no canonical Register authority exists yet (future 04E gap)',
        ],
        timestampSources: buildTimestampSources('PLAN'),
      };
    }

    const workspace = this.harness.store.getWorkspace(project.id);
    const luminaires = workspace.luminaires;
    const missingDatasheets = luminaires.filter((item) => !item.datasheetPath).length;
    const missingImages = luminaires.filter((item) => !item.imagePath).length;
    const openActions = workspace.actions.filter(
      (item) => item.status !== 'Completed' && item.status !== 'Cancelled',
    ).length;
    const overdueActions = workspace.actions.filter(
      (item) =>
        item.dueDate !== null &&
        item.dueDate < contract.anchorDate &&
        item.status !== 'Completed' &&
        item.status !== 'Cancelled',
    ).length;
    const revisions = workspace.revisions;
    const workSessions = this.harness.store.listWorkSessions(project.id);
    const activeSession = this.harness.store.getActiveWorkSession();
    const transitions = this.harness.store.listWorkflowTransitions(project.id);
    const revisionCycles = this.harness.store.listRevisionCycles(project.id);
    const threadContext = this.harness.store.operations.listReviewThreadContext(project.id);

    const timelineEvidence = [
      ...transitions.map((transition, index) => ({
        source: 'Workflow',
        sourceId: transition.transitionId,
        sourceTimestampField: 'occurredAt',
        rawTimestampValue: transition.occurredAt,
        expectedOrder: index,
      })),
      ...revisions.map((revision, index) => ({
        source: 'Revision',
        sourceId: revision.id,
        sourceTimestampField: 'createdAt',
        rawTimestampValue: revision.createdAt,
        expectedOrder: index,
      })),
      ...revisions.map((revision, index) => ({
        source: 'Revision',
        sourceId: revision.id,
        sourceTimestampField: 'issuedAt',
        rawTimestampValue: revision.issuedAt ?? '',
        expectedOrder: index,
      })),
      ...workspace.meetings.map((meeting, index) => ({
        source: 'Meeting',
        sourceId: meeting.id,
        sourceTimestampField: 'startAt',
        rawTimestampValue: meeting.startAt,
        expectedOrder: index,
      })),
      ...workspace.actions.map((action, index) => ({
        source: 'Action',
        sourceId: action.id,
        sourceTimestampField: 'createdAt',
        rawTimestampValue: action.createdAt,
        expectedOrder: index,
      })),
    ];

    return {
      schema: 'golden-uat-manifest/v1',
      fixture: {
        marker: GOLDEN_UAT_FIXTURE_MARKER,
        scenario: GOLDEN_UAT_SCENARIO,
        projectId: project.id,
        projectCode: project.projectCode,
        projectName: project.projectName,
        anchorDate: contract.anchorDate,
      },
      expectedCounts: {
        luminaires: luminaires.length,
        missingDatasheets,
        missingImages,
        openActions,
        overdueActions,
        meetings: workspace.meetings.length,
        commentsOrReviews: workspace.reviewItems.length,
        reviewReplies: threadContext.replies.length,
        reviewAttachments: threadContext.attachments.length,
        revisions: revisions.length,
        packages: workspace.revisionPackages.length,
        workSessions: workSessions.length,
        requirements: workspace.requirements.length,
        contacts: workspace.contacts.length,
        documents: workspace.documents.length,
      },
      health: {
        score: workspace.health.score,
        blockingChecks: workspace.health.checks.filter(
          (check) => check.severity === 'Blocking' && !check.passed,
        ).length,
        warningChecks: workspace.health.checks.filter(
          (check) => check.severity === 'Warning' && !check.passed,
        ).length,
        readyOrInfoChecks: workspace.health.checks.filter((check) => check.passed).length,
        checks: workspace.health.checks.map((check) => ({
          key: check.key,
          label: check.label,
          severity: check.severity,
          passed: check.passed,
        })),
      },
      revisions: revisions.map((revision) => ({
        revisionId: revision.id,
        revisionNumber: revision.revisionNumber,
        status: revision.status,
        createdAtRaw: revision.createdAt,
        issuedAtRaw: revision.issuedAt,
      })),
      comments: {
        roots: workspace.reviewItems.map((item) => ({
          id: item.id,
          reference: item.reference,
          origin: item.origin,
          status: item.status,
          authorId: item.authorId,
          revisionId: item.revisionId,
          luminaireId: item.luminaireId,
          createdAt: item.createdAt,
        })),
        replies: threadContext.replies.map((item) => ({
          id: item.id,
          reviewItemId: item.reviewItemId,
          origin: item.origin,
          authorId: item.authorId,
          createdAt: item.createdAt,
        })),
        attachments: threadContext.attachments.map((item) => ({
          id: item.id,
          documentId: item.documentId,
          reviewItemId: item.reviewItemId,
          replyId: item.replyId,
          createdAt: item.createdAt,
        })),
      },
      timelineEvidence,
      workflow: {
        transitions: transitions.map((transition) => ({
          transitionId: transition.transitionId,
          fromStatus: transition.fromStatus,
          toStatus: transition.toStatus,
          occurredAt: transition.occurredAt,
          reason: transition.reason,
        })),
        revisionCycles: revisionCycles.map((cycle) => ({
          revisionCycleId: cycle.revisionCycleId,
          cycleNumber: cycle.cycleNumber,
          status: cycle.status,
          openedAt: cycle.openedAt,
          feedbackSummary: cycle.feedbackSummary,
        })),
      },
      entityIds: {
        actions: workspace.actions.map((item) => item.id),
        meetings: workspace.meetings.map((item) => item.id),
        reviews: workspace.reviewItems.map((item) => item.id),
        reviewReplies: threadContext.replies.map((item) => item.id),
        reviewAttachments: threadContext.attachments.map((item) => item.id),
        luminaires: luminaires.map((item) => item.id),
        revisions: revisions.map((item) => item.id),
        packages: workspace.revisionPackages.map((item) => item.id),
        workSessions: workSessions.map((item) => item.id),
        requirements: workspace.requirements.map((item) => item.id),
        contacts: workspace.contacts.map((item) => item.id),
        documents: workspace.documents.map((item) => item.id),
      },
      activeWorkSessionAfterSeed: activeSession !== null,
      unsupportedCanonicalCapabilities: [
        'SUBMISSIONS: NOT_CANONICALLY_SEEDABLE_YET',
        'PHASE_2_V19_GRAPH: seeded by the additive golden:v19 upgrade after this historical baseline',
        'REGISTER: no canonical Register authority exists yet (future 04E gap)',
      ],
      timestampSources: buildTimestampSources(
        'APPLY',
        this.buildObservedRawMap(project, workspace, revisions, workSessions, transitions),
      ),
    };
  }

  /**
   * Builds the observed raw timestamp map for APPLY read-back. observedPrecision is derived
   * from these actual persisted values (never from the schema). Sources without a single
   * representative raw value (e.g. Health.today) map to null so their observedPrecision is NULL.
   */
  private buildObservedRawMap(
    project: Project,
    workspace: WorkspaceWithScope,
    revisions: ProjectRevision[],
    workSessions: WorkSession[],
    transitions: WorkflowTransitionRecord[],
  ): ReadonlyMap<string, string | null> {
    const map = new Map<string, string | null>();
    map.set('Project.createdAt', project.createdAt);
    map.set('Workflow.occurredAt', transitions[0]?.occurredAt ?? null);
    map.set('Revision.createdAt', revisions[0]?.createdAt ?? null);
    // issuedAt is only populated on an issued revision (REV01); use the first revision that
    // actually carries a non-null issuedAt so observedPrecision reflects the real persisted value.
    map.set(
      'Revision.issuedAt',
      revisions.find((revision) => revision.issuedAt !== null)?.issuedAt ?? null,
    );
    map.set('Meeting.startAt/endAt', workspace.meetings[0]?.startAt ?? null);
    map.set('WorkSession.startedAt/endedAt', workSessions[0]?.startedAt ?? null);
    map.set('Action.createdAt', workspace.actions[0]?.createdAt ?? null);
    map.set('Luminaire.createdAt/updatedAt', workspace.luminaires[0]?.createdAt ?? null);
    map.set('Document.createdAt', workspace.documents[0]?.createdAt ?? null);
    map.set(
      'FolderIndex.indexedAt',
      this.harness.store.getFolderIndex(project.id)?.indexedAt ?? null,
    );
    map.set('Health.today', null);
    return map;
  }
}
