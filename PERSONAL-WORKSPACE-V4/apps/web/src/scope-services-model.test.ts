import { describe, expect, it } from 'vitest';
import type {
  Project,
  ProjectDeliverable,
  ProjectRequirement,
  ProjectScopeItem,
} from '@scli/domain';
import { scopeServicesView } from './scope-services-model';

const timestamp = '2026-08-01T08:00:00.000Z';

function makeProject(overrides: Partial<Project> = {}): Project {
  return {
    id: 'aaaaaaaa-0000-4000-8000-000000000001',
    projectCode: '036_SCLI260801_UI_TEST',
    projectName: 'UI Test Project',
    clientName: 'Acme',
    crmReference: null,
    projectType: 'Lighting Layout',
    description: 'Lighting component test',
    salesOwnerId: '11111111-1111-4111-8111-111111111111',
    salesOwnerNameSnapshot: 'Maya Hassan',
    salesOwnerEmailSnapshot: 'maya@scli.example',
    createdById: '11111111-1111-4111-8111-111111111111',
    createdByNameSnapshot: 'Maya Hassan',
    createdByEmailSnapshot: 'maya@scli.example',
    assignedDesignerId: null,
    assignedDesignerNameSnapshot: null,
    collaboratorDesignerIds: [],
    collaboratorDesignerNameSnapshots: [],
    siteLocation: 'Dubai, UAE',
    designStage: 'Concept',
    lightingScope: 'Interior lighting layout.',
    luxRequirements: '500 lux',
    drawingReference: 'A-101',
    status: 'Planning',
    priority: 'Normal',
    complexity: 'Medium',
    estimatedHours: 10,
    actualHours: 0,
    progressPercent: 0,
    requiredDeliveryDate: '2026-08-20',
    projectFolderUrl: null,
    revisionNumber: 0,
    createdAt: timestamp,
    updatedAt: timestamp,
    completedAt: null,
    cancelledAt: null,
    version: 1,
    ...overrides,
  };
}

function makeWorkspace(
  overrides: Partial<{
    scopeItems: ProjectScopeItem[];
    deliverables: ProjectDeliverable[];
    requirements: ProjectRequirement[];
  }> = {},
) {
  return {
    scopeItems: [],
    deliverables: [],
    requirements: [],
    ...overrides,
  };
}

function builtIn(code: string, label: string): ProjectScopeItem {
  return { id: code, code: code as ProjectScopeItem['code'], label, custom: false };
}

function custom(label: string): ProjectScopeItem {
  return {
    id: `custom:${label.toLowerCase().replace(/\s+/g, '-')}`,
    code: null,
    label,
    custom: true,
  };
}

function deliverable(
  id: string,
  title: string,
  sortOrder: number,
  overrides: Partial<ProjectDeliverable> = {},
): ProjectDeliverable {
  return {
    id,
    projectId: 'aaaaaaaa-0000-4000-8000-000000000001',
    serviceCode: 'LightingLayout',
    title,
    status: 'NotStarted',
    progressPercent: 0,
    required: true,
    dueDate: null,
    sortOrder,
    updatedAt: timestamp,
    ...overrides,
  };
}

function requirement(
  id: string,
  title: string,
  status: ProjectRequirement['status'],
): ProjectRequirement {
  return {
    id,
    projectId: 'aaaaaaaa-0000-4000-8000-000000000001',
    category: 'Design',
    title,
    details: '',
    requestedFrom: '',
    requestedAt: null,
    dueDate: null,
    status,
    impact: 'Medium',
    sourceType: 'Manual',
    sourceReference: '',
    notes: '',
    sortOrder: 0,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

describe('scopeServicesView', () => {
  it('separates built-in and custom services truthfully', () => {
    const project = makeProject();
    const workspace = makeWorkspace({
      scopeItems: [
        builtIn('LightingLayout', 'Lighting Layout'),
        custom('Façade mock-up coordination'),
        builtIn('Datasheets', 'Datasheets Package'),
      ],
    });
    const view = scopeServicesView(project, workspace);

    expect(view.builtInServices.map((s) => s.label)).toEqual([
      'Lighting Layout',
      'Datasheets Package',
    ]);
    expect(view.builtInServices.every((s) => s.custom === false)).toBe(true);
    expect(view.customServices.map((s) => s.label)).toEqual(['Façade mock-up coordination']);
    expect(view.customServices.every((s) => s.custom === true)).toBe(true);
    expect(view.hasScope).toBe(true);
  });

  it('reports an empty scope truthfully', () => {
    const view = scopeServicesView(makeProject(), makeWorkspace());
    expect(view.builtInServices).toEqual([]);
    expect(view.customServices).toEqual([]);
    expect(view.hasScope).toBe(false);
  });

  it('retains historical/custom unknown scope values as custom items', () => {
    const project = makeProject();
    const legacy = custom('Legacy Historical Item');
    const view = scopeServicesView(project, makeWorkspace({ scopeItems: [legacy] }));
    expect(view.customServices.map((s) => s.label)).toEqual(['Legacy Historical Item']);
    expect(view.hasScope).toBe(true);
  });

  it('represents deliverables from canonical data with stable ordering', () => {
    const project = makeProject();
    const workspace = makeWorkspace({
      deliverables: [deliverable('b', 'Technical BOQ', 2), deliverable('a', 'Lighting Layout', 0)],
    });
    const view = scopeServicesView(project, workspace);
    expect(view.deliverables.map((d) => d.title)).toEqual(['Lighting Layout', 'Technical BOQ']);
  });

  it('presents only current required deliverables and hides non-required records', () => {
    const project = makeProject();
    const workspace = makeWorkspace({
      deliverables: [
        deliverable('a', 'Lighting Layout', 0, { required: true }),
        deliverable('b', 'DIALux Calculation', 1, { required: false }),
        deliverable('c', 'Luminaire Schedule', 2, { required: true }),
        deliverable('d', 'Technical BOQ', 3, { required: false }),
      ],
    });
    const view = scopeServicesView(project, workspace);
    // Only required=true records are current deliverables.
    expect(view.deliverables.map((d) => d.title)).toEqual([
      'Lighting Layout',
      'Luminaire Schedule',
    ]);
    expect(view.deliverables.some((d) => d.title === 'DIALux Calculation')).toBe(false);
    expect(view.deliverables.some((d) => d.title === 'Technical BOQ')).toBe(false);
  });

  it('preserves status/progress/due data on current required deliverables', () => {
    const project = makeProject();
    const workspace = makeWorkspace({
      deliverables: [
        deliverable('a', 'Lighting Layout', 0, {
          required: true,
          status: 'InProgress',
          progressPercent: 50,
          dueDate: '2026-08-20',
        }),
        deliverable('b', 'Technical BOQ', 1, { required: false, status: 'Completed' }),
      ],
    });
    const view = scopeServicesView(project, workspace);
    expect(view.deliverables).toHaveLength(1);
    expect(view.deliverables[0]).toMatchObject({
      title: 'Lighting Layout',
      status: 'InProgress',
      progressPercent: 50,
      dueDate: '2026-08-20',
    });
  });

  it('returns an empty deliverables view when no canonical record is required', () => {
    const project = makeProject();
    const workspace = makeWorkspace({
      deliverables: [
        deliverable('b', 'Technical BOQ', 0, { required: false }),
        deliverable('c', 'Datasheets', 1, { required: false }),
      ],
    });
    const view = scopeServicesView(project, workspace);
    expect(view.deliverables).toEqual([]);
  });

  it('handles optional Project Brief fields, omitting absent ones', () => {
    const project = makeProject({
      crmReference: null,
      commercialValueMinor: null,
      commercialCurrency: null,
      drawingReference: '',
      estimatedHours: 10,
      lightingScope: '',
      luxRequirements: '',
    });
    const view = scopeServicesView(project, makeWorkspace());
    expect(view.scopeSummary.lightingScope).toBeNull();
    expect(view.scopeSummary.luxRequirements).toBeNull();
    expect(view.projectBrief.crmReference).toBeNull();
    expect(view.projectBrief.commercialValue).toBeNull();
    expect(view.projectBrief.drawingReference).toBeNull();
    expect(view.projectBrief.estimatedHours).toBe(10);
  });

  it('preserves the canonical commercial value pair and exposes it verbatim', () => {
    const project = makeProject({
      commercialValueMinor: 12500000,
      commercialCurrency: 'AED',
    });
    const view = scopeServicesView(project, makeWorkspace());
    expect(view.projectBrief.commercialValueMinor).toBe(12500000);
    expect(view.projectBrief.commercialCurrency).toBe('AED');
    expect(view.projectBrief.commercialValue).toBe('AED:12500000');
  });

  it('groups active and NotRequired requirements truthfully', () => {
    const project = makeProject();
    const workspace = makeWorkspace({
      requirements: [
        requirement('r1', 'Target lux values', 'Received'),
        requirement('r2', 'Lighting control programming', 'NotRequired'),
        requirement('r3', 'Emergency standard', 'Missing'),
      ],
    });
    const view = scopeServicesView(project, workspace);
    expect(view.requirements.active.map((r) => r.title)).toEqual([
      'Target lux values',
      'Emergency standard',
    ]);
    expect(view.requirements.exclusions.map((r) => r.title)).toEqual([
      'Lighting control programming',
    ]);
  });

  it('orders requirements by canonical sortOrder deterministically', () => {
    const project = makeProject();
    const workspace = makeWorkspace({
      requirements: [
        { ...requirement('a', 'Last', 'Missing'), sortOrder: 2 },
        { ...requirement('b', 'First', 'Missing'), sortOrder: 0 },
        { ...requirement('c', 'Second', 'Missing'), sortOrder: 1 },
      ],
    });
    const view = scopeServicesView(project, workspace);
    expect(view.requirements.active.map((r) => r.title)).toEqual(['First', 'Second', 'Last']);
  });

  it('does not fabricate an excluded state for absent built-in services', () => {
    const view = scopeServicesView(makeProject(), makeWorkspace());
    // Absence is simply "not selected": no excluded/status field is invented.
    for (const service of view.builtInServices) {
      expect(Object.prototype.hasOwnProperty.call(service, 'excluded')).toBe(false);
    }
    expect(view.hasScope).toBe(false);
  });
});
