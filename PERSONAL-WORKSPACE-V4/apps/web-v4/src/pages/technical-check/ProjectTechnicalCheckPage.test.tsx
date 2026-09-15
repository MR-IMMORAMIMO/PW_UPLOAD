import { v4Decisions } from '../../components/interaction/V4Decisions';
/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import type {
  LocalIntelligenceOverview,
  LuminaireAssetSummary,
  LuminaireDatasheetAnalysis,
  LuminaireRecord,
} from '@scli/domain';
import { V4Router as ProductionRouter } from '../../router/V4Router';
import { Route, Routes } from 'react-router-dom';
import { ProjectTechnicalCheckWorkspace } from './ProjectTechnicalCheckWorkspace';
function V4Router() {
  return (
    <Routes>
      <Route
        path="/projects/:projectId/technical-check"
        element={<ProjectTechnicalCheckWorkspace />}
      />
      <Route path="*" element={<ProductionRouter />} />
    </Routes>
  );
}
import { cleanupV4, renderV4, stubMatchMedia } from '../../test-utils/renderV4';

const project = {
  id: 'p1',
  projectCode: '004_SCT260812_SCT_UAT',
  projectName: '[SCT UAT] Boutique Hotel Lighting Package',
  clientName: 'Boutique Hotel Developments',
  projectType: 'DIALux Simulation',
  designStage: 'Detailed Design',
  requiredDeliveryDate: '2026-08-14',
  status: 'InProgress',
  version: 1,
};

const record = (
  id: string,
  tag: string,
  patch: Partial<LuminaireRecord> = {},
): LuminaireRecord => ({
  id,
  projectId: 'p1',
  tag,
  category: 'Downlight',
  imagePath: '',
  description: 'Architectural downlight',
  manufacturer: '',
  model: 'DL-150',
  wattage: '12W',
  lumens: '',
  lightColor: '3000K',
  cri: '> 80',
  beamAngle: '',
  ipRating: 'IP65',
  mounting: '',
  cutout: '',
  driver: '',
  control: '',
  emergency: '',
  datasheetPath: '',
  location: 'Lobby',
  unit: 'No.',
  quantity: 12,
  notes: '',
  sourceName: '',
  dimensions: '',
  bodyColorFinish: '',
  rowVersion: 1,
  createdAt: '2026-08-16T08:00:00.000Z',
  updatedAt: '2026-08-16T08:00:00.000Z',
  ...patch,
});

const l1 = record('l1', 'DL01', {
  datasheetPath: 'C:\\fixtures\\DL01_datasheet.pdf',
  imagePath: 'C:\\fixtures\\DL01.png',
});
const l2 = record('l2', 'DL02', { category: 'Wall Washer', model: '' });
let workspaceLuminaires: LuminaireRecord[] = [l1, l2];
let storageState = 'CONNECTED';
let adoptionItems: unknown[] = [];

const workspace = {
  projectId: 'p1',
  folderPath: null,
  folderProfile: 'default',
  folderStructure: [],
  outputFolders: {},
  services: [],
  deliverables: [],
  lightingPackage: { scheduleColumns: [] },
  luminaires: workspaceLuminaires,
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
    score: 0,
    checklistPercent: 0,
    openRequirements: 0,
    blockingRequirements: 0,
    overdueActions: 0,
    unresolvedReviews: 0,
    checks: [],
  },
  updatedAt: '2026-08-16T08:00:00.000Z',
};

const assets: LuminaireAssetSummary[] = [
  {
    luminaireId: 'l1',
    datasheet: {
      id: 'a1',
      projectId: 'p1',
      luminaireId: 'l1',
      assetType: 'Datasheet',
      versionSequence: 1,
      filePath: 'C:\\fixtures\\DL01_datasheet.pdf',
      fileName: 'DL01_datasheet.pdf',
      mimeType: 'application/pdf',
      sizeBytes: 2000,
      fileHash: null,
      backfilled: false,
      attachedAt: '2026-08-16T08:00:00.000Z',
      attachedById: 'u1',
      attachedByNameSnapshot: 'Owner',
    },
    productImage: {
      id: 'a2',
      projectId: 'p1',
      luminaireId: 'l1',
      assetType: 'ProductImage',
      versionSequence: 1,
      filePath: 'C:\\fixtures\\DL01.png',
      fileName: 'DL01.png',
      mimeType: 'image/png',
      sizeBytes: 1000,
      fileHash: null,
      backfilled: false,
      attachedAt: '2026-08-16T08:00:00.000Z',
      attachedById: 'u1',
      attachedByNameSnapshot: 'Owner',
    },
  },
  { luminaireId: 'l2', datasheet: null, productImage: null },
];

const overview: LocalIntelligenceOverview = {
  projectId: 'p1',
  generatedAt: '2026-08-16T08:00:00.000Z',
  engine: 'SCLI Local Intelligence 1.0',
  privacyMode: 'LocalOnly',
  readinessScore: 70,
  checks: [
    {
      key: 'local-datasheets',
      label: 'Datasheets',
      detail: '1 missing',
      severity: 'Warning',
      passed: false,
    },
  ],
  brief: { headline: '', summary: '', nextActions: [], warnings: [] },
  fileClassifications: [],
  stats: {
    luminaireCount: 2,
    linkedDatasheets: 1,
    missingDatasheets: 1,
    indexedFiles: 0,
    classificationsNeedingReview: 0,
  },
};

const comparisons: LuminaireDatasheetAnalysis = {
  luminaireId: 'l1',
  tag: 'DL01',
  datasheetPath: l1.datasheetPath,
  fileName: 'DL01_datasheet.pdf',
  analyzedAt: '2026-08-16T17:51:00.000Z',
  engine: 'SCLI P5C Datasheet Verification 1.0',
  privacyMode: 'LocalOnly',
  status: 'Ready',
  message: 'Five technical fields were found locally.',
  pageCount: 2,
  textAvailable: true,
  comparisons: [
    {
      fieldKey: 'manufacturer',
      label: 'Manufacturer',
      value: 'LumenWorks',
      alternatives: ['LumenWorks'],
      confidence: 95,
      pageNumber: 1,
      evidence: 'Manufacturer: LumenWorks',
      ambiguous: false,
      scheduleValue: '',
      status: 'MissingSchedule',
      verificationResult: 'MISSING_IN_TABLE',
      canUseDatasheetValue: true,
    },
    {
      fieldKey: 'model',
      label: 'Model',
      value: 'DL-150',
      alternatives: ['DL-150'],
      confidence: 92,
      pageNumber: 1,
      evidence: 'Model: DL-150',
      ambiguous: false,
      scheduleValue: 'DL-150',
      status: 'Matched',
    },
    {
      fieldKey: 'wattage',
      label: 'Wattage',
      value: '15W',
      alternatives: ['15W'],
      confidence: 93,
      pageNumber: 1,
      evidence: 'Power: 15W',
      ambiguous: false,
      scheduleValue: '12W',
      status: 'Mismatch',
    },
    {
      fieldKey: 'cri',
      label: 'CRI',
      value: '',
      alternatives: [],
      confidence: 0,
      pageNumber: 0,
      evidence: '',
      ambiguous: false,
      scheduleValue: '> 80',
      status: 'MissingDatasheet',
    },
    {
      fieldKey: 'beamAngle',
      label: 'Beam Angle',
      value: '36° / 60°',
      alternatives: ['36°', '60°'],
      confidence: 55,
      pageNumber: 2,
      evidence: 'Beam angle: 36° / 60°',
      ambiguous: true,
      scheduleValue: '',
      status: 'NeedsReview',
    },
  ],
  counts: { Matched: 1, Mismatch: 1, MissingSchedule: 1, MissingDatasheet: 1, NeedsReview: 1 },
  verificationFingerprint: 'verification-fingerprint-1',
};

const response = (data: unknown) => ({
  ok: true,
  status: 200,
  headers: { get: () => 'c1' },
  json: () => Promise.resolve({ data }),
});

function stubApi(saved = false) {
  const fetch = vi.fn(async (url: string, init?: RequestInit) => {
    if (url.endsWith('/api/projects/p1')) return response(project);
    if (url.endsWith('/workspace'))
      return response({ ...workspace, luminaires: workspaceLuminaires });
    if (url.endsWith('/luminaire-assets')) return response(assets);
    if (url.endsWith('/storage-health')) return response({ state: storageState });
    if (url.endsWith('/legacy-datasheet-adoption'))
      return response({ projectId: 'p1', backupId: null, items: adoptionItems });
    if (url.endsWith('/local-intelligence')) return response(overview);
    if (url.endsWith('/local-intelligence/datasheet-results') && !saved) return response(null);
    if (
      url.endsWith('/local-intelligence/analyze-datasheets') ||
      url.endsWith('/local-intelligence/datasheet-results')
    )
      return response({
        projectId: 'p1',
        items: [
          {
            luminaireId: 'l1',
            tag: 'DL01',
            status: 'VERIFIED',
            reasonCode: 'NONE',
            message: comparisons.message,
            analysis: comparisons,
          },
          {
            luminaireId: 'l2',
            tag: 'DL02',
            status: 'MISSING_DATASHEET',
            reasonCode: 'MISSING_DATASHEET',
            message: 'Attach an official Datasheet first.',
            analysis: null,
          },
        ],
        summary: {
          total: 2,
          analyzed: 1,
          verified: 1,
          needsAdoption: 0,
          failed: 0,
          unverified: 0,
        },
      });
    if (url.endsWith('/luminaires/l1/datasheet-verification/field') && init?.method === 'PATCH') {
      const input = JSON.parse(String(init.body)) as {
        fieldKey: string;
        verificationFingerprint: string;
      };
      workspaceLuminaires = workspaceLuminaires.map((item) =>
        item.id === 'l1' ? { ...item, manufacturer: 'LumenWorks', rowVersion: 2 } : item,
      );
      return response({
        ...comparisons,
        verificationFingerprint: `${input.verificationFingerprint}-next`,
        comparisons: comparisons.comparisons.map((item) =>
          item.fieldKey === input.fieldKey
            ? {
                ...item,
                scheduleValue: 'LumenWorks',
                status: 'Matched' as const,
                verificationResult: 'MATCH' as const,
                canUseDatasheetValue: false,
              }
            : item,
        ),
        counts: { ...comparisons.counts, Matched: 2, MissingSchedule: 0 },
      });
    }
    if (url.endsWith('/luminaires/l1/analyze-datasheet')) {
      return response({
        ...comparisons,
        comparisons: comparisons.comparisons.map((item) =>
          item.fieldKey === 'manufacturer'
            ? { ...item, scheduleValue: 'LumenWorks', status: 'Matched' }
            : item,
        ),
        counts: { ...comparisons.counts, Matched: 2, MissingSchedule: 0 },
      });
    }
    return response({});
  });
  vi.stubGlobal('fetch', fetch);
  return fetch;
}

describe('ProjectTechnicalCheckPage', () => {
  afterEach(() => {
    cleanup();
    cleanupV4();
    vi.unstubAllGlobals();
    delete window.scliDesktop;
    workspaceLuminaires = [l1, l2];
    storageState = 'CONNECTED';
    adoptionItems = [];
    if (assets[0]?.datasheet) {
      delete assets[0].datasheet.locatorKind;
      delete assets[0].datasheet.locatorValue;
    }
  });

  it('shows accurate legacy-adoption guidance and blocks the action until storage is verified', async () => {
    if (assets[0]?.datasheet) {
      assets[0].datasheet.locatorKind = 'LEGACY_PATH';
      assets[0].datasheet.locatorValue = assets[0].datasheet.filePath;
    }
    storageState = 'LEGACY_UNVERIFIED';
    adoptionItems = [
      {
        luminaireId: 'l1',
        tag: 'DL01',
        requestedAssetVersionId: 'a1',
        resultingAssetVersionId: null,
        status: 'BLOCKED_STORAGE_UNVERIFIED',
        reasonCode: 'STORAGE_UNVERIFIED',
        message: 'Connect / verify the Project folder before adopting legacy Datasheets.',
      },
    ];
    stubApi();
    stubMatchMedia();
    renderV4(<V4Router />, ['/projects/p1/technical-check']);

    expect(await screen.findByText('Legacy Datasheet needs adoption')).toBeInTheDocument();
    expect(
      screen.getByText(/Connect \/ verify the Project folder before adopting/i),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Adopt Legacy Datasheets' })).toBeDisabled();
  });

  it('renders the grouped composition and truthful pre-analysis state', async () => {
    stubApi();
    stubMatchMedia();
    renderV4(<V4Router />, ['/projects/p1/technical-check']);

    expect(await screen.findByRole('heading', { name: 'Technical Check' })).toBeInTheDocument();
    expect(await screen.findByRole('button', { name: 'Run Technical Check' })).toBeInTheDocument();
    const summary = screen.getByLabelText('Technical Check summary');
    expect(within(summary).getAllByText('Not run')).toHaveLength(2);
    expect(screen.getAllByText('Missing Datasheet').length).toBeGreaterThan(0);
    const inspector = screen.getByRole('complementary', { name: 'DL02 grouped check inspector' });
    for (const heading of ['Luminaire Summary', 'Review Actions'])
      expect(within(inspector).getByRole('heading', { name: heading })).toBeInTheDocument();
    expect(within(inspector).getByRole('button', { name: 'Open Review' })).toBeEnabled();
    expect(inspector.querySelector('.v4-technical-check__child-check')).toBeNull();
    expect(
      screen.queryByText(/Accept|Dismiss|Mark Reviewed|Approve|Reject/),
    ).not.toBeInTheDocument();
  });

  it('runs real analysis and supports search, result, field, and Hide Matched controls', async () => {
    stubApi();
    stubMatchMedia();
    renderV4(<V4Router />, ['/projects/p1/technical-check']);
    fireEvent.click(await screen.findByRole('button', { name: 'Run Technical Check' }));
    fireEvent.change(screen.getByLabelText('Result filter'), { target: { value: 'all' } });
    fireEvent.click(await screen.findByRole('button', { name: 'Open DL01 review' }));

    const workspace = await screen.findByRole('dialog', {
      name: 'Technical Verification — DL01',
    });
    expect(within(workspace).getAllByText('Conflict').length).toBeGreaterThan(0);
    expect(within(workspace).getAllByText('Missing').length).toBeGreaterThan(0);
    expect(within(workspace).getAllByText('Unverified').length).toBeGreaterThan(0);
    expect(within(workspace).getByText(/Page 1 · Method unavailable/)).toBeInTheDocument();
    fireEvent.click(within(workspace).getByRole('button', { name: 'Close Review' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(screen.getByRole('button', { name: 'Run Again' })).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Result filter'), { target: { value: 'matched' } });
    await waitFor(() =>
      expect(
        screen
          .getByRole('table')
          .querySelectorAll(".v4-technical-check__pill[data-tone='success']"),
      ).toHaveLength(1),
    );
    fireEvent.change(screen.getByLabelText('Result filter'), { target: { value: 'all' } });
    fireEvent.change(screen.getByLabelText('Field filter'), { target: { value: 'beamAngle' } });
    expect((await screen.findAllByText(/Beam Angle/)).length).toBeGreaterThan(0);
    fireEvent.change(screen.getByLabelText('Field filter'), { target: { value: '' } });
    fireEvent.change(screen.getByLabelText('Search technical checks'), {
      target: { value: 'Power: 15W' },
    });
    await waitFor(() => expect(screen.getAllByText('Wattage').length).toBeGreaterThan(1));
    fireEvent.change(screen.getByLabelText('Search technical checks'), { target: { value: '' } });
    fireEvent.click(screen.getByLabelText('Hide Matched'));
    expect(
      screen.getByRole('table').querySelectorAll(".v4-technical-check__pill[data-tone='success']"),
    ).toHaveLength(0);
  });

  it('opens a floating review, returns focus, deep-links by stable luminaire ID, and applies one field-scoped CAS resolution', async () => {
    const fetch = stubApi();
    stubMatchMedia();
    vi.spyOn(v4Decisions, 'confirm').mockResolvedValue(true);
    renderV4(<V4Router />, ['/projects/p1/technical-check']);
    fireEvent.click(await screen.findByRole('button', { name: 'Run Technical Check' }));
    fireEvent.change(screen.getByLabelText('Result filter'), { target: { value: 'all' } });
    const origin = await screen.findByRole('button', { name: 'Open DL01 review' });
    origin.focus();
    fireEvent.click(origin);
    const workspace = await screen.findByRole('dialog', {
      name: 'Technical Verification — DL01',
    });
    expect(within(workspace).getByText('DL01_datasheet.pdf')).toBeInTheDocument();
    fireEvent.click(within(workspace).getByRole('button', { name: 'Manufacturer' }));
    fireEvent.click(within(workspace).getByRole('button', { name: 'Review reading' }));
    fireEvent.click(within(workspace).getByRole('button', { name: /Add \/ Use Datasheet Value/ }));
    await waitFor(() =>
      expect(fetch).toHaveBeenCalledWith(
        expect.stringContaining('/api/projects/p1/luminaires/l1/datasheet-verification/field'),
        expect.objectContaining({ method: 'PATCH' }),
      ),
    );
    const patchCall = fetch.mock.calls.find(
      ([url, init]) =>
        String(url).endsWith('/luminaires/l1/datasheet-verification/field') &&
        init?.method === 'PATCH',
    );
    const body = JSON.parse(String(patchCall?.[1]?.body)) as Record<string, unknown>;
    expect(body).toMatchObject({
      fieldKey: 'manufacturer',
      expectedRowVersion: 1,
      verificationFingerprint: 'verification-fingerprint-1',
    });

    fireEvent.click(within(workspace).getByRole('button', { name: 'Close Review' }));
    await waitFor(() => expect(origin).toHaveFocus());
    const inspector = screen.getByRole('complementary', { name: 'DL01 grouped check inspector' });
    fireEvent.click(within(inspector).getByRole('button', { name: /View in Luminaires/ }));
    expect(await screen.findByRole('heading', { name: 'Luminaires' })).toBeInTheDocument();
    expect(
      screen.getByRole('complementary', { name: 'Selected luminaire inspector' }),
    ).toHaveTextContent(l1.tag);
  });

  it('keeps unsafe ambiguous extracted values disabled', async () => {
    stubApi();
    stubMatchMedia();
    renderV4(<V4Router />, ['/projects/p1/technical-check']);
    fireEvent.click(await screen.findByRole('button', { name: 'Run Technical Check' }));
    fireEvent.change(screen.getByLabelText('Result filter'), { target: { value: 'all' } });
    fireEvent.click(await screen.findByRole('button', { name: 'Open DL01 review' }));
    const workspace = await screen.findByRole('dialog', {
      name: 'Technical Verification — DL01',
    });
    fireEvent.click(within(workspace).getByRole('button', { name: 'Beam Angle' }));
    expect(within(workspace).queryByRole('button', { name: /Use Datasheet Value/ })).toBeNull();
    fireEvent.click(within(workspace).getByRole('button', { name: 'Review reading' }));
    expect(within(workspace).getByRole('button', { name: 'Replace Datasheet' })).toBeEnabled();
  });

  it('keeps pagination anchored and reachable for a longer derived issue list', async () => {
    workspaceLuminaires = Array.from({ length: 10 }, (_, index) =>
      record(`l${index + 10}`, `L${String(index + 1).padStart(2, '0')}`),
    );
    stubApi();
    stubMatchMedia();
    renderV4(<V4Router />, ['/projects/p1/technical-check']);
    expect(await screen.findByText('Showing 1 to 8 of 10 luminaires')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Next page' }));
    expect(await screen.findByText('Showing 9 to 10 of 10 luminaires')).toBeInTheDocument();
    expect(screen.getByLabelText('Luminaires per page')).toHaveValue('8');
  });

  it('shows compact loading and bounded error states', async () => {
    stubMatchMedia();
    vi.stubGlobal(
      'fetch',
      vi.fn(() => new Promise(() => undefined)),
    );
    const loadingView = renderV4(<V4Router />, ['/projects/p1/technical-check']);
    expect(screen.getByText('Loading Technical Check…')).toBeInTheDocument();
    loadingView.unmount();

    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
    renderV4(<V4Router />, ['/projects/p1/technical-check']);
    expect(await screen.findByRole('heading', { name: 'Technical Check' })).toBeInTheDocument();
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Project luminaires and asset data could not be loaded.',
    );
    expect(screen.getByRole('button', { name: 'Retry' })).toBeEnabled();
  });
  it('restores persisted checks in the final view without running extraction on mount', async () => {
    const fetch = stubApi(true);
    stubMatchMedia();
    renderV4(<ProductionRouter />, ['/projects/p1/technical-check']);
    const row = await screen.findByRole('button', { name: /^DL01: \d+ checks$/ });
    expect(
      fetch.mock.calls.some(
        ([url, init]) => String(url).endsWith('/analyze-datasheets') && init?.method === 'POST',
      ),
    ).toBe(false);
    fireEvent.click(row);
    const review = await screen.findByRole('dialog', { name: 'Technical Verification — DL01' });
    expect(within(review).getByText('DL01_datasheet.pdf')).toBeInTheDocument();
    fireEvent.click(within(review).getByRole('button', { name: 'Close Review' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(screen.getByRole('button', { name: 'Run Technical Check' })).toBeInTheDocument();
  });
  it('synchronizes final KPI selection, Hide Matched, and the anchored analysis filter', async () => {
    stubApi(true);
    stubMatchMedia();
    renderV4(<ProductionRouter />, ['/projects/p1/technical-check']);
    await screen.findByRole('button', { name: /^DL01: \d+ checks$/ });
    fireEvent.click(screen.getByRole('button', { name: 'Matched' }));
    expect(screen.getByRole('button', { name: 'Matched' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('switch', { name: 'Hide Matched' })).toHaveAttribute(
      'aria-checked',
      'false',
    );
    fireEvent.click(screen.getByRole('button', { name: 'Matched' }));
    expect(screen.getByRole('button', { name: 'Matched' })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
    fireEvent.click(screen.getByRole('button', { name: 'Datasheets Analyzed' }));
    expect(screen.getByRole('button', { name: 'Datasheets Analyzed' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    fireEvent.click(screen.getByRole('button', { name: 'Analysis status' }));
    fireEvent.click(screen.getByRole('option', { name: 'Not run' }));
    expect(screen.queryByRole('button', { name: /^DL01: \d+ checks$/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});
