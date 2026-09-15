// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type {
  AppUser,
  LuminaireRecord,
  Project,
  ProjectTimesheet,
  ProjectScopeItem,
  ProjectWorkspace,
  WorkloadMetrics,
} from '@scli/domain';
import { api, apiRequest, ApiError } from '../api';
import { useAppContext } from '../app-context';
import { AssignmentDrawer } from '../components/assignment-drawer';
import { ProjectCard } from '../components/project-card';
import { ToastProvider } from '../components/toast';
import { DesignersScreen } from './designers';
import { NewProjectScreen } from './new-project';
import { PersonalNewProjectScreen } from './personal-new-project';
import { PersonalProjectDetailsScreen } from './personal-project-details';
import { TimesheetsScreen } from './timesheets';

vi.mock('../app-context', () => ({ useAppContext: vi.fn() }));
vi.mock('../api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api')>()),
  apiRequest: vi.fn(),
}));

const timestamp = '2026-08-01T08:00:00.000Z';
const makeUser = (id: string, displayName: string, role: AppUser['role']): AppUser => ({
  id,
  entraObjectId: `entra-${id}`,
  displayName,
  email: `${id}@scli.example`,
  jobTitle:
    role === 'Sales' ? 'Sales Executive' : role === 'Designer' ? 'Designer' : 'Design Manager',
  department: role === 'Sales' ? 'Sales' : 'Design Studio',
  role,
  weeklyCapacityHours: role === 'Designer' ? 40 : 0,
  availabilityStatus: role === 'Designer' ? 'Unavailable' : 'Available',
  avatarUrl: null,
  isActive: true,
  createdAt: timestamp,
  updatedAt: timestamp,
});
const sales = makeUser('11111111-1111-4111-8111-111111111111', 'Maya Hassan', 'Sales');
const otherSales = makeUser('22222222-2222-4222-8222-222222222222', 'Omar Khalid', 'Sales');
const designer = makeUser('33333333-3333-4333-8333-333333333333', 'Lina Mansour', 'Designer');
const manager = makeUser('66666666-6666-4666-8666-666666666666', 'Daniel Brooks', 'LineManager');
const admin = makeUser('77777777-7777-4777-8777-777777777777', 'Priya Nair', 'Admin');
const project: Project = {
  id: 'aaaaaaaa-0000-4000-8000-000000000001',
  projectCode: '777_SCLI260101_UAT_LEGACY_IMPORT',
  projectName: 'UI Test Project',
  clientName: 'Acme',
  crmReference: null,
  projectType: 'Lighting Layout',
  description: 'Lighting component test',
  salesOwnerId: sales.id,
  salesOwnerNameSnapshot: sales.displayName,
  salesOwnerEmailSnapshot: sales.email,
  createdById: sales.id,
  createdByNameSnapshot: sales.displayName,
  createdByEmailSnapshot: sales.email,
  assignedDesignerId: null,
  assignedDesignerNameSnapshot: null,
  collaboratorDesignerIds: [],
  collaboratorDesignerNameSnapshots: [],
  siteLocation: 'Dubai, UAE',
  designStage: 'Concept',
  lightingScope: 'Interior lighting layout and luminaire coordination.',
  luxRequirements: '500 lux at working plane.',
  drawingReference: 'A-101',
  status: 'Unassigned',
  priority: 'Urgent',
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
};
const personalWorkspace: ProjectWorkspace & { scopeItems: ProjectScopeItem[] } = {
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
  services: ['LuminaireSchedule', 'TechnicalBoq', 'Datasheets'],
  scopeItems: [
    {
      id: 'LuminaireSchedule',
      code: 'LuminaireSchedule',
      label: 'Luminaire Schedule',
      custom: false,
    },
    { id: 'TechnicalBoq', code: 'TechnicalBoq', label: 'Technical BOQ', custom: false },
    { id: 'Datasheets', code: 'Datasheets', label: 'Datasheets Package', custom: false },
  ],
  deliverables: [],
  lightingPackage: {
    projectId: project.id,
    inputMode: 'Later',
    pdfPaperSize: 'Auto',
    scheduleColumns: [],
    boqColumns: [],
    updatedAt: timestamp,
  },
  luminaires: [],
  exports: [],
  revisionPackages: [],
  requirements: [],
  tags: [],
  scopeNotes: [],
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
const existingLuminaire: LuminaireRecord = {
  id: '88888888-8888-4888-8888-888888888888',
  projectId: project.id,
  tag: 'DL01',
  category: 'Downlight',
  imagePath: '',
  description: 'Existing project downlight',
  manufacturer: 'ERCO',
  model: 'MODEL-01',
  wattage: '8W',
  lumens: '720 lm',
  lightColor: '3000K',
  cri: '90',
  beamAngle: '24 deg',
  ipRating: 'IP44',
  mounting: 'Recessed',
  cutout: '85 mm',
  driver: 'Remote',
  control: 'DALI',
  emergency: 'No',
  datasheetPath: '',
  location: 'Ground Floor',
  unit: 'No.',
  quantity: 1,
  notes: '',
  sourceName: '',
  dimensions: '',
  bodyColorFinish: '',
  rowVersion: 1,
  createdAt: timestamp,
  updatedAt: timestamp,
};
const workload: WorkloadMetrics = {
  designer,
  activeProjectCount: 3,
  activeEstimatedHours: 40,
  activeActualHours: 20,
  weeklyCapacityHours: 40,
  remainingCapacity: 0,
  utilizationPercent: 100,
  availabilityPercent: 0,
  overdueProjectCount: 1,
  nextDeadline: '2026-08-05',
  classification: 'Unavailable',
  activeProjects: [{ ...project, assignedDesignerId: designer.id, status: 'InProgress' }],
};
const submittedTimesheet: ProjectTimesheet = {
  projectId: project.id,
  projectCode: project.projectCode,
  projectName: project.projectName,
  userId: designer.id,
  userNameSnapshot: designer.displayName,
  status: 'Submitted',
  entries: [
    {
      id: '99999999-9999-4999-8999-999999999999',
      projectId: project.id,
      projectCode: project.projectCode,
      projectName: project.projectName,
      userId: designer.id,
      userNameSnapshot: designer.displayName,
      workCategory: 'DIALux',
      note: 'Calculation model',
      status: 'Stopped',
      startedAt: timestamp,
      pausedAt: null,
      stoppedAt: '2026-08-01T09:00:00.000Z',
      durationMinutes: 60,
      updatedAt: '2026-08-01T09:00:00.000Z',
    },
  ],
  totalMinutes: 60,
  submittedAt: '2026-08-01T09:05:00.000Z',
  reviewedAt: null,
  reviewedByNameSnapshot: null,
  reviewReason: null,
};

function setActor(currentUser: AppUser): void {
  vi.mocked(useAppContext).mockReturnValue({
    currentUser,
    mockUsers: [sales, otherSales, designer, manager, admin],
    integrationStatus: {
      mode: 'mock',
      workspaceVariant: 'team',
      personalAutoLogin: false,
      configured: true,
      teamsSsoConfigured: false,
      sharePointConfigured: false,
      proactiveNotificationsConfigured: false,
      missing: [],
    },
    switchMockUser: vi.fn(),
    logout: vi.fn(),
    themePreference: 'light',
    resolvedTheme: 'dark',
    setThemePreference: vi.fn(),
  });
}

function renderApp(node: React.ReactNode) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <ToastProvider>{node}</ToastProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.spyOn(api, 'projectTypes').mockResolvedValue([
    {
      id: crypto.randomUUID(),
      name: 'Lighting Layout',
      isActive: true,
      createdAt: timestamp,
      updatedAt: timestamp,
    },
  ]);
  vi.spyOn(api, 'projectTypeCatalogue').mockResolvedValue([
    {
      id: 'eeeeeeee-0000-4000-8000-000000000001',
      name: 'Lighting Layout',
      isActive: true,
      createdAt: timestamp,
      updatedAt: timestamp,
    },
    {
      id: 'eeeeeeee-0000-4000-8000-000000000002',
      name: 'Villa Lighting Design',
      isActive: true,
      createdAt: timestamp,
      updatedAt: timestamp,
    },
  ]);
  vi.spyOn(api, 'salesUsers').mockResolvedValue([sales, otherSales]);
  vi.spyOn(api, 'workloads').mockResolvedValue([workload]);
  vi.spyOn(api, 'updateUser').mockResolvedValue(designer);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('New Project role modes', () => {
  it('locks the Sales Owner for a Sales user', async () => {
    setActor(sales);
    renderApp(<NewProjectScreen />);
    expect((await screen.findAllByText('Maya Hassan')).length).toBeGreaterThan(0);
    expect(screen.getByText('Locked')).toBeInTheDocument();
    expect(screen.queryByRole('radio', { name: /On behalf of Sales/i })).not.toBeInTheDocument();
  });

  it('lets a manager select an active Sales owner without opening a separate mode', async () => {
    setActor(manager);
    renderApp(<NewProjectScreen />);
    const owner = await screen.findByRole('combobox', { name: 'Sales Owner' });
    await screen.findByRole('option', { name: 'Omar Khalid' });
    await userEvent.selectOptions(owner, otherSales.id);
    expect(owner).toHaveValue(otherSales.id);
    expect(screen.queryByRole('radio', { name: /On behalf of Sales/i })).not.toBeInTheDocument();
  });

  it('applies a lighting template to the quick form', async () => {
    setActor(sales);
    renderApp(<NewProjectScreen />);
    await userEvent.click(await screen.findByRole('button', { name: /DIALux Study/i }));
    expect(screen.getByRole('combobox', { name: /Project type/i })).toHaveValue(
      'DIALux Simulation',
    );
    expect(
      (screen.getByRole('textbox', { name: /Lighting scope/i }) as HTMLTextAreaElement).value,
    ).toContain('DIALux');
  });
});

describe('timesheet approvals', () => {
  it('shows submitted time and lets the manager approve it', async () => {
    vi.spyOn(api, 'timesheets').mockResolvedValue([submittedTimesheet]);
    const review = vi
      .spyOn(api, 'reviewTimesheet')
      .mockResolvedValue({ ...submittedTimesheet, status: 'Approved' });
    setActor(manager);
    renderApp(<TimesheetsScreen />);
    expect((await screen.findAllByText('1h 00m')).length).toBeGreaterThan(0);
    await userEvent.click(screen.getByRole('button', { name: 'Approve' }));
    await waitFor(() =>
      expect(review).toHaveBeenCalledWith(project.id, designer.id, 'approve', {}),
    );
  });
});

describe('assignment and permission components', () => {
  it('requires a reason before assigning an unavailable Designer', async () => {
    setActor(manager);
    renderApp(<AssignmentDrawer project={project} onClose={vi.fn()} />);
    await userEvent.click(await screen.findByRole('button', { name: /Lina Mansour/i }));
    expect(screen.getByText('Capacity override required')).toBeInTheDocument();
    const confirm = screen.getByRole('button', { name: 'Confirm assignment' });
    expect(confirm).toBeDisabled();
    await userEvent.type(
      screen.getByRole('textbox', { name: 'Override reason' }),
      'Specialist needed',
    );
    expect(confirm).toBeEnabled();
  });

  it('shows Quick Assign only when the parent grants the action', () => {
    const { rerender } = renderApp(<ProjectCard project={project} />);
    expect(
      screen.queryByRole('button', { name: /Assign UI Test Project/i }),
    ).not.toBeInTheDocument();
    rerender(
      <QueryClientProvider client={new QueryClient()}>
        <MemoryRouter>
          <ToastProvider>
            <ProjectCard project={project} onAssign={vi.fn()} />
          </ToastProvider>
        </MemoryRouter>
      </QueryClientProvider>,
    );
    expect(screen.getByRole('button', { name: /Assign UI Test Project/i })).toBeInTheDocument();
  });
});

describe('personal new project CRM Reference', () => {
  it('exposes the optional CRM Reference field in the first wizard step', async () => {
    setActor(manager);
    vi.spyOn(api, 'personalSettings').mockResolvedValue({
      projectRoot: '',
      defaultFolderProfile: 'Full Lighting Design',
      defaultInputMode: 'Later',
      autoOpenProjectFolder: false,
      designerName: 'Daniel Brooks',
      companyName: 'Scientechnic',
      companyLogoPath: '',
      accentColor: '#0b6e6e',
      timeZone: 'Asia/Dubai',
      backupRetention: 30,
      updatedAt: timestamp,
    });
    vi.spyOn(api, 'folderProfiles').mockResolvedValue([
      {
        name: 'Full Lighting Design',
        description: 'Test profile',
        folders: [],
        outputFolders: {
          scheduleExcel: '',
          schedulePdf: '',
          boqExcel: '',
          boqPdf: '',
          datasheets: '',
        },
        builtIn: true,
      },
    ]);
    renderApp(<PersonalNewProjectScreen />);
    const crmInput = await screen.findByLabelText(/CRM Reference/);
    expect(crmInput).toBeInTheDocument();
    expect(crmInput).toHaveAttribute('placeholder', 'e.g. CRM-48572');
    expect(
      screen.getByText(/Optional reference used to link the project to a CRM record\./),
    ).toBeInTheDocument();
  });
});

describe('personal new project flexible scope', () => {
  function mockNewProjectQueries() {
    vi.spyOn(api, 'personalSettings').mockResolvedValue({
      projectRoot: '',
      defaultFolderProfile: 'Full Lighting Design',
      defaultInputMode: 'Later',
      autoOpenProjectFolder: false,
      designerName: 'Daniel Brooks',
      companyName: 'Scientechnic',
      companyLogoPath: '',
      accentColor: '#0b6e6e',
      timeZone: 'Asia/Dubai',
      backupRetention: 30,
      updatedAt: timestamp,
    });
    vi.spyOn(api, 'folderProfiles').mockResolvedValue([
      {
        name: 'Full Lighting Design',
        description: 'Test profile',
        folders: [{ name: '01_INPUT', children: [] }],
        outputFolders: {
          scheduleExcel: '01_SCHEDULES',
          schedulePdf: '01_SCHEDULES',
          boqExcel: '02_BOQ',
          boqPdf: '02_BOQ',
          datasheets: '04_DATASHEETS',
        },
        builtIn: true,
      },
    ]);
  }

  it('lets the user deselect built-in services and add custom scope items before creation', async () => {
    setActor(manager);
    mockNewProjectQueries();
    const createProject = vi.spyOn(api, 'createProject').mockResolvedValue({
      project: { ...project, id: crypto.randomUUID() },
      workflow: [],
      workspace: personalWorkspace,
      folderCreation: null,
      folderError: null,
    });
    const user = userEvent.setup();
    renderApp(<PersonalNewProjectScreen />);

    await user.type(await screen.findByLabelText(/Project Name/), 'Dubai Hills Villa');
    await user.type(screen.getByLabelText(/Client Name/), 'Private Client');
    await user.type(screen.getByLabelText(/Site Location/), 'Dubai Hills');
    await user.type(screen.getByLabelText(/Lighting Scope/), 'Complete villa lighting design.');
    await user.selectOptions(screen.getByLabelText(/Salesperson/), sales.id);
    await user.click(screen.getByRole('button', { name: /Continue/ }));

    // Step 2: deselect Technical BOQ and add a custom scope item.
    await user.click(screen.getByRole('button', { name: /Technical BOQ/ }));
    await user.type(screen.getByPlaceholderText(/e.g. Authority Submission/), 'Mockup Review');
    await user.click(screen.getByRole('button', { name: 'Add item' }));
    expect(screen.getByText('Mockup Review')).toBeInTheDocument();

    // Step 3: decide on folders later.
    await user.click(screen.getByRole('button', { name: /Continue/ }));
    await user.click(screen.getByRole('button', { name: /Decide later/ }));
    await user.click(screen.getByRole('button', { name: /Continue/ }));

    // Step 4: decide on luminaire input later.
    await user.click(screen.getByRole('button', { name: /Ask per project/ }));
    await user.click(screen.getByRole('button', { name: /Continue/ }));

    // Step 5: create.
    await user.click(screen.getByRole('button', { name: /Create Project Workspace/ }));
    await waitFor(() =>
      expect(createProject).toHaveBeenCalledWith(
        expect.objectContaining({
          services: expect.not.arrayContaining(['TechnicalBoq']),
          scopeItems: expect.arrayContaining([
            expect.objectContaining({ label: 'Mockup Review', custom: true }),
          ]),
        }),
        expect.anything(),
      ),
    );
    const payload = createProject.mock.calls[0]![0] as Record<string, unknown>;
    expect(payload).not.toHaveProperty('commercialValueMinor');
    expect(payload).not.toHaveProperty('commercialCurrency');
  });

  it('requires a complete commercial pair and submits canonical minor units', async () => {
    setActor(manager);
    mockNewProjectQueries();
    const createdProject = {
      ...project,
      id: crypto.randomUUID(),
      commercialValueMinor: 12_500_050,
      commercialCurrency: 'AED',
    };
    const createProject = vi.spyOn(api, 'createProject').mockResolvedValue({
      project: createdProject,
      workflow: [],
      workspace: { ...personalWorkspace, projectId: createdProject.id },
      folderCreation: null,
      folderError: null,
    });
    const user = userEvent.setup();
    renderApp(<PersonalNewProjectScreen />);

    await user.type(await screen.findByLabelText(/Project Name/), 'Commercial Villa');
    await user.type(screen.getByLabelText(/Client Name/), 'Private Client');
    await user.type(screen.getByLabelText(/Site Location/), 'Dubai Hills');
    await user.type(screen.getByLabelText(/Lighting Scope/), 'Complete lighting design.');
    await user.selectOptions(screen.getByLabelText(/Salesperson/), sales.id);
    await user.type(screen.getByLabelText('Commercial Value Amount'), '125000.50');

    expect(screen.getByRole('button', { name: /Continue/ })).toBeDisabled();
    expect(screen.getByRole('alert')).toHaveTextContent(/Currency is required/);
    await user.type(screen.getByLabelText('Commercial Value Currency'), 'aed');
    expect(screen.getByLabelText('Commercial Value Currency')).toHaveValue('AED');
    await user.click(screen.getByRole('button', { name: /Continue/ }));

    await user.click(screen.getByRole('button', { name: /Continue/ }));
    await user.click(screen.getByRole('button', { name: /Decide later/ }));
    await user.click(screen.getByRole('button', { name: /Continue/ }));
    await user.click(screen.getByRole('button', { name: /Ask per project/ }));
    await user.click(screen.getByRole('button', { name: /Continue/ }));
    expect(screen.getByText(/AED/)).toHaveTextContent(/125,000\.50/);
    await user.click(screen.getByRole('button', { name: /Create Project Workspace/ }));

    await waitFor(() => expect(createProject).toHaveBeenCalled());
    const payload = createProject.mock.calls[0]![0] as Record<string, unknown>;
    expect(payload).toMatchObject({
      commercialValueMinor: 12_500_050,
      commercialCurrency: 'AED',
    });
    expect(payload).not.toHaveProperty('commercialValueAmount');
  });
});

describe('Personal Project Details edit scope', () => {
  function renderDetails() {
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    return render(
      <QueryClientProvider client={client}>
        <ToastProvider>
          <MemoryRouter initialEntries={[`/projects/${project.id}/scope`]}>
            <Routes>
              <Route path="/projects/:id/:section" element={<PersonalProjectDetailsScreen />} />
            </Routes>
          </MemoryRouter>
        </ToastProvider>
      </QueryClientProvider>,
    );
  }

  beforeEach(() => {
    setActor(admin);
    vi.spyOn(api, 'project').mockResolvedValue(project);
    vi.spyOn(api, 'projectWorkspace').mockResolvedValue(personalWorkspace);
    vi.spyOn(api, 'salesUsers').mockResolvedValue([sales, otherSales]);
  });

  it('edits scope through the dedicated endpoint and keeps data intact', async () => {
    const request = vi.mocked(apiRequest);
    request.mockResolvedValue({ workspace: personalWorkspace });
    const user = userEvent.setup();
    renderDetails();
    await screen.findByRole('heading', { name: 'UI Test Project' });
    await user.click(screen.getByRole('button', { name: 'Edit Scope' }));

    const technicalBoq = screen.getByRole('checkbox', { name: /Technical BOQ/ });
    expect(technicalBoq).toBeChecked();
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
            ]),
          }),
        }),
      ),
    );
  });

  it('cancel performs no persistence and restores the current scope', async () => {
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
    expect(screen.getByText('Technical BOQ')).toBeInTheDocument();
    expect(screen.queryByText('Authority Submission')).not.toBeInTheDocument();
  });
});

describe('Personal Project Details single navigation authority', () => {
  function renderDetails() {
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    return render(
      <QueryClientProvider client={client}>
        <ToastProvider>
          <MemoryRouter initialEntries={[`/projects/${project.id}`]}>
            <Routes>
              <Route path="/projects/:id" element={<PersonalProjectDetailsScreen />} />
            </Routes>
          </MemoryRouter>
        </ToastProvider>
      </QueryClientProvider>,
    );
  }

  beforeEach(() => {
    setActor(admin);
    vi.spyOn(api, 'project').mockResolvedValue(project);
    vi.spyOn(api, 'projectWorkspace').mockResolvedValue(personalWorkspace);
    vi.spyOn(api, 'salesUsers').mockResolvedValue([sales, otherSales]);
  });

  it('does not render the old horizontal detail-tabs navigation strip', async () => {
    renderDetails();
    await screen.findByRole('heading', { name: 'UI Test Project' });
    // The old horizontal detail-tabs nav is removed as a navigation authority.
    expect(screen.queryByRole('navigation', { name: /tabs?/i })).not.toBeInTheDocument();
    expect(document.querySelector('.detail-tabs')).toBeNull();
    // Old horizontal tab labels must not appear as duplicate primary nav.
    expect(screen.queryByRole('button', { name: 'Overview' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'AI Check' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Scope & Folders' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Deliverables' })).not.toBeInTheDocument();
  });

  it('keeps Overview content reachable on the index project route', async () => {
    renderDetails();
    await screen.findByRole('heading', { name: 'UI Test Project' });
    // The overview workspace content (Project brief) remains present on /projects/:id.
    expect(screen.getByText('Project brief')).toBeInTheDocument();
    expect(screen.getByText('Lighting scope')).toBeInTheDocument();
  });
});

describe('Personal Project Details luminaire Tag validation', () => {
  function renderDetails() {
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    return render(
      <QueryClientProvider client={client}>
        <ToastProvider>
          <MemoryRouter initialEntries={[`/projects/${project.id}/luminaires`]}>
            <Routes>
              <Route path="/projects/:id/:section" element={<PersonalProjectDetailsScreen />} />
            </Routes>
          </MemoryRouter>
        </ToastProvider>
      </QueryClientProvider>,
    );
  }

  async function enterNewLuminaireTag(tag: string) {
    const user = userEvent.setup();
    await screen.findByRole('heading', { name: 'UI Test Project' });
    await user.click(screen.getByRole('button', { name: 'Add Luminaire' }));
    const dialog = screen.getByRole('dialog', { name: /Add luminaire/i });
    await user.type(within(dialog).getByLabelText(/Type \/ Tag/), tag);
    await user.click(within(dialog).getByRole('button', { name: 'Save Luminaire' }));
    return dialog;
  }

  beforeEach(() => {
    setActor(admin);
    vi.spyOn(api, 'project').mockResolvedValue(project);
    vi.spyOn(api, 'salesUsers').mockResolvedValue([sales, otherSales]);
  });

  it('shows the canonical uppercase Tag immediately after a successful save', async () => {
    const canonicalLuminaire = { ...existingLuminaire, tag: 'MIX03' };
    const workspaceWithVisibleTag = {
      ...personalWorkspace,
      lightingPackage: {
        ...personalWorkspace.lightingPackage,
        scheduleColumns: [
          {
            fieldKey: 'tag',
            header: 'Type / Tag',
            visible: true,
            sortOrder: 0,
            width: 140,
            compareInRevision: true,
            requiredForIssue: true,
            internalOnly: false,
          },
        ],
      },
    };
    vi.spyOn(api, 'projectWorkspace')
      .mockResolvedValueOnce(workspaceWithVisibleTag)
      .mockResolvedValue({ ...workspaceWithVisibleTag, luminaires: [canonicalLuminaire] });
    const addLuminaire = vi.spyOn(api, 'addLuminaire').mockResolvedValue(canonicalLuminaire);
    renderDetails();

    await enterNewLuminaireTag('miX03');

    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: /Add luminaire/i })).toBeNull(),
    );
    expect(await screen.findByText('MIX03')).toBeVisible();
    expect(screen.queryByText('miX03')).toBeNull();
    expect(addLuminaire).toHaveBeenCalledWith(
      project.id,
      expect.objectContaining({ tag: 'miX03' }),
    );
  });

  it('blocks a case-variant duplicate locally with the specific project-scoped message', async () => {
    vi.spyOn(api, 'projectWorkspace').mockResolvedValue({
      ...personalWorkspace,
      luminaires: [existingLuminaire],
    });
    const addLuminaire = vi.spyOn(api, 'addLuminaire').mockResolvedValue(existingLuminaire);
    renderDetails();

    const dialog = await enterNewLuminaireTag('dl01');

    await waitFor(() =>
      expect(screen.getByText('Type / Tag "DL01" already exists in this project.')).toBeVisible(),
    );
    expect(addLuminaire).not.toHaveBeenCalled();
    expect(dialog).toBeVisible();
  });

  it('surfaces the authoritative duplicate error returned by the API', async () => {
    vi.spyOn(api, 'projectWorkspace').mockResolvedValue(personalWorkspace);
    vi.spyOn(api, 'addLuminaire').mockRejectedValue(
      new ApiError(
        'Type / Tag "DL03" already exists in this project.',
        'CONFLICT',
        409,
        'test-correlation-id',
        { field: 'tag' },
      ),
    );
    renderDetails();

    const dialog = await enterNewLuminaireTag('DL03');

    await waitFor(() =>
      expect(screen.getByText('Type / Tag "DL03" already exists in this project.')).toBeVisible(),
    );
    expect(dialog).toBeVisible();
  });

  it('preserves the generic fallback message for unknown failures', async () => {
    vi.spyOn(api, 'projectWorkspace').mockResolvedValue(personalWorkspace);
    vi.spyOn(api, 'addLuminaire').mockRejectedValue(
      new Error('Something went wrong. Try again or contact support.'),
    );
    renderDetails();

    await enterNewLuminaireTag('DL99');

    await waitFor(() =>
      expect(screen.getByText('Something went wrong. Try again or contact support.')).toBeVisible(),
    );
  });
});

describe('Personal Project Details luminaire Quantity keyboard entry', () => {
  function renderDetails() {
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    return render(
      <QueryClientProvider client={client}>
        <ToastProvider>
          <MemoryRouter initialEntries={[`/projects/${project.id}/luminaires`]}>
            <Routes>
              <Route path="/projects/:id/:section" element={<PersonalProjectDetailsScreen />} />
            </Routes>
          </MemoryRouter>
        </ToastProvider>
      </QueryClientProvider>,
    );
  }

  async function openEditorForExistingLuminaire() {
    const user = userEvent.setup();
    await screen.findByRole('heading', { name: 'UI Test Project' });
    await user.click(screen.getByRole('button', { name: 'Edit' }));
    return screen.getByRole('dialog', { name: /Edit DL01/i });
  }

  beforeEach(() => {
    setActor(admin);
    vi.spyOn(api, 'project').mockResolvedValue(project);
    vi.spyOn(api, 'salesUsers').mockResolvedValue([sales, otherSales]);
    vi.spyOn(api, 'projectWorkspace').mockResolvedValue({
      ...personalWorkspace,
      luminaires: [existingLuminaire],
    });
  });

  it('allows direct keyboard entry of a multi-digit quantity and saves the numeric value', async () => {
    const user = userEvent.setup();
    const updateLuminaire = vi.spyOn(api, 'updateLuminaire').mockResolvedValue(existingLuminaire);
    renderDetails();

    const dialog = await openEditorForExistingLuminaire();
    const quantity = within(dialog).getByLabelText('Quantity');
    // Existing value is 1.
    expect(quantity).toHaveValue(1);

    // Clear the existing value (select-all + delete) then type a new multi-digit
    // value. user.clear() is the canonical select-all-and-delete interaction.
    await user.clear(quantity);
    await user.type(quantity, '125');

    // The field shows the typed value, not a forced 0 or truncated digit.
    expect(quantity).toHaveValue(125);

    await user.click(within(dialog).getByRole('button', { name: 'Save Luminaire' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: /Edit DL01/i })).toBeNull());
    expect(updateLuminaire).toHaveBeenCalledWith(
      project.id,
      existingLuminaire.id,
      expect.objectContaining({ quantity: 125 }),
    );
  });

  it('allows clearing and backspace/delete editing without forcing the value to 0', async () => {
    const user = userEvent.setup();
    renderDetails();

    const dialog = await openEditorForExistingLuminaire();
    const quantity = within(dialog).getByLabelText('Quantity');

    // Select all and delete, then type a new value.
    await user.clear(quantity);
    // The field may be temporarily empty while editing.
    expect(quantity).toHaveValue(null);

    await user.type(quantity, '10');
    expect(quantity).toHaveValue(10);
  });

  it('does not truncate multiple-digit entry and keeps spinner behavior', async () => {
    const user = userEvent.setup();
    renderDetails();

    const dialog = await openEditorForExistingLuminaire();
    const quantity = within(dialog).getByLabelText('Quantity');

    await user.clear(quantity);
    await user.type(quantity, '1250');
    expect(quantity).toHaveValue(1250);

    // Spinner arrows remain available on the number input.
    expect(quantity).toHaveAttribute('type', 'number');
  });

  it('blocks Save while Quantity is blank and persists an explicit 0', async () => {
    const user = userEvent.setup();
    const updateLuminaire = vi.spyOn(api, 'updateLuminaire').mockResolvedValue(existingLuminaire);
    renderDetails();

    const dialog = await openEditorForExistingLuminaire();
    const quantity = within(dialog).getByLabelText('Quantity');
    const save = within(dialog).getByRole('button', { name: 'Save Luminaire' });
    // Existing value is 1, so Save is enabled.
    expect(save).toBeEnabled();

    // Clear the field -> blank, Save disabled, no stale value can be persisted.
    await user.clear(quantity);
    expect(quantity).toHaveValue(null);
    expect(save).toBeDisabled();
    expect(updateLuminaire).not.toHaveBeenCalled();

    // Type an explicit 0 -> Save becomes enabled and numeric 0 is persisted.
    await user.type(quantity, '0');
    expect(quantity).toHaveValue(0);
    expect(save).toBeEnabled();

    await user.click(save);
    await waitFor(() => expect(screen.queryByRole('dialog', { name: /Edit DL01/i })).toBeNull());
    expect(updateLuminaire).toHaveBeenCalledWith(
      project.id,
      existingLuminaire.id,
      expect.objectContaining({ quantity: 0 }),
    );
  });
});

describe('workload states', () => {
  it('renders classification, utilization and Admin capacity controls', async () => {
    setActor(admin);
    renderApp(<DesignersScreen />);
    expect((await screen.findAllByText('Unavailable')).length).toBeGreaterThan(0);
    expect(screen.getAllByText('100%').length).toBeGreaterThan(0);
    expect(
      screen.getByRole('button', { name: /Save capacity for Lina Mansour/i }),
    ).toBeInTheDocument();
  });

  it('renders a recoverable error state', async () => {
    vi.mocked(api.workloads).mockRejectedValueOnce(new Error('Capacity service unavailable'));
    setActor(manager);
    renderApp(<DesignersScreen />);
    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent('Capacity service unavailable'),
    );
    expect(screen.getByRole('button', { name: /Try again/i })).toBeInTheDocument();
  });
});

describe('Personal Project Details metadata editor', () => {
  function renderDetails() {
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    return render(
      <QueryClientProvider client={client}>
        <ToastProvider>
          <MemoryRouter initialEntries={[`/projects/${project.id}`]}>
            <Routes>
              <Route path="/projects/:id" element={<PersonalProjectDetailsScreen />} />
            </Routes>
          </MemoryRouter>
        </ToastProvider>
      </QueryClientProvider>,
    );
  }

  async function openEditor() {
    const user = userEvent.setup();
    await screen.findByRole('heading', { name: 'UI Test Project' });
    await user.click(screen.getByRole('button', { name: 'Edit Project' }));
    await screen.findByRole('dialog', { name: 'Edit project details' });
    return user;
  }

  beforeEach(() => {
    setActor(admin);
    vi.spyOn(api, 'project').mockResolvedValue(project);
    vi.spyOn(api, 'projectWorkspace').mockResolvedValue(personalWorkspace);
    vi.spyOn(api, 'salesUsers').mockResolvedValue([sales, otherSales]);
    vi.spyOn(api, 'updateProject').mockResolvedValue(project);
  });

  it('renders a legacy project without commercial value as Not set', async () => {
    renderDetails();
    await screen.findByRole('heading', { name: 'UI Test Project' });
    const label = screen.getByText('Commercial Value');
    expect(label.parentElement).toHaveTextContent('Not set');
  });

  it('shows missing historical Luminaire Input as Not recorded', async () => {
    renderDetails();
    await screen.findByRole('heading', { name: 'UI Test Project' });
    const projectInput = screen.getAllByText('Luminaire input')[0]!;
    expect(projectInput.parentElement).toHaveTextContent('Not recorded');
  });

  it('shows the persisted project-level Luminaire Input label', async () => {
    vi.mocked(api.project).mockResolvedValue({ ...project, luminaireInputMode: 'DialuxCsv' });
    renderDetails();
    await screen.findByRole('heading', { name: 'UI Test Project' });
    const projectInput = screen.getAllByText('Luminaire input')[0]!;
    expect(projectInput.parentElement).toHaveTextContent('DIALux CSV');
  });

  it('renders zero as a real commercial value', async () => {
    vi.mocked(api.project).mockResolvedValue({
      ...project,
      commercialValueMinor: 0,
      commercialCurrency: 'AED',
    });
    renderDetails();
    await screen.findByRole('heading', { name: 'UI Test Project' });
    const label = screen.getByText('Commercial Value');
    expect(label.parentElement).toHaveTextContent('AED');
    expect(label.parentElement).toHaveTextContent('0.00');
    expect(label.parentElement).not.toHaveTextContent('Not set');
  });

  it('pre-populates the edit form with current values', async () => {
    renderDetails();
    const user = await openEditor();
    const dialog = screen.getByRole('dialog', { name: 'Edit project details' });
    expect(within(dialog).getByLabelText(/Project Name/)).toHaveValue('UI Test Project');
    expect(within(dialog).getByLabelText(/Client Name/)).toHaveValue('Acme');
    expect(within(dialog).getByLabelText(/CRM Reference/)).toHaveValue('');
    expect(within(dialog).getByLabelText(/Project Type/)).toHaveValue('Lighting Layout');
    expect(within(dialog).getByLabelText(/Site Location/)).toHaveValue('Dubai, UAE');
    expect(within(dialog).getByLabelText(/Design Stage/)).toHaveValue('Concept');
    expect(within(dialog).getByLabelText(/Lighting Scope/)).toHaveValue(
      'Interior lighting layout and luminaire coordination.',
    );
    expect(within(dialog).getByLabelText(/Lux Requirements/)).toHaveValue(
      '500 lux at working plane.',
    );
    expect(within(dialog).getByLabelText(/Drawing Reference/)).toHaveValue('A-101');
    expect(within(dialog).getByLabelText(/Priority/)).toHaveValue('Urgent');
    expect(within(dialog).getByLabelText(/Complexity/)).toHaveValue('Medium');
    expect(within(dialog).getByLabelText(/Estimated Hours/)).toHaveValue(10);
    expect(within(dialog).getByLabelText(/Progress %/)).toHaveValue(0);
    expect(within(dialog).getByLabelText(/Required Delivery Date/)).toHaveValue('2026-08-20');
    expect(user).toBeTruthy();
  });

  it('uses the canonical catalogue selector instead of free text', async () => {
    renderDetails();
    await openEditor();
    const selector = within(
      screen.getByRole('dialog', { name: 'Edit project details' }),
    ).getByLabelText(/Project Type/);
    expect(selector.tagName).toBe('SELECT');
    expect(within(selector).getByRole('option', { name: 'Lighting Layout' })).toBeInTheDocument();
    expect(
      within(selector).getByRole('option', { name: 'Villa Lighting Design' }),
    ).toBeInTheDocument();
  });

  it('shows an inactive current value but offers only active replacements', async () => {
    vi.mocked(api.project).mockResolvedValue({ ...project, projectType: 'Villa' });
    vi.mocked(api.projectTypeCatalogue).mockResolvedValue([
      {
        id: 'eeeeeeee-0000-4000-8000-000000000001',
        name: 'Residential',
        isActive: true,
        createdAt: timestamp,
        updatedAt: timestamp,
      },
      {
        id: 'eeeeeeee-0000-4000-8000-000000000002',
        name: 'Villa',
        isActive: false,
        createdAt: timestamp,
        updatedAt: timestamp,
      },
      {
        id: 'eeeeeeee-0000-4000-8000-000000000003',
        name: 'Inactive Other',
        isActive: false,
        createdAt: timestamp,
        updatedAt: timestamp,
      },
    ]);
    renderDetails();
    await openEditor();
    const dialog = screen.getByRole('dialog', { name: 'Edit project details' });
    const selector = within(dialog).getByLabelText(/Project Type/);
    expect(selector).toHaveValue('Villa');
    expect(
      within(selector).getByRole('option', { name: 'Villa — Current / Inactive' }),
    ).toBeInTheDocument();
    expect(within(selector).getByRole('option', { name: 'Residential' })).toBeInTheDocument();
    expect(
      within(selector).queryByRole('option', { name: 'Inactive Other' }),
    ).not.toBeInTheDocument();
    expect(dialog).toHaveTextContent('This historical value is inactive');
  });

  it('preserves a missing historical value during an unrelated edit', async () => {
    vi.mocked(api.project).mockResolvedValue({ ...project, projectType: 'Retail Fitout' });
    renderDetails();
    const user = await openEditor();
    const dialog = screen.getByRole('dialog', { name: 'Edit project details' });
    const selector = within(dialog).getByLabelText(/Project Type/);
    expect(selector).toHaveValue('Retail Fitout');
    expect(
      within(selector).getByRole('option', {
        name: 'Retail Fitout — Historical / Not in catalogue',
      }),
    ).toBeInTheDocument();
    expect(dialog).toHaveTextContent('This historical value is not in the catalogue');

    const client = within(dialog).getByLabelText(/Client Name/);
    await user.clear(client);
    await user.type(client, 'Acme Historical');
    await user.click(within(dialog).getByRole('button', { name: 'Save Changes' }));

    await waitFor(() =>
      expect(api.updateProject).toHaveBeenCalledWith(project.id, {
        clientName: 'Acme Historical',
        expectedVersion: 1,
      }),
    );
  });

  it('changes a historical value only to an active catalogue target', async () => {
    vi.mocked(api.project).mockResolvedValue({ ...project, projectType: 'Villa' });
    vi.mocked(api.projectTypeCatalogue).mockResolvedValue([
      {
        id: 'eeeeeeee-0000-4000-8000-000000000001',
        name: 'Residential',
        isActive: true,
        createdAt: timestamp,
        updatedAt: timestamp,
      },
      {
        id: 'eeeeeeee-0000-4000-8000-000000000002',
        name: 'Villa',
        isActive: false,
        createdAt: timestamp,
        updatedAt: timestamp,
      },
    ]);
    renderDetails();
    const user = await openEditor();
    const dialog = screen.getByRole('dialog', { name: 'Edit project details' });
    await user.selectOptions(within(dialog).getByLabelText(/Project Type/), 'Residential');
    await user.click(within(dialog).getByRole('button', { name: 'Save Changes' }));
    await waitFor(() =>
      expect(api.updateProject).toHaveBeenCalledWith(project.id, {
        projectType: 'Residential',
        expectedVersion: 1,
      }),
    );
  });

  it('keeps unrelated editing available when no active Project Type exists', async () => {
    vi.mocked(api.project).mockResolvedValue({ ...project, projectType: 'Villa' });
    vi.mocked(api.projectTypeCatalogue).mockResolvedValue([]);
    renderDetails();
    const user = await openEditor();
    const dialog = screen.getByRole('dialog', { name: 'Edit project details' });
    expect(within(dialog).getByLabelText(/Project Type/)).toBeDisabled();
    expect(dialog).toHaveTextContent('No active Project Types are available');
    const client = within(dialog).getByLabelText(/Client Name/);
    await user.clear(client);
    await user.type(client, 'Acme Zero Active');
    await user.click(within(dialog).getByRole('button', { name: 'Save Changes' }));
    await waitFor(() =>
      expect(api.updateProject).toHaveBeenCalledWith(project.id, {
        clientName: 'Acme Zero Active',
        expectedVersion: 1,
      }),
    );
  });

  it('pre-populates and edits commercial value as a complete canonical pair', async () => {
    vi.mocked(api.project).mockResolvedValue({
      ...project,
      commercialValueMinor: 12_500_050,
      commercialCurrency: 'AED',
    });
    renderDetails();
    const user = await openEditor();
    const dialog = screen.getByRole('dialog', { name: 'Edit project details' });
    const amount = within(dialog).getByLabelText('Commercial Value Amount');
    const currency = within(dialog).getByLabelText('Commercial Value Currency');
    expect(amount).toHaveValue('125000.50');
    expect(currency).toHaveValue('AED');

    await user.clear(amount);
    await user.type(amount, '130000.125');
    await user.clear(currency);
    await user.type(currency, 'bhd');
    await user.click(within(dialog).getByRole('button', { name: 'Save Changes' }));

    await waitFor(() =>
      expect(api.updateProject).toHaveBeenCalledWith(project.id, {
        commercialValueMinor: 130_000_125,
        commercialCurrency: 'BHD',
        expectedVersion: 1,
      }),
    );
  });

  it('prevents saving an amount without currency', async () => {
    renderDetails();
    const user = await openEditor();
    const dialog = screen.getByRole('dialog', { name: 'Edit project details' });
    await user.type(within(dialog).getByLabelText('Commercial Value Amount'), '250000');
    expect(within(dialog).getByRole('alert')).toHaveTextContent(/Currency is required/);
    expect(within(dialog).getByRole('button', { name: 'Save Changes' })).toBeDisabled();
    expect(api.updateProject).not.toHaveBeenCalled();
  });

  it('clears both commercial fields without changing identity or unrelated metadata', async () => {
    vi.mocked(api.project).mockResolvedValue({
      ...project,
      crmReference: 'CRM-KEEP',
      commercialValueMinor: 500_000,
      commercialCurrency: 'AED',
    });
    renderDetails();
    const user = await openEditor();
    const dialog = screen.getByRole('dialog', { name: 'Edit project details' });
    await user.click(within(dialog).getByRole('button', { name: 'Clear commercial value' }));
    await user.click(within(dialog).getByRole('button', { name: 'Save Changes' }));

    await waitFor(() =>
      expect(api.updateProject).toHaveBeenCalledWith(project.id, {
        commercialValueMinor: null,
        commercialCurrency: null,
        expectedVersion: 1,
      }),
    );
    const [projectId, payload] = vi.mocked(api.updateProject).mock.calls[0]!;
    expect(projectId).toBe(project.id);
    expect(payload).not.toHaveProperty('crmReference');
    expect(payload).not.toHaveProperty('projectCode');
    expect(payload).not.toHaveProperty('id');
  });

  it('refreshes the overview from the server-authoritative project after save', async () => {
    const updated = {
      ...project,
      commercialValueMinor: 250_000,
      commercialCurrency: 'AED',
      version: 2,
    };
    vi.mocked(api.project).mockResolvedValueOnce(project).mockResolvedValue(updated);
    vi.mocked(api.updateProject).mockResolvedValue(updated);
    renderDetails();
    const user = await openEditor();
    const dialog = screen.getByRole('dialog', { name: 'Edit project details' });
    await user.type(within(dialog).getByLabelText('Commercial Value Amount'), '2500');
    await user.type(within(dialog).getByLabelText('Commercial Value Currency'), 'AED');
    await user.click(within(dialog).getByRole('button', { name: 'Save Changes' }));

    await waitFor(() => {
      const label = screen.getByText('Commercial Value');
      expect(label.parentElement).toHaveTextContent('AED');
      expect(label.parentElement).toHaveTextContent('2,500.00');
    });
    expect(api.project).toHaveBeenCalledTimes(2);
  });

  it('persists several metadata edits in one save', async () => {
    renderDetails();
    const user = await openEditor();
    const dialog = screen.getByRole('dialog', { name: 'Edit project details' });
    await user.clear(within(dialog).getByLabelText(/Project Name/));
    await user.type(within(dialog).getByLabelText(/Project Name/), 'UI Test Project - Updated');
    await user.clear(within(dialog).getByLabelText(/Client Name/));
    await user.type(within(dialog).getByLabelText(/Client Name/), 'Acme Revised');
    await user.clear(within(dialog).getByLabelText(/CRM Reference/));
    await user.type(within(dialog).getByLabelText(/CRM Reference/), 'CRM-99110');
    await user.selectOptions(
      within(dialog).getByLabelText(/Project Type/),
      'Villa Lighting Design',
    );
    await user.clear(within(dialog).getByLabelText(/Site Location/));
    await user.type(within(dialog).getByLabelText(/Site Location/), 'Dubai Hills, Al Barari');
    await user.selectOptions(within(dialog).getByLabelText(/Design Stage/), 'DetailedDesign');
    await user.clear(within(dialog).getByLabelText(/Lighting Scope/));
    await user.type(
      within(dialog).getByLabelText(/Lighting Scope/),
      'Interior, landscape and facade lighting design.',
    );
    await user.clear(within(dialog).getByLabelText(/Lux Requirements/));
    await user.type(within(dialog).getByLabelText(/Lux Requirements/), '500 lux working plane.');
    await user.clear(within(dialog).getByLabelText(/Drawing Reference/));
    await user.type(within(dialog).getByLabelText(/Drawing Reference/), 'L-101 Rev B');
    await user.selectOptions(within(dialog).getByLabelText(/Priority/), 'High');
    await user.selectOptions(within(dialog).getByLabelText(/Complexity/), 'Large');
    await user.clear(within(dialog).getByLabelText(/Estimated Hours/));
    await user.type(within(dialog).getByLabelText(/Estimated Hours/), '40');
    await user.clear(within(dialog).getByLabelText(/Progress %/));
    await user.type(within(dialog).getByLabelText(/Progress %/), '30');
    await user.clear(within(dialog).getByLabelText(/Required Delivery Date/));
    await user.type(within(dialog).getByLabelText(/Required Delivery Date/), '2026-09-15');

    await user.click(within(dialog).getByRole('button', { name: 'Save Changes' }));

    await waitFor(() =>
      expect(api.updateProject).toHaveBeenCalledWith(project.id, {
        projectName: 'UI Test Project - Updated',
        clientName: 'Acme Revised',
        crmReference: 'CRM-99110',
        projectType: 'Villa Lighting Design',
        siteLocation: 'Dubai Hills, Al Barari',
        designStage: 'DetailedDesign',
        lightingScope: 'Interior, landscape and facade lighting design.',
        luxRequirements: '500 lux working plane.',
        drawingReference: 'L-101 Rev B',
        priority: 'High',
        complexity: 'Large',
        estimatedHours: 40,
        progressPercent: 30,
        requiredDeliveryDate: '2026-09-15',
        expectedVersion: 1,
      }),
    );
    await waitFor(() => expect(screen.getByText('Project details saved.')).toBeInTheDocument());
  }, 20_000);

  it('clears the CRM Reference safely', async () => {
    vi.spyOn(api, 'project').mockResolvedValue({ ...project, crmReference: 'CRM-48572' });
    renderDetails();
    const user = await openEditor();
    const dialog = screen.getByRole('dialog', { name: 'Edit project details' });
    expect(within(dialog).getByLabelText(/CRM Reference/)).toHaveValue('CRM-48572');
    await user.clear(within(dialog).getByLabelText(/CRM Reference/));
    await user.click(within(dialog).getByRole('button', { name: 'Save Changes' }));
    await waitFor(() =>
      expect(api.updateProject).toHaveBeenCalledWith(project.id, {
        crmReference: null,
        expectedVersion: 1,
      }),
    );
  }, 20_000);

  it('sends only changed fields so untouched values are preserved', async () => {
    renderDetails();
    const user = await openEditor();
    const dialog = screen.getByRole('dialog', { name: 'Edit project details' });
    await user.clear(within(dialog).getByLabelText(/Project Name/));
    await user.type(within(dialog).getByLabelText(/Project Name/), 'Renamed Only');
    await user.click(within(dialog).getByRole('button', { name: 'Save Changes' }));
    await waitFor(() =>
      expect(api.updateProject).toHaveBeenCalledWith(project.id, {
        projectName: 'Renamed Only',
        expectedVersion: 1,
      }),
    );
  });

  it('cancel performs no request and leaves the view unchanged', async () => {
    renderDetails();
    const user = await openEditor();
    const dialog = screen.getByRole('dialog', { name: 'Edit project details' });
    await user.clear(within(dialog).getByLabelText(/Project Name/));
    await user.type(within(dialog).getByLabelText(/Project Name/), 'Should Not Save');
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    await waitFor(() =>
      expect(
        screen.queryByRole('dialog', { name: 'Edit project details' }),
      ).not.toBeInTheDocument(),
    );
    expect(api.updateProject).not.toHaveBeenCalled();
    expect(screen.getByRole('heading', { name: 'UI Test Project' })).toBeInTheDocument();
  });

  it('keeps projectCode and folder path out of the edit form', async () => {
    renderDetails();
    await openEditor();
    const dialog = screen.getByRole('dialog', { name: 'Edit project details' });
    expect(within(dialog).queryByLabelText('Project Code')).not.toBeInTheDocument();
    expect(within(dialog).queryByLabelText(/Folder/)).not.toBeInTheDocument();
    expect(within(dialog).queryByDisplayValue(project.projectCode)).not.toBeInTheDocument();
    expect(
      within(dialog).queryByDisplayValue(personalWorkspace.folderPath ?? ''),
    ).not.toBeInTheDocument();
  });

  it('shows API validation errors without closing the form', async () => {
    vi.mocked(api.updateProject).mockRejectedValue(new Error('Project name is required.'));
    renderDetails();
    const user = await openEditor();
    const dialog = screen.getByRole('dialog', { name: 'Edit project details' });
    await user.clear(within(dialog).getByLabelText(/Project Name/));
    await user.type(within(dialog).getByLabelText(/Project Name/), 'x');
    await user.click(within(dialog).getByRole('button', { name: 'Save Changes' }));
    await waitFor(() => expect(screen.getByText('Project name is required.')).toBeInTheDocument());
    expect(screen.getByRole('dialog', { name: 'Edit project details' })).toBeInTheDocument();
  });

  it('disables editing for completed projects and explains why', async () => {
    vi.spyOn(api, 'project').mockResolvedValue({ ...project, status: 'Completed' });
    renderDetails();
    await screen.findByRole('heading', { name: 'UI Test Project' });
    const editButton = screen.getByRole('button', { name: 'Edit Project' });
    expect(editButton).toBeDisabled();
    expect(screen.getByText(/Reopen it before editing its details\./)).toBeInTheDocument();
    await userEvent
      .setup()
      .click(editButton)
      .catch(() => undefined);
    expect(screen.queryByRole('dialog', { name: 'Edit project details' })).not.toBeInTheDocument();
  });
});

describe('Personal Project Details change reference', () => {
  function renderDetails() {
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    return render(
      <QueryClientProvider client={client}>
        <ToastProvider>
          <MemoryRouter initialEntries={[`/projects/${project.id}`]}>
            <Routes>
              <Route path="/projects/:id" element={<PersonalProjectDetailsScreen />} />
            </Routes>
          </MemoryRouter>
        </ToastProvider>
      </QueryClientProvider>,
    );
  }

  async function openReferenceDialog() {
    const user = userEvent.setup();
    await screen.findByRole('heading', { name: 'UI Test Project' });
    await user.click(screen.getByRole('button', { name: 'Change Reference' }));
    await screen.findByRole('dialog', { name: 'Change project reference' });
    return user;
  }

  beforeEach(() => {
    setActor(admin);
    vi.spyOn(api, 'project').mockResolvedValue(project);
    vi.spyOn(api, 'projectWorkspace').mockResolvedValue(personalWorkspace);
    vi.spyOn(api, 'salesUsers').mockResolvedValue([sales, otherSales]);
    vi.spyOn(api, 'updateProject').mockResolvedValue(project);
  });

  it('shows the current reference and the managed folder consequence', async () => {
    renderDetails();
    await openReferenceDialog();
    const dialog = screen.getByRole('dialog', { name: 'Change project reference' });
    expect(within(dialog).getByLabelText('Current project reference')).toHaveValue(
      '777_SCLI260101_UAT_LEGACY_IMPORT',
    );
    expect(within(dialog).getByLabelText('Proposed project reference')).toBeInTheDocument();
    expect(
      within(dialog).getByText(/will be renamed to match the new reference/i),
    ).toBeInTheDocument();
    expect(within(dialog).getByText(/777_SCLI260101_UAT_LEGACY_IMPORT/i)).toBeInTheDocument();
  });

  it('submits the proposed reference with the expected version and reports the rename', async () => {
    const request = vi.mocked(apiRequest);
    request.mockResolvedValue({
      project: { ...project, projectCode: '036_SCT260801_UI_TEST' },
      folderRenamed: true,
      recoveryRequired: false,
    });
    renderDetails();
    const user = await openReferenceDialog();
    const dialog = screen.getByRole('dialog', { name: 'Change project reference' });
    const proposed = within(dialog).getByLabelText('Proposed project reference');
    await user.clear(proposed);
    await user.type(proposed, '036_SCT260801_UI_TEST');
    const confirm = within(dialog).getByRole('button', { name: 'Change Reference' });
    expect(confirm).toBeEnabled();
    await user.click(confirm);
    await waitFor(() =>
      expect(request).toHaveBeenCalledWith(
        `/api/projects/${project.id}/reference`,
        expect.objectContaining({
          method: 'POST',
          body: { projectCode: '036_SCT260801_UI_TEST', expectedVersion: project.version },
        }),
      ),
    );
    await waitFor(() =>
      expect(
        screen.getByText('Project reference updated and the managed folder was renamed.'),
      ).toBeInTheDocument(),
    );
  });

  it('keeps the confirm disabled for the same code or an unsafe shape', async () => {
    renderDetails();
    const user = await openReferenceDialog();
    const dialog = screen.getByRole('dialog', { name: 'Change project reference' });
    const input = within(dialog).getByLabelText('Proposed project reference');
    const confirm = within(dialog).getByRole('button', { name: 'Change Reference' });
    expect(confirm).toBeDisabled();
    await user.clear(input);
    await user.type(input, project.projectCode);
    expect(confirm).toBeDisabled();
    await user.clear(input);
    await user.type(input, '../../BAD');
    expect(confirm).toBeDisabled();
    await user.clear(input);
    await user.type(input, '036_SCT260801_UI_TEST');
    expect(confirm).toBeEnabled();
  });
});
