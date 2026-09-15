/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import type {
  CanonicalLuminaireSnapshot,
  LuminaireRecord,
  ResolvedOutputTemplate,
  ResolvedOutputEnvelope,
  TechnicalBoqComposableTarget,
  TechnicalBoqOutputHistoryItem,
  TechnicalBoqRequestedTargetView,
  TechnicalBoqWorkspaceView,
} from '@scli/domain';
import { V4Router as ProductionRouter } from '../../router/V4Router';
import { Route, Routes } from 'react-router-dom';
import { ProjectTechnicalBoqWorkspace } from './ProjectTechnicalBoqWorkspace';
function V4Router() {
  return (
    <Routes>
      <Route path="/projects/:projectId/technical-boq" element={<ProjectTechnicalBoqWorkspace />} />
    </Routes>
  );
}
import { cleanupV4, renderV4, stubMatchMedia } from '../../test-utils/renderV4';

const project = {
  id: 'p1',
  projectCode: '001_SCT260809_TEST',
  projectName: 'TEST',
  clientName: 'Scientechnic LLC',
  projectType: 'Lighting Design',
  designStage: 'Technical',
  requiredDeliveryDate: '2026-09-26',
  status: 'InProgress',
  version: 1,
};

const luminaire = (index: number): LuminaireRecord => ({
  id: `l${index}`,
  projectId: 'p1',
  tag: `DL${String(index).padStart(2, '0')}`,
  category: index % 2 ? 'Downlight' : 'Wall Light',
  imagePath: index === 1 ? 'https://example.test/dl01.png' : '',
  description: `Luminaire ${index}`,
  manufacturer: 'Scientechnic',
  model: `DLX Pro ${index}`,
  wattage: `${10 + index}W`,
  lumens: `${1000 + index * 100} lm`,
  lightColor: '3000K',
  cri: '>90',
  beamAngle: '40°',
  ipRating: 'IP20',
  mounting: 'Recessed',
  cutout: 'Ø100 mm',
  driver: 'Remote',
  control: 'DALI',
  emergency: 'No',
  datasheetPath: `C:\\fixtures\\DL${index}.pdf`,
  location: `Level ${index}`,
  unit: index === 1 ? 'No.' : 'm',
  quantity: index === 1 ? 1.5 : index,
  notes: `Notes ${index}`,
  sourceName: 'DIALux',
  dimensions: 'Ø120 × 80 mm',
  bodyColorFinish: 'White',
  rowVersion: 1,
  createdAt: '2026-08-16T08:00:00.000Z',
  updatedAt: '2026-08-16T08:00:00.000Z',
});

const historicalRow: CanonicalLuminaireSnapshot = {
  luminaireId: 'historical-l1',
  tag: 'OLD01',
  category: 'Historical Downlight',
  imagePath: '',
  description: 'Stored revision value',
  manufacturer: 'Historic Maker',
  model: 'Archived Model',
  wattage: '8W',
  lumens: '800 lm',
  lightColor: '2700K',
  cri: '>80',
  beamAngle: '25°',
  ipRating: 'IP20',
  mounting: 'Recessed',
  cutout: 'Ø80 mm',
  driver: 'Integral',
  control: 'On/Off',
  emergency: 'No',
  datasheetPath: '',
  location: 'Historic Level',
  unit: 'nos',
  quantity: 2,
  notes: 'Snapshot note',
  sourceName: 'Revision',
  dimensions: 'Ø90 × 60 mm',
  bodyColorFinish: 'Black',
  attachmentReferences: [],
};

const columns: ResolvedOutputTemplate['columns'] = [
  {
    columnId: 'tag',
    label: 'Tag',
    visible: true,
    order: 1,
    width: 92,
    fieldKey: 'tag',
    groupId: 'identity',
  },
  {
    columnId: 'category',
    label: 'Category',
    visible: true,
    order: 2,
    width: 120,
    fieldKey: 'category',
    groupId: 'identity',
  },
  {
    columnId: 'description',
    label: 'Description',
    visible: true,
    order: 3,
    width: 220,
    fieldKey: 'description',
    groupId: 'identity',
  },
  {
    columnId: 'manufacturer',
    label: 'Manufacturer',
    visible: true,
    order: 4,
    width: 140,
    fieldKey: 'manufacturer',
    groupId: 'identity',
  },
  {
    columnId: 'model',
    label: 'Model',
    visible: true,
    order: 5,
    width: 130,
    fieldKey: 'model',
    groupId: 'identity',
  },
  {
    columnId: 'unit',
    label: 'Unit',
    visible: true,
    order: 6,
    width: 90,
    fieldKey: 'unit',
    groupId: 'project',
  },
  {
    columnId: 'quantity',
    label: 'Quantity',
    visible: true,
    order: 7,
    width: 90,
    fieldKey: 'quantity',
    groupId: 'project',
  },
  {
    columnId: 'location',
    label: 'Location',
    visible: true,
    order: 8,
    width: 145,
    fieldKey: 'location',
    groupId: 'project',
  },
  {
    columnId: 'notes',
    label: 'Notes',
    visible: true,
    order: 9,
    width: 180,
    fieldKey: 'notes',
    groupId: 'project',
  },
];

const template = (
  templateId = 'boq.technical-approved',
  versionId = 'v1',
  displayName = 'Technical Approved',
): ResolvedOutputTemplate => ({
  templateId,
  versionId,
  family: 'TechnicalBoq',
  origin: 'builtin',
  state: 'active',
  displayName,
  sections: [
    {
      sectionId: 'documentTitle',
      label: 'Title',
      visible: true,
      order: 0,
      config: {},
      mandatory: true,
    },
  ],
  columnGroups: [
    { groupId: 'identity', label: 'Identity', order: 0 },
    { groupId: 'technical', label: 'Technical', order: 1 },
    { groupId: 'project', label: 'Project', order: 2 },
  ],
  columns: columns.map((column) => ({ ...column })),
  paperSize: 'A4',
  orientation: 'Landscape',
  rowDensity: 'Compact',
  productsPerPage: null,
  imageSettings: { visible: false, width: 0 },
  headerSettings: { visible: true },
  footerSettings: { visible: true },
  logoVisible: true,
  nonPriced: true,
});

const revision = {
  revisionId: '11111111-1111-4111-8111-111111111111',
  projectId: 'p1',
  revisionSequence: 5,
  revisionLabel: 'REV_05',
  purpose: null,
  internalNote: null,
  lifecycleState: 'FINALIZED' as const,
  projectSnapshot: {},
  luminaireSnapshot: [historicalRow],
  snapshotHash: 'hash',
  createdById: 'u1',
  createdByName: 'Mohamed Ali',
  provenanceClassification: 'CANONICAL' as const,
  legacySourceId: null,
  failureReason: null,
  createdAt: '2026-08-15T08:00:00.000Z',
  finalizedAt: '2026-08-15T08:01:00.000Z',
  updatedAt: '2026-08-15T08:01:00.000Z',
};

const output = (
  id: string,
  format: string,
  lifecycleState: 'FINALIZED' | 'FAILED_RECOVERABLE',
  artifactPresence: 'Present' | 'Missing' | 'Unavailable',
  sequence: number,
): TechnicalBoqOutputHistoryItem => ({
  output: {
    outputId: id,
    projectId: 'p1',
    revisionId: revision.revisionId,
    outputFamily: 'TechnicalBoq',
    outputFormat: format,
    locatorKind: 'PROJECT_RELATIVE',
    locatorValue: `04_TECHNICAL/BOQ/REV_0${sequence}/boq.${format.toLowerCase()}`,
    legacyAbsolutePath: null,
    contentHash: lifecycleState === 'FINALIZED' ? 'a'.repeat(64) : null,
    templateId: 'boq.technical-modern',
    templateVersionId: 'v1',
    resolvedTemplateSnapshot: template('boq.technical-modern', 'v1', 'Technical Modern'),
    resolvedTemplateSnapshotHash: 'template-hash',
    lifecycleState,
    provenanceClassification: 'CANONICAL',
    legacySourceId: null,
    legacySourceField: null,
    templateProvenance: 'RESOLVED',
    failureReason: lifecycleState === 'FAILED_RECOVERABLE' ? 'Writer interrupted safely.' : null,
    createdAt: `2026-08-${10 + sequence}T08:00:00.000Z`,
    finalizedAt: lifecycleState === 'FINALIZED' ? `2026-08-${10 + sequence}T08:01:00.000Z` : null,
    updatedAt: `2026-08-${10 + sequence}T08:01:00.000Z`,
  },
  revisionLabel: `REV_0${sequence}`,
  revisionSequence: sequence,
  templateName: 'Technical Modern',
  createdById: 'u1',
  createdByName: 'Mohamed Ali',
  artifactPresence,
});

const history = [
  output('present', 'PDF', 'FINALIZED', 'Present', 5),
  output('missing', 'XLSX', 'FINALIZED', 'Missing', 4),
  output('failed', 'PDF', 'FAILED_RECOVERABLE', 'Missing', 3),
];

const response = (data: unknown) => ({
  ok: true,
  status: 200,
  headers: { get: () => 'c1' },
  json: () => Promise.resolve({ data }),
});

function outputPreview(body: {
  format: 'PDF' | 'XLSX';
  targetRevisionId?: string;
  options: { pageSize: 'A4' | 'A3'; orientation: 'Landscape' };
}): ResolvedOutputEnvelope {
  const rows = [luminaire(1), luminaire(2)].map((item) => ({
    ...historicalRow,
    ...item,
    luminaireId: item.id,
  }));
  return {
    outputKind: 'TechnicalBoq',
    format: body.format,
    project: {
      projectId: 'p1',
      projectCode: project.projectCode,
      projectName: project.projectName,
      clientName: project.clientName,
    },
    revision: body.targetRevisionId
      ? {
          revisionId: body.targetRevisionId,
          revisionLabel: 'REV_06',
          revisionSequence: 6,
          lifecycleState: 'PREPARING',
          draftPreview: false,
        }
      : {
          revisionId: null,
          revisionLabel: 'DRAFT PREVIEW',
          revisionSequence: null,
          lifecycleState: null,
          draftPreview: true,
        },
    template: { ...template(), versionId: 'v2' },
    branding: {
      companyName: 'Scientechnic',
      designerName: 'Mohamed Ali',
      logoDataUrl: null,
      timeZone: 'Asia/Dubai',
    },
    issueDate: '2026-08-25',
    issueStatus: 'Preliminary',
    sourceFingerprint: 'b'.repeat(64),
    templateSnapshotHash: 'c'.repeat(64),
    rendererIdentity: 'scli.output-presentation',
    rendererVersion: 'p4d-1',
    layoutContractVersion: 'p4d-v1',
    pageSize: body.options.pageSize,
    orientation: body.options.orientation,
    productsPerPage: null,
    messages: [{ code: 'OUTPUT_SUMMARY', level: 'INFO', message: '1 page, 2 luminaires.' }],
    pages: [
      {
        kind: 'TechnicalBoq',
        pageNumber: 1,
        groups: [{ category: 'Downlight', rows, totalsByUnit: { nos: 3 } }],
      },
    ],
    rowCount: 2,
    unitTotals: { nos: 3 },
  };
}

// C1 — a PREPARING composed Revision that may receive a generated Output.
const COMPOSED_TARGET_ID = '22222222-2222-4222-8222-222222222222';
const composableTarget = (
  occupiedFormats: Array<'XLSX' | 'PDF' | 'Both'> = [],
): TechnicalBoqComposableTarget => ({
  revisionId: COMPOSED_TARGET_ID,
  revisionLabel: 'REV_06',
  revisionSequence: 6,
  lifecycleState: 'PREPARING',
  createdAt: '2026-08-18T08:00:00.000Z',
  createdByName: 'Mohamed Ali',
  occupiedFormats,
  snapshotCount: 2,
});

interface StubTarget {
  /** Server verdict returned for the requested target. */
  eligible: boolean;
  occupiedFormats?: Array<'XLSX' | 'PDF' | 'Both'>;
  rejection?: TechnicalBoqRequestedTargetView['rejection'];
  message?: string;
}

function stubApi(
  options: {
    ready?: boolean;
    readinessReason?: string;
    rowCount?: number;
    target?: StubTarget;
    generateFails?: string;
  } = {},
) {
  const classic = template('boq.technical-modern', 'v1', 'Technical Modern');
  let effectiveTemplate = template();
  const currentRows = Array.from({ length: options.rowCount ?? 12 }, (_, index) =>
    luminaire(index + 1),
  );
  const bodies: unknown[] = [];
  const fetch = vi.fn((url: string, init?: RequestInit) => {
    if (url.includes('/output-presentations/preview') && init?.method === 'POST') {
      const body = JSON.parse(String(init.body));
      return Promise.resolve(response(outputPreview(body)));
    }
    if (url.includes('/output-presentations/generate') && init?.method === 'POST') {
      const body = JSON.parse(String(init.body));
      bodies.push(body);
      if (options.generateFails)
        return Promise.resolve({
          ok: false,
          status: 409,
          headers: { get: () => 'c1' },
          json: () =>
            Promise.resolve({ error: { code: 'CONFLICT', message: options.generateFails } }),
        });
      return Promise.resolve(
        response({ revision, outputs: [], files: { xlsxPath: null, pdfPath: null } }),
      );
    }
    if (url.includes('/technical-boq/generate') && init?.method === 'POST') {
      bodies.push(JSON.parse(String(init.body)));
      if (options.generateFails) {
        return Promise.resolve({
          ok: false,
          status: 409,
          headers: { get: () => 'c1' },
          json: () =>
            Promise.resolve({ error: { code: 'CONFLICT', message: options.generateFails } }),
        });
      }
      return Promise.resolve(
        response({ revision, outputs: [], files: { xlsxPath: null, pdfPath: null } }),
      );
    }
    if (url.endsWith('/technical-boq/config') && init?.method === 'PATCH') {
      const body = JSON.parse(String(init.body)) as {
        templateId?: string;
        templateVersionId?: string;
        paperSize?: 'Auto' | 'A4' | 'A3';
        columns?: Array<{ columnId: string; visible?: boolean; order?: number; width?: number }>;
        reset?: true;
      };
      bodies.push(body);
      if (body.templateId === classic.templateId) effectiveTemplate = structuredClone(classic);
      if (body.reset) effectiveTemplate = structuredClone(template());
      if (body.paperSize) effectiveTemplate.paperSize = body.paperSize;
      for (const patch of body.columns ?? []) {
        const current = effectiveTemplate.columns.find(
          (column) => column.columnId === patch.columnId,
        );
        if (current) Object.assign(current, patch);
      }
      return Promise.resolve(response({ projectOverride: {}, effectiveTemplate }));
    }
    if (url.includes('/technical-boq')) {
      const selected = url.includes(`revisionId=${revision.revisionId}`);
      // The workspace read is the ONLY source of the target verdict, and it is
      // returned only when the request actually carried targetRevisionId.
      const requestedTargetId = new URL(url, 'http://test.local').searchParams.get(
        'targetRevisionId',
      );
      const target = options.target;
      const requestedTarget: TechnicalBoqRequestedTargetView | null =
        requestedTargetId && target
          ? target.eligible
            ? {
                revisionId: requestedTargetId,
                eligible: true,
                rejection: null,
                message: 'REV_06 can receive a generated Technical BOQ Output.',
                target: composableTarget(target.occupiedFormats ?? []),
              }
            : {
                revisionId: requestedTargetId,
                eligible: false,
                rejection: target.rejection ?? 'TARGET_FINALIZED',
                message: target.message ?? 'REV_06 is finalized and immutable.',
                target: null,
              }
          : null;
      const workspace: TechnicalBoqWorkspaceView = {
        projectId: 'p1',
        currentRows,
        templates: [template(), classic].map((resolvedTemplate) => ({
          templateId: resolvedTemplate.templateId,
          templateVersionId: resolvedTemplate.versionId,
          name: resolvedTemplate.displayName,
          version: resolvedTemplate.versionId,
          resolvedTemplate,
        })),
        effectiveTemplate: structuredClone(effectiveTemplate),
        projectOverride: null,
        revisions: [{ revision, generatedOutputRevision: true, compatibility: null }],
        selectedRevision: selected
          ? {
              metadata: { revision, generatedOutputRevision: true, compatibility: null },
              rows: [historicalRow],
            }
          : null,
        outputs: history,
        composableTargets: options.target ? [composableTarget(options.target.occupiedFormats)] : [],
        requestedTarget,
        generationReadiness:
          options.ready === false
            ? { ready: false, reasons: [options.readinessReason ?? 'Project folder required'] }
            : { ready: true, reasons: [] },
      };
      return Promise.resolve(response(workspace));
    }
    if (url.endsWith('/workspace')) {
      return Promise.resolve(response({ projectId: 'p1', folderPath: 'C:\\Projects\\TEST' }));
    }
    if (url.endsWith('/api/projects/p1')) return Promise.resolve(response(project));
    return Promise.resolve(response({}));
  });
  vi.stubGlobal('fetch', fetch);
  return { fetch, bodies };
}

function renderPage() {
  stubMatchMedia();
  renderV4(<V4Router />, ['/projects/p1/technical-boq']);
}

/**
 * Deep-links the SAME route with a composition target in the address — the only
 * authority for the target. No router state and no session storage.
 */
function renderPageWithTarget(targetRevisionId: string = COMPOSED_TARGET_ID) {
  stubMatchMedia();
  renderV4(<V4Router />, [`/projects/p1/technical-boq?targetRevisionId=${targetRevisionId}`]);
}

describe('ProjectTechnicalBoqPage', () => {
  afterEach(() => {
    cleanup();
    delete window.scliDesktop;
    cleanupV4();
  });

  it('renders the final BOQ with real quantities and the non-priced output contract', async () => {
    const { fetch, bodies } = stubApi();
    stubMatchMedia();
    renderV4(<ProductionRouter />, ['/projects/p1/technical-boq/advanced']);
    const main = await screen.findByTestId('v4-technical-boq');
    expect(
      await within(main).findByRole('table', { name: 'Technical Lighting BOQ' }),
    ).toBeInTheDocument();
    expect(within(main).getByText('Showing 1 to 5 of 12 items')).toBeInTheDocument();
    expect(within(main).getByText('Not applicable')).toBeInTheDocument();
    expect(
      within(main).queryByRole('columnheader', { name: /Price|Rate|Amount/ }),
    ).not.toBeInTheDocument();
    fireEvent.click(within(main).getByRole('button', { name: 'Generate Output' }));
    expect(
      await screen.findByRole('dialog', { name: /Technical Lighting BOQ Preview/ }),
    ).toBeInTheDocument();
    const preview = fetch.mock.calls.find(
      ([url, init]) =>
        String(url).endsWith('/output-presentations/preview') && init?.method === 'POST',
    );
    expect(JSON.parse(String(preview?.[1]?.body))).toMatchObject({ outputKind: 'TechnicalBoq' });
    expect(bodies).toHaveLength(0);
  });

  it('renders the locked technical workspace from current canonical rows and effective template authority', async () => {
    stubApi();
    renderPage();
    expect(
      await screen.findByRole('heading', { name: 'Technical Lighting BOQ' }),
    ).toBeInTheDocument();
    await screen.findByText('DL01');
    expect(screen.getByRole('button', { name: 'Preview BOQ' })).toBeEnabled();
    expect(screen.getByRole('combobox', { name: 'BOQ template' })).toHaveDisplayValue(
      'Technical Approved · v1',
    );
    expect(
      screen
        .getAllByRole('columnheader')
        .slice(1)
        .map((header) => header.textContent),
    ).toEqual([
      'Tag',
      'Category',
      'Description',
      'Manufacturer',
      'Model',
      'Unit',
      'Quantity',
      'Location',
      'Notes',
    ]);
    expect(screen.getByText('DL01')).toBeInTheDocument();
    expect(screen.getByText('Luminaire 1')).toBeInTheDocument();
    expect(screen.getByText('No.')).toBeInTheDocument();
    expect(screen.getByText('1.5')).toBeInTheDocument();
    expect(screen.getByText('Showing 1 to 12 of 12 items')).toBeInTheDocument();
    expect(screen.getByTestId('boq-table-scroll')).toHaveClass('v4-schedule__table-scroll');
    expect(screen.getByTestId('boq-workspace')).toContainElement(
      screen.getByTestId('boq-main-card'),
    );
    expect(screen.getByTestId('boq-workspace')).toContainElement(
      screen.getByTestId('boq-inspector'),
    );
    expect(screen.getByTestId('boq-main-card')).toContainElement(
      screen.getByTestId('boq-pagination'),
    );
    const inspector = screen.getByRole('complementary', { name: 'BOQ Output Details' });
    expect(inspector).toHaveTextContent('Technical Approved');
    expect(inspector).toHaveTextContent('Landscape · Template-defined');
    expect(inspector).not.toHaveTextContent('Units');
    expect(inspector).not.toHaveTextContent('Currency');
    expect(inspector).not.toHaveTextContent('Language');
    expect(inspector).not.toHaveTextContent('Include Images');
    expect(within(inspector).getByText('Present')).toBeInTheDocument();
    expect(within(inspector).getByText('Missing Artifact')).toBeInTheDocument();
    expect(within(inspector).getByText('Failed · Recoverable')).toBeInTheDocument();
  });

  it('loads a canonical historical snapshot without changing the effective generation template', async () => {
    stubApi();
    renderPage();
    await screen.findByText('DL01');
    fireEvent.change(screen.getByRole('combobox', { name: 'BOQ revision' }), {
      target: { value: revision.revisionId },
    });
    expect(await screen.findByText('OLD01')).toBeInTheDocument();
    expect(screen.getByText('Snapshot')).toHaveClass('v4-schedule__snapshot-pill');
    expect(screen.queryByText('Viewing REV_05 snapshot')).not.toBeInTheDocument();
    expect(document.querySelector('.v4-schedule__snapshot-notice')).not.toBeInTheDocument();
    expect(screen.queryByText('DL01')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Preview BOQ' })).toBeDisabled();
    expect(screen.getByRole('combobox', { name: 'BOQ template' })).toHaveDisplayValue(
      'Technical Approved · v1',
    );
    expect(screen.getByRole('complementary', { name: 'BOQ Output Details' })).toHaveTextContent(
      'Technical Modern',
    );
  });

  it('writes real template and paper-size overrides through the canonical config endpoint', async () => {
    const { fetch, bodies } = stubApi();
    renderPage();
    await screen.findByText('DL01');
    fireEvent.change(screen.getByRole('combobox', { name: 'BOQ template' }), {
      target: { value: 'boq.technical-modern::v1' },
    });
    await waitFor(() =>
      expect(bodies).toContainEqual({
        templateId: 'boq.technical-modern',
        templateVersionId: 'v1',
      }),
    );
    const settings = screen
      .getAllByRole('button', { name: 'Settings' })
      .find((button) => button.hasAttribute('aria-expanded'))!;
    fireEvent.click(settings);
    fireEvent.change(screen.getByRole('combobox', { name: 'Paper size' }), {
      target: { value: 'A3' },
    });
    await waitFor(() => expect(bodies).toContainEqual({ paperSize: 'A3' }));
    expect(
      fetch.mock.calls.some(
        ([url, init]) => String(url).endsWith('/technical-boq/config') && init?.method === 'PATCH',
      ),
    ).toBe(true);
  });

  it('persists column visibility, order, width and reset-to-template through canonical overrides', async () => {
    const { bodies } = stubApi();
    renderPage();
    await screen.findByText('DL01');
    fireEvent.click(screen.getByRole('button', { name: /Columns/ }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Model' }));
    await waitFor(() =>
      expect(bodies).toContainEqual({ columns: [{ columnId: 'model', visible: false }] }),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Move Category up' }));
    await waitFor(() =>
      expect(bodies.some((body) => JSON.stringify(body).includes('"order"'))).toBe(true),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Widen Unit' }));
    await waitFor(() =>
      expect(bodies).toContainEqual({ columns: [{ columnId: 'unit', width: 110 }] }),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Reset to Template' }));
    await waitFor(() =>
      expect(
        bodies.some(
          (body) =>
            typeof body === 'object' && body !== null && 'reset' in body && body.reset === true,
        ),
      ).toBe(true),
    );
    expect(screen.getByRole('checkbox', { name: /Tag/ })).toBeDisabled();
  });

  it('previews and generates only professional BOQ PDF/XLSX payloads', async () => {
    const { fetch, bodies } = stubApi();
    renderPage();
    await screen.findByText('DL01');
    fireEvent.click(screen.getByRole('button', { name: 'Preview BOQ' }));
    await screen.findByRole('heading', { name: 'Technical Lighting BOQ Preview' });
    expect(screen.getByRole('row', { name: 'Downlight subtotal nos 3' })).toBeInTheDocument();
    expect(screen.getByRole('row', { name: 'Final quantity total nos 3' })).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Format'), { target: { value: 'XLSX' } });
    fireEvent.click(screen.getByRole('button', { name: 'Refresh Preview' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Generate XLSX' }));
    await waitFor(() =>
      expect(bodies.some((body) => (body as { format?: string }).format === 'XLSX')).toBe(true),
    );
    expect(JSON.stringify(bodies)).toContain('"pageSize":"A3"');
    const mutationUrls = fetch.mock.calls
      .filter(([, init]) => init?.method === 'POST')
      .map(([url]) => String(url));
    expect(
      mutationUrls.filter((url) => url.endsWith('/output-presentations/generate')),
    ).toHaveLength(1);
    expect(mutationUrls.some((url) => url.includes('lighting-package'))).toBe(false);
    expect(JSON.stringify(bodies)).not.toContain('LuminaireSchedule');
    expect(JSON.stringify(bodies)).not.toContain('PresentationSchedule');
  });

  it('opens present artifacts, withholds Open for missing artifacts, and retries without duplicating history', async () => {
    const openPath = vi.fn().mockResolvedValue('opened');
    window.scliDesktop = { openPath };
    const { bodies } = stubApi();
    renderPage();
    await screen.findByText('DL01');
    expect(screen.getAllByRole('article')).toHaveLength(3);
    const open = screen.getByRole('button', { name: 'Open' });
    fireEvent.click(open);
    expect(openPath).toHaveBeenCalledWith('C:\\Projects\\TEST\\04_TECHNICAL\\BOQ\\REV_05\\boq.pdf');
    const missingArticle = screen.getByText('Missing Artifact').closest('article')!;
    expect(within(missingArticle).queryByRole('button', { name: 'Open' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Retry Generation' }));
    await waitFor(() =>
      expect(
        bodies.some(
          (body) =>
            (body as { recoveryRevisionId?: string }).recoveryRevisionId === revision.revisionId,
        ),
      ).toBe(true),
    );
    expect(screen.getAllByRole('article')).toHaveLength(3);
  });

  it('blocks Golden generation with the real Project folder readiness reason', async () => {
    stubApi({ ready: false });
    renderPage();
    expect(await screen.findByText('Project folder required')).toBeInTheDocument();
    const generate = screen.getByRole('button', { name: 'Preview BOQ' });
    expect(generate).toBeVisible();
    expect(generate).toBeDisabled();
  });

  it('blocks TEST generation when the stored physical project root is missing', async () => {
    stubApi({ ready: false, readinessReason: 'Project folder is missing' });
    renderPage();
    expect(await screen.findByText('Project folder is missing')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Preview BOQ' })).toBeDisabled();
  });

  it('uses shared pagination while retaining internal table scrolling', async () => {
    stubApi({ rowCount: 12 });
    renderPage();
    await screen.findByText('Showing 1 to 12 of 12 items');
    fireEvent.change(screen.getByRole('combobox', { name: 'Rows per page' }), {
      target: { value: '10' },
    });
    expect(await screen.findByText('Showing 1 to 10 of 12 items')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Next page' }));
    expect(await screen.findByText('Showing 11 to 12 of 12 items')).toBeInTheDocument();
    expect(screen.getByTestId('boq-table-scroll')).toHaveClass('v4-schedule__table-scroll');
  });
});

/**
 * C1 — targeted generation into an existing PREPARING composed Revision.
 *
 * Every case drives the SAME route; only the address query differs. The page
 * never invents eligibility: it renders the server verdict and blocks when the
 * verdict is negative.
 */
describe('ProjectTechnicalBoqPage — composition target (C1)', () => {
  afterEach(() => {
    cleanup();
    delete window.scliDesktop;
    cleanupV4();
  });

  it('sends no targetRevisionId and shows no target chip when the address carries none', async () => {
    const { fetch, bodies } = stubApi();
    renderPage();
    await screen.findByText('DL01');
    expect(screen.queryByTestId('v4-target-revision-chip')).not.toBeInTheDocument();
    expect(screen.queryByTestId('v4-target-revision-invalid')).not.toBeInTheDocument();
    // The workspace read must not carry an empty target parameter.
    const reads = fetch.mock.calls
      .map(([url]) => String(url))
      .filter((url) => url.includes('/technical-boq') && !url.includes('/generate'));
    expect(reads.length).toBeGreaterThan(0);
    expect(reads.every((url) => !url.includes('targetRevisionId'))).toBe(true);

    fireEvent.click(screen.getByRole('button', { name: 'Preview BOQ' }));
    await screen.findByRole('heading', { name: 'Technical Lighting BOQ Preview' });
    fireEvent.change(screen.getByLabelText('Format'), { target: { value: 'XLSX' } });
    fireEvent.click(screen.getByRole('button', { name: 'Refresh Preview' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Generate XLSX' }));
    await waitFor(() => expect(bodies).toHaveLength(1));
    expect(bodies[0]).not.toHaveProperty('targetRevisionId');
  });

  it('forwards the address target to the workspace read and renders the compact server verdict', async () => {
    const { fetch } = stubApi({ target: { eligible: true } });
    renderPageWithTarget();
    await screen.findByText('DL01');
    const reads = fetch.mock.calls
      .map(([url]) => String(url))
      .filter((url) => url.includes('/technical-boq') && !url.includes('/generate'));
    expect(reads.some((url) => url.includes(`targetRevisionId=${COMPOSED_TARGET_ID}`))).toBe(true);

    const chip = await screen.findByTestId('v4-target-revision-chip');
    expect(chip).toHaveTextContent('Generating into REV_06');
    // Display-only source language: never the raw canonicalOperation.
    expect(screen.getByTestId('v4-target-revision-meta')).toHaveTextContent(
      'Composed / Manual Revision · PREPARING · 2 documents',
    );
    expect(chip).not.toHaveTextContent('MANUAL_DELIVERABLES');
    expect(screen.getByRole('button', { name: 'Preview BOQ' })).toBeEnabled();
  });

  it('sends ONLY targetRevisionId in the generation payload and refreshes the Revision reads', async () => {
    const { bodies } = stubApi({ target: { eligible: true } });
    renderPageWithTarget();
    await screen.findByText('DL01');
    await screen.findByTestId('v4-target-revision-chip');
    fireEvent.click(screen.getByRole('button', { name: 'Preview BOQ' }));
    await screen.findByRole('heading', { name: 'Technical Lighting BOQ Preview' });
    fireEvent.change(screen.getByLabelText('Format'), { target: { value: 'XLSX' } });
    fireEvent.click(screen.getByRole('button', { name: 'Refresh Preview' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Generate XLSX' }));
    await waitFor(() => expect(bodies).toHaveLength(1));
    const body = bodies[0] as Record<string, unknown>;
    expect(body.targetRevisionId).toBe(COMPOSED_TARGET_ID);
    expect(body.format).toBe('XLSX');
    // No client-asserted lifecycle, operation, label, sequence, or recovery.
    expect(body).not.toHaveProperty('recoveryRevisionId');
    expect(body).not.toHaveProperty('lifecycleState');
    expect(body).not.toHaveProperty('canonicalOperation');
    expect(body).not.toHaveProperty('revisionLabel');
    expect(body).not.toHaveProperty('revisionSequence');
  });

  it('keeps the target chip visible while a historical snapshot is inspected', async () => {
    stubApi({ target: { eligible: true } });
    renderPageWithTarget();
    await screen.findByText('DL01');
    await screen.findByTestId('v4-target-revision-chip');
    fireEvent.change(screen.getByRole('combobox', { name: 'BOQ revision' }), {
      target: { value: revision.revisionId },
    });
    expect(await screen.findByText('OLD01')).toBeInTheDocument();
    // The historical selector and the composition target are independent.
    expect(screen.getByTestId('v4-target-revision-chip')).toHaveTextContent(
      'Generating into REV_06',
    );
    expect(screen.getByRole('button', { name: 'Preview BOQ' })).toBeDisabled();
  });

  it('blocks generation on an ineligible target instead of falling back to standalone', async () => {
    const { bodies } = stubApi({
      target: {
        eligible: false,
        rejection: 'TARGET_FINALIZED',
        message: 'REV_06 is finalized and immutable.',
      },
    });
    renderPageWithTarget();
    await screen.findByText('DL01');
    const invalid = await screen.findByTestId('v4-target-revision-invalid');
    expect(invalid).toHaveTextContent('REV_06 is finalized and immutable.');
    expect(invalid).toHaveTextContent('Generation is blocked until the target is cleared.');
    expect(screen.queryByTestId('v4-target-revision-chip')).not.toBeInTheDocument();
    const generate = screen.getByRole('button', { name: 'Preview BOQ' });
    expect(generate).toBeDisabled();
    expect(bodies).toHaveLength(0);
  });

  it('reports a malformed address target locally without failing the workspace read', async () => {
    const { fetch } = stubApi({ target: { eligible: true } });
    renderPageWithTarget('not-a-uuid');
    await screen.findByText('DL01');
    expect(await screen.findByTestId('v4-target-revision-invalid')).toHaveTextContent(
      'not a valid Revision identifier',
    );
    // A malformed reference is never forwarded to the server.
    const reads = fetch.mock.calls
      .map(([url]) => String(url))
      .filter((url) => url.includes('/technical-boq') && !url.includes('/generate'));
    expect(reads.every((url) => !url.includes('targetRevisionId'))).toBe(true);
    expect(screen.getByRole('button', { name: 'Preview BOQ' })).toBeDisabled();
  });

  it('clears the target from the address and returns to standalone generation', async () => {
    const { bodies } = stubApi({ target: { eligible: true } });
    renderPageWithTarget();
    await screen.findByText('DL01');
    await screen.findByTestId('v4-target-revision-chip');
    fireEvent.click(screen.getByTestId('v4-target-revision-clear'));
    await waitFor(() =>
      expect(screen.queryByTestId('v4-target-revision-chip')).not.toBeInTheDocument(),
    );
    // The address no longer names a target, so the workspace re-reads standalone.
    await screen.findByText('DL01');
    fireEvent.click(screen.getByRole('button', { name: 'Preview BOQ' }));
    await screen.findByRole('heading', { name: 'Technical Lighting BOQ Preview' });
    fireEvent.change(screen.getByLabelText('Format'), { target: { value: 'XLSX' } });
    fireEvent.click(screen.getByRole('button', { name: 'Refresh Preview' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Generate XLSX' }));
    await waitFor(() => expect(bodies).toHaveLength(1));
    expect(bodies[0]).not.toHaveProperty('targetRevisionId');
  });

  it('surfaces occupied target slots before Preview generation', async () => {
    stubApi({ target: { eligible: true, occupiedFormats: ['XLSX'] } });
    renderPageWithTarget();
    await screen.findByText('DL01');
    expect(await screen.findByTestId('v4-target-revision-meta')).toHaveTextContent(
      'Technical BOQ XLSX already present',
    );
    expect(screen.getByRole('button', { name: 'Preview BOQ' })).toBeEnabled();
  });

  it('surfaces a server duplicate refusal verbatim and leaves the target intact', async () => {
    stubApi({
      target: { eligible: true },
      generateFails: 'REV_06 already contains a Technical BOQ XLSX Output.',
    });
    renderPageWithTarget();
    await screen.findByText('DL01');
    await screen.findByTestId('v4-target-revision-chip');
    fireEvent.click(screen.getByRole('button', { name: 'Preview BOQ' }));
    await screen.findByRole('heading', { name: 'Technical Lighting BOQ Preview' });
    fireEvent.change(screen.getByLabelText('Format'), { target: { value: 'XLSX' } });
    fireEvent.click(screen.getByRole('button', { name: 'Refresh Preview' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Generate XLSX' }));
    expect(
      await screen.findByText('REV_06 already contains a Technical BOQ XLSX Output.'),
    ).toBeInTheDocument();
    expect(screen.getByTestId('v4-target-revision-chip')).toBeInTheDocument();
  });
});
