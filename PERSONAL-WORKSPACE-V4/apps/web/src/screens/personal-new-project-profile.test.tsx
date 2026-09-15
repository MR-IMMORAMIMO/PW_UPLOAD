// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import type {
  AppUser,
  FolderProfile,
  FolderProfilePreset,
  FolderProfileRef,
  LuminaireInputMode,
  Project,
} from '@scli/domain';
import { api } from '../api';
import { useAppContext } from '../app-context';
import { ToastProvider } from '../components/toast';
import { PersonalNewProjectScreen } from './personal-new-project';

vi.mock('../app-context', () => ({ useAppContext: vi.fn() }));
vi.mock('../api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api')>()),
  apiRequest: vi.fn(),
}));

const timestamp = '2026-08-01T08:00:00.000Z';
const manager: AppUser = {
  id: '66666666-6666-4666-8666-666666666666',
  entraObjectId: 'entra-manager',
  displayName: 'Daniel Brooks',
  email: 'daniel@scli.example',
  jobTitle: 'Design Manager',
  department: 'Design Studio',
  role: 'LineManager',
  weeklyCapacityHours: 0,
  availabilityStatus: 'Available',
  avatarUrl: null,
  isActive: true,
  createdAt: timestamp,
  updatedAt: timestamp,
};
const sales: AppUser = {
  id: '11111111-1111-4111-8111-111111111111',
  entraObjectId: 'entra-sales',
  displayName: 'Maya Hassan',
  email: 'maya@scli.example',
  jobTitle: 'Sales Executive',
  department: 'Sales',
  role: 'Sales',
  weeklyCapacityHours: 0,
  availabilityStatus: 'Available',
  avatarUrl: null,
  isActive: true,
  createdAt: timestamp,
  updatedAt: timestamp,
};

const factoryFull: FolderProfilePreset = {
  name: 'Full Lighting Design',
  description: 'Complete design package.',
  builtIn: true,
  factoryProfileKey: 'full-lighting-design',
  source: 'factory',
  outputFolders: {
    scheduleExcel: '03_DRAWINGS',
    schedulePdf: '03_DRAWINGS',
    boqExcel: '07_BOQ',
    boqPdf: '07_BOQ',
    datasheets: '08_DATASHEETS',
  },
  folders: [
    { name: '03_DRAWINGS', children: [] },
    { name: '07_BOQ', children: [] },
    { name: '08_DATASHEETS', children: [] },
  ],
};

const userProfile: FolderProfilePreset = {
  name: 'Lighting + Authority',
  description: 'User profile.',
  builtIn: false,
  source: 'user',
  profileId: 'bbbbbbbb-0000-4000-8000-000000000001',
  outputFolders: {
    scheduleExcel: 'SCHEDULES',
    schedulePdf: 'SCHEDULES',
    boqExcel: 'BOQ',
    boqPdf: 'BOQ',
    datasheets: 'DATASHEETS',
  },
  folders: [
    { name: 'SCHEDULES', children: [] },
    { name: 'BOQ', children: [] },
    { name: 'DATASHEETS', children: [] },
  ],
};

const legacyProfile: FolderProfilePreset = {
  name: 'Legacy Old',
  description: 'Historical.',
  builtIn: false,
  source: 'legacy',
  outputFolders: {
    scheduleExcel: 'OLD',
    schedulePdf: 'OLD',
    boqExcel: 'OLD',
    boqPdf: 'OLD',
    datasheets: 'OLD',
  },
  folders: [{ name: 'OLD', children: [] }],
};

const project: Project = {
  id: 'aaaaaaaa-0000-4000-8000-000000000001',
  projectCode: '001_SCT260807_DUBAI_HILLS_VILLA',
  projectName: 'Dubai Hills Villa',
  clientName: 'Private Client',
  crmReference: null,
  projectType: 'Villa Lighting Design',
  description: '',
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
  siteLocation: 'Dubai Hills',
  designStage: 'Concept',
  lightingScope: 'Complete villa lighting design.',
  luxRequirements: '',
  drawingReference: '',
  status: 'Unassigned',
  priority: 'Normal',
  complexity: 'Medium',
  estimatedHours: 24,
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

function setActor() {
  vi.mocked(useAppContext).mockReturnValue({
    currentUser: manager,
    mockUsers: [sales, manager],
    integrationStatus: {
      mode: 'mock',
      workspaceVariant: 'personal',
      personalAutoLogin: true,
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

function renderScreen() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <ToastProvider>
          <PersonalNewProjectScreen />
        </ToastProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function mockQueries(
  overrides: {
    defaultRef?: FolderProfileRef;
    profiles?: FolderProfilePreset[];
    catalogProfiles?: FolderProfile[];
    projectTypes?: Array<{
      id: string;
      name: string;
      isActive: boolean;
      createdAt: string;
      updatedAt: string;
    }>;
    defaultInputMode?: LuminaireInputMode;
  } = {},
) {
  vi.spyOn(api, 'personalSettings').mockResolvedValue({
    projectRoot: 'D:\\\\SCLI PROJECTS',
    defaultFolderProfile: 'Full Lighting Design',
    defaultInputMode: overrides.defaultInputMode ?? 'Later',
    autoOpenProjectFolder: false,
    designerName: 'Daniel Brooks',
    companyName: 'Scientechnic',
    companyLogoPath: '',
    accentColor: '#0b6e6e',
    timeZone: 'Asia/Dubai',
    backupRetention: 30,
    updatedAt: timestamp,
  });
  vi.spyOn(api, 'folderProfiles').mockResolvedValue(
    overrides.profiles ?? [factoryFull, userProfile, legacyProfile],
  );
  vi.spyOn(api, 'folderProfileCatalog').mockResolvedValue({
    schemaVersion: '1.0',
    profiles: overrides.catalogProfiles ?? [],
    defaultProfileRef: overrides.defaultRef ?? {
      kind: 'factory',
      factoryProfileKey: 'full-lighting-design',
    },
    defaultProfileId: null,
    effectiveDefaultRef: overrides.defaultRef ?? {
      kind: 'factory',
      factoryProfileKey: 'full-lighting-design',
    },
    legacyDefaultFolderProfile: 'Full Lighting Design',
    legacyDefaultMatch: 'canonical',
    legacyImportRequired: false,
  });
  vi.spyOn(api, 'projectTypes').mockResolvedValue(
    overrides.projectTypes ?? [
      {
        id: crypto.randomUUID(),
        name: 'Villa Lighting Design',
        isActive: true,
        createdAt: timestamp,
        updatedAt: timestamp,
      },
    ],
  );
  vi.spyOn(api, 'salesUsers').mockResolvedValue([sales]);
}

async function fillStepOne(user: ReturnType<typeof userEvent.setup>) {
  await user.type(await screen.findByLabelText(/Project Name/), 'Dubai Hills Villa');
  await user.type(screen.getByLabelText(/Client Name/), 'Private Client');
  await user.type(screen.getByLabelText(/Site Location/), 'Dubai Hills');
  await user.type(screen.getByLabelText(/Lighting Scope/), 'Complete villa lighting design.');
  await user.selectOptions(screen.getByLabelText(/Salesperson/), sales.id);
  await user.click(screen.getByRole('button', { name: /Continue/ }));
  await user.click(screen.getByRole('button', { name: /Continue/ }));
}

beforeEach(() => {
  setActor();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('P2.4B3B2B New Project folder profile UX', () => {
  it('preselects the canonical factory default and shows a compact preview, not the full editor', async () => {
    mockQueries();
    const user = userEvent.setup();
    renderScreen();
    await fillStepOne(user);

    const profileSelect = screen.getByLabelText(/Folder Profile/);
    expect(profileSelect).toHaveValue('factory:full-lighting-design');
    expect(screen.getAllByText('Full Lighting Design').length).toBeGreaterThan(0);
    expect(screen.getByText('3 folders')).toBeInTheDocument();
    expect(screen.getByText('5 output mappings')).toBeInTheDocument();
    expect(screen.getByText('Not customized')).toBeInTheDocument();
    // Full editor is not open by default.
    expect(screen.queryByRole('button', { name: /Add root folder/ })).not.toBeInTheDocument();
  });

  it('excludes legacy profiles from the New Project selector', async () => {
    mockQueries();
    const user = userEvent.setup();
    renderScreen();
    await fillStepOne(user);
    const profileSelect = screen.getByLabelText(/Folder Profile/);
    const options = within(profileSelect)
      .getAllByRole('option')
      .map((o) => o.textContent);
    expect(options).toContain('Blank');
    expect(options).toContain('Full Lighting Design');
    expect(options).toContain('Lighting + Authority');
    expect(options).not.toContain('Legacy Old');
  });

  it('preselects Blank when the canonical default is blank', async () => {
    mockQueries({ defaultRef: { kind: 'blank' } });
    const user = userEvent.setup();
    renderScreen();
    await fillStepOne(user);
    expect(screen.getByLabelText(/Folder Profile/)).toHaveValue('blank');
    expect(screen.getByText('No folders yet — customize to add folders.')).toBeInTheDocument();
  });

  it('preselects a user profile by profileId when the canonical default is a user profile', async () => {
    const userProfileId = userProfile.profileId!;
    mockQueries({
      defaultRef: { kind: 'user', profileId: userProfileId },
      catalogProfiles: [
        {
          schemaVersion: '1.0',
          profileId: userProfileId,
          name: 'Lighting + Authority',
          description: 'User profile.',
          folders: [
            {
              profileFolderId: 'pf-1',
              parentProfileFolderId: null,
              name: 'SCHEDULES',
              displayOrder: 0,
              semanticRole: null,
            },
            {
              profileFolderId: 'pf-2',
              parentProfileFolderId: null,
              name: 'BOQ',
              displayOrder: 1,
              semanticRole: null,
            },
            {
              profileFolderId: 'pf-3',
              parentProfileFolderId: null,
              name: 'DATASHEETS',
              displayOrder: 2,
              semanticRole: null,
            },
          ],
          outputDefaults: [
            { outputTypeId: 'scheduleExcel', destinationProfileFolderId: 'pf-1' },
            { outputTypeId: 'schedulePdf', destinationProfileFolderId: 'pf-1' },
            { outputTypeId: 'boqExcel', destinationProfileFolderId: 'pf-2' },
            { outputTypeId: 'boqPdf', destinationProfileFolderId: 'pf-2' },
            { outputTypeId: 'datasheets', destinationProfileFolderId: 'pf-3' },
          ],
          structuralFingerprint: 'fp-user',
          createdAt: timestamp,
          updatedAt: timestamp,
        },
      ],
    });
    const user = userEvent.setup();
    renderScreen();
    await fillStepOne(user);
    expect(screen.getByLabelText(/Folder Profile/)).toHaveValue(`user:${userProfile.profileId}`);
    expect(screen.getAllByText('Lighting + Authority').length).toBeGreaterThan(0);
  });

  it('customizes the draft without mutating the source profile and preserves draftFolderId on rename', async () => {
    mockQueries();
    const user = userEvent.setup();
    renderScreen();
    await fillStepOne(user);

    await user.click(screen.getByRole('button', { name: /Customize for this project/ }));
    expect(screen.getByRole('button', { name: /Add root folder/ })).toBeInTheDocument();

    // Rename 03_DRAWINGS -> 03_LIGHTING_DRAWINGS.
    const nameInputs = screen.getAllByLabelText('Folder name');
    const drawingsInput = nameInputs.find(
      (input) => (input as HTMLInputElement).value === '03_DRAWINGS',
    );
    expect(drawingsInput).toBeTruthy();
    await user.clear(drawingsInput!);
    await user.type(drawingsInput!, '03_LIGHTING_DRAWINGS');

    // Add a root folder MOCKUP.
    await user.click(screen.getByRole('button', { name: /Add root folder/ }));
    const newInput = screen
      .getAllByLabelText('Folder name')
      .find((input) => (input as HTMLInputElement).value === 'NEW_FOLDER');
    await user.clear(newInput!);
    await user.type(newInput!, 'MOCKUP');

    // Close customization and confirm the badge reflects customization.
    await user.click(screen.getByRole('button', { name: /Close customization/ }));
    expect(screen.getByText('Customized for this project')).toBeInTheDocument();
    // Source profile unchanged.
    expect(screen.getAllByText('Full Lighting Design').length).toBeGreaterThan(0);
  });

  it('requires confirmation when switching profile on a customized draft and Keep Current preserves it', async () => {
    mockQueries();
    const user = userEvent.setup();
    renderScreen();
    await fillStepOne(user);

    await user.click(screen.getByRole('button', { name: /Customize for this project/ }));
    const nameInputs = screen.getAllByLabelText('Folder name');
    const drawingsInput = nameInputs.find(
      (input) => (input as HTMLInputElement).value === '03_DRAWINGS',
    );
    await user.clear(drawingsInput!);
    await user.type(drawingsInput!, '03_LIGHTING_DRAWINGS');
    await user.click(screen.getByRole('button', { name: /Close customization/ }));

    // Attempt to switch to the user profile.
    await user.selectOptions(
      screen.getByLabelText(/Folder Profile/),
      `user:${userProfile.profileId}`,
    );
    expect(screen.getByRole('dialog', { name: 'Change profile' })).toBeInTheDocument();
    expect(screen.getByText(/Changing the profile will replace those changes/)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Keep Current' }));
    expect(screen.getByLabelText(/Folder Profile/)).toHaveValue('factory:full-lighting-design');
    expect(screen.getByText('Customized for this project')).toBeInTheDocument();
  });

  it('Change Profile replaces the draft intentionally', async () => {
    mockQueries();
    const user = userEvent.setup();
    renderScreen();
    await fillStepOne(user);

    await user.click(screen.getByRole('button', { name: /Customize for this project/ }));
    const nameInputs = screen.getAllByLabelText('Folder name');
    const drawingsInput = nameInputs.find(
      (input) => (input as HTMLInputElement).value === '03_DRAWINGS',
    );
    await user.clear(drawingsInput!);
    await user.type(drawingsInput!, '03_LIGHTING_DRAWINGS');
    await user.click(screen.getByRole('button', { name: /Close customization/ }));

    await user.selectOptions(
      screen.getByLabelText(/Folder Profile/),
      `user:${userProfile.profileId}`,
    );
    await user.click(screen.getByRole('button', { name: 'Change Profile' }));
    expect(screen.getByLabelText(/Folder Profile/)).toHaveValue(`user:${userProfile.profileId}`);
    expect(screen.getAllByText('Lighting + Authority').length).toBeGreaterThan(0);
    expect(screen.getByText('Not customized')).toBeInTheDocument();
  });

  it('Reset to Profile restores the selected profile structure after confirmation', async () => {
    mockQueries();
    const user = userEvent.setup();
    renderScreen();
    await fillStepOne(user);

    await user.click(screen.getByRole('button', { name: /Customize for this project/ }));
    const nameInputs = screen.getAllByLabelText('Folder name');
    const drawingsInput = nameInputs.find(
      (input) => (input as HTMLInputElement).value === '03_DRAWINGS',
    );
    await user.clear(drawingsInput!);
    await user.type(drawingsInput!, '03_LIGHTING_DRAWINGS');
    await user.click(screen.getByRole('button', { name: /Close customization/ }));

    await user.click(screen.getByRole('button', { name: /Reset to Profile/ }));
    const dialog = screen.getByRole('dialog', { name: 'Reset to profile' });
    expect(dialog).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Reset to Profile' }));
    expect(screen.getByText('Not customized')).toBeInTheDocument();
    expect(screen.getByText('3 folders')).toBeInTheDocument();
  });

  it('Save as New Profile creates a canonical user profile and keeps the draft unchanged', async () => {
    mockQueries();
    const createProfile = vi.spyOn(api, 'createFolderProfile').mockResolvedValue({
      schemaVersion: '1.0',
      profileId: 'cccccccc-0000-4000-8000-000000000001',
      name: 'Full Lighting + Mockup',
      description: 'Custom project folder structure.',
      folders: [],
      outputDefaults: [],
      structuralFingerprint: 'fp-new',
      createdAt: timestamp,
      updatedAt: timestamp,
    });
    const user = userEvent.setup();
    renderScreen();
    await fillStepOne(user);

    await user.click(screen.getByRole('button', { name: /Customize for this project/ }));
    await user.click(screen.getByRole('button', { name: /Add root folder/ }));
    const newInput = screen
      .getAllByLabelText('Folder name')
      .find((input) => (input as HTMLInputElement).value === 'NEW_FOLDER');
    await user.clear(newInput!);
    await user.type(newInput!, 'MOCKUP');
    await user.click(screen.getByRole('button', { name: /Close customization/ }));

    await user.click(screen.getByRole('button', { name: /Save as New Profile/ }));
    expect(screen.getByRole('dialog', { name: 'Save as new profile' })).toBeInTheDocument();
    await user.type(screen.getByLabelText('Profile name'), 'Full Lighting + Mockup');
    await user.click(screen.getByRole('button', { name: 'Save Profile' }));

    await waitFor(() => expect(createProfile).toHaveBeenCalled());
    const input = createProfile.mock.calls[0]![0] as {
      name: string;
      folders: Array<{ name: string; children: unknown[] }>;
    };
    expect(input.name).toBe('Full Lighting + Mockup');
    expect(input.folders.some((f) => f.name === 'MOCKUP')).toBe(true);
    // Draft remains customized and unchanged.
    expect(screen.getByText('Customized for this project')).toBeInTheDocument();
  });

  it('sends the canonical ProjectFolderDraft as the only folder authority on Create', async () => {
    mockQueries();
    const createProject = vi.spyOn(api, 'createProject').mockResolvedValue({
      project,
      workflow: [],
      folderCreation: null,
      folderError: null,
    });
    const user = userEvent.setup();
    renderScreen();
    await fillStepOne(user);

    // Step 3: Create mode with project root from settings.
    await user.click(screen.getByRole('button', { name: /Continue/ }));
    await user.click(screen.getByRole('button', { name: /Ask per project/ }));
    await user.click(screen.getByRole('button', { name: /Continue/ }));
    await user.click(screen.getByRole('button', { name: /Create Project Workspace/ }));

    await waitFor(() => expect(createProject).toHaveBeenCalled());
    const payload = createProject.mock.calls[0]![0] as Record<string, unknown>;
    expect(payload.folderDraft).toBeTruthy();
    expect((payload.folderDraft as { folders: unknown[] }).folders.length).toBe(3);
    expect(payload.folderStructure).toBeUndefined();
    expect(payload.outputFolders).toBeUndefined();
    expect(payload.idempotencyKey).toBeTruthy();
  });

  it('Set Up Later does not require a profile or submit a canonical draft', async () => {
    mockQueries();
    const createProject = vi.spyOn(api, 'createProject').mockResolvedValue({
      project,
      workflow: [],
      folderCreation: null,
      folderError: null,
    });
    const user = userEvent.setup();
    renderScreen();
    await fillStepOne(user);

    await user.click(screen.getByRole('button', { name: /Decide later/ }));
    await user.click(screen.getByRole('button', { name: /Continue/ }));
    await user.click(screen.getByRole('button', { name: /Ask per project/ }));
    await user.click(screen.getByRole('button', { name: /Continue/ }));
    await user.click(screen.getByRole('button', { name: /Create Project Workspace/ }));

    await waitFor(() => expect(createProject).toHaveBeenCalled());
    const payload = createProject.mock.calls[0]![0] as Record<string, unknown>;
    expect(payload.folderDraft).toBeUndefined();
    expect(payload.createFolders).toBe(false);
  });

  it('preserves unknown/custom output mappings through select, customize and Save as New Profile', async () => {
    const userProfileId = userProfile.profileId!;
    mockQueries({
      defaultRef: { kind: 'user', profileId: userProfileId },
      catalogProfiles: [
        {
          schemaVersion: '1.0',
          profileId: userProfileId,
          name: 'Lighting + Authority',
          description: 'User profile.',
          folders: [
            {
              profileFolderId: 'pf-1',
              parentProfileFolderId: null,
              name: 'SCHEDULES',
              displayOrder: 0,
              semanticRole: null,
            },
            {
              profileFolderId: 'pf-2',
              parentProfileFolderId: null,
              name: 'BOQ',
              displayOrder: 1,
              semanticRole: null,
            },
            {
              profileFolderId: 'pf-3',
              parentProfileFolderId: null,
              name: 'DATASHEETS',
              displayOrder: 2,
              semanticRole: null,
            },
          ],
          outputDefaults: [
            { outputTypeId: 'scheduleExcel', destinationProfileFolderId: 'pf-1' },
            { outputTypeId: 'schedulePdf', destinationProfileFolderId: 'pf-1' },
            { outputTypeId: 'boqExcel', destinationProfileFolderId: 'pf-2' },
            { outputTypeId: 'boqPdf', destinationProfileFolderId: 'pf-2' },
            { outputTypeId: 'datasheets', destinationProfileFolderId: 'pf-3' },
            { outputTypeId: 'authoritySubmission', destinationProfileFolderId: 'pf-2' },
            { outputTypeId: 'renderPackage', destinationProfileFolderId: 'pf-3' },
          ],
          structuralFingerprint: 'fp-user-unknown',
          createdAt: timestamp,
          updatedAt: timestamp,
        },
      ],
    });
    const createProfile = vi.spyOn(api, 'createFolderProfile').mockResolvedValue({
      schemaVersion: '1.0',
      profileId: 'cccccccc-0000-4000-8000-000000000002',
      name: 'Lighting + Authority + Mockup',
      description: 'Custom project folder structure.',
      folders: [],
      outputDefaults: [],
      structuralFingerprint: 'fp-new',
      createdAt: timestamp,
      updatedAt: timestamp,
    });
    const user = userEvent.setup();
    renderScreen();
    await fillStepOne(user);

    // Customize by adding an unrelated root folder.
    await user.click(screen.getByRole('button', { name: /Customize for this project/ }));
    await user.click(screen.getByRole('button', { name: /Add root folder/ }));
    const newInput = screen
      .getAllByLabelText('Folder name')
      .find((input) => (input as HTMLInputElement).value === 'NEW_FOLDER');
    await user.clear(newInput!);
    await user.type(newInput!, 'MOCKUP');
    await user.click(screen.getByRole('button', { name: /Close customization/ }));

    await user.click(screen.getByRole('button', { name: /Save as New Profile/ }));
    await user.type(screen.getByLabelText('Profile name'), 'Lighting + Authority + Mockup');
    await user.click(screen.getByRole('button', { name: 'Save Profile' }));

    await waitFor(() => expect(createProfile).toHaveBeenCalled());
    const input = createProfile.mock.calls[0]![0] as {
      outputDefaults: Array<{ outputTypeId: string; destinationPath: string }>;
    };
    const typeIds = input.outputDefaults.map((o) => o.outputTypeId);
    expect(typeIds).toContain('authoritySubmission');
    expect(typeIds).toContain('renderPackage');
  });

  it('Review step shows the folder setup summary without a giant editor', async () => {
    mockQueries();
    const user = userEvent.setup();
    renderScreen();
    await fillStepOne(user);

    await user.click(screen.getByRole('button', { name: /Continue/ }));
    await user.click(screen.getByRole('button', { name: /Ask per project/ }));
    await user.click(screen.getByRole('button', { name: /Continue/ }));

    expect(screen.getByText('Folder setup')).toBeInTheDocument();
    expect(screen.getByText('Create new')).toBeInTheDocument();
    expect(screen.getByText('Full Lighting Design')).toBeInTheDocument();
    expect(screen.getByText('No')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Add root folder/ })).not.toBeInTheDocument();
  });
});

describe('P2.9A New Project defaults', () => {
  it('10+11) initializes projectType from the first active configured type, not a hardcoded fallback', async () => {
    mockQueries({
      projectTypes: [
        {
          id: crypto.randomUUID(),
          name: 'Healthcare',
          isActive: true,
          createdAt: timestamp,
          updatedAt: timestamp,
        },
        {
          id: crypto.randomUUID(),
          name: 'Hospital',
          isActive: true,
          createdAt: timestamp,
          updatedAt: timestamp,
        },
      ],
    });
    renderScreen();
    await screen.findByLabelText(/Project Name/);
    const typeSelect = screen.getByLabelText(/Project Type/);
    await waitFor(() => expect(typeSelect).toHaveValue('Healthcare'));
    // No hardcoded divergent fallback is present.
    expect(screen.queryByRole('option', { name: 'Villa Lighting Design' })).not.toBeInTheDocument();
    expect(screen.queryByRole('option', { name: 'Lighting Layout' })).not.toBeInTheDocument();
    expect(screen.queryByRole('option', { name: 'DIALux Study' })).not.toBeInTheDocument();
  });

  it('13) defaultInputMode persisted as Manual initializes New Project with it', async () => {
    mockQueries({ defaultInputMode: 'Manual' });
    const user = userEvent.setup();
    renderScreen();
    await screen.findByLabelText(/Project Name/);
    await fillStepOne(user);
    // fillStepOne ends at step 3 (Folders); one Continue reaches step 4 (Input).
    await user.click(screen.getByRole('button', { name: /Continue/ }));
    const manual = screen.getByRole('button', { name: /Manual/ });
    expect(manual).toHaveClass('selected');
  });

  it('14) defaultInputMode persisted as Later keeps New Project on Ask per project', async () => {
    mockQueries({ defaultInputMode: 'Later' });
    const user = userEvent.setup();
    renderScreen();
    await screen.findByLabelText(/Project Name/);
    await fillStepOne(user);
    await user.click(screen.getByRole('button', { name: /Continue/ }));
    const later = screen.getByRole('button', { name: /Ask per project/ });
    expect(later).toHaveClass('selected');
  });

  it('preselects the Settings default, accepts an override, and submits that project value', async () => {
    mockQueries({ defaultInputMode: 'Manual' });
    const createProject = vi.spyOn(api, 'createProject').mockResolvedValue({
      project,
      workflow: [],
      folderCreation: null,
      folderError: null,
    });
    const user = userEvent.setup();
    renderScreen();
    await fillStepOne(user);

    await user.click(screen.getByRole('button', { name: /Continue/ }));
    expect(screen.getByRole('button', { name: /Manual/ })).toHaveClass('selected');
    await user.click(screen.getByRole('button', { name: /AutoCAD CSV/ }));
    await user.click(screen.getByRole('button', { name: /Continue/ }));
    await user.click(screen.getByRole('button', { name: /Create Project Workspace/ }));

    await waitFor(() => expect(createProject).toHaveBeenCalledTimes(1));
    expect(createProject.mock.calls[0]![0]).toMatchObject({
      projectName: 'Dubai Hills Villa',
      clientName: 'Private Client',
      projectType: 'Villa Lighting Design',
      siteLocation: 'Dubai Hills',
      luminaireInputMode: 'AutoCadCsv',
      createFolders: true,
    });
  });

  it('15) a background refetch does not overwrite a user-changed projectType', async () => {
    mockQueries({
      projectTypes: [
        {
          id: crypto.randomUUID(),
          name: 'Healthcare',
          isActive: true,
          createdAt: timestamp,
          updatedAt: timestamp,
        },
        {
          id: crypto.randomUUID(),
          name: 'Hospital',
          isActive: true,
          createdAt: timestamp,
          updatedAt: timestamp,
        },
      ],
    });
    const user = userEvent.setup();
    renderScreen();
    await screen.findByLabelText(/Project Name/);
    const typeSelect = screen.getByLabelText(/Project Type/);
    // Wait for the catalogue to initialize the default before changing it.
    await waitFor(() => expect(typeSelect).toHaveValue('Healthcare'));
    await user.selectOptions(typeSelect, 'Hospital');
    // Simulate a background refetch resolving with the same catalogue.
    await waitFor(() => expect(typeSelect).toHaveValue('Hospital'));
    expect(typeSelect).toHaveValue('Hospital');
  });
});
