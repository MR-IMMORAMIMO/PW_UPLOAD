import { describe, expect, it } from 'vitest';
import {
  CURRENT_PROJECT_PREFIX,
  LEGACY_PROJECT_PREFIX,
  DomainError,
  builtInCodesFromScopeItems,
  calculateDesignerWorkload,
  calculateReportSummary,
  canAssignProject,
  canChangeProjectReference,
  canonicalizeLuminaireTag,
  canCreateProjectFor,
  canEditProjectCommercialValue,
  canEditProjectField,
  canPersonalTransition,
  canViewProject,
  classifyAvailability,
  customScopeId,
  dedupeScopeItems,
  duplicateLuminaireTagMessage,
  formatProjectCode,
  getAllowedPersonalTransitions,
  isTransitionAllowed,
  luminaireInputModeOptions,
  luminaireInputModes,
  normalizeScopeItemInputs,
  normalizeLuminaireTag,
  normalizeScopeLabel,
  parseScopeItems,
  replaceBuiltInScopeItems,
  sanitizeProjectName,
  scopeItemsFromServices,
  serializeScopeItems,
  validateProjectReferenceInput,
  assertValidWorkflowTransitionRecord,
  assertValidRevisionCycle,
  assertValidWorkSession,
  workSessionState,
  revisionCycleStatuses,
} from './index';
import type { AppUser, Project } from './types';
import type { RevisionCycle, RevisionCycleStatus, WorkflowTransitionRecord } from './types';

const now = '2026-08-01T00:00:00.000Z';

describe('Luminaire Input catalogue', () => {
  it('covers every canonical value exactly once with Settings terminology', () => {
    expect(luminaireInputModeOptions.map((option) => option.value).sort()).toEqual(
      [...luminaireInputModes].sort(),
    );
    expect(luminaireInputModeOptions.map((option) => option.label)).toEqual([
      'Ask per project',
      'Manual',
      'AutoCAD CSV',
      'DIALux CSV',
    ]);
  });
});
const makeUser = (id: string, role: AppUser['role'], capacity = 40): AppUser => ({
  id,
  entraObjectId: `entra-${id}`,
  displayName: `${role} ${id}`,
  email: `${id}@example.com`,
  jobTitle: role,
  department: role === 'Designer' ? 'Design' : 'Commercial',
  role,
  weeklyCapacityHours: capacity,
  availabilityStatus: 'Available',
  avatarUrl: null,
  isActive: true,
  createdAt: now,
  updatedAt: now,
});
const salesOne = makeUser('sales-1', 'Sales', 0);
const salesTwo = makeUser('sales-2', 'Sales', 0);
const designer = makeUser('designer-1', 'Designer');
const manager = makeUser('manager-1', 'LineManager', 0);
const admin = makeUser('admin-1', 'Admin', 0);
const makeProject = (overrides: Partial<Project> = {}): Project => ({
  id: 'project-1',
  projectCode: '001_SCLI260801_TEST',
  projectName: 'Test project',
  clientName: 'Client',
  projectType: 'Lighting Layout',
  description: 'Brief',
  salesOwnerId: salesOne.id,
  salesOwnerNameSnapshot: salesOne.displayName,
  salesOwnerEmailSnapshot: salesOne.email,
  createdById: salesOne.id,
  createdByNameSnapshot: salesOne.displayName,
  createdByEmailSnapshot: salesOne.email,
  assignedDesignerId: designer.id,
  assignedDesignerNameSnapshot: designer.displayName,
  collaboratorDesignerIds: [],
  collaboratorDesignerNameSnapshots: [],
  siteLocation: 'Dubai, UAE',
  designStage: 'DetailedDesign',
  lightingScope: 'Interior lighting',
  luxRequirements: '500 lux',
  drawingReference: 'A-101 Rev 2',
  status: 'InProgress',
  priority: 'Normal',
  complexity: 'Medium',
  estimatedHours: 20,
  actualHours: 8,
  progressPercent: 40,
  requiredDeliveryDate: '2026-08-10',
  projectFolderUrl: null,
  revisionNumber: 0,
  createdAt: '2026-07-20T00:00:00.000Z',
  updatedAt: now,
  completedAt: null,
  cancelledAt: null,
  version: 1,
  ...overrides,
});

describe('project code generation', () => {
  it('sanitizes unsafe separators and keeps the required format', () => {
    expect(sanitizeProjectName('  Gévi / Sharjah: Launch***  ')).toBe('GEVI_SHARJAH_LAUNCH');
    expect(formatProjectCode(20, new Date('2026-08-01T01:00:00.000Z'), 'Gévi / Sharjah')).toBe(
      '020_SCT260801_GEVI_SHARJAH',
    );
  });

  it('generates the canonical new-project SCT reference', () => {
    expect(
      formatProjectCode(
        23,
        new Date('2026-08-07T00:00:00.000Z'),
        'Dubai Hills Villa',
        'Asia/Dubai',
      ),
    ).toBe('023_SCT260807_DUBAI_HILLS_VILLA');
    expect(CURRENT_PROJECT_PREFIX).toBe('SCT');
    expect(LEGACY_PROJECT_PREFIX).toBe('SCLI');
  });

  it('rejects invalid sequence values and caps long names', () => {
    expect(() => formatProjectCode(0, new Date(), 'Project')).toThrow(RangeError);
    expect(formatProjectCode(1, new Date('2026-08-01T00:00:00Z'), 'x'.repeat(300)).length).toBe(80);
  });
});

describe('controlled project reference validation', () => {
  it('accepts canonical current-convention SCT references and returns uppercase form', () => {
    expect(validateProjectReferenceInput('019_SCT251204_GEVI_SHARJAH')).toBe(
      '019_SCT251204_GEVI_SHARJAH',
    );
    expect(validateProjectReferenceInput(' 019_SCT260807_DUBAI_HILLS_VILLA ')).toBe(
      '019_SCT260807_DUBAI_HILLS_VILLA',
    );
  });

  it('rejects traversal, separators, unsafe characters and legacy SCLI targets', () => {
    for (const invalid of [
      '../../OTHER',
      '019_SCT251204_GEVI/SHARJAH',
      '019_SCT251204_GEVI\\SHARJAH',
      '019_SCT251204_GEVI SHARJAH',
      '019_SCLI251204_GEVI_SHARJAH',
      '019_SCT251204_GEVI..SHARJAH',
      '19_SCT251204_GEVI_SHARJAH',
      '019_SCT999999_GEVI_SHARJAH',
      '019_SCT251304_GEVI_SHARJAH',
      '019_SCT251204_GEVI__SHARJAH',
      '019_SCT251204__GEVI_SHARJAH',
      '019_SCT251204_GEVI_SHARJAH_',
      '',
    ]) {
      expect(() => validateProjectReferenceInput(invalid)).toThrow(DomainError);
    }
  });

  it('grants reference changes to managers and the owning Sales user only', () => {
    const owned = makeProject();
    const unrelated = makeProject({
      id: 'project-2',
      salesOwnerId: salesTwo.id,
      assignedDesignerId: null,
    });
    expect(canChangeProjectReference(manager, owned)).toBe(true);
    expect(canChangeProjectReference(salesOne, owned)).toBe(true);
    expect(canChangeProjectReference(designer, owned)).toBe(false);
    expect(canChangeProjectReference(salesOne, unrelated)).toBe(false);
    expect(canChangeProjectReference(salesTwo, unrelated)).toBe(true);
  });
});

describe('workload calculations', () => {
  it('uses active hours, capacity, deadlines and explicit status', () => {
    const metrics = calculateDesignerWorkload(
      designer,
      [
        makeProject({ id: 'p1', estimatedHours: 20 }),
        makeProject({ id: 'p2', estimatedHours: 25, requiredDeliveryDate: '2026-07-30' }),
        makeProject({ id: 'p3', status: 'Completed', estimatedHours: 100 }),
      ],
      new Date('2026-08-01T00:00:00.000Z'),
    );
    expect(metrics.activeProjectCount).toBe(2);
    expect(metrics.activeEstimatedHours).toBe(45);
    expect(metrics.remainingCapacity).toBe(0);
    expect(metrics.classification).toBe('FullyLoaded');
    expect(metrics.activeProjects.every((project) => project.status !== 'Completed')).toBe(true);
  });

  it('classifies thresholds and honors an unavailable flag', () => {
    expect(classifyAvailability(50, 'Available')).toBe('Available');
    expect(classifyAvailability(20, 'Available')).toBe('Limited');
    expect(classifyAvailability(19, 'Available')).toBe('FullyLoaded');
    expect(classifyAvailability(100, 'Unavailable')).toBe('Unavailable');
  });
});

describe('status and authorization policies', () => {
  it('has explicit valid and invalid transitions', () => {
    expect(isTransitionAllowed('Assigned', 'InProgress')).toBe(true);
    expect(isTransitionAllowed('Unassigned', 'Completed')).toBe(false);
  });

  it('enforces role and record boundaries', () => {
    const owned = makeProject();
    const unrelated = makeProject({
      id: 'project-2',
      salesOwnerId: salesTwo.id,
      assignedDesignerId: null,
    });

    expect(canCreateProjectFor(salesOne, salesOne)).toBe(true);
    expect(canCreateProjectFor(salesOne, salesTwo)).toBe(false);
    expect(canViewProject(salesOne, owned)).toBe(true);
    expect(canViewProject(salesOne, unrelated)).toBe(false);
    expect(canAssignProject(designer)).toBe(false);
    expect(canAssignProject(manager)).toBe(true);
    expect(canEditProjectField(designer, owned, 'salesOwnerId')).toBe(false);
  });

  it('allows CRM Reference editing through the repository permission model', () => {
    const owned = makeProject();
    const unrelated = makeProject({
      id: 'project-2',
      salesOwnerId: salesTwo.id,
      assignedDesignerId: null,
    });
    expect(canEditProjectField(salesOne, owned, 'crmReference')).toBe(true);
    expect(canEditProjectField(designer, owned, 'crmReference')).toBe(true);
    expect(canEditProjectField(manager, owned, 'crmReference')).toBe(true);
    expect(canEditProjectField(designer, unrelated, 'crmReference')).toBe(false);
  });

  it('limits commercial value mutation to active managers, Admins, and the owning Sales user', () => {
    const owned = makeProject();
    const unrelated = makeProject({
      id: 'project-2',
      salesOwnerId: salesTwo.id,
      assignedDesignerId: null,
    });

    expect(canEditProjectCommercialValue(manager, owned)).toBe(true);
    expect(canEditProjectCommercialValue(admin, owned)).toBe(true);
    expect(canEditProjectCommercialValue(salesOne, owned)).toBe(true);
    expect(canEditProjectCommercialValue(salesOne, unrelated)).toBe(false);
    expect(canEditProjectCommercialValue(designer, owned)).toBe(false);
    expect(canEditProjectCommercialValue({ ...manager, isActive: false }, owned)).toBe(false);
    expect(canEditProjectCommercialValue({ ...salesOne, isActive: false }, owned)).toBe(false);
    expect(canEditProjectField(salesOne, owned, 'commercialValueMinor')).toBe(true);
    expect(canEditProjectField(designer, owned, 'commercialCurrency')).toBe(false);
  });

  it('enforces the controlled Personal workflow policy', () => {
    const planning = makeProject({ status: 'Planning' });
    const inProgress = makeProject({ status: 'InProgress' });
    const clientReview = makeProject({ status: 'ClientReview' });
    const revisionRequired = makeProject({ status: 'RevisionRequired' });

    expect(canPersonalTransition(planning, 'InProgress')).toBe(true);
    expect(canPersonalTransition(planning, 'Completed')).toBe(false);
    expect(canPersonalTransition(inProgress, 'ClientReview')).toBe(true);
    expect(canPersonalTransition(clientReview, 'RevisionRequired')).toBe(true);
    expect(canPersonalTransition(revisionRequired, 'InProgress')).toBe(true);
    expect(canPersonalTransition(clientReview, 'InProgress')).toBe(false);
    expect(canPersonalTransition(inProgress, 'OnHold')).toBe(true);
    expect(canPersonalTransition(clientReview, 'OnHold')).toBe(true);
    expect(canPersonalTransition(revisionRequired, 'OnHold')).toBe(true);
    expect(canPersonalTransition(inProgress, 'Completed')).toBe(true);
    expect(canPersonalTransition(inProgress, 'Cancelled')).toBe(true);
  });

  it('resolves OnHold resume from the recorded status with a safe legacy fallback', () => {
    const heldFromInProgress = makeProject({ status: 'OnHold', statusBeforeHold: 'InProgress' });
    const heldFromClientReview = makeProject({
      status: 'OnHold',
      statusBeforeHold: 'ClientReview',
    });
    const heldFromRevision = makeProject({
      status: 'OnHold',
      statusBeforeHold: 'RevisionRequired',
    });
    const legacyHold = makeProject({ status: 'OnHold', statusBeforeHold: null });

    expect(getAllowedPersonalTransitions(heldFromInProgress)).toContain('InProgress');
    expect(getAllowedPersonalTransitions(heldFromClientReview)).toContain('ClientReview');
    expect(getAllowedPersonalTransitions(heldFromRevision)).toContain('RevisionRequired');
    expect(getAllowedPersonalTransitions(legacyHold)).toContain('InProgress');
    expect(canPersonalTransition(heldFromInProgress, 'Completed')).toBe(false);
    expect(canPersonalTransition(heldFromInProgress, 'ClientReview')).toBe(false);
  });

  it('enforces the locked completion rules for Personal projects', () => {
    expect(canPersonalTransition(makeProject({ status: 'InProgress' }), 'Completed')).toBe(true);
    expect(canPersonalTransition(makeProject({ status: 'ClientReview' }), 'Completed')).toBe(true);
    expect(canPersonalTransition(makeProject({ status: 'Planning' }), 'Completed')).toBe(false);
    expect(canPersonalTransition(makeProject({ status: 'RevisionRequired' }), 'Completed')).toBe(
      false,
    );
    expect(canPersonalTransition(makeProject({ status: 'OnHold' }), 'Completed')).toBe(false);
  });

  it('allows explicit reopen from terminal states only to InProgress', () => {
    const completed = makeProject({ status: 'Completed' });
    const cancelled = makeProject({ status: 'Cancelled' });
    expect(canPersonalTransition(completed, 'InProgress')).toBe(true);
    expect(canPersonalTransition(cancelled, 'InProgress')).toBe(true);
    expect(canPersonalTransition(completed, 'ClientReview')).toBe(false);
    expect(canPersonalTransition(cancelled, 'Completed')).toBe(false);
  });
});

describe('report calculations', () => {
  it('aggregates the seeded portfolio consistently', () => {
    const projects = [
      makeProject(),
      makeProject({
        id: 'project-2',
        projectCode: '002_SCLI260801_DONE',
        salesOwnerId: salesTwo.id,
        salesOwnerNameSnapshot: salesTwo.displayName,
        status: 'Completed',
        revisionNumber: 2,
        estimatedHours: 10,
        actualHours: 12,
        completedAt: '2026-07-30T00:00:00.000Z',
      }),
      makeProject({ id: 'project-3', status: 'Cancelled', estimatedHours: 5 }),
    ];
    const report = calculateReportSummary(
      projects,
      [salesOne, salesTwo, designer, manager],
      new Date('2026-08-01T00:00:00.000Z'),
    );
    expect(report.totalProjects).toBe(3);
    expect(report.activeProjects).toBe(1);
    expect(report.projectsBySalesOwner.reduce((sum, item) => sum + item.value, 0)).toBe(3);
    expect(report.totalEstimatedHours).toBe(35);
    expect(report.revisionCounts[0]?.value).toBe(2);
  });
});

describe('flexible project scope', () => {
  it('normalizes labels and derives stable custom identities', () => {
    expect(normalizeScopeLabel('  Mockup   Review ')).toBe('mockup review');
    expect(customScopeId('Mockup Review')).toBe('custom:mockup-review');
    expect(customScopeId('Authority Submission')).toBe('custom:authority-submission');
    expect(customScopeId('!!!')).toBe('custom:item');
  });

  it('converts built-in services into canonical scope items', () => {
    const items = scopeItemsFromServices(['LightingDesign', 'TechnicalBoq']);
    expect(items).toEqual([
      { id: 'LightingDesign', code: 'LightingDesign', label: 'Lighting Design', custom: false },
      { id: 'TechnicalBoq', code: 'TechnicalBoq', label: 'Technical BOQ', custom: false },
    ]);
    expect(builtInCodesFromScopeItems(items)).toEqual(['LightingDesign', 'TechnicalBoq']);
  });

  it('parses legacy string arrays and preserves unknown entries as custom items', () => {
    const items = parseScopeItems(['LuminaireSchedule', 'TechnicalBoq', 'Authority Submission']);
    expect(items).toEqual([
      {
        id: 'LuminaireSchedule',
        code: 'LuminaireSchedule',
        label: 'Luminaire Schedule',
        custom: false,
      },
      { id: 'TechnicalBoq', code: 'TechnicalBoq', label: 'Technical BOQ', custom: false },
      {
        id: 'custom:authority-submission',
        code: null,
        label: 'Authority Submission',
        custom: true,
      },
    ]);
  });

  it('parses object scope entries and keeps unknown objects as custom items', () => {
    const items = parseScopeItems([
      { code: 'Datasheets', label: 'Datasheets Package', custom: false },
      { id: 'custom:mockup-review', label: 'Mockup Review', custom: true },
      { id: 'legacy:unknown', label: 'Legacy Item', custom: false },
    ]);
    expect(items.map((item) => item.id)).toEqual([
      'Datasheets',
      'custom:mockup-review',
      'legacy:unknown',
    ]);
    expect(items[2]).toMatchObject({ code: null, label: 'Legacy Item', custom: true });
  });

  it('round-trips scope items through serialization without dropping entries', () => {
    const items = parseScopeItems([
      { code: 'LightingDesign', label: 'Lighting Design', custom: false },
      { id: 'custom:mockup-review', label: 'Mockup Review', custom: true },
    ]);
    const roundTrip = parseScopeItems(serializeScopeItems(items));
    expect(roundTrip).toEqual(items);
  });

  it('deduplicates custom items by normalized label and built-ins by code', () => {
    const items = dedupeScopeItems([
      { id: 'custom:mockup-review', code: null, label: 'Mockup Review', custom: true },
      { id: 'custom:mockup-review-2', code: null, label: '  Mockup  Review ', custom: true },
      { id: 'LightingDesign', code: 'LightingDesign', label: 'Lighting Design', custom: false },
      { id: 'LightingDesign', code: 'LightingDesign', label: 'Lighting Design', custom: false },
    ]);
    expect(items).toHaveLength(2);
    expect(items.map((item) => item.id)).toEqual(['custom:mockup-review', 'LightingDesign']);
  });

  it('normalizes client scope input and rejects duplicate custom labels', () => {
    const items = normalizeScopeItemInputs([
      { code: 'LightingDesign' },
      { label: 'Mockup Review', custom: true },
      { label: 'mockup review', custom: true },
    ]);
    expect(items).toEqual([
      { id: 'LightingDesign', code: 'LightingDesign', label: 'Lighting Design', custom: false },
      { id: 'custom:mockup-review', code: null, label: 'Mockup Review', custom: true },
    ]);
  });

  it('replaces built-in services while preserving custom scope entries', () => {
    const current = parseScopeItems(['TechnicalBoq', 'Authority Submission']);
    const merged = replaceBuiltInScopeItems(current, ['LightingDesign', 'Datasheets']);
    expect(merged.map((item) => item.id)).toEqual([
      'LightingDesign',
      'Datasheets',
      'custom:authority-submission',
    ]);
  });
});

describe('luminaire Tag identity', () => {
  it('canonicalizes persisted and displayed Tags to trimmed uppercase', () => {
    expect(canonicalizeLuminaireTag(' dl01 ')).toBe('DL01');
    expect(canonicalizeLuminaireTag('Dl 01')).toBe('DL 01');
    expect(duplicateLuminaireTagMessage(' dL01 ')).toBe(
      'Type / Tag "DL01" already exists in this project.',
    );
  });

  it('normalizes only surrounding whitespace and casing for comparisons', () => {
    expect(normalizeLuminaireTag(' DL01 ')).toBe('dl01');
    expect(normalizeLuminaireTag('Dl 01')).toBe('dl 01');
  });
});

// ===========================================================================
// P2.6B1 — Workflow history + Revision Cycle domain lifecycle validation
// ===========================================================================

const PROJECT_UUID = 'aaaaaaaa-0000-4000-8000-000000000001';
const OTHER_UUID = 'bbbbbbbb-0000-4000-8000-000000000002';
const T1 = '11111111-0000-4000-8000-000000000001';
const T3 = '33333333-0000-4000-8000-000000000003';
const C1 = '44444444-0000-4000-8000-000000000004';

const validTransition: WorkflowTransitionRecord = {
  transitionId: T1,
  projectId: PROJECT_UUID,
  sequence: 1,
  fromStatus: 'Planning',
  toStatus: 'InProgress',
  occurredAt: '2026-08-01T08:00:00.000Z',
  actorId: null,
  reason: null,
  revisionCycleId: null,
};

const validCycle: RevisionCycle = {
  revisionCycleId: C1,
  projectId: PROJECT_UUID,
  cycleNumber: 1,
  status: 'Open',
  openedAt: '2026-08-01T08:30:00.000Z',
  openedByTransitionId: T3,
  feedbackSummary: 'Client requested lighting revisions.',
  workStartedAt: null,
  returnedToClientAt: null,
  cancelledAt: null,
};

describe('WorkflowTransitionRecord domain validation', () => {
  it('accepts a valid canonical row', () => {
    expect(() => assertValidWorkflowTransitionRecord(validTransition)).not.toThrow();
  });

  it('transitionId UUID is required', () => {
    expect(() =>
      assertValidWorkflowTransitionRecord({ ...validTransition, transitionId: 'not-a-uuid' }),
    ).toThrow('transitionId must be a UUID');
  });

  it('projectId UUID is required', () => {
    expect(() =>
      assertValidWorkflowTransitionRecord({ ...validTransition, projectId: 'proj-1' }),
    ).toThrow('projectId must be a UUID');
  });

  it('sequence must be a positive integer', () => {
    expect(() => assertValidWorkflowTransitionRecord({ ...validTransition, sequence: 0 })).toThrow(
      'sequence must be a positive integer',
    );
    expect(() =>
      assertValidWorkflowTransitionRecord({ ...validTransition, sequence: 1.5 }),
    ).toThrow('sequence must be a positive integer');
  });

  it('fromStatus must be a valid ProjectStatus', () => {
    expect(() =>
      assertValidWorkflowTransitionRecord({ ...validTransition, fromStatus: 'Nonsense' as never }),
    ).toThrow('fromStatus is not a valid project status');
  });

  it('toStatus must be a valid ProjectStatus', () => {
    expect(() =>
      assertValidWorkflowTransitionRecord({ ...validTransition, toStatus: 'Nonsense' as never }),
    ).toThrow('toStatus is not a valid project status');
  });

  it('rejects a no-op fromStatus === toStatus persisted record', () => {
    expect(() =>
      assertValidWorkflowTransitionRecord({
        ...validTransition,
        fromStatus: 'InProgress',
        toStatus: 'InProgress',
      }),
    ).toThrow('actual transition');
  });

  it('occurredAt must be a valid timestamp', () => {
    expect(() =>
      assertValidWorkflowTransitionRecord({ ...validTransition, occurredAt: 'not-a-date' }),
    ).toThrow('occurredAt must be a valid UTC ISO timestamp');
  });

  it('actorId is nullable', () => {
    expect(() =>
      assertValidWorkflowTransitionRecord({ ...validTransition, actorId: null }),
    ).not.toThrow();
    expect(() =>
      assertValidWorkflowTransitionRecord({ ...validTransition, actorId: 'not-a-uuid' }),
    ).toThrow('actorId must be a UUID');
  });

  it('reason is nullable', () => {
    expect(() =>
      assertValidWorkflowTransitionRecord({ ...validTransition, reason: null }),
    ).not.toThrow();
    expect(() =>
      assertValidWorkflowTransitionRecord({ ...validTransition, reason: 'Client changes' }),
    ).not.toThrow();
  });

  it('revisionCycleId is a nullable UUID', () => {
    expect(() =>
      assertValidWorkflowTransitionRecord({ ...validTransition, revisionCycleId: null }),
    ).not.toThrow();
    expect(() =>
      assertValidWorkflowTransitionRecord({ ...validTransition, revisionCycleId: C1 }),
    ).not.toThrow();
    expect(() =>
      assertValidWorkflowTransitionRecord({ ...validTransition, revisionCycleId: 'cycle-1' }),
    ).toThrow('revisionCycleId must be a UUID');
  });
});

describe('RevisionCycleStatus canonical statuses', () => {
  it('accepts exactly Open / ReturnedToClient / Cancelled', () => {
    expect(revisionCycleStatuses).toEqual(['Open', 'ReturnedToClient', 'Cancelled']);
    const shapeFor = (status: RevisionCycleStatus): RevisionCycle => {
      if (status === 'ReturnedToClient') {
        return {
          ...validCycle,
          status,
          workStartedAt: '2026-08-02T08:00:00.000Z',
          returnedToClientAt: '2026-08-03T08:00:00.000Z',
        };
      }
      if (status === 'Cancelled') {
        return { ...validCycle, status, cancelledAt: '2026-08-02T08:00:00.000Z' };
      }
      return { ...validCycle, status };
    };
    for (const status of revisionCycleStatuses) {
      expect(() => assertValidRevisionCycle(shapeFor(status as RevisionCycleStatus))).not.toThrow();
    }
  });

  it('rejects an invalid cycle status', () => {
    expect(() => assertValidRevisionCycle({ ...validCycle, status: 'Closed' as never })).toThrow(
      'Invalid revision cycle status',
    );
    expect(() => assertValidRevisionCycle({ ...validCycle, status: 'Abandoned' as never })).toThrow(
      'Invalid revision cycle status',
    );
  });
});

describe('RevisionCycle domain validation', () => {
  it('revisionCycleId must be a UUID', () => {
    expect(() => assertValidRevisionCycle({ ...validCycle, revisionCycleId: 'cycle-1' })).toThrow(
      'revisionCycleId must be a UUID',
    );
  });

  it('projectId must be a UUID', () => {
    expect(() => assertValidRevisionCycle({ ...validCycle, projectId: 'proj' })).toThrow(
      'projectId must be a UUID',
    );
  });

  it('cycleNumber must be a positive integer', () => {
    expect(() => assertValidRevisionCycle({ ...validCycle, cycleNumber: 0 })).toThrow(
      'cycleNumber must be a positive integer',
    );
  });

  it('openedByTransitionId must be a UUID', () => {
    expect(() => assertValidRevisionCycle({ ...validCycle, openedByTransitionId: 't3' })).toThrow(
      'openedByTransitionId must be a UUID',
    );
  });

  it('feedbackSummary must be meaningful non-empty text', () => {
    expect(() => assertValidRevisionCycle({ ...validCycle, feedbackSummary: '   ' })).toThrow(
      'feedbackSummary must be meaningful non-empty text',
    );
    expect(() => assertValidRevisionCycle({ ...validCycle, feedbackSummary: '' })).toThrow(
      'feedbackSummary must be meaningful non-empty text',
    );
  });

  it('accepts a valid Open lifecycle shape', () => {
    expect(() => assertValidRevisionCycle(validCycle)).not.toThrow();
  });

  it('rejects Open with returnedToClientAt set', () => {
    expect(() =>
      assertValidRevisionCycle({
        ...validCycle,
        status: 'Open',
        returnedToClientAt: '2026-08-02T08:00:00.000Z',
      }),
    ).toThrow('An Open cycle must not have returnedToClientAt set');
  });

  it('rejects Open with cancelledAt set', () => {
    expect(() =>
      assertValidRevisionCycle({
        ...validCycle,
        status: 'Open',
        cancelledAt: '2026-08-02T08:00:00.000Z',
      }),
    ).toThrow('An Open cycle must not have cancelledAt set');
  });

  it('ReturnedToClient requires workStartedAt', () => {
    expect(() =>
      assertValidRevisionCycle({
        ...validCycle,
        status: 'ReturnedToClient',
        workStartedAt: null,
        returnedToClientAt: '2026-08-03T08:00:00.000Z',
      }),
    ).toThrow('A ReturnedToClient cycle requires workStartedAt');
  });

  it('ReturnedToClient requires returnedToClientAt', () => {
    expect(() =>
      assertValidRevisionCycle({
        ...validCycle,
        status: 'ReturnedToClient',
        workStartedAt: '2026-08-02T08:00:00.000Z',
        returnedToClientAt: null,
      }),
    ).toThrow('A ReturnedToClient cycle requires returnedToClientAt');
  });

  it('rejects ReturnedToClient with cancelledAt set', () => {
    expect(() =>
      assertValidRevisionCycle({
        ...validCycle,
        status: 'ReturnedToClient',
        workStartedAt: '2026-08-02T08:00:00.000Z',
        returnedToClientAt: '2026-08-03T08:00:00.000Z',
        cancelledAt: '2026-08-03T09:00:00.000Z',
      }),
    ).toThrow('A ReturnedToClient cycle must not have cancelledAt set');
  });

  it('accepts a valid ReturnedToClient lifecycle shape', () => {
    expect(() =>
      assertValidRevisionCycle({
        ...validCycle,
        status: 'ReturnedToClient',
        workStartedAt: '2026-08-02T08:00:00.000Z',
        returnedToClientAt: '2026-08-03T08:00:00.000Z',
      }),
    ).not.toThrow();
  });

  it('Cancelled requires cancelledAt', () => {
    expect(() =>
      assertValidRevisionCycle({ ...validCycle, status: 'Cancelled', cancelledAt: null }),
    ).toThrow('A Cancelled cycle requires cancelledAt');
  });

  it('rejects Cancelled with returnedToClientAt set', () => {
    expect(() =>
      assertValidRevisionCycle({
        ...validCycle,
        status: 'Cancelled',
        cancelledAt: '2026-08-02T08:00:00.000Z',
        returnedToClientAt: '2026-08-01T09:00:00.000Z',
      }),
    ).toThrow('A Cancelled cycle must not have returnedToClientAt set');
  });

  it('accepts a valid Cancelled lifecycle shape with optional workStartedAt', () => {
    expect(() =>
      assertValidRevisionCycle({
        ...validCycle,
        status: 'Cancelled',
        workStartedAt: '2026-08-01T09:00:00.000Z',
        cancelledAt: '2026-08-02T08:00:00.000Z',
      }),
    ).not.toThrow();
  });

  it('rejects impossible temporal ordering (workStartedAt before openedAt)', () => {
    expect(() =>
      assertValidRevisionCycle({
        ...validCycle,
        status: 'ReturnedToClient',
        workStartedAt: '2026-08-01T08:00:00.000Z',
        returnedToClientAt: '2026-08-03T08:00:00.000Z',
      }),
    ).toThrow('workStartedAt is before openedAt');
  });

  it('rejects workStartedAt after returnedToClientAt for ReturnedToClient', () => {
    expect(() =>
      assertValidRevisionCycle({
        ...validCycle,
        status: 'ReturnedToClient',
        workStartedAt: '2026-08-05T08:00:00.000Z',
        returnedToClientAt: '2026-08-03T08:00:00.000Z',
      }),
    ).toThrow('workStartedAt is after returnedToClientAt');
  });

  it('rejects cancelledAt before openedAt for Cancelled', () => {
    expect(() =>
      assertValidRevisionCycle({
        ...validCycle,
        status: 'Cancelled',
        cancelledAt: '2026-07-01T08:00:00.000Z',
      }),
    ).toThrow('cancelledAt is before openedAt');
  });

  it('accepts valid cross-project independence', () => {
    expect(() =>
      assertValidWorkflowTransitionRecord({ ...validTransition, projectId: OTHER_UUID }),
    ).not.toThrow();
    expect(() => assertValidRevisionCycle({ ...validCycle, projectId: OTHER_UUID })).not.toThrow();
  });
});

// ===========================================================================
// P2.8A — WorkSession domain validation
// ===========================================================================

const validSession = {
  id: 'aaaaaaaa-0000-4000-8000-0000000000aa',
  projectId: PROJECT_UUID,
  startedAt: '2026-08-01T08:00:00.000Z',
  endedAt: null,
  pausedAt: null,
  accumulatedPausedMs: 0,
  createdAt: '2026-08-01T08:00:00.000Z',
};

describe('WorkSession domain validation', () => {
  it('accepts a valid active canonical row', () => {
    expect(() => assertValidWorkSession(validSession)).not.toThrow();
  });

  it('accepts a valid completed canonical row', () => {
    expect(() =>
      assertValidWorkSession({ ...validSession, endedAt: '2026-08-01T10:00:00.000Z' }),
    ).not.toThrow();
  });

  it('id UUID is required', () => {
    expect(() => assertValidWorkSession({ ...validSession, id: 'not-a-uuid' })).toThrow(
      'WorkSession id must be a UUID',
    );
  });

  it('projectId UUID is required', () => {
    expect(() => assertValidWorkSession({ ...validSession, projectId: 'proj-1' })).toThrow(
      'WorkSession projectId must be a UUID',
    );
  });

  it('startedAt must be a valid UTC ISO timestamp', () => {
    expect(() => assertValidWorkSession({ ...validSession, startedAt: 'not-a-date' })).toThrow(
      'startedAt must be a valid UTC ISO timestamp',
    );
  });

  it('endedAt must be a valid UTC ISO timestamp or null', () => {
    expect(() => assertValidWorkSession({ ...validSession, endedAt: 'not-a-date' })).toThrow(
      'endedAt must be a valid UTC ISO timestamp or null',
    );
  });

  it('endedAt before startedAt is rejected', () => {
    expect(() =>
      assertValidWorkSession({
        ...validSession,
        endedAt: '2026-08-01T07:00:00.000Z',
      }),
    ).toThrow('endedAt is before startedAt');
  });

  it('createdAt must be a valid UTC ISO timestamp', () => {
    expect(() => assertValidWorkSession({ ...validSession, createdAt: 'nope' })).toThrow(
      'createdAt must be a valid UTC ISO timestamp',
    );
  });

  it('accepts a valid cross-project session', () => {
    expect(() => assertValidWorkSession({ ...validSession, projectId: OTHER_UUID })).not.toThrow();
  });

  it('accepts a valid PAUSED canonical row', () => {
    expect(() =>
      assertValidWorkSession({ ...validSession, pausedAt: '2026-08-01T09:00:00.000Z' }),
    ).not.toThrow();
  });

  it('accepts accumulated paused time on an active session', () => {
    expect(() =>
      assertValidWorkSession({
        ...validSession,
        pausedAt: '2026-08-01T09:00:00.000Z',
        accumulatedPausedMs: 3_600_000,
      }),
    ).not.toThrow();
  });

  it('pausedAt must be a valid UTC ISO timestamp or null', () => {
    expect(() => assertValidWorkSession({ ...validSession, pausedAt: 'not-a-date' })).toThrow(
      'pausedAt must be a valid UTC ISO timestamp',
    );
  });

  it('pausedAt before startedAt is rejected', () => {
    expect(() =>
      assertValidWorkSession({ ...validSession, pausedAt: '2026-08-01T07:00:00.000Z' }),
    ).toThrow('pausedAt is before startedAt');
  });

  it('accumulatedPausedMs must be a finite non-negative integer', () => {
    expect(() => assertValidWorkSession({ ...validSession, accumulatedPausedMs: -1 })).toThrow(
      'accumulatedPausedMs must be a finite non-negative integer',
    );
    expect(() => assertValidWorkSession({ ...validSession, accumulatedPausedMs: 1.5 })).toThrow(
      'accumulatedPausedMs must be a finite non-negative integer',
    );
    expect(() =>
      assertValidWorkSession({ ...validSession, accumulatedPausedMs: Number.NaN }),
    ).toThrow('accumulatedPausedMs must be a finite non-negative integer');
  });

  it('a completed session cannot be paused', () => {
    expect(() =>
      assertValidWorkSession({
        ...validSession,
        endedAt: '2026-08-01T10:00:00.000Z',
        pausedAt: '2026-08-01T09:00:00.000Z',
      }),
    ).toThrow('A completed WorkSession cannot be paused');
  });

  it('workSessionState derives RUNNING / PAUSED / STOPPED canonically', () => {
    expect(workSessionState({ ...validSession })).toBe('RUNNING');
    expect(workSessionState({ ...validSession, pausedAt: '2026-08-01T09:00:00.000Z' })).toBe(
      'PAUSED',
    );
    expect(workSessionState({ ...validSession, endedAt: '2026-08-01T10:00:00.000Z' })).toBe(
      'STOPPED',
    );
    // STOPPED wins over any stale pausedAt.
    expect(
      workSessionState({
        ...validSession,
        endedAt: '2026-08-01T10:00:00.000Z',
        pausedAt: '2026-08-01T09:00:00.000Z',
      }),
    ).toBe('STOPPED');
  });
});
