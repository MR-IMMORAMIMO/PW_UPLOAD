// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type {
  FolderProfile,
  FolderProfilePreset,
  FolderProfileRef,
  PersonalWorkspaceSettings,
} from '@scli/domain';
import { api } from '../api';
import type { FolderProfileCatalogResponse } from '../api';
import { useAppContext } from '../app-context';
import { ToastProvider } from '../components/toast';
import { PersonalSettingsScreen } from './personal-settings';

vi.mock('../app-context', () => ({ useAppContext: vi.fn() }));

const makeSettings = (defaultFolderProfile: string): PersonalWorkspaceSettings => ({
  projectRoot: 'D:\\SCLI PROJECTS',
  defaultFolderProfile,
  defaultInputMode: 'Later',
  autoOpenProjectFolder: true,
  designerName: 'Mohamed',
  companyName: 'SCIENTECHNIC',
  companyLogoPath: '',
  accentColor: '#008C95',
  timeZone: 'Asia/Dubai',
  backupRetention: 20,
  updatedAt: '2026-08-07T00:00:00.000Z',
});

const factoryProfiles: FolderProfilePreset[] = [
  {
    name: 'Full Lighting Design',
    description: 'Complete design.',
    folders: [
      {
        name: '03_DRAWINGS',
        children: [
          { name: 'WORKING', children: [] },
          { name: 'PDF', children: [] },
        ],
      },
    ],
    outputFolders: {
      scheduleExcel: '03_DRAWINGS/WORKING',
      schedulePdf: '03_DRAWINGS/PDF',
      boqExcel: '03_DRAWINGS/WORKING',
      boqPdf: '03_DRAWINGS/PDF',
      datasheets: '03_DRAWINGS',
    },
    builtIn: true,
    factoryProfileKey: 'full-lighting-design',
    source: 'factory',
  },
];

const userProfile: FolderProfile = {
  schemaVersion: '1.0',
  profileId: 'cccccccc-0000-4000-8000-000000000001',
  name: 'Lighting + Authority',
  description: 'Reality profile',
  folders: [
    {
      profileFolderId: 'f0',
      parentProfileFolderId: null,
      name: '03_DRAWINGS',
      displayOrder: 0,
      semanticRole: null,
    },
    {
      profileFolderId: 'f1',
      parentProfileFolderId: 'f0',
      name: 'WORKING',
      displayOrder: 0,
      semanticRole: null,
    },
    {
      profileFolderId: 'f2',
      parentProfileFolderId: 'f0',
      name: 'PDF',
      displayOrder: 1,
      semanticRole: null,
    },
  ],
  outputDefaults: [
    { outputTypeId: 'scheduleExcel', destinationProfileFolderId: 'f1' },
    { outputTypeId: 'schedulePdf', destinationProfileFolderId: 'f2' },
    { outputTypeId: 'CustomDeliverable', destinationProfileFolderId: 'f0' },
  ],
  structuralFingerprint: 'fingerprint-1',
  createdAt: '2026-08-07T00:00:00.000Z',
  updatedAt: '2026-08-07T00:00:00.000Z',
};

const userPresets: FolderProfilePreset[] = [
  {
    name: 'Lighting + Authority',
    description: 'Reality profile',
    folders: [
      {
        name: '03_DRAWINGS',
        children: [
          { name: 'WORKING', children: [] },
          { name: 'PDF', children: [] },
        ],
      },
    ],
    outputFolders: {
      scheduleExcel: '03_DRAWINGS/WORKING',
      schedulePdf: '03_DRAWINGS/PDF',
      boqExcel: '03_DRAWINGS/WORKING',
      boqPdf: '03_DRAWINGS/PDF',
      datasheets: '03_DRAWINGS',
    },
    builtIn: false,
    source: 'user',
    profileId: userProfile.profileId,
  },
];

const legacyPresets: FolderProfilePreset[] = [
  {
    name: 'Old Facade',
    description: 'Historical facade profile.',
    folders: [{ name: '01_RECEIVED', children: [] }],
    outputFolders: {
      scheduleExcel: '01_RECEIVED',
      schedulePdf: '01_RECEIVED',
      boqExcel: '01_RECEIVED',
      boqPdf: '01_RECEIVED',
      datasheets: '01_RECEIVED',
    },
    builtIn: false,
    source: 'legacy',
  },
];

function catalogResponse(defaultProfileRef: FolderProfileRef): FolderProfileCatalogResponse {
  return {
    schemaVersion: '1.0' as const,
    profiles: [userProfile],
    defaultProfileRef,
    defaultProfileId: defaultProfileRef.kind === 'user' ? defaultProfileRef.profileId : null,
    effectiveDefaultRef: defaultProfileRef,
    legacyDefaultFolderProfile: 'Full Lighting Design',
    legacyDefaultMatch: 'canonical',
    legacyImportRequired: false,
  };
}
function setActor(): void {
  vi.mocked(useAppContext).mockReturnValue({
    currentUser: {
      id: '66666666-6666-4666-8666-666666666666',
      entraObjectId: 'entra-66666666',
      displayName: 'Daniel Brooks',
      email: 'daniel@scli.example',
      jobTitle: 'Design Manager',
      department: 'Design Studio',
      role: 'LineManager',
      weeklyCapacityHours: 0,
      availabilityStatus: 'Available',
      avatarUrl: null,
      isActive: true,
      createdAt: '2026-08-01T08:00:00.000Z',
      updatedAt: '2026-08-01T08:00:00.000Z',
    },
    mockUsers: [],
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
      <ToastProvider>
        <PersonalSettingsScreen />
      </ToastProvider>
    </QueryClientProvider>,
  );
}

const defaultCatalog = catalogResponse({
  kind: 'factory',
  factoryProfileKey: 'full-lighting-design',
});

beforeEach(() => {
  setActor();
  vi.spyOn(api, 'personalSettings').mockResolvedValue(makeSettings('Full Lighting Design'));
  vi.spyOn(api, 'folderProfiles').mockResolvedValue([
    ...factoryProfiles,
    ...userPresets,
    ...legacyPresets,
  ]);
  vi.spyOn(api, 'folderProfileCatalog').mockResolvedValue(defaultCatalog);
  vi.spyOn(api, 'backups').mockResolvedValue([]);
  vi.spyOn(api, 'personalProjectTypes').mockResolvedValue([
    {
      id: 'aaaaaaaa-0000-4000-8000-000000000001',
      name: 'Villa Lighting Design',
      isActive: true,
      createdAt: '2026-08-01T08:00:00.000Z',
      updatedAt: '2026-08-01T08:00:00.000Z',
    },
    {
      id: 'bbbbbbbb-0000-4000-8000-000000000002',
      name: 'Hospital',
      isActive: true,
      createdAt: '2026-08-01T08:00:00.000Z',
      updatedAt: '2026-08-01T08:00:00.000Z',
    },
  ]);
  vi.spyOn(api, 'updatePersonalProjectTypes').mockImplementation(async (types) => types);
  vi.spyOn(api, 'updatePersonalSettings').mockResolvedValue(makeSettings('Full Lighting Design'));
  vi.spyOn(api, 'createBackup').mockResolvedValue({ backupPath: 'C:\\backup.sqlite' });
  vi.spyOn(api, 'restoreBackup').mockResolvedValue({ pendingPath: 'x', restartRequired: true });
  vi.spyOn(api, 'createFolderProfile').mockResolvedValue(userProfile);
  vi.spyOn(api, 'updateFolderProfile').mockResolvedValue(userProfile);
  vi.spyOn(api, 'deleteFolderProfile').mockResolvedValue({ deleted: true });
  vi.spyOn(api, 'setFolderProfileDefault').mockImplementation(async (ref) => catalogResponse(ref));
  vi.spyOn(api, 'importLegacyFolderProfile').mockResolvedValue(userProfile);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

async function openNewProfile() {
  renderScreen();
  const user = userEvent.setup();
  const button = await screen.findByRole('button', { name: /New Profile/i });
  await user.click(button);
  return user;
}

function getFactoryRow() {
  const heading = screen
    .getAllByText('Factory profiles')
    .find((el) => el.closest('.profile-list-section'));
  const section = heading?.closest('.profile-list-section') as HTMLElement;
  const row = within(section)
    .getAllByText('Full Lighting Design')
    .find((el) => el.closest('.profile-row'));
  return row?.closest('.profile-row') as HTMLElement;
}

function userProfileRow() {
  const row = screen.getAllByText('Lighting + Authority').find((el) => el.closest('.profile-row'));
  return row?.closest('.profile-row') as HTMLElement;
}

interface DraftNode {
  profileFolderId?: string;
  name: string;
  children: DraftNode[];
}

function collectFolderIds(nodes: DraftNode[]): string[] {
  return nodes.flatMap((node) => [
    ...(node.profileFolderId ? [node.profileFolderId] : []),
    ...collectFolderIds(node.children),
  ]);
}

function findDraftNode(nodes: DraftNode[], name: string): DraftNode | null {
  for (const node of nodes) {
    if (node.name === name) return node;
    const found = findDraftNode(node.children, name);
    if (found) return found;
  }
  return null;
}

describe('Settings integration', () => {
  it('separates Factory, User, and Legacy profiles and offers Blank default', async () => {
    renderScreen();
    await screen.findByText('Folder Profiles');
    expect(screen.getAllByText('Full Lighting Design').length).toBeGreaterThan(0);
    expect(userProfileRow()).toBeTruthy();
    expect(screen.getByText('Old Facade')).toBeTruthy();
    const defaultSelect = screen.getByLabelText('Default folder profile');
    expect(within(defaultSelect).getByText('Blank')).toBeTruthy();
    expect(within(defaultSelect).queryByText('Old Facade')).toBeNull();
  });

  it('renders the Folder Profiles card and keeps unrelated settings visible', async () => {
    renderScreen();
    expect(await screen.findByText('Folder Profiles')).toBeTruthy();
    expect(screen.getByText('Identity & branding')).toBeTruthy();
    expect(screen.getByText('Project folders')).toBeTruthy();
    expect(screen.getByText('Workspace preferences')).toBeTruthy();
    expect(screen.getByText('Factory profiles')).toBeTruthy();
    expect(screen.getByText('My profiles')).toBeTruthy();
    expect(screen.getByText('Legacy profiles')).toBeTruthy();
  });

  it('shows exactly one Default Folder Profile control', async () => {
    renderScreen();
    await screen.findByText('Folder Profiles');
    expect(screen.getAllByLabelText('Default folder profile')).toHaveLength(1);
    expect(screen.queryAllByLabelText('Default Folder Profile')).toHaveLength(0);
  });
});

describe('Factory profiles', () => {
  it('previews a factory profile read-only', async () => {
    const user = userEvent.setup();
    renderScreen();
    await screen.findByText('Folder Profiles');
    const previewButtons = screen.getAllByRole('button', { name: 'Preview' });
    await user.click(previewButtons[0]!);
    expect(await screen.findByRole('dialog', { name: 'Profile preview' })).toBeTruthy();
    const dialog = screen.getByRole('dialog', { name: 'Profile preview' });
    expect(within(dialog).getByText('Factory')).toBeTruthy();
    expect(within(dialog).getByText('03_DRAWINGS')).toBeTruthy();
    expect(within(dialog).queryByText(/Template folder structure/i)).toBeNull();
    expect(within(dialog).queryByRole('button', { name: /Save/ })).toBeNull();
    expect(api.createFolderProfile).not.toHaveBeenCalled();
    expect(api.updateFolderProfile).not.toHaveBeenCalled();
    expect(api.deleteFolderProfile).not.toHaveBeenCalled();
  });

  it('does not offer Edit or Delete on a factory profile', async () => {
    renderScreen();
    await screen.findByText('Folder Profiles');
    const factoryRow = getFactoryRow();
    expect(within(factoryRow).queryByRole('button', { name: 'Edit' })).toBeNull();
    expect(within(factoryRow).queryByRole('button', { name: 'Delete' })).toBeNull();
    expect(within(factoryRow).getByRole('button', { name: 'Duplicate' })).toBeTruthy();
    expect(within(factoryRow).getByRole('button', { name: 'Set as Default' })).toBeTruthy();
  });

  it('duplicates a factory profile into a canonical user profile with a confirmed name', async () => {
    const user = userEvent.setup();
    renderScreen();
    await screen.findByText('Folder Profiles');
    const heading = screen
      .getAllByText('Factory profiles')
      .find((el) => el.closest('.profile-list-section')) as HTMLElement;
    const section = heading.closest('.profile-list-section') as HTMLElement;
    const duplicateButtons = within(section).getAllByRole('button', { name: 'Duplicate' });
    await user.click(duplicateButtons[0]!);
    expect(await screen.findByRole('dialog', { name: /Duplicate/ })).toBeTruthy();
    const nameInput = screen.getByLabelText('Duplicate profile name');
    await user.clear(nameInput);
    await user.type(nameInput, 'Full Lighting Custom');
    const dialog = screen.getByRole('dialog', { name: /Duplicate/ });
    await user.click(within(dialog).getByRole('button', { name: 'Duplicate' }));
    const editor = await screen.findByRole('dialog', { name: 'New folder profile' });
    expect(within(editor).getByDisplayValue('Full Lighting Custom')).toBeTruthy();
    await user.click(within(editor).getByRole('button', { name: 'Save' }));
    await waitFor(() => {
      expect(api.createFolderProfile).toHaveBeenCalledTimes(1);
    });
    const body = vi.mocked(api.createFolderProfile).mock.calls[0]![0];
    expect(body.name).toBe('Full Lighting Custom');
    expect(body.folders.length).toBeGreaterThan(0);
  });

  it('sets a factory default using factoryProfileKey', async () => {
    const user = userEvent.setup();
    renderScreen();
    await screen.findByText('Folder Profiles');
    const factoryRow = getFactoryRow();
    await user.click(within(factoryRow).getByRole('button', { name: 'Set as Default' }));
    await waitFor(() => {
      expect(vi.mocked(api.setFolderProfileDefault).mock.calls[0]![0]).toEqual({
        kind: 'factory',
        factoryProfileKey: 'full-lighting-design',
      });
    });
  });
});

describe('User profiles', () => {
  it('creates a user profile through the New Profile drawer', async () => {
    const user = await openNewProfile();
    expect(await screen.findByRole('dialog', { name: 'New folder profile' })).toBeTruthy();
    await user.type(screen.getByLabelText('Profile name'), 'Lighting + Authority');
    await user.type(screen.getByLabelText('Profile description'), 'A new profile');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => {
      expect(api.createFolderProfile).toHaveBeenCalledTimes(1);
    });
    expect(vi.mocked(api.createFolderProfile).mock.calls[0]![0].name).toBe('Lighting + Authority');
  });
  it('edit preserves profile identity and folder node ids', async () => {
    const user = userEvent.setup();
    renderScreen();
    await screen.findByText('Folder Profiles');
    const userRow = userProfileRow();
    await user.click(within(userRow).getByRole('button', { name: 'Edit' }));
    expect(await screen.findByRole('dialog', { name: 'Edit folder profile' })).toBeTruthy();
    const nameInput = screen.getByLabelText('Profile name');
    await user.clear(nameInput);
    await user.type(nameInput, 'Renamed Profile');
    const workingInput = screen.getByDisplayValue('WORKING');
    fireEvent.change(workingInput, { target: { value: 'WORKING_DRAWINGS' } });
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => {
      expect(api.updateFolderProfile).toHaveBeenCalledTimes(1);
    });
    const [profileId, body] = vi.mocked(api.updateFolderProfile).mock.calls[0]!;
    expect(profileId).toBe(userProfile.profileId);
    expect(body.name).toBe('Renamed Profile');
    const ids = collectFolderIds(body.folders as unknown as DraftNode[]);
    expect(ids).toEqual(expect.arrayContaining(['f0', 'f1', 'f2']));
    const renamed = findDraftNode(body.folders as unknown as DraftNode[], 'WORKING_DRAWINGS');
    expect(renamed?.profileFolderId).toBe('f1');
  });

  it('removing an unmapped template folder succeeds', async () => {
    const user = userEvent.setup();
    renderScreen();
    await screen.findByText('Folder Profiles');
    const userRow = userProfileRow();
    await user.click(within(userRow).getByRole('button', { name: 'Edit' }));
    await screen.findByRole('dialog', { name: 'Edit folder profile' });
    await user.click(screen.getByRole('button', { name: /Add root folder/ }));
    const newInput = screen.getByDisplayValue('NEW_FOLDER');
    const newNode = newInput.closest('.folder-tree-node') as HTMLElement;
    await user.click(within(newNode).getByTitle('Delete folder'));
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(api.updateFolderProfile).toHaveBeenCalled());
    const body = vi.mocked(api.updateFolderProfile).mock.calls[0]![1];
    expect(body.folders.some((node) => node.name === 'NEW_FOLDER')).toBe(false);
  });

  it('blocks deleting a folder targeted by an output default', async () => {
    const user = userEvent.setup();
    renderScreen();
    await screen.findByText('Folder Profiles');
    const userRow = userProfileRow();
    await user.click(within(userRow).getByRole('button', { name: 'Edit' }));
    await screen.findByRole('dialog', { name: 'Edit folder profile' });
    const workingInput = screen.getByDisplayValue('WORKING');
    const workingNode = workingInput.closest('.folder-tree-node') as HTMLElement;
    expect(within(workingNode).getByTitle('Delete folder')).toBeDisabled();
    expect(within(workingNode).getByText(/Targeted by an output default/)).toBeTruthy();
    const pdfInput = screen.getByDisplayValue('PDF');
    const pdfNode = pdfInput.closest('.folder-tree-node') as HTMLElement;
    expect(within(pdfNode).getByTitle('Delete folder')).toBeDisabled();
  });

  it('deleting a user profile requires explicit confirmation', async () => {
    const user = userEvent.setup();
    renderScreen();
    await screen.findByText('Folder Profiles');
    const userRow = userProfileRow();
    await user.click(within(userRow).getByRole('button', { name: 'Delete' }));
    expect(await screen.findByRole('dialog', { name: /Delete/ })).toBeTruthy();
    expect(api.deleteFolderProfile).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Delete Profile' }));
    await waitFor(() => {
      expect(vi.mocked(api.deleteFolderProfile).mock.calls[0]![0]).toBe(userProfile.profileId);
    });
  });
});

describe('Default selection', () => {
  it('saves a user default using canonical profile id', async () => {
    const user = userEvent.setup();
    renderScreen();
    await screen.findByText('Folder Profiles');
    const select = screen.getByLabelText('Default folder profile');
    await user.selectOptions(select, `user:${userProfile.profileId}`);
    await waitFor(() => {
      expect(vi.mocked(api.setFolderProfileDefault).mock.calls[0]![0]).toEqual({
        kind: 'user',
        profileId: userProfile.profileId,
      });
    });
  });

  it('saves a blank default', async () => {
    const user = userEvent.setup();
    renderScreen();
    await screen.findByText('Folder Profiles');
    const select = screen.getByLabelText('Default folder profile');
    await user.selectOptions(select, 'blank');
    await waitFor(() => {
      expect(vi.mocked(api.setFolderProfileDefault).mock.calls[0]![0]).toEqual({ kind: 'blank' });
    });
  });
});

describe('Legacy profiles', () => {
  it('shows legacy separately and never offers it as a direct default', async () => {
    renderScreen();
    await screen.findByText('Folder Profiles');
    const defaultSelect = screen.getByLabelText('Default folder profile');
    expect(within(defaultSelect).queryByText('Old Facade')).toBeNull();
    const legacyRow = screen.getByText('Old Facade').closest('.profile-row') as HTMLElement;
    expect(within(legacyRow).queryByRole('button', { name: 'Edit' })).toBeNull();
    expect(within(legacyRow).queryByRole('button', { name: 'Set as Default' })).toBeNull();
    expect(within(legacyRow).queryByRole('button', { name: 'Delete' })).toBeNull();
    expect(within(legacyRow).getByRole('button', { name: 'Import' })).toBeTruthy();
  });

  it('imports a legacy profile after confirmation', async () => {
    const user = userEvent.setup();
    renderScreen();
    await screen.findByText('Folder Profiles');
    const legacyRow = screen.getByText('Old Facade').closest('.profile-row') as HTMLElement;
    await user.click(within(legacyRow).getByRole('button', { name: 'Import' }));
    expect(await screen.findByRole('dialog', { name: /Import/ })).toBeTruthy();
    expect(api.importLegacyFolderProfile).not.toHaveBeenCalled();
    const dialog = screen.getByRole('dialog', { name: /Import/ });
    await user.click(within(dialog).getByRole('button', { name: 'Import' }));
    await waitFor(() => {
      expect(vi.mocked(api.importLegacyFolderProfile).mock.calls[0]![0]).toBe('Old Facade');
    });
  });
});

describe('Output defaults', () => {
  it('offers only known UI output types, not arbitrary creation', async () => {
    const user = await openNewProfile();
    await screen.findByRole('dialog', { name: 'New folder profile' });
    expect(screen.getByText('Known output defaults')).toBeTruthy();
    expect(screen.getByText('Luminaire Schedule · Excel')).toBeTruthy();
    expect(screen.getByText('Datasheets package')).toBeTruthy();
    const mappingGrid = screen
      .getByText('Known output defaults')
      .closest('.output-folder-mapping') as HTMLElement;
    expect(within(mappingGrid).getAllByRole('combobox')).toHaveLength(5);
    void user;
  });

  it('shows preserved unknown output mappings read-only in preview', async () => {
    const user = userEvent.setup();
    renderScreen();
    await screen.findByText('Folder Profiles');
    const userRow = userProfileRow();
    await user.click(within(userRow).getByRole('button', { name: 'Preview' }));
    const dialog = await screen.findByRole('dialog', { name: 'Profile preview' });
    expect(within(dialog).getByText(/Additional preserved output mappings: 1/)).toBeTruthy();
    expect(within(dialog).getByText('CustomDeliverable')).toBeTruthy();
  });

  it('preserves unknown output mappings through edit and save', async () => {
    const user = userEvent.setup();
    renderScreen();
    await screen.findByText('Folder Profiles');
    const userRow = userProfileRow();
    await user.click(within(userRow).getByRole('button', { name: 'Edit' }));
    await screen.findByRole('dialog', { name: 'Edit folder profile' });
    const nameInput = screen.getByLabelText('Profile name');
    await user.clear(nameInput);
    await user.type(nameInput, 'Renamed With Custom');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(api.updateFolderProfile).toHaveBeenCalled());
    const body = vi.mocked(api.updateFolderProfile).mock.calls[0]![1];
    expect(body.outputDefaults).toContainEqual({
      outputTypeId: 'CustomDeliverable',
      destinationPath: '03_DRAWINGS',
    });
  });

  it('preserves unknown output mappings through duplicate', async () => {
    const user = userEvent.setup();
    renderScreen();
    await screen.findByText('Folder Profiles');
    const userRow = userProfileRow();
    await user.click(within(userRow).getByRole('button', { name: 'Duplicate' }));
    const dialog = await screen.findByRole('dialog', { name: /Duplicate/ });
    await user.click(within(dialog).getByRole('button', { name: 'Duplicate' }));
    const editor = await screen.findByRole('dialog', { name: 'New folder profile' });
    await user.click(within(editor).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(api.createFolderProfile).toHaveBeenCalled());
    const body = vi.mocked(api.createFolderProfile).mock.calls[0]![0];
    expect(body.outputDefaults).toContainEqual({
      outputTypeId: 'CustomDeliverable',
      destinationPath: '03_DRAWINGS',
    });
  });

  it('remaps output defaults when a targeted folder is renamed', async () => {
    const user = userEvent.setup();
    renderScreen();
    await screen.findByText('Folder Profiles');
    const userRow = userProfileRow();
    await user.click(within(userRow).getByRole('button', { name: 'Edit' }));
    await screen.findByRole('dialog', { name: 'Edit folder profile' });
    const workingInput = screen.getByDisplayValue('WORKING');
    fireEvent.change(workingInput, { target: { value: 'WORKING_DRAWINGS' } });
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(api.updateFolderProfile).toHaveBeenCalled());
    const body = vi.mocked(api.updateFolderProfile).mock.calls[0]![1];
    expect(body.outputDefaults).toContainEqual({
      outputTypeId: 'scheduleExcel',
      destinationPath: '03_DRAWINGS/WORKING_DRAWINGS',
    });
    expect(body.outputDefaults).toContainEqual({
      outputTypeId: 'CustomDeliverable',
      destinationPath: '03_DRAWINGS',
    });
  });
});

describe('Boundaries', () => {
  it('cancel create performs no API write', async () => {
    const user = await openNewProfile();
    await screen.findByRole('dialog', { name: 'New folder profile' });
    await user.type(screen.getByLabelText('Profile name'), 'Discarded Profile');
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(api.createFolderProfile).not.toHaveBeenCalled();
  });

  it('does not silently discard meaningful unsaved edits', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false);
    const user = userEvent.setup();
    renderScreen();
    await screen.findByText('Folder Profiles');
    const userRow = userProfileRow();
    await user.click(within(userRow).getByRole('button', { name: 'Edit' }));
    await screen.findByRole('dialog', { name: 'Edit folder profile' });
    await user.clear(screen.getByLabelText('Profile name'));
    await user.type(screen.getByLabelText('Profile name'), 'Uncommitted');
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(confirmSpy).toHaveBeenCalled();
    expect(api.updateFolderProfile).not.toHaveBeenCalled();
    confirmSpy.mockRestore();
  });

  it('profile editor never calls folder-actions APIs', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const user = await openNewProfile();
    await screen.findByRole('dialog', { name: 'New folder profile' });
    await user.type(screen.getByLabelText('Profile name'), 'No Folder Actions');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(api.createFolderProfile).toHaveBeenCalled());
    const urls = fetchMock.mock.calls.map((call) => String(call[0]));
    expect(urls.some((url) => url.includes('folder-actions'))).toBe(false);
    vi.unstubAllGlobals();
  });
});

describe('P2.9A Personal Project Types', () => {
  it('1) displays the configured project types', async () => {
    renderScreen();
    await screen.findByText('Project Types');
    expect(screen.getByLabelText('Project type Villa Lighting Design')).toHaveValue(
      'Villa Lighting Design',
    );
    expect(screen.getByLabelText('Project type Hospital')).toHaveValue('Hospital');
  });

  it('2+3) adds a valid type and rejects a blank type', async () => {
    const user = userEvent.setup();
    renderScreen();
    await screen.findByText('Project Types');
    const input = screen.getByLabelText('New project type name');
    await user.type(input, 'Healthcare');
    await user.click(screen.getByRole('button', { name: 'Add type' }));
    expect(screen.getByLabelText('Project type Healthcare')).toHaveValue('Healthcare');
    // Blank rejected.
    await user.click(screen.getByRole('button', { name: 'Add type' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Project type name is required.');
  });

  it('4) rejects a duplicate active type', async () => {
    const user = userEvent.setup();
    renderScreen();
    await screen.findByText('Project Types');
    const input = screen.getByLabelText('New project type name');
    await user.type(input, 'hospital');
    await user.click(screen.getByRole('button', { name: 'Add type' }));
    expect(screen.getByRole('alert')).toHaveTextContent('already exists');
  });

  it('5) rename updates the catalogue entry', async () => {
    const user = userEvent.setup();
    renderScreen();
    await screen.findByText('Project Types');
    const field = screen.getByLabelText('Project type Hospital');
    await user.clear(field);
    await user.type(field, 'Healthcare');
    await user.click(screen.getByRole('button', { name: 'Save Project Types' }));
    await waitFor(() => expect(api.updatePersonalProjectTypes).toHaveBeenCalled());
    const saved = vi.mocked(api.updatePersonalProjectTypes).mock.calls[0]![0];
    expect(saved.find((type) => type.name === 'Healthcare')).toBeTruthy();
  });

  it('7+8) deactivate makes a type unavailable for new selection without mutating existing projects', async () => {
    const user = userEvent.setup();
    renderScreen();
    await screen.findByText('Project Types');
    const hospitalRow = screen
      .getByLabelText('Project type Hospital')
      .closest('.project-type-row') as HTMLElement;
    await user.click(within(hospitalRow).getByRole('button', { name: 'Active' }));
    await user.click(screen.getByRole('button', { name: 'Save Project Types' }));
    await waitFor(() => expect(api.updatePersonalProjectTypes).toHaveBeenCalled());
    const saved = vi.mocked(api.updatePersonalProjectTypes).mock.calls[0]![0];
    expect(saved.find((type) => type.name === 'Hospital')?.isActive).toBe(false);
  });

  it('9) final active project type cannot be deactivated', async () => {
    vi.spyOn(api, 'personalProjectTypes').mockResolvedValue([
      {
        id: 'aaaaaaaa-0000-4000-8000-000000000001',
        name: 'Villa Lighting Design',
        isActive: true,
        createdAt: '2026-08-01T08:00:00.000Z',
        updatedAt: '2026-08-01T08:00:00.000Z',
      },
    ]);
    const user = userEvent.setup();
    renderScreen();
    await screen.findByText('Project Types');
    const row = screen
      .getByLabelText('Project type Villa Lighting Design')
      .closest('.project-type-row') as HTMLElement;
    await user.click(within(row).getByRole('button', { name: 'Active' }));
    expect(screen.getByRole('alert')).toHaveTextContent(
      'At least one project type must remain active',
    );
  });

  it('16) normal Personal Settings fields still save correctly', async () => {
    const user = userEvent.setup();
    renderScreen();
    await screen.findByText('Project Types');
    await user.clear(screen.getByLabelText('Designer Name'));
    await user.type(screen.getByLabelText('Designer Name'), 'Alex Morgan');
    await user.click(screen.getByRole('button', { name: 'Save Settings' }));
    await waitFor(() => expect(api.updatePersonalSettings).toHaveBeenCalled());
    const body = vi.mocked(api.updatePersonalSettings).mock.calls[0]![0] as {
      designerName: string;
    };
    expect(body.designerName).toBe('Alex Morgan');
  });

  it('H1-1) rename to an exact existing name is rejected on save', async () => {
    const user = userEvent.setup();
    renderScreen();
    await screen.findByText('Project Types');
    const field = screen.getByLabelText('Project type Hospital');
    await user.clear(field);
    await user.type(field, 'Villa Lighting Design');
    await user.click(screen.getByRole('button', { name: 'Save Project Types' }));
    expect(screen.getByRole('alert')).toHaveTextContent('must be unique');
    expect(api.updatePersonalProjectTypes).not.toHaveBeenCalled();
  });

  it('H1-2) rename to a case-variant existing name is rejected on save', async () => {
    const user = userEvent.setup();
    renderScreen();
    await screen.findByText('Project Types');
    const field = screen.getByLabelText('Project type Hospital');
    await user.clear(field);
    await user.type(field, 'villa lighting design');
    await user.click(screen.getByRole('button', { name: 'Save Project Types' }));
    expect(screen.getByRole('alert')).toHaveTextContent('must be unique');
    expect(api.updatePersonalProjectTypes).not.toHaveBeenCalled();
  });

  it('H1-3) rename with whitespace around an existing name is rejected after trim on save', async () => {
    const user = userEvent.setup();
    renderScreen();
    await screen.findByText('Project Types');
    const field = screen.getByLabelText('Project type Hospital');
    await user.clear(field);
    await user.type(field, '  Villa Lighting Design  ');
    await user.click(screen.getByRole('button', { name: 'Save Project Types' }));
    expect(screen.getByRole('alert')).toHaveTextContent('must be unique');
    expect(api.updatePersonalProjectTypes).not.toHaveBeenCalled();
  });

  it('H1-4) a valid unique rename succeeds', async () => {
    const user = userEvent.setup();
    renderScreen();
    await screen.findByText('Project Types');
    const field = screen.getByLabelText('Project type Hospital');
    await user.clear(field);
    await user.type(field, 'Healthcare');
    await user.click(screen.getByRole('button', { name: 'Save Project Types' }));
    await waitFor(() => expect(api.updatePersonalProjectTypes).toHaveBeenCalled());
    const saved = vi.mocked(api.updatePersonalProjectTypes).mock.calls[0]![0];
    expect(saved.find((type) => type.name === 'Healthcare')).toBeTruthy();
    expect(saved.find((type) => type.name === 'Hospital')).toBeUndefined();
  });

  it('H1-5) a failed rename does not persist/mutate the catalogue', async () => {
    const user = userEvent.setup();
    renderScreen();
    await screen.findByText('Project Types');
    const field = screen.getByLabelText('Project type Hospital');
    await user.clear(field);
    await user.type(field, 'Villa Lighting Design');
    await user.click(screen.getByRole('button', { name: 'Save Project Types' }));
    expect(screen.getByRole('alert')).toHaveTextContent('must be unique');
    expect(api.updatePersonalProjectTypes).not.toHaveBeenCalled();
  });
});
