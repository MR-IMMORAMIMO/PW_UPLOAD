// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import type { LegacyProjectCandidate, LegacyProjectPreview } from '@scli/domain';
import { api } from '../api';
import { useAppContext } from '../app-context';
import { ToastProvider } from '../components/toast';
import { PersonalLegacyImportScreen } from './personal-legacy-import';

vi.mock('../app-context', () => ({ useAppContext: vi.fn() }));

const candidate: LegacyProjectCandidate = {
  folderName: '042_SCLI260802_LEGACY_VILLA',
  folderPath: 'C:\\projects\\042_SCLI260802_LEGACY_VILLA',
  recognized: true,
  sequenceNumber: 42,
  projectDate: '2026-08-02',
  projectCode: '042_SCLI260802_LEGACY_VILLA',
  projectName: 'Legacy Villa',
  duplicateProjectId: null,
  warnings: [],
};

const preview: LegacyProjectPreview = {
  rootPath: 'C:\\projects',
  scannedAt: '2026-08-07T00:00:00.000Z',
  nextProjectNumber: 43,
  candidates: [candidate],
};

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
      <MemoryRouter>
        <ToastProvider>
          <PersonalLegacyImportScreen />
        </ToastProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  setActor();
  vi.spyOn(api, 'personalSettings').mockResolvedValue({
    projectRoot: 'C:\\projects',
    defaultFolderProfile: 'Full Lighting Design',
    defaultInputMode: 'Later',
    autoOpenProjectFolder: false,
    designerName: 'Daniel Brooks',
    companyName: 'Scientechnic',
    companyLogoPath: '',
    accentColor: '#0b6e6e',
    timeZone: 'Asia/Dubai',
    backupRetention: 30,
    updatedAt: '2026-08-07T00:00:00.000Z',
  });
  vi.spyOn(api, 'salesUsers').mockResolvedValue([]);
  vi.spyOn(api, 'previewLegacyProjects').mockResolvedValue(preview);
  vi.spyOn(api, 'scanLegacyProjectFolders').mockResolvedValue([]);
  vi.spyOn(api, 'importLegacyProjects').mockResolvedValue({
    imported: [
      {
        projectId: 'aaaaaaaa-0000-4000-8000-000000000001',
        projectCode: '042_SCLI260802_LEGACY_VILLA',
        projectName: 'Legacy Villa',
        folderPath: candidate.folderPath,
        fileCount: 0,
        scanWarning: '',
      },
    ],
    skipped: 0,
    nextProjectNumber: 43,
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

async function openPreview() {
  const user = userEvent.setup();
  renderScreen();
  await user.type(screen.getByLabelText('Projects root'), 'C:\\projects');
  await user.click(screen.getByRole('button', { name: 'Scan Folder Names' }));
  await screen.findByText('042_SCLI260802_LEGACY_VILLA');
  return user;
}

describe('P2.9B legacy import compatibility UI', () => {
  it('exposes editable projectType, CRM, commercial value, and actualHours baseline', async () => {
    const user = await openPreview();
    const editor = screen.getByText('042_SCLI260802_LEGACY_VILLA').closest('details')!;
    await user.click(editor.querySelector('summary')!);
    const projectType = within(editor).getByLabelText(/Project type/);
    expect(projectType).toHaveValue('Legacy Project');
    expect(within(editor).getByLabelText(/CRM Reference/)).toBeInTheDocument();
    expect(within(editor).getByLabelText(/Commercial Value Amount/)).toBeInTheDocument();
    expect(within(editor).getByLabelText(/Commercial Value Currency/)).toBeInTheDocument();
    expect(within(editor).getByLabelText(/Actual Hours/)).toBeInTheDocument();
  });

  it('carries the edited compatibility fields into the import payload', async () => {
    const user = await openPreview();
    const editor = screen.getByText('042_SCLI260802_LEGACY_VILLA').closest('details')!;
    await user.click(editor.querySelector('summary')!);
    await user.clear(within(editor).getByLabelText(/Project type/));
    await user.type(within(editor).getByLabelText(/Project type/), 'Hospital');
    await user.type(within(editor).getByLabelText(/CRM Reference/), 'CRM-LEGACY-1');
    await user.type(within(editor).getByLabelText(/Commercial Value Amount/), '125000.50');
    await user.type(within(editor).getByLabelText(/Commercial Value Currency/), 'AED');
    await user.type(within(editor).getByLabelText(/Actual Hours/), '12.5');
    await user.click(screen.getByRole('button', { name: 'Import Selected Projects' }));
    await waitFor(() => expect(api.importLegacyProjects).toHaveBeenCalled());
    const payload = vi.mocked(api.importLegacyProjects).mock.calls[0]![0] as {
      projects: Array<Record<string, unknown>>;
    };
    const project = payload.projects[0]!;
    expect(project.projectType).toBe('Hospital');
    expect(project.crmReference).toBe('CRM-LEGACY-1');
    expect(project.commercialValueMinor).toBe(12_500_050);
    expect(project.commercialCurrency).toBe('AED');
    expect(project.actualHours).toBe(12.5);
  });

  it('empty optional values still import with safe defaults', async () => {
    const user = await openPreview();
    await user.click(screen.getByRole('button', { name: 'Import Selected Projects' }));
    await waitFor(() => expect(api.importLegacyProjects).toHaveBeenCalled());
    const payload = vi.mocked(api.importLegacyProjects).mock.calls[0]![0] as {
      projects: Array<Record<string, unknown>>;
    };
    const project = payload.projects[0]!;
    expect(project.crmReference).toBeNull();
    expect(project.commercialValueMinor).toBeNull();
    expect(project.commercialCurrency).toBeNull();
    expect(project.actualHours).toBeUndefined();
  });

  it('blocks import when the commercial value pair is invalid', async () => {
    const user = await openPreview();
    const editor = screen.getByText('042_SCLI260802_LEGACY_VILLA').closest('details')!;
    await user.click(editor.querySelector('summary')!);
    await user.type(within(editor).getByLabelText(/Commercial Value Amount/), '100');
    await user.click(screen.getByRole('button', { name: 'Import Selected Projects' }));
    await waitFor(() =>
      expect(
        screen.getByText(/Currency is required when an amount is entered/),
      ).toBeInTheDocument(),
    );
    expect(api.importLegacyProjects).not.toHaveBeenCalled();
  });
});
