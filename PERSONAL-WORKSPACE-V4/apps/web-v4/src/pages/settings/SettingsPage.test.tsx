import { v4Decisions } from '../../components/interaction/V4Decisions';
/** @vitest-environment jsdom */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { V4ThemeProvider } from '../../theme/ThemeProvider';
import { SettingsWorkspace as SettingsPage } from './SettingsWorkspace';
import { SettingsPage as FinalSettingsPage } from './SettingsPage';

const apiMock = vi.hoisted(() => ({
  personalSettings: vi.fn(),
  updatePersonalSettings: vi.fn(),
  personalProjectTypes: vi.fn(),
  updatePersonalProjectTypes: vi.fn(),
  folderProfiles: vi.fn(),
  folderProfileCatalog: vi.fn(),
  setFolderProfileDefault: vi.fn(),
  createFolderProfile: vi.fn(),
  updateFolderProfile: vi.fn(),
  importLegacyFolderProfile: vi.fn(),
  deleteFolderProfile: vi.fn(),
  listActionCategories: vi.fn(),
  createActionCategory: vi.fn(),
  updateActionCategory: vi.fn(),
  replaceAndDeleteActionCategory: vi.fn(),
  users: vi.fn(),
  createSalesContact: vi.fn(),
  updateUser: vi.fn(),
  backups: vi.fn(),
  createBackup: vi.fn(),
  restoreBackup: vi.fn(),
  testIntegrationLaunchHandoff: vi.fn(),
}));
const apiRequestMock = vi.hoisted(() => vi.fn());
vi.mock('../../api/environment', () => ({ api: apiMock, apiRequest: apiRequestMock }));

const settings = {
  projectRoot: 'D:\\SCT Workspace\\Projects',
  defaultFolderProfile: 'Full Lighting Design',
  defaultInputMode: 'Manual' as const,
  autoOpenProjectFolder: true,
  designerName: 'Mohamed',
  companyName: 'SCT Lighting Design',
  companyLogoPath: '',
  accentColor: '#008C95',
  timeZone: 'Asia/Dubai',
  backupRetention: 30,
  updatedAt: '2026-08-18T08:00:00.000Z',
};
const typeId = '10000000-0000-4000-8000-000000000001';
const categoryId = '20000000-0000-4000-8000-000000000001';
const salesId = '30000000-0000-4000-8000-000000000001';
const profileId = '40000000-0000-4000-8000-000000000001';
const profile = {
  schemaVersion: '1.0' as const,
  profileId,
  name: 'Tender Package',
  description: 'Tender outputs',
  folders: [
    {
      profileFolderId: 'root',
      parentProfileFolderId: null,
      name: 'Project',
      displayOrder: 0,
      semanticRole: null,
    },
  ],
  outputDefaults: [],
  structuralFingerprint: 'fp',
  createdAt: '2026-08-18T08:00:00.000Z',
  updatedAt: '2026-08-18T08:00:00.000Z',
};
const backupRecord = {
  fileName: 'workspace-2026-08-18.sqlite',
  filePath: 'D:\\Backups\\workspace-2026-08-18.sqlite',
  sizeBytes: 2_097_152,
  createdAt: '2026-08-18T08:00:00.000Z',
  reason: 'manual',
};

function renderPage(final = false) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <V4ThemeProvider>
        <MemoryRouter initialEntries={['/settings']}>
          {final ? <FinalSettingsPage /> : <SettingsPage />}
        </MemoryRouter>
      </V4ThemeProvider>
    </QueryClientProvider>,
  );
}

async function openDataAndBackup() {
  fireEvent.click(await screen.findByRole('button', { name: 'Data & Backup' }));
}

beforeEach(() => {
  vi.clearAllMocks();
  window.localStorage.clear();
  vi.stubGlobal(
    'matchMedia',
    vi
      .fn()
      .mockReturnValue({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() }),
  );
  vi.spyOn(v4Decisions, 'confirm').mockResolvedValue(true);
  delete window.scliDesktop;
  apiMock.personalSettings.mockResolvedValue(settings);
  apiMock.updatePersonalSettings.mockImplementation(async (body) => ({
    ...settings,
    ...(body as object),
    updatedAt: '2026-08-18T09:00:00.000Z',
  }));
  apiMock.personalProjectTypes.mockResolvedValue([
    {
      id: typeId,
      name: 'Hospitality',
      isActive: true,
      createdAt: settings.updatedAt,
      updatedAt: settings.updatedAt,
    },
  ]);
  apiMock.updatePersonalProjectTypes.mockImplementation(async (body) => body);
  apiMock.folderProfiles.mockResolvedValue([
    {
      name: 'Full Lighting Design',
      description: 'Factory',
      folders: [{ name: 'Project', children: [] }],
      outputFolders: {
        scheduleExcel: 'Project',
        schedulePdf: 'Project',
        boqExcel: 'Project',
        boqPdf: 'Project',
        datasheets: 'Project',
      },
      builtIn: true,
      factoryProfileKey: 'full-lighting-design',
      source: 'factory',
    },
  ]);
  apiMock.folderProfileCatalog.mockResolvedValue({
    schemaVersion: '1.0',
    profiles: [profile],
    defaultProfileRef: { kind: 'factory', factoryProfileKey: 'full-lighting-design' },
    defaultProfileId: null,
    effectiveDefaultRef: { kind: 'factory', factoryProfileKey: 'full-lighting-design' },
    legacyDefaultFolderProfile: 'Full Lighting Design',
    legacyDefaultMatch: 'factory',
    legacyImportRequired: false,
  });
  apiMock.setFolderProfileDefault.mockResolvedValue({});
  apiMock.listActionCategories.mockResolvedValue([
    {
      id: categoryId,
      label: 'Design',
      iconKey: 'lightbulb',
      colorKey: 'purple',
      sortOrder: 1,
      createdAt: settings.updatedAt,
      updatedAt: settings.updatedAt,
    },
  ]);
  apiMock.createActionCategory.mockImplementation(async (body) => ({
    id: categoryId,
    ...(body as object),
    sortOrder: 2,
    createdAt: settings.updatedAt,
    updatedAt: settings.updatedAt,
  }));
  apiMock.updateActionCategory.mockResolvedValue({});
  apiMock.replaceAndDeleteActionCategory.mockResolvedValue({ deleted: true });
  apiMock.users.mockResolvedValue([
    {
      id: salesId,
      entraObjectId: `local-sales:${salesId}`,
      displayName: 'Noor',
      email: 'noor@example.com',
      jobTitle: 'Sales Contact',
      department: 'Sales',
      role: 'Sales',
      weeklyCapacityHours: 0,
      availabilityStatus: 'Available',
      avatarUrl: null,
      isActive: true,
      createdAt: settings.updatedAt,
      updatedAt: settings.updatedAt,
    },
  ]);
  apiMock.createSalesContact.mockResolvedValue({});
  apiMock.updateUser.mockResolvedValue({});
  apiMock.backups.mockResolvedValue([backupRecord]);
  apiMock.createBackup.mockResolvedValue({ backupPath: backupRecord.filePath });
  apiMock.restoreBackup.mockResolvedValue({
    pendingPath: 'D:\\restore-pending.sqlite',
    restartRequired: true,
  });
});

describe('SettingsPage', () => {
  it('adds the compact Integrations & Automation section without a global switch', async () => {
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Integrations & Automation' }));
    expect(
      await screen.findByRole('heading', { name: 'Integrations & Automation' }),
    ).toBeInTheDocument();
    expect((await screen.findAllByText('Desktop unavailable')).length).toBe(2);
    expect(screen.queryByText('Automation Enabled')).not.toBeInTheDocument();
  });
  it('isolates the approved groups in keyboard-reachable General and Data & Backup sections', async () => {
    renderPage();
    for (const heading of ['Workspace', 'Identity & Branding', 'Catalogues', 'Appearance'])
      expect(await screen.findByRole('heading', { name: heading })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Data & Backup' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'General' })).toHaveAttribute('aria-pressed', 'true');
    await openDataAndBackup();
    expect(screen.getByRole('heading', { name: 'Data & Backup' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Workspace' })).not.toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Data and backup settings' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'General' }));
    expect(screen.getByRole('region', { name: 'General settings' })).toBeInTheDocument();
    for (const forbidden of [
      'Integrations',
      'Notifications',
      'System Information',
      'Typography',
      'Density',
      'Project Code',
    ])
      expect(screen.queryByText(forbidden)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save Changes' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Settings' })).toHaveAttribute(
      'aria-current',
      'page',
    );
  });

  it('preserves canonical Folder Profile default identity and supports create/edit/preview', async () => {
    apiMock.createFolderProfile.mockResolvedValue(profile);
    apiMock.updateFolderProfile.mockResolvedValue({ ...profile, name: 'Tender Package Updated' });
    renderPage();
    expect(await screen.findByTestId('v4-settings')).not.toHaveTextContent(
      'Settings data is unavailable.',
    );
    const defaultSelect = await screen.findByLabelText(/Default Folder Profile/);
    expect(defaultSelect).toHaveValue('factory:full-lighting-design');
    fireEvent.change(defaultSelect, { target: { value: `user:${profileId}` } });
    await waitFor(() => expect(apiMock.setFolderProfileDefault).toHaveBeenCalled());
    expect(apiMock.setFolderProfileDefault.mock.calls[0]?.[0]).toEqual({ kind: 'user', profileId });
    await waitFor(() => expect(defaultSelect).toBeEnabled());
    fireEvent.change(defaultSelect, { target: { value: 'blank' } });
    await waitFor(() => expect(apiMock.setFolderProfileDefault).toHaveBeenCalledTimes(2));
    expect(apiMock.setFolderProfileDefault.mock.calls[1]?.[0]).toEqual({ kind: 'blank' });

    fireEvent.click(screen.getByRole('button', { name: 'Manage Folder Profiles' }));
    fireEvent.click(screen.getByRole('button', { name: 'Preview Tender Package' }));
    const previewDialog = screen.getByRole('dialog', { name: 'Preview — Tender Package' });
    expect(previewDialog).toHaveTextContent('Project');
    fireEvent.click(within(previewDialog).getByRole('button', { name: 'Close' }));
    fireEvent.click(screen.getByRole('button', { name: 'Edit Tender Package' }));
    const editDialog = screen.getByRole('dialog', { name: 'Edit Folder Profile' });
    fireEvent.change(within(editDialog).getByLabelText('Profile name'), {
      target: { value: 'Tender Package Updated' },
    });
    fireEvent.click(within(editDialog).getByRole('button', { name: 'Save Profile' }));
    await waitFor(() => expect(apiMock.updateFolderProfile).toHaveBeenCalled());
    expect(apiMock.updateFolderProfile.mock.calls[0]?.[0]).toBe(profileId);
    expect(apiMock.updateFolderProfile.mock.calls[0]?.[1]).toEqual(
      expect.objectContaining({
        name: 'Tender Package Updated',
        folders: [expect.objectContaining({ profileFolderId: 'root', name: 'Project' })],
      }),
    );
  });

  it('creates a new canonical Folder Profile without fabricating filesystem work', async () => {
    apiMock.createFolderProfile.mockResolvedValue(profile);
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Manage Folder Profiles' }));
    fireEvent.click(screen.getByRole('button', { name: 'Create Profile' }));
    const dialog = screen.getByRole('dialog', { name: 'Create Folder Profile' });
    fireEvent.change(within(dialog).getByLabelText('Profile name'), {
      target: { value: 'Fast Track' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save Profile' }));
    await waitFor(() => expect(apiMock.createFolderProfile).toHaveBeenCalled());
    expect(apiMock.createFolderProfile.mock.calls[0]?.[0]).toEqual({
      name: 'Fast Track',
      description: null,
      folders: [{ name: 'Project', semanticRole: null, children: [] }],
      outputDefaults: [],
    });
    expect(apiRequestMock).not.toHaveBeenCalledWith(
      expect.stringContaining('/folder-actions'),
      expect.anything(),
    );
  });

  it('duplicates, imports, and safely deletes canonical Folder Profiles', async () => {
    apiMock.folderProfiles.mockResolvedValue([
      {
        name: 'Full Lighting Design',
        description: 'Factory',
        folders: [{ name: 'Project', children: [] }],
        outputFolders: {
          scheduleExcel: 'Project',
          schedulePdf: 'Project',
          boqExcel: 'Project',
          boqPdf: 'Project',
          datasheets: 'Project',
        },
        builtIn: true,
        factoryProfileKey: 'full-lighting-design',
        source: 'factory',
      },
      {
        name: 'Legacy Office',
        description: 'Legacy',
        folders: [{ name: 'Project', children: [] }],
        outputFolders: {
          scheduleExcel: 'Project',
          schedulePdf: 'Project',
          boqExcel: 'Project',
          boqPdf: 'Project',
          datasheets: 'Project',
        },
        builtIn: false,
        source: 'legacy',
      },
    ]);
    apiRequestMock.mockResolvedValue({});
    apiMock.importLegacyFolderProfile.mockResolvedValue(profile);
    apiMock.deleteFolderProfile.mockResolvedValue({ deleted: true });
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Manage Folder Profiles' }));
    const dialog = screen.getByRole('dialog', { name: 'Folder Profiles' });
    const profileRow = within(dialog)
      .getByText('Tender Package')
      .closest('.v4-settings__manage-row') as HTMLElement | null;
    expect(profileRow).not.toBeNull();

    fireEvent.click(within(profileRow!).getByRole('button', { name: 'Duplicate Tender Package' }));
    await waitFor(() =>
      expect(apiRequestMock).toHaveBeenCalledWith(
        `/api/folder-profiles/catalog/${profileId}/duplicate`,
        { method: 'POST' },
      ),
    );
    await waitFor(() =>
      expect(
        within(profileRow!).getByRole('button', { name: 'Delete Tender Package' }),
      ).toBeEnabled(),
    );

    fireEvent.click(within(dialog).getByRole('button', { name: 'Import' }));
    await waitFor(() => expect(apiMock.importLegacyFolderProfile).toHaveBeenCalled());
    expect(apiMock.importLegacyFolderProfile.mock.calls[0]?.[0]).toBe('Legacy Office (Imported)');
    await waitFor(() =>
      expect(
        within(profileRow!).getByRole('button', { name: 'Delete Tender Package' }),
      ).toBeEnabled(),
    );

    fireEvent.click(within(profileRow!).getByRole('button', { name: 'Delete Tender Package' }));
    await waitFor(() => expect(apiMock.deleteFolderProfile).toHaveBeenCalled());
    expect(apiMock.deleteFolderProfile.mock.calls[0]?.[0]).toBe(profileId);
    expect(v4Decisions.confirm).toHaveBeenCalledWith(
      'Delete Tender Package? Projects already created from it retain their stored structure.',
    );
  });

  it('uses the safe folder picker, tracks dirty state, and reconciles the returned settings', async () => {
    window.scliDesktop = { selectFolder: vi.fn().mockResolvedValue('E:\\Lighting Projects') };
    renderPage();
    const root = await screen.findByLabelText('Project Root');
    fireEvent.click(within(root.closest('label')!).getByRole('button', { name: 'Browse' }));
    await waitFor(() => expect(root).toHaveValue('E:\\Lighting Projects'));
    const saveButton = screen.getByRole('button', { name: 'Save Changes' });
    expect(saveButton).toBeEnabled();
    fireEvent.click(saveButton);
    await waitFor(() =>
      expect(apiMock.updatePersonalSettings).toHaveBeenCalledWith(
        expect.objectContaining({ projectRoot: 'E:\\Lighting Projects' }),
      ),
    );
    expect(await screen.findByText('Workspace settings saved.')).toBeInTheDocument();
    await waitFor(() => expect(saveButton).toBeDisabled());
  });

  it('does not claim a failed Settings save succeeded', async () => {
    apiMock.updatePersonalSettings.mockRejectedValueOnce(new Error('Settings conflict'));
    renderPage();
    fireEvent.change(await screen.findByLabelText('Designer Name'), {
      target: { value: 'Mohamed Ali' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save Changes' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Settings conflict');
    expect(screen.queryByText('Workspace settings saved.')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save Changes' })).toBeEnabled();
  });

  it('uses the safe file picker and local-image bridge for the company logo preview', async () => {
    const logoPath = 'C:\\Logos\\SCT.png';
    window.scliDesktop = {
      selectFile: vi.fn().mockResolvedValue(logoPath),
      readLocalImage: vi.fn().mockResolvedValue({
        ok: true,
        src: 'data:image/png;base64,iVBORw0KGgo=',
      }),
    };
    renderPage();
    const logoInput = await screen.findByLabelText('Company Logo');
    fireEvent.click(within(logoInput.closest('label')!).getByRole('button', { name: 'Browse' }));
    await waitFor(() => expect(logoInput).toHaveValue(logoPath));
    expect(window.scliDesktop.selectFile).toHaveBeenCalledWith([
      { name: 'Logo images', extensions: ['png', 'jpg', 'jpeg', 'webp'] },
    ]);
    expect(await screen.findByRole('img', { name: 'Company logo preview' })).toHaveAttribute(
      'src',
      'data:image/png;base64,iVBORw0KGgo=',
    );
  });

  it('manages project types while preserving the active-type invariant', async () => {
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Manage Project Types' }));
    const dialog = screen.getByRole('dialog', { name: 'Project Types' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Deactivate Hospitality' }));
    expect(within(dialog).getByRole('alert')).toHaveTextContent(
      'At least one project type must remain active.',
    );
    fireEvent.change(within(dialog).getByLabelText('Project type Hospitality'), {
      target: { value: 'Hospitality Updated' },
    });
    fireEvent.change(within(dialog).getByLabelText('New project type'), {
      target: { value: 'Residential' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Add' }));
    fireEvent.change(within(dialog).getByLabelText('New project type'), {
      target: { value: 'residential' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Add' }));
    expect(within(dialog).getByRole('alert')).toHaveTextContent(
      'Project type names must be unique.',
    );
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save Project Types' }));
    await waitFor(() => expect(apiMock.updatePersonalProjectTypes).toHaveBeenCalled());
    expect(apiMock.updatePersonalProjectTypes.mock.calls[0]?.[0]).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'Hospitality Updated', isActive: true }),
        expect.objectContaining({ name: 'Residential', isActive: true }),
      ]),
    );
  });

  it('creates action categories from the centralized icon and colour catalogues', async () => {
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Manage Action Categories' }));
    fireEvent.click(screen.getByRole('button', { name: 'Add Category' }));
    const dialog = screen.getByRole('dialog', { name: 'Add Action Category' });
    fireEvent.change(within(dialog).getByLabelText('Label'), {
      target: { value: 'Client Review' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: 'People' }));
    fireEvent.click(within(dialog).getByRole('button', { name: 'blue' }));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save Category' }));
    await waitFor(() => expect(apiMock.createActionCategory).toHaveBeenCalled());
    expect(apiMock.createActionCategory.mock.calls[0]?.[0]).toEqual({
      label: 'Client Review',
      iconKey: 'people',
      colorKey: 'blue',
    });
  });

  it('edits and deletes Action Categories while showing server-owned sort order', async () => {
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Manage Action Categories' }));
    expect(screen.getByText('Sort order 1')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Edit Design' }));
    const editDialog = screen.getByRole('dialog', { name: 'Edit Action Category' });
    fireEvent.change(within(editDialog).getByLabelText('Label'), {
      target: { value: 'Design Review' },
    });
    fireEvent.click(within(editDialog).getByRole('button', { name: 'Save Category' }));
    await waitFor(() =>
      expect(apiMock.updateActionCategory).toHaveBeenCalledWith(categoryId, {
        label: 'Design Review',
        iconKey: 'lightbulb',
        colorKey: 'purple',
      }),
    );

    fireEvent.click(await screen.findByRole('button', { name: 'Manage Action Categories' }));
    fireEvent.click(screen.getByRole('button', { name: 'Delete Design' }));
    const deletion = screen.getByRole('dialog', { name: 'Replace and delete category' });
    fireEvent.click(within(deletion).getByRole('button', { name: 'Delete category' }));
    await waitFor(() =>
      expect(apiMock.replaceAndDeleteActionCategory).toHaveBeenCalledWith(categoryId, null),
    );
    expect(apiMock.replaceAndDeleteActionCategory.mock.calls[0]?.[0]).toBe(categoryId);
  });

  it('keeps Sales separate and supports real edit/deactivate authority', async () => {
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Manage Sales Directory' }));
    fireEvent.click(screen.getByRole('button', { name: 'Edit Noor' }));
    const dialog = screen.getByRole('dialog', { name: 'Edit Sales Contact' });
    fireEvent.change(within(dialog).getByLabelText('Name'), { target: { value: 'Noor Alami' } });
    fireEvent.click(
      within(dialog).getByRole('checkbox', { name: 'Active for future project assignment' }),
    );
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save Sales Contact' }));
    await waitFor(() =>
      expect(apiMock.updateUser).toHaveBeenCalledWith(salesId, {
        displayName: 'Noor Alami',
        email: 'noor@example.com',
        isActive: false,
      }),
    );
    expect(screen.queryByText('Contacts')).not.toBeInTheDocument();
  });

  it('lists and adds a Sales identity without creating a Contacts record', async () => {
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Manage Sales Directory' }));
    const directory = screen.getByRole('dialog', { name: 'Sales Directory' });
    expect(within(directory).getByText('Noor')).toBeInTheDocument();
    fireEvent.click(within(directory).getByRole('button', { name: 'Add Sales Contact' }));
    const dialog = screen.getByRole('dialog', { name: 'Add Sales Contact' });
    fireEvent.change(within(dialog).getByLabelText('Name'), { target: { value: 'Ahmed' } });
    fireEvent.change(within(dialog).getByLabelText('Email (optional)'), {
      target: { value: 'ahmed@example.com' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save Sales Contact' }));
    await waitFor(() => expect(apiMock.createSalesContact).toHaveBeenCalled());
    expect(apiMock.createSalesContact.mock.calls[0]?.[0]).toEqual({
      displayName: 'Ahmed',
      email: 'ahmed@example.com',
    });
    expect(screen.queryByText('Contacts')).not.toBeInTheDocument();
  });

  it('uses real backup retention, create, list, and safe desktop open authority', async () => {
    const openPath = vi.fn().mockResolvedValue(undefined);
    window.scliDesktop = { openPath };
    renderPage();
    await openDataAndBackup();
    const retention = await screen.findByLabelText('Backup Retention');
    expect(retention).toHaveAttribute('min', '3');
    expect(retention).toHaveAttribute('max', '100');
    expect(screen.getByText(backupRecord.fileName)).toBeInTheDocument();
    expect(screen.getByText('2.0 MB')).toBeInTheDocument();

    fireEvent.change(retention, { target: { value: '45' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save Changes' }));
    await waitFor(() =>
      expect(apiMock.updatePersonalSettings).toHaveBeenCalledWith(
        expect.objectContaining({ backupRetention: 45 }),
      ),
    );

    const createButtons = screen.getAllByRole('button', { name: 'Create Backup' });
    fireEvent.click(createButtons.at(-1)!);
    await waitFor(() => expect(apiMock.createBackup).toHaveBeenCalled());
    expect(await screen.findByText('Backup created.')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Open' }));
    expect(openPath).toHaveBeenCalledWith(backupRecord.filePath);
  });

  it('paginates returned backups by eight and returns to the refreshed newest-first page', async () => {
    const backupRows = Array.from({ length: 18 }, (_, index) => ({
      ...backupRecord,
      fileName: `workspace-backup-${String(index + 1).padStart(2, '0')}.sqlite`,
      filePath: `D:\\Backups\\workspace-backup-${String(index + 1).padStart(2, '0')}.sqlite`,
      createdAt: `2026-08-${String(18 - index).padStart(2, '0')}T08:00:00.000Z`,
    }));
    const newest = {
      ...backupRecord,
      fileName: 'workspace-backup-newest.sqlite',
      filePath: 'D:\\Backups\\workspace-backup-newest.sqlite',
      createdAt: '2026-08-19T08:00:00.000Z',
    };
    apiMock.backups.mockResolvedValueOnce(backupRows).mockResolvedValue([newest, ...backupRows]);
    renderPage();
    await openDataAndBackup();

    expect(await screen.findByText('workspace-backup-01.sqlite')).toBeInTheDocument();
    expect(screen.getByText('workspace-backup-08.sqlite')).toBeInTheDocument();
    expect(screen.queryByText('workspace-backup-09.sqlite')).not.toBeInTheDocument();
    expect(screen.getByText('Showing 1–8 of 18 backups')).toBeInTheDocument();
    expect(screen.getByRole('navigation', { name: 'Recent Backups pages' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Next page' }));
    expect(screen.queryByText('workspace-backup-01.sqlite')).not.toBeInTheDocument();
    expect(screen.getByText('workspace-backup-09.sqlite')).toBeInTheDocument();
    expect(screen.getByText('Showing 9–16 of 18 backups')).toBeInTheDocument();

    fireEvent.click(screen.getAllByRole('button', { name: 'Create Backup' }).at(-1)!);
    expect(await screen.findByText('workspace-backup-newest.sqlite')).toBeInTheDocument();
    expect(screen.getByText('Showing 1–8 of 19 backups')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Page 1 of 3' })).toHaveAttribute(
      'aria-current',
      'page',
    );
  });

  it('requires explicit restore confirmation and reports restart-required truthfully', async () => {
    renderPage();
    await openDataAndBackup();
    const restoreButtons = await screen.findAllByRole('button', { name: 'Restore' });
    fireEvent.click(restoreButtons[0]!);
    const dialog = screen.getByRole('dialog', { name: 'Restore backup' });
    expect(dialog).toHaveTextContent('replaces current workspace data');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Restore workspace' }));
    await waitFor(() => expect(apiMock.restoreBackup).toHaveBeenCalledWith(backupRecord.filePath));
    expect(await screen.findByText('Restart required')).toBeInTheDocument();
  });

  it('persists only the V4 Light/Dark/System theme preference', async () => {
    renderPage();
    fireEvent.click(await screen.findByRole('radio', { name: 'Dark' }));
    expect(window.localStorage.getItem('scli.v4.theme')).toBe('dark');
    expect(window.localStorage.getItem('scli.theme')).toBeNull();
    fireEvent.click(screen.getByRole('radio', { name: 'System' }));
    expect(window.localStorage.getItem('scli.v4.theme')).toBeNull();
  });

  it('applies the selected Accent Color immediately and marks the preset', async () => {
    renderPage();
    const teal = await screen.findByRole('button', { name: '#008C95' });
    expect(teal).toHaveAttribute('aria-pressed', 'true');
    await waitFor(() =>
      expect(document.documentElement.style.getPropertyValue('--v4-accent')).toBe('#008C95'),
    );

    fireEvent.click(screen.getByRole('button', { name: '#2563EB' }));
    expect(screen.getByRole('button', { name: '#2563EB' })).toHaveAttribute('aria-pressed', 'true');
    expect(teal).toHaveAttribute('aria-pressed', 'false');
    expect(document.documentElement.style.getPropertyValue('--v4-accent')).toBe('#2563EB');
  });

  it('persists the selected Accent Color through Save Changes', async () => {
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: '#9333EA' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save Changes' }));
    await waitFor(() =>
      expect(apiMock.updatePersonalSettings).toHaveBeenCalledWith(
        expect.objectContaining({ accentColor: '#9333EA' }),
      ),
    );
    expect(await screen.findByText('Workspace settings saved.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '#9333EA' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('restores the persisted Accent Color after a reload/refetch', async () => {
    const first = renderPage();
    fireEvent.click(await screen.findByRole('button', { name: '#EA580C' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save Changes' }));
    await waitFor(() =>
      expect(apiMock.updatePersonalSettings).toHaveBeenCalledWith(
        expect.objectContaining({ accentColor: '#EA580C' }),
      ),
    );
    expect(document.documentElement.style.getPropertyValue('--v4-accent')).toBe('#EA580C');
    first.unmount();

    apiMock.personalSettings.mockResolvedValue({
      ...settings,
      accentColor: '#EA580C',
      updatedAt: '2026-08-18T10:00:00.000Z',
    });
    renderPage();
    expect(await screen.findByRole('button', { name: '#EA580C' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await waitFor(() =>
      expect(document.documentElement.style.getPropertyValue('--v4-accent')).toBe('#EA580C'),
    );
  });

  it('does not claim durable persistence when the Accent Color save fails', async () => {
    apiMock.updatePersonalSettings.mockRejectedValueOnce(new Error('Settings conflict'));
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: '#DC2626' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save Changes' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Settings conflict');
    expect(screen.queryByText('Workspace settings saved.')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save Changes' })).toBeEnabled();
  });

  it('keeps Light/Dark/System independent of the Accent Color selection', async () => {
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: '#475569' }));
    expect(document.documentElement.style.getPropertyValue('--v4-accent')).toBe('#475569');
    fireEvent.click(screen.getByRole('radio', { name: 'Dark' }));
    expect(window.localStorage.getItem('scli.v4.theme')).toBe('dark');
    expect(document.documentElement.dataset.theme).toBe('dark');
    expect(document.documentElement.style.getPropertyValue('--v4-accent')).toBe('#475569');
    fireEvent.click(screen.getByRole('radio', { name: 'Light' }));
    expect(window.localStorage.getItem('scli.v4.theme')).toBe('light');
    expect(document.documentElement.dataset.theme).toBe('light');
    expect(document.documentElement.style.getPropertyValue('--v4-accent')).toBe('#475569');
  });

  // ── Accent preview lifecycle regression (V4-SETTINGS-ACCENT-PREVIEW-RECONCILE-01) ──

  it('A: restores the last persisted accent after an unsaved preview and unmount', async () => {
    apiMock.personalSettings.mockResolvedValue({ ...settings, accentColor: '#9333EA' });
    const first = renderPage();
    await waitFor(() =>
      expect(document.documentElement.style.getPropertyValue('--v4-accent')).toBe('#9333EA'),
    );
    fireEvent.click(screen.getByRole('button', { name: '#EA580C' }));
    expect(document.documentElement.style.getPropertyValue('--v4-accent')).toBe('#EA580C');

    first.unmount();
    // After unmount the cleanup should re-apply persisted '#9333EA'
    await waitFor(() =>
      expect(document.documentElement.style.getPropertyValue('--v4-accent')).toBe('#9333EA'),
    );
  });

  it('B: preserves the newly saved accent after unmount', async () => {
    apiMock.personalSettings.mockResolvedValue({ ...settings, accentColor: '#EA580C' });
    const first = renderPage();
    await waitFor(() =>
      expect(document.documentElement.style.getPropertyValue('--v4-accent')).toBe('#EA580C'),
    );
    fireEvent.click(screen.getByRole('button', { name: '#2563EB' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save Changes' }));
    await waitFor(() => expect(apiMock.updatePersonalSettings).toHaveBeenCalled());
    expect(document.documentElement.style.getPropertyValue('--v4-accent')).toBe('#2563EB');

    first.unmount();
    expect(document.documentElement.style.getPropertyValue('--v4-accent')).toBe('#2563EB');
  });

  it('C: falls back to Brand Teal when there is no persisted accent', async () => {
    apiMock.personalSettings.mockResolvedValue({ ...settings, accentColor: '' });
    const first = renderPage();
    await screen.findByRole('button', { name: '#008C95' });
    await waitFor(() =>
      expect(document.documentElement.style.getPropertyValue('--v4-accent')).toBe(''),
    );
    fireEvent.click(screen.getByRole('button', { name: '#9333EA' }));
    expect(document.documentElement.style.getPropertyValue('--v4-accent')).toBe('#9333EA');

    first.unmount();
    // No persisted accent → cleanup removes override → stylesheet default (empty)
    await waitFor(() =>
      expect(document.documentElement.style.getPropertyValue('--v4-accent')).toBe(''),
    );
  });

  it('D: keeps theme preference unchanged when previewing and switching theme', async () => {
    apiMock.personalSettings.mockResolvedValue({ ...settings, accentColor: '#9333EA' });
    const first = renderPage();
    await waitFor(() =>
      expect(document.documentElement.style.getPropertyValue('--v4-accent')).toBe('#9333EA'),
    );
    fireEvent.click(screen.getByRole('button', { name: '#EA580C' }));
    expect(document.documentElement.style.getPropertyValue('--v4-accent')).toBe('#EA580C');

    fireEvent.click(screen.getByRole('radio', { name: 'Dark' }));
    expect(window.localStorage.getItem('scli.v4.theme')).toBe('dark');

    first.unmount();
    // Persisted accent restored, theme unchanged
    await waitFor(() =>
      expect(document.documentElement.style.getPropertyValue('--v4-accent')).toBe('#9333EA'),
    );
    expect(window.localStorage.getItem('scli.v4.theme')).toBe('dark');
  });

  it('E: reload restores the saved accent normally via V4AccentProvider', async () => {
    apiMock.personalSettings.mockResolvedValue({ ...settings, accentColor: '#DC2626' });
    renderPage();
    await waitFor(() =>
      expect(document.documentElement.style.getPropertyValue('--v4-accent')).toBe('#DC2626'),
    );
    expect(await screen.findByRole('button', { name: '#DC2626' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });
});

it('persists final Settings values and keeps restore behind the existing confirmation', async () => {
  renderPage(true);
  const company = await screen.findByRole('textbox', { name: 'Company Name' });
  fireEvent.change(company, { target: { value: 'Actual company' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save Changes' }));
  await waitFor(() =>
    expect(apiMock.updatePersonalSettings).toHaveBeenCalledWith(
      expect.objectContaining({ companyName: 'Actual company' }),
    ),
  );
  expect(screen.queryByText('512 MB')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Restore' }));
  expect(apiMock.restoreBackup).not.toHaveBeenCalled();
  expect(await screen.findByRole('dialog')).toBeInTheDocument();
});
