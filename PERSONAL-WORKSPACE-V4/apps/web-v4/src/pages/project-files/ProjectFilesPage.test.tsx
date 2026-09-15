/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { Link, Route, Routes } from 'react-router-dom';
import type { CaptureReadModel } from '@scli/contracts';
import type { Project, ProjectDocument, ProjectWorkspace } from '@scli/domain';
import { api } from '../../api/environment';
import { cleanupV4, renderV4, stubMatchMedia } from '../../test-utils/renderV4';
import { ProjectFilesPage } from './ProjectFilesPage';

vi.mock('../../api/environment', () => ({
  api: {
    project: vi.fn(),
    projectWorkspace: vi.fn(),
    projectStorageHealth: vi.fn(),
    reconnectProjectStorage: vi.fn(),
    createDocument: vi.fn(),
    updateDocument: vi.fn(),
    removeDocument: vi.fn(),
    activeWorkSession: vi.fn(),
    toolSessions: vi.fn(),
    projectRevisions: vi.fn(),
    captures: vi.fn(),
    retryCapture: vi.fn(),
    discardCapture: vi.fn(),
    captureFileHandoff: vi.fn(),
    projectDocumentFileHandoff: vi.fn(),
    updateOutputMapping: vi.fn(),
    startToolSession: vi.fn(),
    closeAutomationContext: vi.fn(),
    expireAutomationContext: vi.fn(),
    restartToolSession: vi.fn(),
    toolSessionExportFolderHandoff: vi.fn(),
    manualCaptureContext: vi.fn(),
  },
}));

const PROJECT_ID = '00000000-0000-4000-8000-000000000001';
const REVISION_ID = '00000000-0000-4000-8000-000000000002';
const LONG_LOCATOR =
  '02_DESIGN/DIALUX/001_SCT260825_P4C_FINAL_OWNER_UAT_WITH_A_DELIBERATELY_LONG_PROJECT_RELATIVE_DESTINATION_DIALUX_REPORT_REV_01_A02.pdf';

const project = {
  id: PROJECT_ID,
  projectCode: 'P-001',
  projectName: 'Files Test',
  clientName: 'SCLI',
  projectType: 'Lighting',
  designStage: 'Detailed Design',
  requiredDeliveryDate: null,
  status: 'InProgress',
} as unknown as Project;

const workspace = (documents: ProjectWorkspace['documents']): ProjectWorkspace =>
  ({
    projectId: PROJECT_ID,
    folderPath: 'C:\\Projects\\P-001',
    documents,
    fileCenter: documents.map((document) => ({
      documentId: document.id,
      title: document.title,
      category: document.category,
      filePath: document.filePath,
      state: document.filePath ? 'Current' : 'NotGenerated',
      sizeBytes: 0,
      modifiedAt: null,
      oneDrive: false,
      note: document.filePath
        ? 'Available locally.'
        : 'No file has been linked to this register item yet.',
    })),
  }) as unknown as ProjectWorkspace;

const drawing: ProjectDocument = {
  id: 'doc-1',
  projectId: PROJECT_ID,
  category: 'Drawing',
  documentNumber: 'L-101',
  title: 'Ground Floor Lighting Layout',
  revision: 'REV_01',
  status: 'Working',
  filePath: 'C:\\Projects\\P-001\\L-101.dwg',
  issuedTo: '',
  issueDate: null,
  notes: 'Initial layout',
  createdAt: '2026-08-01T08:00:00.000Z',
  updatedAt: '2026-08-02T09:00:00.000Z',
};

const drawings = (count: number): ProjectDocument[] =>
  Array.from({ length: count }, (_, index) => ({
    ...drawing,
    id: `doc-${index + 1}`,
    title: `Lighting Layout ${String(index + 1).padStart(2, '0')}`,
    documentNumber: `L-${String(index + 1).padStart(3, '0')}`,
    filePath: `C:\\Projects\\P-001\\L-${String(index + 1).padStart(3, '0')}.dwg`,
    updatedAt: `2026-08-${String(Math.min(index + 1, 28)).padStart(2, '0')}T09:00:00.000Z`,
  }));

const capture = (overrides: Partial<CaptureReadModel> = {}): CaptureReadModel => ({
  captureId: '00000000-0000-4000-8000-000000000010',
  sourceFileName: 'owner-uat-output.pdf',
  project: { id: PROJECT_ID, code: 'P-001', name: 'Files Test' },
  targetRevision: { id: REVISION_ID, label: 'REV_01', state: 'PREPARING' },
  application: 'DIALUX',
  artifactType: 'DIALUX_REPORT',
  outputMappingId: 'dialuxReport',
  state: 'UNRESOLVED',
  routingDecision: 'USER_CONFIRMED',
  routingReason: 'DESTINATION_MAPPING_REQUIRED',
  structuredReason: {
    code: 'DESTINATION_MAPPING_REQUIRED',
    summary: 'Output filing needs a valid Project folder mapping.',
  },
  sizeBytes: 54_152,
  contentHash: 'a'.repeat(64),
  milestones: {
    detectedAt: '2026-08-25T04:16:24.604Z',
    stagedAt: '2026-08-25T04:16:24.616Z',
    admittedAt: null,
    completedAt: null,
    decidedAt: '2026-08-25T04:15:53.450Z',
  },
  finalProjectRelativeLocator: null,
  artifactId: null,
  versionId: null,
  artifactVersion: null,
  reusedExisting: false,
  allowedRecoveryActions: ['CONFIGURE_OUTPUT_FILING', 'RETRY', 'DISCARD'],
  ...overrides,
});

const capturePage = (items: CaptureReadModel[]) => ({
  items,
  nextCursor: null,
  totalCount: items.length,
  pageSize: 8,
  page: 0,
});

function renderFiles(search = '') {
  return renderV4(
    <Routes>
      <Route path="/projects/:projectId/files" element={<ProjectFilesPage />} />
    </Routes>,
    [`/projects/${PROJECT_ID}/files${search}`],
  );
}

describe('ProjectFilesPage', () => {
  beforeEach(() => {
    stubMatchMedia();
    vi.mocked(api.project).mockResolvedValue(project);
    vi.mocked(api.projectWorkspace).mockResolvedValue(workspace([]));
    vi.mocked(api.projectStorageHealth).mockResolvedValue({
      projectId: PROJECT_ID,
      state: 'UNAVAILABLE',
      reason: 'IO_UNAVAILABLE',
      projectPath: null,
      workspacePath: null,
      canonicalPath: null,
      marker: null,
      canReconnect: true,
      canOpenFolder: false,
      canAdoptLegacy: false,
      checkedAt: '2026-08-25T04:22:08.724Z',
    });
    vi.mocked(api.activeWorkSession).mockResolvedValue(null);
    vi.mocked(api.toolSessions).mockResolvedValue([]);
    vi.mocked(api.projectRevisions).mockResolvedValue([]);
    vi.mocked(api.captures).mockResolvedValue({
      items: [],
      nextCursor: null,
      totalCount: 0,
      pageSize: 8,
      page: 0,
    });
  });

  afterEach(() => {
    cleanupV4();
    vi.clearAllMocks();
    delete window.scliDesktop;
  });

  it('renders the page title band and a truthful empty state', async () => {
    renderFiles();
    expect(await screen.findByText('Project Files')).toBeInTheDocument();
    expect(await screen.findByText('No working files yet')).toBeInTheDocument();
  });
  it('opens a searched document on its actual page and refuses an unknown identity', async () => {
    vi.mocked(api.projectWorkspace).mockResolvedValue(workspace(drawings(12)));
    const view = renderFiles('?documentId=doc-2');
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /Lighting Layout 02/ })).toHaveAttribute(
        'aria-pressed',
        'true',
      ),
    );
    view.unmount();
    renderFiles('?documentId=unknown');
    expect(
      await screen.findByText('The linked file is not available in this project.'),
    ).toBeVisible();
  });

  it('reveals a linked file when navigation begins inside an already filtered register', async () => {
    vi.mocked(api.projectWorkspace).mockResolvedValue(workspace(drawings(12)));
    renderV4(
      <>
        <Link to={`/projects/${PROJECT_ID}/files?documentId=doc-2`}>Open search result</Link>
        <Routes>
          <Route path="/projects/:projectId/files" element={<ProjectFilesPage />} />
        </Routes>
      </>,
      [`/projects/${PROJECT_ID}/files`],
    );
    const search = await screen.findByRole('textbox', { name: 'Search working files' });
    fireEvent.change(search, { target: { value: 'Layout 12' } });
    fireEvent.click(screen.getByRole('link', { name: 'Open search result' }));
    await waitFor(() => expect(search).toHaveValue(''));
    expect(await screen.findByRole('button', { name: /Lighting Layout 02/ })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });

  it('renders registered working files with presence state', async () => {
    vi.mocked(api.projectWorkspace).mockResolvedValue(workspace([drawing]));
    renderFiles();
    expect(await screen.findByText('Ground Floor Lighting Layout')).toBeInTheDocument();
    expect((await screen.findAllByText('Present')).length).toBeGreaterThan(0);
    expect(await screen.findByText('L-101.dwg')).toBeInTheDocument();
  });

  it('uses sibling Working Files and Output Activity views without a Sidebar route', async () => {
    renderFiles();
    fireEvent.click(await screen.findByRole('button', { name: 'Output Activity' }));
    expect(await screen.findByRole('heading', { name: 'Output Activity' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Capture File to Project' })).toBeInTheDocument();
    expect(screen.getByText('No outputs need attention')).toBeInTheDocument();
  });

  it('refetches after Retry and removes stale attention copy from Completed Recent and Inspector projections', async () => {
    const warning = 'The output needs attention before filing can continue.';
    const recoverable = capture({
      structuredReason: { code: 'CAPTURE_ROUTING_FAILED', summary: warning },
      routingReason: 'CAPTURE_ROUTING_FAILED',
    });
    const completed = capture({
      state: 'COMPLETED',
      structuredReason: { code: 'CAPTURE_ROUTING_FAILED', summary: warning },
      routingReason: 'MANUAL_EXPLICIT_FILE_ADMISSION',
      milestones: {
        ...recoverable.milestones,
        admittedAt: '2026-08-25T04:22:08.708Z',
        completedAt: '2026-08-25T04:22:08.724Z',
      },
      finalProjectRelativeLocator: LONG_LOCATOR,
      artifactId: '00000000-0000-4000-8000-000000000020',
      versionId: '00000000-0000-4000-8000-000000000021',
      artifactVersion: 2,
      allowedRecoveryActions: ['OPEN', 'REVEAL'],
    });
    let retryCompleted = false;
    vi.mocked(api.captures).mockImplementation(async (_projectId, query) =>
      query?.view === 'attention'
        ? capturePage(retryCompleted ? [] : [recoverable])
        : capturePage([completed]),
    );
    vi.mocked(api.retryCapture).mockImplementation(async () => {
      retryCompleted = true;
      return completed;
    });

    renderFiles();
    fireEvent.click(await screen.findByRole('button', { name: 'Output Activity' }));
    expect(await screen.findByText('Output filing needs attention')).toBeInTheDocument();
    fireEvent.click(screen.getByText('owner-uat-output.pdf'));
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));

    expect(await screen.findByText('No outputs need attention')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Recent' }));
    expect(await screen.findByText(`Saved to ${LONG_LOCATOR}`)).toBeInTheDocument();
    expect(screen.queryByText(warning)).not.toBeInTheDocument();

    fireEvent.click(screen.getByText('owner-uat-output.pdf'));
    const inspector = document.querySelector('.v4-output-activity .v4-inspector') as HTMLElement;
    expect(within(inspector).getByText('Completed', { selector: 'dd' })).toBeInTheDocument();
    expect(within(inspector).getByText('Output filed successfully')).toBeInTheDocument();
    expect(within(inspector).getByText(LONG_LOCATOR)).toBeInTheDocument();
    expect(within(inspector).queryByText('Needs Attention')).not.toBeInTheDocument();
    expect(within(inspector).queryByText(warning)).not.toBeInTheDocument();
    await waitFor(() => expect(api.captures).toHaveBeenCalledTimes(3));
  });

  it.each([
    {
      code: 'DESTINATION_MAPPING_REQUIRED',
      summary: 'Output filing needs a valid Project folder mapping.',
      label: 'Output filing needs configuration',
      state: 'UNRESOLVED' as const,
      actions: ['CONFIGURE_OUTPUT_FILING', 'RETRY', 'DISCARD'] as const,
      actionName: 'Configure Output Filing',
    },
    {
      code: 'STORAGE_UNAVAILABLE',
      summary: 'Project storage is disconnected or unavailable.',
      label: 'Project storage is unavailable',
      state: 'FAILED_RECOVERABLE' as const,
      actions: ['RECONNECT_STORAGE', 'RETRY', 'DISCARD'] as const,
      actionName: 'Reconnect marked folder',
    },
    {
      code: 'TARGET_REVISION_FINALIZED',
      summary: 'The Revision this output targeted is already finalized.',
      label: 'Target Revision is finalized',
      state: 'UNRESOLVED' as const,
      actions: ['START_NEW_TOOL_SESSION', 'DISCARD'] as const,
      actionName: 'Start New Tool Session',
      forbiddenAction: 'Retry',
    },
    {
      code: 'SOURCE_NOT_FOUND',
      summary: 'The exported source file could not be found.',
      label: 'Source file was not found',
      state: 'FAILED_RECOVERABLE' as const,
      actions: ['RETRY', 'DISCARD'] as const,
      actionName: 'Retry',
    },
  ])(
    'uses $code as the primary reason while keeping the generic state technical',
    async ({ code, summary, label, state, actions, actionName, forbiddenAction }) => {
      const reasonCapture = capture({
        state,
        routingReason: code,
        structuredReason: { code, summary },
        allowedRecoveryActions: [...actions],
      });
      vi.mocked(api.captures).mockResolvedValue(capturePage([reasonCapture]));

      renderFiles();
      fireEvent.click(await screen.findByRole('button', { name: 'Output Activity' }));
      const primary = await screen.findByText(label);
      const row = primary.closest('.v4-output-activity__row') as HTMLElement;
      expect(within(row).getByText('Needs Attention')).toBeInTheDocument();
      expect(within(row).queryByText(state.replaceAll('_', ' '))).not.toBeInTheDocument();

      fireEvent.click(within(row).getByText('owner-uat-output.pdf'));
      const inspector = document.querySelector('.v4-output-activity .v4-inspector') as HTMLElement;
      expect(within(inspector).getByRole('heading', { name: label })).toBeInTheDocument();
      expect(within(inspector).getByText(state)).toBeInTheDocument();
      expect(
        await within(inspector).findByRole('button', { name: actionName }),
      ).toBeInTheDocument();
      if (forbiddenAction) {
        expect(
          within(inspector).queryByRole('button', { name: forbiddenAction }),
        ).not.toBeInTheDocument();
      }
    },
  );

  it('opens a real inspector on selection and restores the full-width list when closed', async () => {
    vi.mocked(api.projectWorkspace).mockResolvedValue(workspace([drawing]));
    renderFiles();
    await screen.findByText('Ground Floor Lighting Layout');
    const workspaceElement = screen
      .getByTestId('v4-project-files')
      .querySelector('.v4-files__workspace') as HTMLElement;
    expect(
      screen.queryByRole('complementary', { name: 'Working file details' }),
    ).not.toBeInTheDocument();
    expect(workspaceElement).not.toHaveClass('v4-files__workspace--inspector-open');

    fireEvent.click(screen.getByText('Ground Floor Lighting Layout').closest('.v4-files__row')!);
    const inspector = screen.getByRole('complementary', { name: 'Working file details' });
    expect(within(inspector).getByText('Initial layout')).toBeInTheDocument();
    expect(workspaceElement).toHaveClass('v4-files__workspace--inspector-open');

    fireEvent.click(within(inspector).getByRole('button', { name: 'Close working file details' }));
    expect(
      screen.queryByRole('complementary', { name: 'Working file details' }),
    ).not.toBeInTheDocument();
    expect(workspaceElement).not.toHaveClass('v4-files__workspace--inspector-open');
  });

  it('paginates the primary file collection by files and resets search to page one', async () => {
    vi.mocked(api.projectWorkspace).mockResolvedValue(workspace(drawings(18)));
    renderFiles();
    expect(await screen.findByText('Showing 1–8 of 18 files')).toBeInTheDocument();
    expect(document.querySelectorAll('.v4-files__row')).toHaveLength(8);
    fireEvent.click(screen.getByRole('button', { name: 'Next page' }));
    expect(await screen.findByText('Showing 9–16 of 18 files')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Search working files'), {
      target: { value: 'Lighting Layout 18' },
    });
    expect(await screen.findByText('Showing 1–1 of 1 files')).toBeInTheDocument();
    expect(screen.getByText('Lighting Layout 18')).toBeInTheDocument();
  });

  it('shows a truthful missing state for a registered file that no longer exists', async () => {
    const missing = { ...drawing, filePath: 'C:\\Projects\\P-001\\gone.dwg' };
    vi.mocked(api.projectWorkspace).mockResolvedValue({
      ...workspace([missing]),
      fileCenter: [
        {
          documentId: missing.id,
          title: missing.title,
          category: missing.category,
          filePath: missing.filePath,
          state: 'Missing',
          sizeBytes: 0,
          modifiedAt: null,
          oneDrive: false,
          note: 'The registered path no longer exists.',
        },
      ],
    } as unknown as ProjectWorkspace);
    renderFiles();
    const row = await screen.findByText('Ground Floor Lighting Layout');
    const rowContainer = row.closest('.v4-files__row') as HTMLElement;
    expect(within(rowContainer).getByText('Missing')).toBeInTheDocument();
    // Open/Reveal are unavailable for a missing item.
    const openButton = within(rowContainer).getByRole('button', { name: /Open/ });
    expect(openButton).toBeDisabled();
  });

  it('Add File opens the native picker and registers a working file', async () => {
    window.scliDesktop = {
      selectFile: vi.fn().mockResolvedValue('C:\\Projects\\P-001\\new.dwg'),
      openPath: vi.fn().mockResolvedValue(''),
      revealInFolder: vi.fn().mockResolvedValue(''),
    };
    vi.mocked(api.createDocument).mockResolvedValue({
      ...drawing,
      id: 'doc-new',
      title: 'New Layout',
      filePath: 'C:\\Projects\\P-001\\new.dwg',
    });
    renderFiles();
    await screen.findByText('No working files yet');

    fireEvent.click(screen.getByRole('button', { name: /Add File/ }));
    const drawer = await screen.findByRole('dialog');
    fireEvent.change(within(drawer).getByLabelText('Working file title'), {
      target: { value: 'New Layout' },
    });
    fireEvent.click(within(drawer).getByRole('button', { name: /Register File/ }));

    await waitFor(() => {
      expect(api.createDocument).toHaveBeenCalledWith(
        PROJECT_ID,
        expect.objectContaining({ title: 'New Layout' }),
      );
    });
  });

  it('adding while a row is selected creates a separate registration and preserves the old file', async () => {
    vi.mocked(api.projectWorkspace).mockResolvedValue(workspace([drawing]));
    window.scliDesktop = {
      selectFile: vi.fn().mockResolvedValue('C:\\Projects\\P-001\\second.dwg'),
      openPath: vi.fn(),
      revealInFolder: vi.fn(),
    };
    vi.mocked(api.createDocument).mockResolvedValue({ ...drawing, id: 'doc-second' });
    renderFiles();
    fireEvent.click(await screen.findByText('Ground Floor Lighting Layout'));
    fireEvent.click(screen.getByRole('button', { name: /Add File/ }));
    const dialog = await screen.findByRole('dialog', { name: 'Add Working File' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Register File' }));
    await waitFor(() =>
      expect(api.createDocument).toHaveBeenCalledWith(
        PROJECT_ID,
        expect.objectContaining({ filePath: 'C:\\Projects\\P-001\\second.dwg' }),
      ),
    );
    expect(api.updateDocument).not.toHaveBeenCalled();
  });

  it('Open invokes only the registered resolved path', async () => {
    const openPath = vi.fn().mockResolvedValue('');
    window.scliDesktop = {
      selectFile: vi.fn(),
      openPath,
      revealInFolder: vi.fn().mockResolvedValue(''),
    };
    vi.mocked(api.projectWorkspace).mockResolvedValue(workspace([drawing]));
    renderFiles();
    const row = await screen.findByText('Ground Floor Lighting Layout');
    const rowContainer = row.closest('.v4-files__row') as HTMLElement;
    fireEvent.click(within(rowContainer).getByRole('button', { name: /Open/ }));
    await waitFor(() => {
      expect(openPath).toHaveBeenCalledWith('C:\\Projects\\P-001\\L-101.dwg');
    });
  });

  it('Reveal invokes only the registered resolved path', async () => {
    const revealInFolder = vi.fn().mockResolvedValue('');
    window.scliDesktop = {
      selectFile: vi.fn(),
      openPath: vi.fn().mockResolvedValue(''),
      revealInFolder,
    };
    vi.mocked(api.projectWorkspace).mockResolvedValue(workspace([drawing]));
    renderFiles();
    const row = await screen.findByText('Ground Floor Lighting Layout');
    const rowContainer = row.closest('.v4-files__row') as HTMLElement;
    fireEvent.click(within(rowContainer).getByRole('button', { name: /Reveal/ }));
    await waitFor(() => {
      expect(revealInFolder).toHaveBeenCalledWith('C:\\Projects\\P-001\\L-101.dwg');
    });
  });

  it('opens a managed relative Project file only through an opaque file handoff', async () => {
    const managed = { ...drawing, filePath: '02 Design/CAD/CAD_WORKING.dwg' };
    const executeDesktopHandoff = vi.fn().mockResolvedValue({ opened: true });
    window.scliDesktop = { executeDesktopHandoff };
    vi.mocked(api.projectWorkspace).mockResolvedValue(workspace([managed]));
    vi.mocked(api.projectDocumentFileHandoff).mockResolvedValue({
      handoffId: '11111111-1111-4111-8111-111111111111',
      action: 'OPEN_CAPTURE_FILE',
      expiresAt: '2026-08-24T18:00:00.000Z',
    });
    renderFiles();
    const row = await screen.findByText('Ground Floor Lighting Layout');
    fireEvent.click(within(row.closest('.v4-files__row')!).getByRole('button', { name: /Open/ }));
    await waitFor(() => {
      expect(api.projectDocumentFileHandoff).toHaveBeenCalledWith(PROJECT_ID, 'doc-1', {
        action: 'OPEN',
      });
      expect(executeDesktopHandoff).toHaveBeenCalledWith(
        '11111111-1111-4111-8111-111111111111',
        'OPEN_CAPTURE_FILE',
      );
    });
    expect(executeDesktopHandoff).not.toHaveBeenCalledWith(expect.stringContaining('02 Design'));
  });

  it('Remove from Register removes the registration without deleting the source file', async () => {
    vi.mocked(api.projectWorkspace).mockResolvedValue(workspace([drawing]));
    vi.mocked(api.removeDocument).mockResolvedValue({ removed: true });
    renderFiles();
    const row = await screen.findByText('Ground Floor Lighting Layout');
    const rowContainer = row.closest('.v4-files__row') as HTMLElement;

    fireEvent.click(within(rowContainer).getByRole('button', { name: /Remove/ }));
    const confirm = await screen.findByRole('alertdialog');
    fireEvent.click(within(confirm).getByRole('button', { name: /Remove from Register/ }));

    await waitFor(() => {
      expect(api.removeDocument).toHaveBeenCalledWith(PROJECT_ID, 'doc-1');
    });
    // The source file is never deleted by the register removal.
    expect(api.removeDocument).not.toHaveBeenCalledWith(
      expect.anything(),
      expect.stringContaining('.dwg'),
    );
  });
});
