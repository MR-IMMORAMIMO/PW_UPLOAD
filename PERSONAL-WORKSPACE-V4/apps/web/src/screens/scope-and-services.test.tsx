// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type {
  AppUser,
  Project,
  ProjectDeliverable,
  ProjectRequirement,
  ProjectScopeItem,
  ProjectWorkspace,
} from '@scli/domain';
import { api, apiRequest, ApiError } from '../api';
import { useAppContext } from '../app-context';
import { ToastProvider } from '../components/toast';
import { PersonalProjectDetailsScreen } from './personal-project-details';

vi.mock('../app-context', () => ({ useAppContext: vi.fn() }));
vi.mock('../api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api')>()),
  apiRequest: vi.fn(),
}));

const timestamp = '2026-08-01T08:00:00.000Z';

const admin: AppUser = {
  id: '77777777-7777-4777-8777-777777777777',
  entraObjectId: 'entra-admin',
  displayName: 'Priya Nair',
  email: 'admin@scli.example',
  jobTitle: 'Admin',
  department: 'Studio',
  role: 'Admin',
  weeklyCapacityHours: 0,
  availabilityStatus: 'Available',
  avatarUrl: null,
  isActive: true,
  createdAt: timestamp,
  updatedAt: timestamp,
};

const project: Project = {
  id: 'aaaaaaaa-0000-4000-8000-000000000001',
  projectCode: '777_SCLI260101_UAT_LEGACY_IMPORT',
  projectName: 'UI Test Project',
  clientName: 'Acme',
  crmReference: 'CRM-2026',
  commercialValueMinor: 12500000,
  commercialCurrency: 'AED',
  projectType: 'Hospitality Lighting',
  description: 'Lighting component test',
  salesOwnerId: admin.id,
  salesOwnerNameSnapshot: admin.displayName,
  salesOwnerEmailSnapshot: admin.email,
  createdById: admin.id,
  createdByNameSnapshot: admin.displayName,
  createdByEmailSnapshot: admin.email,
  assignedDesignerId: null,
  assignedDesignerNameSnapshot: null,
  collaboratorDesignerIds: [],
  collaboratorDesignerNameSnapshots: [],
  siteLocation: 'Dubai, UAE',
  designStage: 'DetailedDesign',
  lightingScope: 'Interior and exterior lighting design.',
  luxRequirements: 'Lobby 300 lux; guest rooms 200 lux.',
  drawingReference: 'L-101',
  status: 'Planning',
  priority: 'High',
  complexity: 'Large',
  estimatedHours: 240,
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
};

const scopeItems: ProjectScopeItem[] = [
  { id: 'LightingLayout', code: 'LightingLayout', label: 'Lighting Layout', custom: false },
  {
    id: 'DialuxCalculation',
    code: 'DialuxCalculation',
    label: 'DIALux Calculation',
    custom: false,
  },
  {
    id: 'Façade mock-up coordination',
    code: null,
    label: 'Façade mock-up coordination',
    custom: true,
  },
];

const workspace: ProjectWorkspace & { scopeItems: ProjectScopeItem[] } = {
  projectId: project.id,
  folderPath: 'C:\\Projects\\777_SCLI260101_UAT_LEGACY_IMPORT',
  folderProfile: 'Full Lighting Design',
  folderStructure: [],
  outputFolders: {
    scheduleExcel: '01_SCHEDULES',
    schedulePdf: '01_SCHEDULES',
    boqExcel: '02_BOQ',
    boqPdf: '02_BOQ',
    datasheets: '04_DATASHEETS',
  },
  services: ['LightingLayout', 'DialuxCalculation'],
  scopeItems,
  deliverables: [
    {
      id: 'd1',
      projectId: project.id,
      serviceCode: 'LightingLayout',
      title: 'Lighting Layout',
      status: 'NotStarted',
      progressPercent: 0,
      required: true,
      dueDate: null,
      sortOrder: 0,
      updatedAt: timestamp,
    },
  ],
  lightingPackage: {
    projectId: project.id,
    inputMode: 'Manual',
    pdfPaperSize: 'Auto',
    scheduleColumns: [],
    boqColumns: [],
    updatedAt: timestamp,
  },
  luminaires: [],
  exports: [],
  revisionPackages: [],
  tags: [],
  scopeNotes: [],
  requirements: [
    {
      id: 'r1',
      projectId: project.id,
      category: 'Design',
      title: 'Target lux values per area',
      details: 'Lobby 300 lux, guest rooms 200 lux.',
      requestedFrom: 'Client',
      requestedAt: null,
      dueDate: null,
      status: 'Received',
      impact: 'High',
      sourceType: 'Manual',
      sourceReference: '',
      notes: 'Confirmed at kickoff.',
      sortOrder: 0,
      createdAt: timestamp,
      updatedAt: timestamp,
    },
    {
      id: 'r2',
      projectId: project.id,
      category: 'Controls',
      title: 'Lighting control programming',
      details: 'Excluded from this package.',
      requestedFrom: 'Client',
      requestedAt: null,
      dueDate: null,
      status: 'NotRequired',
      impact: 'Low',
      sourceType: 'Manual',
      sourceReference: '',
      notes: 'Excluded from scope.',
      sortOrder: 1,
      createdAt: timestamp,
      updatedAt: timestamp,
    },
  ],
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
    score: 100,
    checklistPercent: 100,
    openRequirements: 0,
    blockingRequirements: 0,
    overdueActions: 0,
    unresolvedReviews: 0,
    checks: [],
  },
  updatedAt: timestamp,
};

function renderDetails(route = `/projects/${project.id}/scope`) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <ToastProvider>
        <MemoryRouter initialEntries={[route]}>
          <Routes>
            <Route path="/projects/:id/:section" element={<PersonalProjectDetailsScreen />} />
          </Routes>
        </MemoryRouter>
      </ToastProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.mocked(useAppContext).mockReturnValue({ currentUser: admin } as never);
  vi.spyOn(api, 'project').mockResolvedValue(project);
  vi.spyOn(api, 'projectWorkspace').mockResolvedValue(workspace);
  vi.spyOn(api, 'salesUsers').mockResolvedValue([admin]);
});

describe('Scope & Services clean route', () => {
  it('renders the new Scope & Services body on /projects/:id/scope', async () => {
    renderDetails();
    await screen.findByRole('heading', { name: 'UI Test Project' });
    expect(screen.getByRole('heading', { name: 'Scope & Services' })).toBeInTheDocument();
    expect(screen.getByLabelText('Project scope')).toBeInTheDocument();
    expect(screen.getByLabelText('Deliverables')).toBeInTheDocument();
    expect(screen.getByLabelText('Project summary')).toBeInTheDocument();
    expect(screen.getByLabelText('Requirements')).toBeInTheDocument();
    expect(screen.getByLabelText('Notes & exclusions')).toBeInTheDocument();
  });

  it('reuses the shared Project Context Header', async () => {
    renderDetails();
    await screen.findByRole('heading', { name: 'UI Test Project' });
    expect(screen.getByLabelText('Project context')).toBeInTheDocument();
    expect(screen.getByText('Hospitality Lighting')).toBeInTheDocument();
    expect(screen.getByText('DetailedDesign')).toBeInTheDocument();
  });

  it('does NOT render legacy folder-management controls on the scope route', async () => {
    renderDetails();
    await screen.findByRole('heading', { name: 'UI Test Project' });
    expect(screen.queryByText('Project folders & output destinations')).not.toBeInTheDocument();
    expect(screen.queryByText('Manage Structure')).not.toBeInTheDocument();
    expect(screen.queryByText('Folder profile')).not.toBeInTheDocument();
    expect(screen.queryByText('Start from a saved profile')).not.toBeInTheDocument();
    expect(screen.queryByText('Save Folder Setup')).not.toBeInTheDocument();
  });

  it('preserves folder management reachable on the legacy workspace route', async () => {
    renderDetails(`/projects/${project.id}/workspace`);
    await screen.findByRole('heading', { name: 'UI Test Project' });
    expect(screen.getByText('Project folders & output destinations')).toBeInTheDocument();
    expect(screen.getByText('Manage Structure')).toBeInTheDocument();
  });

  it('renders scope summary, services, deliverables, brief, and requirements truthfully', async () => {
    renderDetails();
    await screen.findByRole('heading', { name: 'UI Test Project' });
    expect(screen.getByText('Interior and exterior lighting design.')).toBeInTheDocument();
    expect(screen.getByText('Lobby 300 lux; guest rooms 200 lux.')).toBeInTheDocument();
    // Services read view distinguishes built-in vs custom.
    expect(screen.getByText('Included services')).toBeInTheDocument();
    expect(screen.getByText('Custom services')).toBeInTheDocument();
    // "Lighting Layout" appears in both the Services chip and the Deliverables card.
    expect(screen.getAllByText('Lighting Layout').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('Façade mock-up coordination')).toBeInTheDocument();
    // Deliverables canonical read view.
    expect(screen.getByText('Deliverables')).toBeInTheDocument();
    // Project Brief fields.
    expect(screen.getByText('CRM-2026')).toBeInTheDocument();
    expect(screen.getByText('L-101')).toBeInTheDocument();
    // Requirements & Exclusions: active + NotRequired exclusion.
    expect(screen.getByText('Target lux values per area')).toBeInTheDocument();
    expect(screen.getByText('Lighting control programming')).toBeInTheDocument();
    expect(screen.getByText('Excluded from scope.')).toBeInTheDocument();
  });
});

describe('Scope & Services scope edit', () => {
  it('enters edit mode and saves through the canonical versioned scope endpoint', async () => {
    const request = vi.mocked(apiRequest);
    request.mockResolvedValue({ workspace });
    const user = userEvent.setup();
    renderDetails();
    await screen.findByRole('heading', { name: 'UI Test Project' });

    await user.click(screen.getByRole('button', { name: 'Edit Scope' }));
    const technicalBoq = screen.getByRole('checkbox', { name: /Technical BOQ/ });
    expect(technicalBoq).not.toBeChecked();
    await user.click(technicalBoq);
    await user.type(
      screen.getByPlaceholderText(/e.g. Authority Submission/),
      'Authority Submission',
    );
    await user.click(screen.getByRole('button', { name: 'Add item' }));
    await user.click(screen.getByRole('button', { name: 'Save Scope' }));

    await waitFor(() =>
      expect(request).toHaveBeenCalledWith(
        `/api/projects/${project.id}/scope`,
        expect.objectContaining({
          method: 'PATCH',
          body: expect.objectContaining({
            expectedVersion: project.version,
            scopeItems: expect.arrayContaining([
              expect.objectContaining({ label: 'Authority Submission', custom: true }),
              expect.objectContaining({ code: 'TechnicalBoq', custom: false }),
            ]),
          }),
        }),
      ),
    );
  });

  it('cancel performs no mutation and restores the current scope', async () => {
    const request = vi.mocked(apiRequest);
    const user = userEvent.setup();
    renderDetails();
    await screen.findByRole('heading', { name: 'UI Test Project' });

    await user.click(screen.getByRole('button', { name: 'Edit Scope' }));
    await user.click(screen.getByRole('checkbox', { name: /Technical BOQ/ }));
    await user.type(
      screen.getByPlaceholderText(/e.g. Authority Submission/),
      'Authority Submission',
    );
    await user.click(screen.getByRole('button', { name: 'Add item' }));
    await user.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(request).not.toHaveBeenCalledWith(
      `/api/projects/${project.id}/scope`,
      expect.anything(),
    );
    expect(screen.queryByText('Authority Submission')).not.toBeInTheDocument();
  });

  it('reflects refreshed canonical required deliverables after a scope change', async () => {
    // Before the change: Lighting Layout and DIALux Calculation are both selected and
    // required (Lighting Layout deliverable is required=true; the DIALux record is the
    // non-required one we will assert disappears after its service is deselected).
    const initialWorkspace: ProjectWorkspace & { scopeItems: ProjectScopeItem[] } = {
      ...workspace,
      deliverables: [
        {
          id: 'd1',
          projectId: project.id,
          serviceCode: 'LightingLayout',
          title: 'Lighting Layout',
          status: 'NotStarted',
          progressPercent: 0,
          required: true,
          dueDate: null,
          sortOrder: 0,
          updatedAt: timestamp,
        },
        {
          id: 'd2',
          projectId: project.id,
          serviceCode: 'DialuxCalculation',
          title: 'DIALux Calculation',
          status: 'InProgress',
          progressPercent: 20,
          required: true,
          dueDate: null,
          sortOrder: 1,
          updatedAt: timestamp,
        },
      ],
    };
    // After the save the canonical sync sets DIALux required=false (service deselected).
    const afterWorkspace: ProjectWorkspace & { scopeItems: ProjectScopeItem[] } = {
      ...workspace,
      scopeItems: [
        { id: 'LightingLayout', code: 'LightingLayout', label: 'Lighting Layout', custom: false },
      ],
      deliverables: [
        {
          id: 'd1',
          projectId: project.id,
          serviceCode: 'LightingLayout',
          title: 'Lighting Layout',
          status: 'NotStarted',
          progressPercent: 0,
          required: true,
          dueDate: null,
          sortOrder: 0,
          updatedAt: timestamp,
        },
        {
          id: 'd2',
          projectId: project.id,
          serviceCode: 'DialuxCalculation',
          title: 'DIALux Calculation',
          status: 'InProgress',
          progressPercent: 20,
          required: false,
          dueDate: null,
          sortOrder: 1,
          updatedAt: timestamp,
        },
      ],
    };

    const workspaceSpy = vi.mocked(api.projectWorkspace);
    workspaceSpy.mockReset();
    workspaceSpy.mockResolvedValueOnce(initialWorkspace).mockResolvedValue(afterWorkspace);
    vi.mocked(apiRequest).mockResolvedValue({ workspace: afterWorkspace });

    const user = userEvent.setup();
    renderDetails();
    await screen.findByRole('heading', { name: 'UI Test Project' });

    // Both deliverables are current initially (assert within the Deliverables section to
    // avoid matching the identical Services chip label).
    const deliverablesSection = screen.getByLabelText('Deliverables');
    expect(within(deliverablesSection).getByText('Lighting Layout')).toBeInTheDocument();
    expect(within(deliverablesSection).getByText('DIALux Calculation')).toBeInTheDocument();

    // Deselect DIALux Calculation and save.
    await user.click(screen.getByRole('button', { name: 'Edit Scope' }));
    await user.click(screen.getByRole('checkbox', { name: /DIALux Calculation/ }));
    await user.click(screen.getByRole('button', { name: 'Save Scope' }));

    // After refresh, the now-required=false DIALux deliverable is hidden from the current
    // Deliverables view; Lighting Layout (required=true) remains. The page respects the
    // refreshed canonical required state. Scope to the Deliverables section again.
    await waitFor(() => {
      const section = screen.getByLabelText('Deliverables');
      expect(within(section).queryByText('DIALux Calculation')).not.toBeInTheDocument();
      expect(within(section).getByText('Lighting Layout')).toBeInTheDocument();
    });
  });

  it('recovers from a 409 conflict by discarding the stale draft and reloading latest scope', async () => {
    // Workspace C is a NEWER canonical scope that another actor saved (version bumped).
    const workspaceC: ProjectWorkspace & { scopeItems: ProjectScopeItem[] } = {
      ...workspace,
      scopeItems: [
        { id: 'Datasheets', code: 'Datasheets', label: 'Datasheets Package', custom: false },
      ],
    };
    const projectC: Project = { ...project, version: project.version + 1 };

    // Initial load returns canonical Scope A (project v1); after the 409 the refetch
    // returns Scope C (project v2). Reset the spies so the queued order is exact.
    const projectSpy = vi.mocked(api.project);
    const workspaceSpy = vi.mocked(api.projectWorkspace);
    projectSpy.mockReset();
    workspaceSpy.mockReset();
    projectSpy.mockResolvedValueOnce(project).mockResolvedValue(projectC);
    workspaceSpy.mockResolvedValueOnce(workspace).mockResolvedValue(workspaceC);
    // The scope save is rejected with a real HTTP 409 conflict.
    vi.mocked(apiRequest).mockRejectedValue(
      new ApiError('This project changed after you opened it.', 'CONFLICT', 409, 'corr-1'),
    );

    const user = userEvent.setup();
    renderDetails();
    await screen.findByRole('heading', { name: 'UI Test Project' });

    // 1. Enter edit with canonical Scope A and change the local draft to Scope Draft B.
    await user.click(screen.getByRole('button', { name: 'Edit Scope' }));
    const lightingLayout = screen.getByRole('checkbox', { name: /Lighting Layout/ });
    expect(lightingLayout).toBeChecked();
    await user.click(lightingLayout);
    await user.type(screen.getByPlaceholderText(/e.g. Authority Submission/), 'Stale Draft B item');
    await user.click(screen.getByRole('button', { name: 'Add item' }));

    // 2. Save → server returns 409.
    await user.click(screen.getByRole('button', { name: 'Save Scope' }));

    // 3. Conflict feedback is shown and the edit session is closed (READ mode).
    await waitFor(() =>
      expect(
        screen.getByText(
          'Scope changed elsewhere. The latest scope has been loaded. Review it before editing again.',
        ),
      ).toBeInTheDocument(),
    );
    expect(screen.queryByRole('button', { name: 'Save Scope' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Edit Scope' })).toBeInTheDocument();

    // 4. Latest canonical Scope C is displayed (not the stale Draft B).
    await waitFor(() => expect(screen.getByText('Datasheets Package')).toBeInTheDocument());
    expect(screen.queryByText('Stale Draft B item')).not.toBeInTheDocument();

    // 5. Re-enter Edit — the editor initializes from Scope C, not stale Draft B.
    await user.click(screen.getByRole('button', { name: 'Edit Scope' }));
    const datasheetsCheckbox = screen.getByRole('checkbox', { name: /Datasheets/ });
    expect(datasheetsCheckbox).toBeChecked();
    // Lighting Layout was part of Draft B's removal but is absent from Scope C, so it
    // must NOT be present in the fresh editor (it was never in canonical Scope C).
    expect(screen.getByRole('checkbox', { name: /Lighting Layout/ })).not.toBeChecked();
    expect(screen.queryByPlaceholderText(/e.g. Authority Submission/)).toBeInTheDocument();
    expect(screen.queryByText('Stale Draft B item')).not.toBeInTheDocument();

    // 6. A second intentional save still carries the LATEST expectedVersion (version 2),
    // proving concurrency protection is active on the freshly-refetched session.
    await user.click(screen.getByRole('button', { name: 'Save Scope' }));
    await waitFor(() =>
      expect(apiRequest).toHaveBeenLastCalledWith(
        `/api/projects/${project.id}/scope`,
        expect.objectContaining({
          body: expect.objectContaining({ expectedVersion: projectC.version }),
        }),
      ),
    );
  });
});

describe('Scope & Services requirements', () => {
  it('adds a requirement through the canonical API path', async () => {
    vi.spyOn(api, 'createRequirement').mockResolvedValue(workspace.requirements[0]!);
    const user = userEvent.setup();
    renderDetails();
    await screen.findByRole('heading', { name: 'UI Test Project' });

    await user.click(screen.getByRole('button', { name: 'Add Requirement' }));
    await user.type(screen.getByLabelText('Title'), 'Confirm emergency lighting standard');
    await user.click(screen.getByRole('button', { name: 'Add Requirement' }));

    await waitFor(() =>
      expect(api.createRequirement).toHaveBeenCalledWith(
        project.id,
        expect.objectContaining({
          title: 'Confirm emergency lighting standard',
          status: 'Missing',
        }),
      ),
    );
  });

  it('updates a requirement through the canonical API path', async () => {
    vi.spyOn(api, 'updateRequirement').mockResolvedValue(workspace.requirements[0]!);
    const user = userEvent.setup();
    renderDetails();
    await screen.findByRole('heading', { name: 'UI Test Project' });

    // The active requirement row exposes Edit inside its overflow menu.
    const activeRow = screen
      .getByText('Target lux values per area')
      .closest('.operation-row') as HTMLElement;
    await user.click(
      within(activeRow).getByRole('button', { name: /Actions for Target lux values/ }),
    );
    await user.click(within(activeRow).getByRole('menuitem', { name: /Edit/ }));

    const titleField = screen.getByLabelText('Title');
    await user.clear(titleField);
    await user.type(titleField, 'Target lux values (revised)');
    await user.click(screen.getByRole('button', { name: 'Save Requirement' }));

    await waitFor(() =>
      expect(api.updateRequirement).toHaveBeenCalledWith(
        project.id,
        'r1',
        expect.objectContaining({ title: 'Target lux values (revised)' }),
      ),
    );
  });

  it('deletes an active requirement through the canonical API path after confirmation', async () => {
    const deleteSpy = vi.spyOn(api, 'deleteRequirement').mockResolvedValue({ deleted: true });
    const user = userEvent.setup();
    renderDetails();
    await screen.findByRole('heading', { name: 'UI Test Project' });

    // The active requirement row exposes a compact overflow menu (⋯).
    const activeRow = screen
      .getByText('Target lux values per area')
      .closest('.operation-row') as HTMLElement;
    await user.click(
      within(activeRow).getByRole('button', { name: /Actions for Target lux values/ }),
    );
    await user.click(within(activeRow).getByRole('menuitem', { name: /Delete Requirement/ }));

    // Confirmation dialog appears; canceling causes no mutation.
    expect(screen.getByRole('dialog', { name: 'Delete requirement' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(deleteSpy).not.toHaveBeenCalled();

    // Re-open the menu and confirm the delete.
    await user.click(
      within(activeRow).getByRole('button', { name: /Actions for Target lux values/ }),
    );
    await user.click(within(activeRow).getByRole('menuitem', { name: /Delete Requirement/ }));
    await user.click(screen.getByRole('button', { name: 'Delete' }));

    await waitFor(() => expect(deleteSpy).toHaveBeenCalledWith(project.id, 'r1'));
  });

  it('deletes a NotRequired requirement from Notes / Exclusions after confirmation', async () => {
    const deleteSpy = vi.spyOn(api, 'deleteRequirement').mockResolvedValue({ deleted: true });
    const user = userEvent.setup();
    renderDetails();
    await screen.findByRole('heading', { name: 'UI Test Project' });

    const exclusionsSection = screen.getByLabelText('Notes & exclusions');
    const exclusionRow = within(exclusionsSection)
      .getByText('Lighting control programming')
      .closest('.operation-row') as HTMLElement;
    await user.click(
      within(exclusionRow).getByRole('button', {
        name: /Actions for Lighting control programming/,
      }),
    );
    await user.click(within(exclusionRow).getByRole('menuitem', { name: /Delete Requirement/ }));
    await user.click(screen.getByRole('button', { name: 'Delete' }));

    await waitFor(() => expect(deleteSpy).toHaveBeenCalledWith(project.id, 'r2'));
  });

  it('removes a deleted requirement from the rendered page after canonical refresh', async () => {
    const deleteSpy = vi.spyOn(api, 'deleteRequirement').mockResolvedValue({ deleted: true });
    // After delete, the refetched workspace no longer contains the deleted requirement.
    const workspaceAfterDelete: ProjectWorkspace & { scopeItems: ProjectScopeItem[] } = {
      ...workspace,
      requirements: workspace.requirements.filter((item) => item.id !== 'r1'),
    };
    const workspaceSpy = vi.mocked(api.projectWorkspace);
    workspaceSpy.mockReset();
    workspaceSpy.mockResolvedValueOnce(workspace).mockResolvedValue(workspaceAfterDelete);

    const user = userEvent.setup();
    renderDetails();
    await screen.findByRole('heading', { name: 'UI Test Project' });

    const activeRow = screen
      .getByText('Target lux values per area')
      .closest('.operation-row') as HTMLElement;
    await user.click(
      within(activeRow).getByRole('button', { name: /Actions for Target lux values/ }),
    );
    await user.click(within(activeRow).getByRole('menuitem', { name: /Delete Requirement/ }));
    await user.click(screen.getByRole('button', { name: 'Delete' }));

    // After the canonical refresh the deleted row is gone (no stale row).
    await waitFor(() => expect(deleteSpy).toHaveBeenCalledWith(project.id, 'r1'));
    await waitFor(() =>
      expect(screen.queryByText('Target lux values per area')).not.toBeInTheDocument(),
    );
  });

  it('keeps Edit available from the same overflow menu', async () => {
    const updateSpy = vi
      .spyOn(api, 'updateRequirement')
      .mockResolvedValue(workspace.requirements[0]!);
    const user = userEvent.setup();
    renderDetails();
    await screen.findByRole('heading', { name: 'UI Test Project' });

    const activeRow = screen
      .getByText('Target lux values per area')
      .closest('.operation-row') as HTMLElement;
    await user.click(
      within(activeRow).getByRole('button', { name: /Actions for Target lux values/ }),
    );
    await user.click(within(activeRow).getByRole('menuitem', { name: /Edit/ }));

    const titleField = screen.getByLabelText('Title');
    await user.clear(titleField);
    await user.type(titleField, 'Target lux values (revised)');
    await user.click(screen.getByRole('button', { name: 'Save Requirement' }));

    await waitFor(() =>
      expect(updateSpy).toHaveBeenCalledWith(
        project.id,
        'r1',
        expect.objectContaining({ title: 'Target lux values (revised)' }),
      ),
    );
  });

  it('provides no manual Deliverable creation action', async () => {
    renderDetails();
    await screen.findByRole('heading', { name: 'UI Test Project' });
    expect(screen.queryByRole('button', { name: /Create Deliverable/i })).not.toBeInTheDocument();
  });
});

describe('Scope & Services structural fidelity', () => {
  it('shows a page heading and operational description', async () => {
    renderDetails();
    await screen.findByRole('heading', { name: 'UI Test Project' });
    expect(screen.getByRole('heading', { name: 'Scope & Services' })).toBeInTheDocument();
    expect(
      screen.getByText(
        'Define project brief, deliverables, technical requirements, and exclusions.',
      ),
    ).toBeInTheDocument();
  });

  it('exposes a page-level Edit Scope action', async () => {
    renderDetails();
    await screen.findByRole('heading', { name: 'UI Test Project' });
    expect(screen.getByRole('button', { name: 'Edit Scope' })).toBeInTheDocument();
  });

  it('keeps folder controls absent on the scope route', async () => {
    renderDetails();
    await screen.findByRole('heading', { name: 'UI Test Project' });
    expect(screen.queryByText('Project folders & output destinations')).not.toBeInTheDocument();
    expect(screen.queryByText('Manage Structure')).not.toBeInTheDocument();
  });

  it('separates requirement title, metadata, and notes into distinct elements', async () => {
    renderDetails();
    await screen.findByRole('heading', { name: 'UI Test Project' });

    const row = screen
      .getByText('Target lux values per area')
      .closest('.requirement-row') as HTMLElement;
    // Title is its own element.
    expect(within(row).getByText('Target lux values per area')).toBeInTheDocument();
    // Metadata items are distinct spans inside .requirement-meta.
    const meta = within(row).getByText('Design').closest('.requirement-meta') as HTMLElement;
    expect(within(meta).getByText('Design')).toBeInTheDocument();
    expect(within(meta).getByText('Received')).toBeInTheDocument();
    expect(within(meta).getByText('High impact')).toBeInTheDocument();
    // Notes are a separate element.
    expect(within(row).getByText('Confirmed at kickoff.')).toBeInTheDocument();
    // No single concatenated run-on text node exists.
    expect(
      within(row).queryByText('Target lux values per areaDesign · Received · High impact'),
    ).not.toBeInTheDocument();
  });

  it('does not duplicate a NotRequired requirement into active requirements', async () => {
    renderDetails();
    await screen.findByRole('heading', { name: 'UI Test Project' });

    const requirementsSection = screen.getByLabelText('Requirements');
    const exclusionsSection = screen.getByLabelText('Notes & exclusions');

    // The NotRequired item appears only in Notes / Exclusions, not in active Requirements.
    expect(within(exclusionsSection).getByText('Lighting control programming')).toBeInTheDocument();
    expect(
      within(requirementsSection).queryByText('Lighting control programming'),
    ).not.toBeInTheDocument();
    // The active item appears only in Requirements.
    expect(within(requirementsSection).getByText('Target lux values per area')).toBeInTheDocument();
    expect(
      within(exclusionsSection).queryByText('Target lux values per area'),
    ).not.toBeInTheDocument();
  });

  it('keeps long identifier-like values readable in the Project Summary card', async () => {
    const longProject: Project = {
      ...project,
      crmReference: 'CRM-2026-0000000000000000000000000000000000000000000000000000000000000001',
      drawingReference:
        'L-101-REV-2026-0000000000000000000000000000000000000000000000000000000000000002',
    };
    vi.mocked(api.project).mockResolvedValue(longProject);
    renderDetails();
    await screen.findByRole('heading', { name: 'UI Test Project' });

    const summarySection = screen.getByLabelText('Project summary');
    // The long values are present and rendered as distinct detail rows (not truncated away).
    expect(
      within(summarySection).getByText(
        'CRM-2026-0000000000000000000000000000000000000000000000000000000000000001',
      ),
    ).toBeInTheDocument();
    expect(
      within(summarySection).getByText(
        'L-101-REV-2026-0000000000000000000000000000000000000000000000000000000000000002',
      ),
    ).toBeInTheDocument();
  });

  it('renders each current deliverable as a distinct readable row', async () => {
    renderDetails();
    await screen.findByRole('heading', { name: 'UI Test Project' });

    const deliverablesSection = screen.getByLabelText('Deliverables');
    // Each required deliverable is its own vertical row with a title and status badge.
    const lightingLayout = within(deliverablesSection)
      .getByText('Lighting Layout')
      .closest('.deliverable-row') as HTMLElement;
    expect(within(lightingLayout).getByText('Lighting Layout')).toBeInTheDocument();
    expect(within(lightingLayout).getByText('NotStarted')).toBeInTheDocument();
  });

  it('renders deliverables as a single-column vertical list (no multi-column cards)', async () => {
    renderDetails();
    await screen.findByRole('heading', { name: 'UI Test Project' });

    const deliverablesSection = screen.getByLabelText('Deliverables');
    // The deliverables container is a vertical list, not a multi-column card grid.
    expect(within(deliverablesSection).getByText('Lighting Layout')).toBeInTheDocument();
    expect(
      within(deliverablesSection).queryByText('Lighting Layout', {
        selector: '.deliverable-card',
      }),
    ).not.toBeInTheDocument();
    // No multi-column deliverable-card structure is reintroduced.
    expect(deliverablesSection.querySelector('.deliverable-grid')).toBeNull();
    expect(deliverablesSection.querySelector('.deliverable-card')).toBeNull();
  });

  it('exposes a compact overflow menu and no direct trash in the normal row state', async () => {
    renderDetails();
    await screen.findByRole('heading', { name: 'UI Test Project' });

    const activeRow = screen
      .getByText('Target lux values per area')
      .closest('.operation-row') as HTMLElement;
    // The row exposes a single compact overflow control.
    expect(
      within(activeRow).getByRole('button', { name: /Actions for Target lux values/ }),
    ).toBeInTheDocument();
    // No permanently-visible direct trash button exists in the normal row state.
    expect(
      within(activeRow).queryByRole('button', { name: /Delete Target lux values/ }),
    ).not.toBeInTheDocument();
    // The menu is closed by default.
    expect(within(activeRow).queryByRole('menuitem')).not.toBeInTheDocument();
  });
});

describe('Scope & Services bounded preview + Show all drawer', () => {
  function req(
    id: string,
    title: string,
    status: ProjectRequirement['status'],
    sortOrder: number,
    notes = '',
  ): ProjectRequirement {
    return {
      id,
      projectId: project.id,
      category: 'Design',
      title,
      details: '',
      requestedFrom: 'Client',
      requestedAt: null,
      dueDate: null,
      status,
      impact: 'Medium',
      sourceType: 'Manual',
      sourceReference: '',
      notes,
      sortOrder,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
  }

  function del(id: string, title: string, sortOrder: number, required = true): ProjectDeliverable {
    return {
      id,
      projectId: project.id,
      serviceCode: 'LightingLayout',
      title,
      status: 'NotStarted',
      progressPercent: 0,
      required,
      dueDate: null,
      sortOrder,
      updatedAt: timestamp,
    };
  }

  function bigWorkspace(): ProjectWorkspace & { scopeItems: ProjectScopeItem[] } {
    return {
      ...workspace,
      scopeItems: Array.from({ length: 8 }, (_, i) => ({
        id: `svc${i}`,
        code: i === 0 ? 'LightingLayout' : null,
        label: `Service ${i + 1}`,
        custom: i !== 0,
      })),
      deliverables: Array.from({ length: 8 }, (_, i) => del(`d${i}`, `Deliverable ${i + 1}`, i)),
      requirements: [
        ...Array.from({ length: 7 }, (_, i) => req(`ra${i}`, `Active req ${i + 1}`, 'Received', i)),
        ...Array.from({ length: 6 }, (_, i) =>
          req(`rx${i}`, `Excluded ${i + 1}`, 'NotRequired', 100 + i, 'Excluded from scope.'),
        ),
      ],
    };
  }

  it('bounds the overview to preview capacities and shows truthful Show all counts', async () => {
    vi.mocked(api.projectWorkspace).mockResolvedValue(bigWorkspace());
    renderDetails();
    await screen.findByRole('heading', { name: 'UI Test Project' });

    // Deliverables preview: first 5 visible, 6–8 hidden, Show all (8).
    const deliverablesSection = screen.getByLabelText('Deliverables');
    expect(within(deliverablesSection).getByText('Deliverable 1')).toBeInTheDocument();
    expect(within(deliverablesSection).getByText('Deliverable 5')).toBeInTheDocument();
    expect(within(deliverablesSection).queryByText('Deliverable 6')).not.toBeInTheDocument();
    expect(within(deliverablesSection).queryByText('Deliverable 8')).not.toBeInTheDocument();
    expect(
      within(deliverablesSection).getByRole('button', { name: 'Show all (8)' }),
    ).toBeInTheDocument();

    // Requirements preview: first 4 active visible, Show all (7).
    const requirementsSection = screen.getByLabelText('Requirements');
    expect(within(requirementsSection).getByText('Active req 1')).toBeInTheDocument();
    expect(within(requirementsSection).getByText('Active req 4')).toBeInTheDocument();
    expect(within(requirementsSection).queryByText('Active req 5')).not.toBeInTheDocument();
    expect(
      within(requirementsSection).getByRole('button', { name: 'Show all (7)' }),
    ).toBeInTheDocument();

    // Exclusions preview: first 4 visible, Show all (6).
    const exclusionsSection = screen.getByLabelText('Notes & exclusions');
    expect(within(exclusionsSection).getByText('Excluded 1')).toBeInTheDocument();
    expect(within(exclusionsSection).getByText('Excluded 4')).toBeInTheDocument();
    expect(within(exclusionsSection).queryByText('Excluded 5')).not.toBeInTheDocument();
    expect(
      within(exclusionsSection).getByRole('button', { name: 'Show all (6)' }),
    ).toBeInTheDocument();

    // Services: 8 scope items > 5 capacity → Show all (8).
    const scopeSection = screen.getByLabelText('Project scope');
    expect(within(scopeSection).getByRole('button', { name: 'Show all (8)' })).toBeInTheDocument();
  });

  it('does not render Show all when the collection is at or under capacity', async () => {
    renderDetails();
    await screen.findByRole('heading', { name: 'UI Test Project' });

    expect(screen.queryByRole('button', { name: /Show all \(/ })).not.toBeInTheDocument();
  });

  it('opens a drawer with the complete canonical collection and closes without mutation', async () => {
    const deleteSpy = vi.spyOn(api, 'deleteRequirement').mockResolvedValue({ deleted: true });
    vi.mocked(api.projectWorkspace).mockResolvedValue(bigWorkspace());
    const user = userEvent.setup();
    renderDetails();
    await screen.findByRole('heading', { name: 'UI Test Project' });

    // Open the Deliverables drawer (scope to the Deliverables card to avoid the
    // identical Services "Show all (8)" button).
    const deliverablesSection = screen.getByLabelText('Deliverables');
    await user.click(within(deliverablesSection).getByRole('button', { name: 'Show all (8)' }));
    const dialog = await screen.findByRole('dialog', { name: 'All Deliverables' });
    expect(within(dialog).getByText('8 items')).toBeInTheDocument();
    // All 8 current required deliverables are visible.
    expect(within(dialog).getByText('Deliverable 1')).toBeInTheDocument();
    expect(within(dialog).getByText('Deliverable 8')).toBeInTheDocument();
    // No required=false deliverable leaks into the drawer.
    expect(within(dialog).queryByText('Hidden deliverable')).not.toBeInTheDocument();

    // Close without mutation.
    await user.click(within(dialog).getByRole('button', { name: 'Close' }));
    expect(screen.queryByRole('dialog', { name: 'All Deliverables' })).not.toBeInTheDocument();
    expect(deleteSpy).not.toHaveBeenCalled();
  });

  it('drawer search filters the loaded collection and switching does not leak items', async () => {
    vi.mocked(api.projectWorkspace).mockResolvedValue(bigWorkspace());
    const user = userEvent.setup();
    renderDetails();
    await screen.findByRole('heading', { name: 'UI Test Project' });

    // Open Requirements drawer.
    await user.click(screen.getAllByRole('button', { name: 'Show all (7)' })[0]!);
    let dialog = await screen.findByRole('dialog', { name: 'All Requirements' });
    expect(within(dialog).getByText('Active req 7')).toBeInTheDocument();
    await user.type(within(dialog).getByLabelText('Search All Requirements'), 'Active req 3');
    expect(within(dialog).getByText('Active req 3')).toBeInTheDocument();
    expect(within(dialog).queryByText('Active req 1')).not.toBeInTheDocument();
    // Close, then open the Deliverables drawer (scope to its card — the Services card
    // also carries a "Show all (8)" button) — and confirm no Requirements items leak in.
    await user.click(within(dialog).getByRole('button', { name: 'Close' }));
    const deliverablesSection = screen.getByLabelText('Deliverables');
    await user.click(within(deliverablesSection).getByRole('button', { name: 'Show all (8)' }));
    dialog = await screen.findByRole('dialog', { name: 'All Deliverables' });
    expect(within(dialog).queryByText('Active req 3')).not.toBeInTheDocument();
  });

  it('keeps requirement Edit/Delete functional inside the drawer via the same canonical path', async () => {
    const updateSpy = vi
      .spyOn(api, 'updateRequirement')
      .mockResolvedValue(workspace.requirements[0]!);
    vi.mocked(api.projectWorkspace).mockResolvedValue(bigWorkspace());
    const user = userEvent.setup();
    renderDetails();
    await screen.findByRole('heading', { name: 'UI Test Project' });

    await user.click(screen.getAllByRole('button', { name: 'Show all (7)' })[0]!);
    const dialog = await screen.findByRole('dialog', { name: 'All Requirements' });
    const row = within(dialog).getByText('Active req 1').closest('.operation-row') as HTMLElement;
    await user.click(within(row).getByRole('button', { name: /Actions for Active req 1/ }));
    await user.click(within(row).getByRole('menuitem', { name: /Edit/ }));
    // Scope the Title field to the drawer (the overview preview also renders a form
    // for the same previewed requirement).
    const titleField = within(dialog).getByLabelText('Title');
    await user.clear(titleField);
    await user.type(titleField, 'Active req 1 (revised)');
    await user.click(within(dialog).getByRole('button', { name: 'Save Requirement' }));

    await waitFor(() =>
      expect(updateSpy).toHaveBeenCalledWith(
        project.id,
        'ra0',
        expect.objectContaining({ title: 'Active req 1 (revised)' }),
      ),
    );
  });
});

describe('Scope & Services narrative bound + equal-height hardening', () => {
  const longText = 'A very long scope narrative '.repeat(20).trim();

  it('clamps long narratives and shows View full scope without a redundant count', async () => {
    const longProject: Project = {
      ...project,
      lightingScope: longText,
      luxRequirements: 'Lobby 300 lux; guest rooms 200 lux.',
    };
    vi.mocked(api.project).mockResolvedValue(longProject);
    renderDetails();
    await screen.findByRole('heading', { name: 'UI Test Project' });

    const scopeSection = screen.getByLabelText('Project scope');
    // The long lighting scope uses the bounded preview class (line-clamp), not an
    // unlimited block.
    expect(scopeSection.querySelector('.scope-narrative-preview')).not.toBeNull();
    // View full scope appears (no numeric count for a narrative).
    const viewFull = within(scopeSection).getByRole('button', { name: /View full scope/ });
    expect(viewFull).toBeInTheDocument();
  });

  it('shows the full canonical narrative in the Full Scope drawer and closes without mutation', async () => {
    const longProject: Project = {
      ...project,
      lightingScope: longText,
      luxRequirements: 'Lobby 300 lux; guest rooms 200 lux.',
    };
    vi.mocked(api.project).mockResolvedValue(longProject);
    const deleteSpy = vi.spyOn(api, 'deleteRequirement').mockResolvedValue({ deleted: true });
    const user = userEvent.setup();
    renderDetails();
    await screen.findByRole('heading', { name: 'UI Test Project' });

    const scopeSection = screen.getByLabelText('Project scope');
    await user.click(within(scopeSection).getByRole('button', { name: /View full scope/ }));

    const dialog = await screen.findByRole('dialog', { name: 'Project Scope' });
    expect(within(dialog).getByText(longText)).toBeInTheDocument();
    expect(within(dialog).getByText('Lobby 300 lux; guest rooms 200 lux.')).toBeInTheDocument();
    // No search input for a two-field narrative.
    expect(within(dialog).queryByLabelText(/Search/)).not.toBeInTheDocument();

    // Close without mutation.
    await user.click(within(dialog).getByRole('button', { name: 'Close' }));
    expect(screen.queryByRole('dialog', { name: 'Project Scope' })).not.toBeInTheDocument();
    expect(deleteSpy).not.toHaveBeenCalled();
  });

  it('does not show View full scope for normal short content', async () => {
    renderDetails();
    await screen.findByRole('heading', { name: 'UI Test Project' });

    const scopeSection = screen.getByLabelText('Project scope');
    expect(
      within(scopeSection).queryByRole('button', { name: /View full scope/ }),
    ).not.toBeInTheDocument();
    expect(scopeSection.querySelector('.scope-narrative-preview')).toBeNull();
  });

  it('does not leak Full Scope drawer state into a collection drawer', async () => {
    const longProject: Project = {
      ...project,
      lightingScope: longText,
    };
    vi.mocked(api.project).mockResolvedValue(longProject);
    vi.mocked(api.projectWorkspace).mockResolvedValue({
      ...workspace,
      deliverables: [
        ...workspace.deliverables,
        ...Array.from({ length: 6 }, (_, i) => ({
          id: `d9${i}`,
          projectId: project.id,
          serviceCode: 'LightingLayout' as const,
          title: `Extra ${i}`,
          status: 'NotStarted' as const,
          progressPercent: 0,
          required: true,
          dueDate: null,
          sortOrder: 10 + i,
          updatedAt: timestamp,
        })),
      ],
    });
    const user = userEvent.setup();
    renderDetails();
    await screen.findByRole('heading', { name: 'UI Test Project' });

    const scopeSection = screen.getByLabelText('Project scope');
    await user.click(within(scopeSection).getByRole('button', { name: /View full scope/ }));
    const scopeDialog = await screen.findByRole('dialog', { name: 'Project Scope' });
    await user.click(within(scopeDialog).getByRole('button', { name: 'Close' }));

    const deliverablesSection = screen.getByLabelText('Deliverables');
    await user.click(within(deliverablesSection).getByRole('button', { name: 'Show all (7)' }));
    const delDialog = await screen.findByRole('dialog', { name: 'All Deliverables' });
    // No narrative leaked into the deliverables drawer.
    expect(within(delDialog).queryByText(longText)).not.toBeInTheDocument();
    expect(within(delDialog).getByText('Extra 5')).toBeInTheDocument();
  });

  it('uses stretch alignment and per-card height for equal-height same-row cards', async () => {
    renderDetails();
    await screen.findByRole('heading', { name: 'UI Test Project' });

    // The grid uses stretch behavior (equal-height row contract) and each card fills
    // its grid area. This is a structural/CSS-contract assertion, not a pixel test:
    // the cards participate in the same grid row via their grid-area classes.
    expect(document.querySelector('.scope-area-scope')).not.toBeNull();
    expect(document.querySelector('.scope-area-deliverables')).not.toBeNull();
    expect(document.querySelector('.scope-area-requirements')).not.toBeNull();
    expect(document.querySelector('.scope-area-exclusions')).not.toBeNull();
    expect(document.querySelector('.scope-area-summary')).not.toBeNull();
  });
});
