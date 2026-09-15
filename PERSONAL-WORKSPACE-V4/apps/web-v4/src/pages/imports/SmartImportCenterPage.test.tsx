/** @vitest-environment jsdom */
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderV4 } from '../../test-utils/renderV4';
import { SmartImportCenterPage } from './SmartImportCenterPage';

const apiMock = vi.hoisted(() => ({
  me: vi.fn(async () => ({ displayName: 'Owner', email: 'owner@example.test' })),
  projects: vi.fn(),
  importHistory: vi.fn(),
  createImportSession: vi.fn(),
  cancelImportSelection: vi.fn(),
  uploadImportSource: vi.fn(),
  importSession: vi.fn(),
  importTables: vi.fn(),
  importRows: vi.fn(),
  createImportSourceHandoff: vi.fn(),
  completeImportSourceHandoff: vi.fn(),
  updateImportTable: vi.fn(),
  reinspectImportSession: vi.fn(),
  reconcileImportSession: vi.fn(),
  decideImportLibraryGroup: vi.fn(),
  updateImportRowAction: vi.fn(),
  bulkUpdateImportRowActions: vi.fn(),
  applyImportSession: vi.fn(),
  importApplyAttempts: vi.fn(),
}));
vi.mock('../../api/environment', () => ({ api: apiMock }));

const session = {
  importSessionId: '10000000-0000-4000-8000-000000000001',
  sourceFileName: 'dialux.csv',
  sourceSha256: 'a'.repeat(64),
  sourceSizeBytes: 120,
  sourceExtension: '.csv' as const,
  detectedAdapterId: 'DIALUX_NATIVE_CSV' as const,
  detectedAdapterVersion: '1',
  destinationMode: 'PROJECT' as const,
  projectId: '20000000-0000-4000-8000-000000000001',
  sessionStatus: 'NEEDS_REVIEW' as const,
  sessionRevision: 1,
  detection: {},
  destinationFingerprint: 'project-fingerprint',
  previewFingerprint: 'b'.repeat(64),
  applyPlanFingerprint: null,
  applyPlan: {
    createProjectOnly: 0,
    updateProjectOnly: 0,
    updateLinkedProjectFields: 0,
    addFromLibrary: 0,
    createLibraryDraft: 0,
    useExistingLibrary: 0,
    reviewExistingLibrary: 0,
    skip: 0,
    blocked: 0,
    unresolved: 51,
    readyMutations: 0,
  },
  actorId: '30000000-0000-4000-8000-000000000001',
  actorName: 'Owner',
  counts: { total: 51, ready: 50, review: 1, blocked: 0 },
  createdAt: '2026-08-27T08:00:00.000Z',
  updatedAt: '2026-08-27T08:01:00.000Z',
  completedAt: null,
  previousSessionId: null,
};
const table = {
  sourceTableId: '40000000-0000-4000-8000-000000000001',
  importSessionId: session.importSessionId,
  tableKey: 'CSV:1',
  tableName: 'dialux.csv',
  sourceOrdinal: 0,
  visibilityState: 'VISIBLE' as const,
  detectedRegion: {},
  headerRow: 2,
  selected: true,
  headerSignature: 'c'.repeat(64),
  mapping: [
    {
      sourceColumnKey: 'C1',
      sourceHeader: 'Type Tag',
      canonicalField: 'TAG' as const,
      confidence: 'HIGH' as const,
      unitHint: null,
      evidence: ['DIALux field matched.'],
    },
  ],
  mappingFingerprint: 'd'.repeat(64),
  rowVersion: 1,
  createdAt: session.createdAt,
  updatedAt: session.updatedAt,
};
const row = {
  importRowId: '50000000-0000-4000-8000-000000000001',
  importSessionId: session.importSessionId,
  sourceTableId: table.sourceTableId,
  sourceRowNumber: 3,
  sourceRowKey: 'row-3',
  sourceRowFingerprint: 'e'.repeat(64),
  rawCells: [
    {
      sourceColumnKey: 'C1',
      internalHeader: 'Type Tag',
      header: 'Type Tag',
      rawValue: 'DL01',
      formula: null,
      cachedValue: null,
    },
  ],
  mappedCandidate: { TAG: { rawValue: 'DL01', normalizedValue: 'DL01' } },
  normalizationEvidence: [
    {
      canonicalField: 'TAG',
      rawValue: 'DL01',
      normalizedValue: 'DL01',
      unit: null,
      basis: null,
      success: true,
      reason: null,
    },
  ],
  validationReasons: [],
  rowStatus: 'READY' as const,
  reconciliation: null,
  intendedAction: null,
  applyState: 'NOT_APPLIED' as const,
  resultIdentity: null,
  rowVersion: 1,
  createdAt: session.createdAt,
  updatedAt: session.updatedAt,
};

function renderPage() {
  return renderV4(<SmartImportCenterPage />, ['/imports']);
}

function openWorkflowStep(name: 'Upload' | 'Inspect' | 'Map' | 'Reconcile' | 'Apply') {
  fireEvent.click(
    within(screen.getByRole('navigation', { name: 'Import workflow' })).getByRole('button', {
      name: new RegExp(name),
    }),
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  window.localStorage.clear();
  delete window.scliDesktop;
  vi.stubGlobal(
    'matchMedia',
    vi.fn().mockReturnValue({
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }),
  );
  apiMock.projects.mockResolvedValue([
    {
      id: session.projectId,
      projectCode: 'PRJ-001',
      projectName: 'Museum',
    },
  ]);
  apiMock.importHistory.mockResolvedValue({
    items: [session],
    page: 0,
    pageSize: 50,
    totalCount: 1,
  });
  apiMock.createImportSession.mockResolvedValue({ ...session, sourceFileName: null });
  apiMock.uploadImportSource.mockResolvedValue(session);
  apiMock.importSession.mockResolvedValue(session);
  apiMock.importTables.mockResolvedValue([table]);
  apiMock.importRows.mockResolvedValue({
    items: [row],
    page: 0,
    pageSize: 50,
    totalCount: 51,
    counts: {
      all: 51,
      ready: 50,
      needsReview: 1,
      blocked: 0,
      failed: 0,
      unmapped: 0,
      mappingConflict: 0,
    },
  });
  apiMock.importApplyAttempts.mockResolvedValue([]);
  apiMock.bulkUpdateImportRowActions.mockResolvedValue(session);
});

describe('Smart Import Center', () => {
  it('clears an empty session after a failed native picker request without losing the error', async () => {
    window.scliDesktop = { executeDesktopHandoff: vi.fn() };
    apiMock.createImportSourceHandoff.mockRejectedValueOnce(new Error('Picker unavailable'));
    apiMock.cancelImportSelection.mockResolvedValueOnce({});
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Select Source' }));
    await screen.findByText('Picker unavailable');
    expect(apiMock.cancelImportSelection).toHaveBeenCalledWith(session.importSessionId);
    expect(apiMock.completeImportSourceHandoff).not.toHaveBeenCalled();
    expect(apiMock.uploadImportSource).not.toHaveBeenCalled();
  });
  it('selects exact visible rows and submits safe bulk Project field evidence', async () => {
    apiMock.importSession.mockResolvedValue({ ...session, sessionRevision: 3 });
    apiMock.uploadImportSource.mockResolvedValue({ ...session, sessionRevision: 3 });
    renderPage();
    await screen.findByText(/Choose a bounded CSV/);
    fireEvent.click(screen.getByRole('button', { name: 'Select Source' }));
    await screen.findByRole('button', { name: 'Select Source' });
    fireEvent.change(screen.getByLabelText('Upload import source'), {
      target: { files: [new File(['Type Tag\nDL01'], 'dialux.csv', { type: 'text/csv' })] },
    });
    await screen.findByText(/DIALUX NATIVE CSV/);
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select import row 3' }));
    expect(screen.getByText('1 selected')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Bulk Project Category'), {
      target: { value: 'Interior' },
    });
    fireEvent.change(screen.getByLabelText('Bulk Location'), {
      target: { value: 'Owner zone' },
    });
    fireEvent.change(screen.getByLabelText('Bulk Unit'), { target: { value: 'Each' } });
    fireEvent.change(screen.getByLabelText('Bulk Quantity'), { target: { value: '2.5' } });
    fireEvent.click(screen.getByRole('button', { name: 'Set fields' }));
    await waitFor(() =>
      expect(apiMock.bulkUpdateImportRowActions).toHaveBeenCalledWith(session.importSessionId, {
        expectedSessionRevision: 3,
        rowIds: [row.importRowId],
        projectFields: {
          category: 'Interior',
          location: 'Owner zone',
          unit: 'Each',
          quantity: 2.5,
        },
      }),
    );
  });

  it('shows persisted terminal counts and the required result actions', async () => {
    apiMock.importApplyAttempts.mockResolvedValue([
      {
        applyAttemptId: '60000000-0000-4000-8000-000000000001',
        importSessionId: session.importSessionId,
        idempotencyKey: 'terminal-result-key',
        state: 'PARTIALLY_APPLIED',
        applyPlanFingerprint: 'f'.repeat(64),
        destinationFingerprint: 'c'.repeat(64),
        backupId: 'verified-backup-1',
        counts: {
          ...session.applyPlan,
          applied: 42,
          failed: 3,
          created: 18,
          updatedProjectOnlyResult: 11,
          updatedLinkedProjectFieldsResult: 4,
          addedFromLibrary: 9,
          skippedResult: 6,
          remainingBlocked: 5,
          remainingUnresolved: 2,
        },
        errorSummary: '3 rows failed.',
        startedAt: session.createdAt,
        updatedAt: session.updatedAt,
        completedAt: session.updatedAt,
      },
    ]);
    renderPage();
    await screen.findByText(/Choose a bounded CSV/);
    fireEvent.click(screen.getByRole('button', { name: 'Select Source' }));
    await screen.findByRole('button', { name: 'Select Source' });
    fireEvent.change(screen.getByLabelText('Upload import source'), {
      target: { files: [new File(['Type Tag\nDL01'], 'dialux.csv', { type: 'text/csv' })] },
    });
    await screen.findByText(/DIALUX NATIVE CSV/);
    openWorkflowStep('Apply');
    const result = await screen.findByRole('region', { name: 'Apply terminal result' });
    expect(result).toHaveTextContent('Partially applied 42 rows');
    expect(result).toHaveTextContent('Created Project-only: 18');
    expect(result).toHaveTextContent('Updated Project-only: 11');
    expect(result).toHaveTextContent('Updated linked Project-owned fields: 4');
    expect(result).toHaveTextContent('Added from Library: 9');
    expect(result).toHaveTextContent('Failed: 3');
    expect(result).toHaveTextContent('Remaining Blocked: 5');
    expect(result).toHaveTextContent('Remaining Unresolved: 2');
    expect(within(result).getByRole('button', { name: 'View Failed Rows' })).toBeEnabled();
    expect(within(result).getByRole('button', { name: 'Open Project Luminaires' })).toBeEnabled();
    expect(within(result).getByRole('button', { name: 'Reopen Import History' })).toBeEnabled();
  });

  it('uses browser upload, exposes source truth, pagination, and exposes Project reconciliation', async () => {
    renderPage();
    expect(await screen.findByText(/Choose a bounded CSV/)).toBeInTheDocument();
    expect(
      screen.getByText(
        'Select a row to compare source values, mapped and normalized values, and validation.',
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Destination: Project/ })).toHaveAttribute(
      'aria-haspopup',
      'listbox',
    );
    expect(screen.getByRole('button', { name: /Project: PRJ-001 · Museum/ })).toHaveAttribute(
      'aria-haspopup',
      'listbox',
    );
    expect(document.querySelector('[data-control-icon="Destination"]')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Select Source' }));
    await waitFor(() => expect(apiMock.createImportSession).toHaveBeenCalled());
    await screen.findByRole('button', { name: 'Select Source' });
    fireEvent.change(screen.getByLabelText('Upload import source'), {
      target: { files: [new File(['Type Tag\nDL01'], 'dialux.csv', { type: 'text/csv' })] },
    });
    expect(await screen.findByText(/DIALUX NATIVE CSV/)).toBeInTheDocument();
    expect(screen.getByRole('complementary', { name: 'Row Inspector' })).toHaveTextContent('DL01');
    expect(screen.getByRole('button', { name: 'Reconcile Project' })).toBeEnabled();
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    await waitFor(() =>
      expect(apiMock.importRows).toHaveBeenLastCalledWith(
        session.importSessionId,
        expect.objectContaining({ page: '1', limit: '50' }),
      ),
    );
  });

  it('presents independent counted filters with a restrained active state', async () => {
    renderPage();
    await screen.findByText(/Choose a bounded CSV/);
    fireEvent.click(screen.getByRole('button', { name: 'Select Source' }));
    await waitFor(() => expect(apiMock.createImportSession).toHaveBeenCalled());
    await screen.findByRole('button', { name: 'Select Source' });
    fireEvent.change(screen.getByLabelText('Upload import source'), {
      target: { files: [new File(['Type Tag\nDL01'], 'dialux.csv', { type: 'text/csv' })] },
    });
    await screen.findByText(/DIALUX NATIVE CSV/);
    const status = await screen.findByRole('button', { name: 'Status: All · 51' });
    fireEvent.click(status);
    fireEvent.click(await screen.findByRole('option', { name: 'Ready · 50' }));
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Status: Ready · 50' })).toBeVisible();
      expect(apiMock.importRows).toHaveBeenLastCalledWith(
        session.importSessionId,
        expect.objectContaining({ filter: 'READY', page: '0' }),
      );
    });
  });

  it('bounds mapping choices in an anchored listbox and restores trigger focus on Escape', async () => {
    renderPage();
    await screen.findByText(/Choose a bounded CSV/);
    fireEvent.click(screen.getByRole('button', { name: 'Select Source' }));
    await waitFor(() => expect(apiMock.createImportSession).toHaveBeenCalled());
    await screen.findByRole('button', { name: 'Select Source' });
    fireEvent.change(screen.getByLabelText('Upload import source'), {
      target: { files: [new File(['Type Tag\nDL01'], 'dialux.csv', { type: 'text/csv' })] },
    });
    await screen.findByText(/DIALUX NATIVE CSV/);
    openWorkflowStep('Map');
    const mappingTrigger = await screen.findByRole('button', { name: 'Map Type Tag: TAG' });
    fireEvent.click(mappingTrigger);
    const listbox = await screen.findByRole('listbox', { name: 'Map Type Tag options' });
    expect(listbox).toHaveClass('v4-imports__select-menu');
    const selectedOption = screen.getByRole('option', { name: 'TAG' });
    await waitFor(() => expect(selectedOption).toHaveFocus());
    fireEvent.keyDown(selectedOption, { key: 'Escape' });
    await waitFor(() => {
      expect(
        screen.queryByRole('listbox', { name: 'Map Type Tag options' }),
      ).not.toBeInTheDocument();
      expect(mappingTrigger).toHaveFocus();
    });
  });

  it('uses destination-aware Library stages and keeps actions disabled before reconciliation', async () => {
    const librarySession = {
      ...session,
      destinationMode: 'MASTER_LIBRARY' as const,
      projectId: null,
      applyPlan: {
        ...session.applyPlan,
        createLibraryDraft: 0,
        useExistingLibrary: 0,
        reviewExistingLibrary: 0,
      },
    };
    apiMock.createImportSession.mockResolvedValue({ ...librarySession, sourceFileName: null });
    apiMock.uploadImportSource.mockResolvedValue(librarySession);
    apiMock.importSession.mockResolvedValue(librarySession);

    renderPage();
    await screen.findByText(/Choose a bounded CSV/);
    fireEvent.click(screen.getByRole('button', { name: /Destination: Project/ }));
    fireEvent.click(await screen.findByRole('option', { name: 'Master Library' }));
    expect(screen.getByRole('button', { name: 'Select import source' })).toBeEnabled();
    expect(
      screen.getByText(/Master Library Draft import with Owner reconciliation/),
    ).toHaveTextContent('Published Versions created: 0');

    fireEvent.click(screen.getByRole('button', { name: 'Select import source' }));
    await waitFor(() =>
      expect(apiMock.createImportSession).toHaveBeenCalledWith({
        destinationMode: 'MASTER_LIBRARY',
        projectId: null,
      }),
    );
    fireEvent.change(screen.getByLabelText('Upload import source'), {
      target: { files: [new File(['Type Tag\nDL01'], 'dialux.csv', { type: 'text/csv' })] },
    });

    expect(await screen.findByRole('button', { name: 'Reconcile Library' })).toBeEnabled();
    fireEvent.click(screen.getByRole('button', { name: 'Status: All · 51' }));
    expect(await screen.findByRole('option', { name: 'Ready to reconcile · 50' })).toBeVisible();
    fireEvent.keyDown(screen.getByRole('option', { name: 'Ready to reconcile · 50' }), {
      key: 'Escape',
    });
    expect(
      screen.getByRole('button', { name: 'Row action: Owner decision required' }),
    ).toBeDisabled();
    expect(screen.getAllByText('Reconcile Library before choosing an action.')).not.toHaveLength(0);

    fireEvent.click(screen.getByRole('checkbox', { name: 'Select import row 3' }));
    expect(screen.getByLabelText('Bulk row action')).toBeDisabled();

    openWorkflowStep('Map');
    fireEvent.click(screen.getByRole('button', { name: 'Map Type Tag: TAG' }));
    const mappingOptions = await screen.findByRole('listbox', { name: 'Map Type Tag options' });
    expect(within(mappingOptions).getByText('Library fields')).toBeVisible();
    expect(within(mappingOptions).getByText('Project-only evidence')).toBeVisible();
    expect(within(mappingOptions).getAllByText('Unmapped')).toHaveLength(2);

    openWorkflowStep('Apply');
    expect(screen.getByRole('button', { name: 'Apply 0 rows' })).toBeDisabled();
    expect(
      screen.getByText(/Apply disabled · Reconcile Library before choosing actions/),
    ).toBeVisible();
  });

  it('reopens persisted history and closes its modal with Escape', async () => {
    const masterSession = {
      ...session,
      destinationMode: 'MASTER_LIBRARY' as const,
      projectId: null,
      applyPlan: {
        ...session.applyPlan,
        createLibraryDraft: 0,
        useExistingLibrary: 0,
        reviewExistingLibrary: 0,
      },
    };
    apiMock.importHistory.mockResolvedValue({
      items: [masterSession],
      page: 0,
      pageSize: 50,
      totalCount: 1,
    });
    apiMock.importSession.mockResolvedValue(masterSession);
    renderPage();
    await screen.findByText(/Choose a bounded CSV/);
    const historyButton = screen
      .getAllByRole('button', { name: 'Import History' })
      .find((button) => button.classList.contains('v4-button'))!;
    fireEvent.click(historyButton);
    expect(await screen.findByRole('dialog', { name: 'Import History' })).toBeInTheDocument();
    fireEvent.keyDown(window, { key: 'Escape' });
    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: 'Import History' })).not.toBeInTheDocument();
      expect(historyButton).toHaveFocus();
    });
    fireEvent.click(historyButton);
    fireEvent.click(await screen.findByRole('button', { name: /dialux\.csv/ }));
    await waitFor(() =>
      expect(
        within(screen.getByRole('navigation', { name: 'Import workflow' })).getByRole('button', {
          name: /Reconcile/,
        }),
      ).toHaveAttribute('aria-pressed', 'true'),
    );
    openWorkflowStep('Upload');
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /Destination: Master Library/ })).toBeVisible(),
    );
    expect(screen.getByRole('button', { name: 'Select import source' })).toBeVisible();
  });

  it('shows materialized impact and requires the verified-backup Apply confirmation', async () => {
    const applySession = {
      ...session,
      sessionRevision: 3,
      applyPlanFingerprint: 'f'.repeat(64),
      applyPlan: {
        ...session.applyPlan,
        createProjectOnly: 1,
        unresolved: 0,
        readyMutations: 1,
      },
    };
    const basis = {
      sourceRowFingerprint: row.sourceRowFingerprint,
      mappingFingerprint: table.mappingFingerprint,
      reconciliationFingerprint: '7'.repeat(64),
    };
    const reviewedRow = {
      ...row,
      rowStatus: 'READY' as const,
      rowVersion: 2,
      reconciliation: {
        schemaVersion: 1 as const,
        inspectionFingerprint: session.previewFingerprint!,
        sourceRowFingerprint: row.sourceRowFingerprint,
        mappingFingerprint: table.mappingFingerprint,
        reconciliationFingerprint: basis.reconciliationFingerprint,
        destinationFingerprint: session.destinationFingerprint!,
        canonicalTag: 'DL01',
        projectState: 'TAG_NEW' as const,
        projectCandidateCount: 0,
        projectLuminaireId: null,
        expectedProjectRowVersion: null,
        bindingId: null,
        expectedBindingRowVersion: null,
        selectedLibraryVersionId: null,
        exactLibraryMatch: null,
        availableLibraryVersions: [],
        possibleLibraryMatches: [],
        ignoredLinkedChanges: [],
        allowedActions: ['PROJECT_CREATE_ONLY', 'SKIP'] as const,
        recommendedAction: 'PROJECT_CREATE_ONLY' as const,
        warnings: [],
        reconciledAt: session.updatedAt,
      },
      intendedAction: {
        type: 'PROJECT_CREATE_ONLY' as const,
        canonicalTag: 'DL01',
        payload: {
          tag: 'DL01',
          category: '',
          description: '',
          manufacturer: '',
          model: '',
          productType: '',
          variantLabel: '',
          orderingCode: '',
          wattage: '',
          lumens: '',
          lightColor: '',
          cri: '',
          beamAngle: '',
          ipRating: '',
          mounting: '',
          cutout: '',
          driver: '',
          control: '',
          emergency: '',
          location: '',
          unit: 'No.',
          quantity: 0,
          notes: '',
          dimensions: '',
          bodyColorFinish: '',
        },
        basis,
      },
    };
    apiMock.uploadImportSource.mockResolvedValue(applySession);
    apiMock.importSession.mockResolvedValue(applySession);
    apiMock.importRows.mockResolvedValue({
      items: [reviewedRow],
      page: 0,
      pageSize: 50,
      totalCount: 1,
      counts: {
        all: 1,
        ready: 1,
        needsReview: 0,
        blocked: 0,
        failed: 0,
        unmapped: 0,
        mappingConflict: 0,
      },
    });
    apiMock.applyImportSession.mockResolvedValue({
      applyAttemptId: '60000000-0000-4000-8000-000000000001',
    });

    renderPage();
    await screen.findByText(/Choose a bounded CSV/);
    fireEvent.click(screen.getByRole('button', { name: 'Select Source' }));
    await screen.findByRole('button', { name: 'Select Source' });
    fireEvent.change(screen.getByLabelText('Upload import source'), {
      target: { files: [new File(['Type Tag\nDL01'], 'dialux.csv', { type: 'text/csv' })] },
    });
    await screen.findByText(/DIALUX NATIVE CSV/);
    openWorkflowStep('Apply');
    expect(await screen.findByText('1 rows will change')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Apply 1 rows' }));
    const dialog = await screen.findByRole('dialog', { name: 'Apply 1 rows' });
    expect(dialog).toHaveTextContent('A verified workspace backup is required before any change.');
    expect(dialog).toHaveTextContent('Applied rows become immutable in this session.');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Apply 1 rows' }));
    await waitFor(() =>
      expect(apiMock.applyImportSession).toHaveBeenCalledWith(
        session.importSessionId,
        expect.objectContaining({
          mode: 'ALL',
          confirmPartial: false,
          applyPlanFingerprint: 'f'.repeat(64),
        }),
      ),
    );
  });
});
