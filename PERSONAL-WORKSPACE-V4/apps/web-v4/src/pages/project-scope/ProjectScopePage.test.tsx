/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { useNavigate, Route, Routes } from 'react-router-dom';
import { V4Router as ProductionRouter } from '../../router/V4Router';
import { ProjectScopeWorkspace } from './ProjectScopeWorkspace';
function V4Router() {
  return (
    <Routes>
      <Route path="/projects/:projectId/scope" element={<ProjectScopeWorkspace />} />
      <Route path="*" element={<ProductionRouter />} />
    </Routes>
  );
}

import { cleanupV4, renderV4, stubMatchMedia } from '../../test-utils/renderV4';

const project = {
  id: 'p1',
  projectCode: '001_SCT_TEST',
  projectName: 'Golden project',
  clientName: 'Client',
  projectType: 'Commercial',
  designStage: 'Technical',
  requiredDeliveryDate: '2026-09-01',
  status: 'InProgress',
  version: 3,
  salesOwnerNameSnapshot: 'Mohamed Ali',
  priority: 'High',
};
const workspace = {
  projectId: 'p1',
  folderPath: null,
  folderProfile: 'default',
  folderStructure: [],
  outputFolders: {},
  services: ['LightingDesign'],
  scopeItems: [
    { id: 'LightingDesign', code: 'LightingDesign', label: 'Lighting Design', custom: false },
    { id: 'custom:mockup-review', code: null, label: 'Mock-up review', custom: true },
    {
      id: 'LuminaireSchedule',
      code: 'LuminaireSchedule',
      label: 'Luminaire Schedule',
      custom: false,
    },
    { id: 'TechnicalBoq', code: 'TechnicalBoq', label: 'Technical BOQ', custom: false },
  ],
  deliverables: [
    {
      id: 'd1',
      projectId: 'p1',
      serviceCode: 'LightingDesign',
      title: 'Lighting Design Package',
      status: 'InProgress',
      progressPercent: 50,
      required: true,
      dueDate: null,
      sortOrder: 0,
      updatedAt: '2026-08-01T00:00:00.000Z',
    },
    {
      id: 'd2',
      projectId: 'p1',
      serviceCode: 'LuminaireSchedule',
      title: 'Luminaire Schedule',
      status: 'NotStarted',
      progressPercent: 0,
      required: true,
      dueDate: null,
      sortOrder: 1,
      updatedAt: '2026-08-01T00:00:00.000Z',
    },
    {
      id: 'd3',
      projectId: 'p1',
      serviceCode: 'TechnicalBoq',
      title: 'Technical BOQ',
      status: 'NotStarted',
      progressPercent: 0,
      required: true,
      dueDate: null,
      sortOrder: 2,
      updatedAt: '2026-08-01T00:00:00.000Z',
    },
    {
      id: 'd4',
      projectId: 'p1',
      serviceCode: 'LightingDesign',
      title: 'Issued Lighting Package',
      status: 'Completed',
      progressPercent: 100,
      required: false,
      dueDate: null,
      sortOrder: 3,
      updatedAt: '2026-08-01T00:00:00.000Z',
    },
  ],
  requirements: [
    {
      id: 'r1',
      title: 'Reflected ceiling plan',
      details: 'Latest coordinated drawing.',
      requestedFrom: 'Client',
      status: 'Requested',
    },
  ],
  tags: [],
  scopeNotes: [],
  lightingPackage: {},
  luminaires: [],
  exports: [],
  revisionPackages: [],
  checklist: [],
  actions: [],
  meetings: [],
  reviewItems: [],
  revisions: [],
  documents: [],
  fileCenter: [],
  contacts: [],
  communications: [],
  activity: [],
  health: {
    score: 0,
    checklistPercent: 0,
    openRequirements: 1,
    blockingRequirements: 0,
    overdueActions: 0,
    unresolvedReviews: 0,
    checks: [],
  },
  updatedAt: '2026-08-01T00:00:00.000Z',
};
function response(data: unknown, ok = true) {
  return {
    ok,
    status: ok ? 200 : 500,
    headers: { get: () => 'c1' },
    json: () => Promise.resolve({ data }),
  };
}
function stubApi(
  error = false,
  options: {
    workspaceData?: unknown;
    scopePatchWorkspace?: unknown;
    requirementPatchData?: unknown;
    requirementMutationError?: boolean;
    requirementDeleteError?: boolean;
    p2Workspace?: unknown;
  } = {},
) {
  const workspaceData = options.workspaceData ?? workspace;
  const scopePatchWorkspace = options.scopePatchWorkspace ?? workspaceData;
  const requirementPatchData = options.requirementPatchData ?? workspace.requirements[0];
  const requirementMutationError = options.requirementMutationError ?? false;
  const requirementDeleteError = options.requirementDeleteError ?? false;
  const p2Workspace = options.p2Workspace ?? workspaceData;
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string, options?: RequestInit) => {
      if (options?.method === 'PATCH' && url.includes('/requirements/'))
        return Promise.resolve(response(requirementPatchData, !requirementMutationError));
      if (options?.method === 'DELETE' && url.includes('/requirements/'))
        return Promise.resolve(response({ deleted: true }, !requirementDeleteError));
      if (options?.method === 'PATCH')
        return Promise.resolve(response({ workspace: scopePatchWorkspace }));
      const projectId = url.includes('/projects/p2/') ? 'p2' : 'p1';
      return Promise.resolve(
        response(
          url.endsWith('/workspace')
            ? projectId === 'p2'
              ? p2Workspace
              : workspaceData
            : { ...project, id: projectId },
          !error,
        ),
      );
    }),
  );
}

function ProjectSwitch() {
  const navigate = useNavigate();
  return (
    <button type="button" onClick={() => navigate('/projects/p2/scope')}>
      Switch project
    </button>
  );
}

describe('ProjectScopePage', () => {
  afterEach(cleanupV4);
  it('renders the locked truthful summary and balanced second-row cards', async () => {
    stubMatchMedia();
    stubApi();
    renderV4(<V4Router />, ['/projects/p1/scope']);
    await screen.findByText('Lighting Design Package');
    expect(screen.getByRole('heading', { name: 'Scope & Services' })).toBeInTheDocument();
    expect(screen.getByText('Mock-up review')).toBeInTheDocument();
    expect(screen.getByText('Latest coordinated drawing.')).toBeInTheDocument();
    expect(screen.getByText('Key Info')).toBeInTheDocument();
    expect(screen.getAllByText('Client').length).toBeGreaterThan(1);
    expect(screen.getByText('Mohamed Ali')).toBeInTheDocument();
    expect(screen.getByText('Priority')).toBeInTheDocument();
    expect(screen.getByText('High')).toBeInTheDocument();
    expect(screen.queryByText('Scope items')).not.toBeInTheDocument();
    expect(screen.queryByText('Required deliverables')).not.toBeInTheDocument();
    expect(screen.queryByText('Open requirements')).not.toBeInTheDocument();
    expect(screen.queryByText(/deliverables are currently recorded/i)).not.toBeInTheDocument();
    expect(screen.getByText('Tags')).toBeInTheDocument();
    expect(screen.queryByLabelText('Included in current scope')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Included in current deliverables')).not.toBeInTheDocument();
    expect(screen.getAllByText('Included')).toHaveLength(7);
    expect(
      screen.getAllByText('Included').every((pill) => pill.classList.contains('v4-status-pill')),
    ).toBe(true);
    expect(screen.getByText(/Status · In Progress/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Page 2 of 2/ })).not.toBeInTheDocument();
    const requirementsCard = screen
      .getByRole('heading', { name: 'Requirements' })
      .closest('section')!;
    const notesCard = screen
      .getByRole('heading', { name: 'Notes & Exclusions' })
      .closest('section')!;
    expect(requirementsCard.parentElement).toBe(notesCard.parentElement);
    expect(within(requirementsCard).getByText('Requested').parentElement).toHaveClass(
      'v4-row-trailing',
    );
    expect(
      within(requirementsCard).getByRole('button', { name: /Requirement actions:/ }).parentElement
        ?.parentElement,
    ).toHaveClass('v4-row-trailing');
    const deliverablesCard = screen
      .getByRole('heading', { name: 'Deliverables' })
      .closest('section')!;
    expect(
      within(deliverablesCard)
        .getAllByText('Included')
        .every((pill) => pill.parentElement?.classList.contains('v4-row-trailing')),
    ).toBe(true);
    expect(screen.getByText(/No notes or exclusions are recorded/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Edit Scope' })).toBeInTheDocument();
  });

  it('uses five visible rows for Scope and Deliverables while retaining bounded pagination', async () => {
    const denseWorkspace = {
      ...workspace,
      scopeItems: Array.from({ length: 6 }, (_, index) => ({
        id: `scope-${index + 1}`,
        code: null,
        label: `Scope item ${index + 1}`,
        custom: true,
      })),
      deliverables: Array.from({ length: 6 }, (_, index) => ({
        ...workspace.deliverables[0],
        id: `deliverable-${index + 1}`,
        title: `Deliverable ${index + 1}`,
      })),
    };
    stubMatchMedia();
    stubApi(false, { workspaceData: denseWorkspace });
    renderV4(<V4Router />, ['/projects/p1/scope']);
    await screen.findByText('Scope item 5');
    expect(screen.queryByText('Scope item 6')).not.toBeInTheDocument();
    expect(screen.getByText('Deliverable 5')).toBeInTheDocument();
    expect(screen.queryByText('Deliverable 6')).not.toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Page 2 of 2' })).toHaveLength(2);
  });

  it('creates a manual requirement through the existing canonical requirement route', async () => {
    stubMatchMedia();
    stubApi();
    renderV4(<V4Router />, ['/projects/p1/scope']);
    await screen.findByText('Lighting Design Package');
    fireEvent.click(screen.getByRole('button', { name: 'Add requirement' }));
    fireEvent.change(screen.getByLabelText('Requirement'), {
      target: { value: 'Latest layout plan' },
    });
    const requirementDialog = screen.getByRole('dialog', { name: 'Add project requirement' });
    fireEvent.click(within(requirementDialog).getByRole('button', { name: 'Add requirement' }));
    await waitFor(() => {
      const request = vi
        .mocked(fetch)
        .mock.calls.find(
          ([url, options]) =>
            String(url).endsWith('/api/projects/p1/requirements') && options?.method === 'POST',
        );
      expect(request).toBeDefined();
      expect(JSON.parse(String(request?.[1]?.body))).toMatchObject({
        category: 'Project information',
        title: 'Latest layout plan',
        sourceType: 'Manual',
      });
    });
  });

  it('marks a requirement as Not Required through the canonical project-scoped update route', async () => {
    const requirement = {
      id: 'r1',
      projectId: 'p1',
      category: 'Project information',
      title: 'Reflected ceiling plan',
      details: 'Latest coordinated drawing.',
      requestedFrom: 'Client',
      requestedAt: null,
      dueDate: null,
      status: 'Requested' as const,
      impact: 'Medium' as const,
      sourceType: 'Manual' as const,
      sourceReference: '',
      notes: '',
      sortOrder: 0,
      createdAt: '2026-08-01T00:00:00.000Z',
      updatedAt: '2026-08-01T00:00:00.000Z',
    };
    const updatedRequirement = { ...requirement, status: 'NotRequired' as const };
    stubMatchMedia();
    stubApi(false, {
      workspaceData: { ...workspace, requirements: [requirement] },
      requirementPatchData: updatedRequirement,
    });
    renderV4(<V4Router />, ['/projects/p1/scope']);
    await screen.findByText(requirement.title);
    fireEvent.click(
      screen.getByRole('button', { name: `Requirement actions: ${requirement.title}` }),
    );
    fireEvent.click(screen.getByRole('menuitem', { name: 'Mark as Not Required' }));
    await waitFor(() => {
      const request = vi
        .mocked(fetch)
        .mock.calls.find(
          ([url, options]) =>
            String(url).endsWith('/api/projects/p1/requirements/r1') && options?.method === 'PATCH',
        );
      expect(request).toBeDefined();
      expect(JSON.parse(String(request?.[1]?.body))).toMatchObject({
        status: 'NotRequired',
        title: requirement.title,
        sortOrder: 0,
      });
    });
    expect(await screen.findByText('Not Required')).toBeInTheDocument();
    expect(screen.getByText(requirement.title)).toBeInTheDocument();
    expect(
      screen.queryByRole('menuitem', { name: 'Mark as Not Required' }),
    ).not.toBeInTheDocument();
  });

  it('keeps a failed Not Required update on the confirmed requirement and prevents duplicate submission', async () => {
    const requirement = {
      id: 'r1',
      projectId: 'p1',
      category: 'Project information',
      title: 'Reflected ceiling plan',
      details: 'Latest coordinated drawing.',
      requestedFrom: 'Client',
      requestedAt: null,
      dueDate: null,
      status: 'Requested' as const,
      impact: 'Medium' as const,
      sourceType: 'Manual' as const,
      sourceReference: '',
      notes: '',
      sortOrder: 0,
      createdAt: '2026-08-01T00:00:00.000Z',
      updatedAt: '2026-08-01T00:00:00.000Z',
    };
    stubMatchMedia();
    stubApi(false, {
      workspaceData: { ...workspace, requirements: [requirement] },
      requirementMutationError: true,
    });
    renderV4(<V4Router />, ['/projects/p1/scope']);
    await screen.findByText(requirement.title);
    fireEvent.click(
      screen.getByRole('button', { name: `Requirement actions: ${requirement.title}` }),
    );
    const action = screen.getByRole('menuitem', { name: 'Mark as Not Required' });
    fireEvent.click(action);
    fireEvent.click(action);
    await waitFor(() => {
      expect(
        vi
          .mocked(fetch)
          .mock.calls.filter(
            ([url, options]) =>
              String(url).endsWith('/api/projects/p1/requirements/r1') &&
              options?.method === 'PATCH',
          ),
      ).toHaveLength(1);
      expect(screen.getByText('Requested')).toBeInTheDocument();
    });
  });

  it('requires server-confirmed permanent deletion and clamps Requirements from page two to page one', async () => {
    const requirements = Array.from({ length: 4 }, (_, index) => ({
      id: `r${index + 1}`,
      projectId: 'p1',
      category: 'Project information',
      title: `Requirement ${index + 1}`,
      details: '',
      requestedFrom: '',
      requestedAt: null,
      dueDate: null,
      status: 'Requested' as const,
      impact: 'Medium' as const,
      sourceType: 'Manual' as const,
      sourceReference: '',
      notes: '',
      sortOrder: index,
      createdAt: '2026-08-01T00:00:00.000Z',
      updatedAt: '2026-08-01T00:00:00.000Z',
    }));
    stubMatchMedia();
    stubApi(false, { workspaceData: { ...workspace, requirements } });
    renderV4(<V4Router />, ['/projects/p1/scope']);
    const card = (await screen.findByRole('heading', { name: 'Requirements' })).closest('section')!;
    fireEvent.click(within(card).getByRole('button', { name: 'Page 2 of 2' }));
    expect(within(card).getByText('Requirement 4')).toBeInTheDocument();
    fireEvent.click(
      within(card).getByRole('button', { name: 'Requirement actions: Requirement 4' }),
    );
    fireEvent.click(within(card).getByRole('menuitem', { name: 'Delete Permanently' }));
    expect(screen.getByRole('heading', { name: 'Delete requirement?' })).toBeInTheDocument();
    expect(within(card).getByText('Requirement 4')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Delete Permanently' }));
    await waitFor(() => {
      expect(within(card).getByText('Requirement 1')).toBeInTheDocument();
      expect(within(card).queryByText('Requirement 4')).toBeNull();
      expect(within(card).queryByRole('button', { name: 'Page 2 of 2' })).toBeNull();
    });
  });

  it('keeps a requirement visible when permanent deletion fails', async () => {
    const requirement = {
      id: 'r1',
      projectId: 'p1',
      category: 'Project information',
      title: 'Reflected ceiling plan',
      details: '',
      requestedFrom: '',
      requestedAt: null,
      dueDate: null,
      status: 'Requested' as const,
      impact: 'Medium' as const,
      sourceType: 'Manual' as const,
      sourceReference: '',
      notes: '',
      sortOrder: 0,
      createdAt: '2026-08-01T00:00:00.000Z',
      updatedAt: '2026-08-01T00:00:00.000Z',
    };
    stubMatchMedia();
    stubApi(false, {
      workspaceData: { ...workspace, requirements: [requirement] },
      requirementDeleteError: true,
    });
    renderV4(<V4Router />, ['/projects/p1/scope']);
    await screen.findByText(requirement.title);
    fireEvent.click(
      screen.getByRole('button', { name: `Requirement actions: ${requirement.title}` }),
    );
    fireEvent.click(screen.getByRole('menuitem', { name: 'Delete Permanently' }));
    fireEvent.click(screen.getByRole('button', { name: 'Delete Permanently' }));
    await waitFor(() => {
      expect(screen.getAllByText(requirement.title)).not.toHaveLength(0);
      expect(
        vi
          .mocked(fetch)
          .mock.calls.some(
            ([url, options]) =>
              String(url).endsWith('/api/projects/p1/requirements/r1') &&
              options?.method === 'DELETE',
          ),
      ).toBe(true);
    });
  });

  it('uses the canonical tag and scope-note routes from the approved Scope locations', async () => {
    stubMatchMedia();
    stubApi();
    renderV4(<V4Router />, ['/projects/p1/scope']);
    await screen.findByText('Lighting Design Package');
    fireEvent.click(screen.getByRole('button', { name: 'Add tag' }));
    fireEvent.change(screen.getByLabelText('Tag name'), {
      target: { value: ' Commercial   Interior ' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Use blue tag color' }));
    const tagDialog = screen.getByRole('dialog', { name: 'Add tag' });
    fireEvent.click(within(tagDialog).getByRole('button', { name: 'Add tag' }));
    await waitFor(() => {
      const request = vi
        .mocked(fetch)
        .mock.calls.find(
          ([url, options]) =>
            String(url).endsWith('/api/projects/p1/tags') && options?.method === 'POST',
        );
      expect(JSON.parse(String(request?.[1]?.body))).toEqual({
        label: 'Commercial   Interior',
        colorKey: 'blue',
      });
    });
    fireEvent.click(screen.getByRole('button', { name: 'Add note or exclusion' }));
    fireEvent.change(screen.getByLabelText('Text'), {
      target: { value: 'Landscape lighting is excluded.' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Add record' }));
    await waitFor(() => {
      const request = vi
        .mocked(fetch)
        .mock.calls.find(
          ([url, options]) =>
            String(url).endsWith('/api/projects/p1/scope-notes') && options?.method === 'POST',
        );
      expect(JSON.parse(String(request?.[1]?.body))).toMatchObject({
        type: 'Note',
        text: 'Landscape lighting is excluded.',
        sortOrder: 0,
      });
    });
  });

  it('keeps tag colors and note actions inside their compact edit interactions', async () => {
    const taggedWorkspace = {
      ...workspace,
      tags: [
        { id: 't1', label: 'Coordination', colorKey: 'teal' },
        { id: 't2', label: 'OFFICE', colorKey: 'purple' },
      ],
      scopeNotes: [
        {
          id: 'n1',
          projectId: 'p1',
          type: 'Note',
          text: 'Coordinate with the architect before issue.',
          sortOrder: 0,
          createdAt: '2026-08-01T00:00:00.000Z',
          updatedAt: '2026-08-01T00:00:00.000Z',
        },
      ],
    };
    stubMatchMedia();
    stubApi(false, { workspaceData: taggedWorkspace });
    renderV4(<V4Router />, ['/projects/p1/scope']);
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Manage Coordination' })).toBeInTheDocument();
    });
    expect(screen.getByRole('button', { name: 'Manage OFFICE' })).toHaveTextContent('OFFICE');
    expect(screen.queryByText('Color')).not.toBeInTheDocument();
    expect(screen.queryByText('Delete')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Manage Coordination' }));
    expect(screen.getByRole('button', { name: 'Use purple tag color' })).toBeInTheDocument();
    expect(screen.queryByRole('combobox', { name: 'Color' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Use purple tag color' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save color' }));
    await waitFor(() => {
      const request = vi
        .mocked(fetch)
        .mock.calls.find(
          ([url, options]) =>
            String(url).endsWith('/api/projects/p1/tags/t1') && options?.method === 'PATCH',
        );
      expect(JSON.parse(String(request?.[1]?.body))).toEqual({ colorKey: 'purple' });
    });

    fireEvent.click(
      screen.getByRole('button', {
        name: 'Edit note: Coordinate with the architect before issue.',
      }),
    );
    expect(screen.getByRole('button', { name: 'Delete note' })).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Text'), { target: { value: 'Updated scope note.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.getByRole('heading', { name: 'Discard note changes?' })).toBeInTheDocument();
  });

  it('uses the canonical scope PATCH with the project version and protects dirty edits', async () => {
    stubMatchMedia();
    stubApi();
    renderV4(<V4Router />, ['/projects/p1/scope']);
    await screen.findByText('Lighting Design Package');
    fireEvent.click(screen.getByRole('button', { name: 'Edit Scope' }));
    fireEvent.click(screen.getByLabelText('DIALux Calculation'));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.getByRole('heading', { name: 'Discard scope changes?' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Keep editing' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save scope' }));
    await waitFor(() => {
      const scopeRequest = vi
        .mocked(fetch)
        .mock.calls.find(
          ([url, options]) =>
            String(url).endsWith('/api/projects/p1/scope') && options?.method === 'PATCH',
        );
      expect(scopeRequest).toBeDefined();
      expect(JSON.parse(String(scopeRequest?.[1]?.body))).toMatchObject({ expectedVersion: 3 });
    });
  });

  it('clamps Scope to page one immediately when a successful edit shrinks its collection', async () => {
    const expandedWorkspace = {
      ...workspace,
      scopeItems: [
        ...workspace.scopeItems,
        { id: 'custom:lighting-control', code: null, label: 'Lighting control', custom: true },
        { id: 'custom:wayfinding', code: null, label: 'Wayfinding', custom: true },
      ],
    };
    const shrunkWorkspace = {
      ...expandedWorkspace,
      scopeItems: expandedWorkspace.scopeItems.filter((item) => item.id !== 'LuminaireSchedule'),
    };
    stubMatchMedia();
    stubApi(false, { workspaceData: expandedWorkspace, scopePatchWorkspace: shrunkWorkspace });
    renderV4(<V4Router />, ['/projects/p1/scope']);
    await screen.findByText('Lighting Design Package');
    const scopeCard = screen.getByRole('heading', { name: 'Project Scope' }).closest('section')!;
    fireEvent.click(within(scopeCard).getByRole('button', { name: 'Page 2 of 2' }));
    expect(scopeCard).toHaveTextContent('Wayfinding');
    fireEvent.click(screen.getByRole('button', { name: 'Edit Scope' }));
    fireEvent.click(
      within(screen.getByRole('dialog')).getByRole('checkbox', { name: 'Luminaire Schedule' }),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Save scope' }));
    await waitFor(() => {
      expect(scopeCard).toHaveTextContent('Lighting Design');
      expect(scopeCard).not.toHaveTextContent('No active scope items are recorded.');
      expect(scopeCard.querySelector('[aria-label="Page 2 of 2"]')).toBeNull();
    });
  });

  it('clamps every card immediately after cross-project navigation supplies smaller collections', async () => {
    const expandedWorkspace = {
      ...workspace,
      requirements: Array.from({ length: 4 }, (_, index) => ({
        ...workspace.requirements[0],
        id: `r${index + 1}`,
        title: `Requirement ${index + 1}`,
      })),
    };
    const p2Workspace = {
      ...expandedWorkspace,
      projectId: 'p2',
      scopeItems: expandedWorkspace.scopeItems.slice(0, 1),
      deliverables: expandedWorkspace.deliverables.slice(0, 1),
      requirements: [
        { ...expandedWorkspace.requirements[0], id: 'p2-r1', title: 'P2 requirement' },
      ],
    };
    stubMatchMedia();
    stubApi(false, { workspaceData: expandedWorkspace, p2Workspace });
    renderV4(
      <>
        <V4Router />
        <ProjectSwitch />
      </>,
      ['/projects/p1/scope'],
    );
    await screen.findByText('Requirement 1');
    for (const button of screen.getAllByRole('button', { name: 'Page 2 of 2' })) {
      fireEvent.click(button);
    }
    expect(screen.getByText('Requirement 4')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Switch project' }));
    expect(await screen.findByText('P2 requirement')).toBeInTheDocument();
    expect(screen.getByText('Lighting Design')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Page 2 of/ })).not.toBeInTheDocument();
  });

  it('renders a bounded error state', async () => {
    stubMatchMedia();
    stubApi(true);
    renderV4(<V4Router />, ['/projects/p1/scope']);
    expect(await screen.findByRole('alert')).toHaveTextContent('could not be loaded');
  });
});
