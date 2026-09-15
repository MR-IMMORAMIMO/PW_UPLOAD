/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import type { LuminaireAssetSummary, LuminaireAssetVersion, LuminaireRecord } from '@scli/domain';
import { V4Router as ProductionRouter } from '../../router/V4Router';
import { Route, Routes } from 'react-router-dom';
import { ProjectDatasheetsWorkspace } from './ProjectDatasheetsWorkspace';
function V4Router() {
  return (
    <Routes>
      <Route
        path="/projects/:projectId/datasheets-images"
        element={<ProjectDatasheetsWorkspace />}
      />
      <Route path="*" element={<ProductionRouter />} />
    </Routes>
  );
}
import { cleanupV4, renderV4, stubMatchMedia } from '../../test-utils/renderV4';

const project = {
  id: 'p1',
  projectCode: '001_SCT_TEST',
  projectName: 'TEST',
  clientName: 'Scientechnic LLC',
  projectType: 'Lighting Design',
  designStage: 'Technical',
  requiredDeliveryDate: '2026-09-26',
  status: 'InProgress',
  version: 1,
};
const luminaire = (id: string, tag: string, category: string): LuminaireRecord => ({
  id,
  projectId: 'p1',
  tag,
  category,
  imagePath: '',
  description: `${category} luminaire`,
  manufacturer: 'Scientechnic',
  model: `${tag} Pro`,
  wattage: '18W',
  lumens: '',
  lightColor: '3000K',
  cri: '',
  beamAngle: '',
  ipRating: '',
  mounting: '',
  cutout: '',
  driver: '',
  control: '',
  emergency: '',
  datasheetPath: '',
  location: '',
  unit: 'No.',
  quantity: 1,
  notes: `Notes for ${tag}`,
  sourceName: '',
  dimensions: '',
  bodyColorFinish: '',
  rowVersion: 1,
  createdAt: '2026-08-16T08:00:00.000Z',
  updatedAt: '2026-08-16T08:00:00.000Z',
});
const version = (
  luminaireId: string,
  assetType: 'Datasheet' | 'ProductImage',
  sequence = 1,
  backfilled = false,
): LuminaireAssetVersion => ({
  id: `${luminaireId}-${assetType}-${sequence}`,
  projectId: 'p1',
  luminaireId,
  assetType,
  versionSequence: sequence,
  filePath:
    assetType === 'Datasheet'
      ? `C:\\assets\\${luminaireId}-v${sequence}.pdf`
      : 'https://example.test/product.png',
  fileName: assetType === 'Datasheet' ? `${luminaireId}-v${sequence}.pdf` : 'product.png',
  mimeType: assetType === 'Datasheet' ? 'application/pdf' : 'image/png',
  sizeBytes: 2048,
  fileHash: null,
  backfilled,
  attachedAt: `2026-08-${10 + sequence}T08:00:00.000Z`,
  attachedById: backfilled ? null : 'u1',
  attachedByNameSnapshot: backfilled ? null : 'Asset Owner',
});
const luminaires = [luminaire('l1', 'DL01', 'Downlight'), luminaire('l2', 'WL01', 'Wall Light')];
let workspaceLuminaires = luminaires;
let summaries: LuminaireAssetSummary[] = [
  {
    luminaireId: 'l1',
    datasheet: version('l1', 'Datasheet'),
    productImage: version('l1', 'ProductImage'),
  },
  { luminaireId: 'l2', datasheet: null, productImage: version('l2', 'ProductImage') },
];
let histories: Record<string, LuminaireAssetVersion[]> = {
  l1: [version('l1', 'Datasheet'), version('l1', 'ProductImage')],
  l2: [version('l2', 'ProductImage')],
};
const workspace = {
  projectId: 'p1',
  folderPath: null,
  folderProfile: 'default',
  folderStructure: [],
  outputFolders: {},
  services: [],
  deliverables: [],
  lightingPackage: { scheduleColumns: [] },
  luminaires,
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
const response = (data: unknown) => ({
  ok: true,
  status: 200,
  headers: { get: () => 'c1' },
  json: () => Promise.resolve({ data }),
});

function stubApi() {
  const fetch = vi.fn((url: string, init?: RequestInit) => {
    if (url.endsWith('/api/projects/p1')) return Promise.resolve(response(project));
    if (url.endsWith('/workspace')) {
      return Promise.resolve(response({ ...workspace, luminaires: workspaceLuminaires }));
    }
    if (url.endsWith('/file-handoff'))
      return Promise.resolve(
        response({
          handoffId: 'handoff-test',
          action:
            JSON.parse(String(init?.body)).action === 'OPEN'
              ? 'OPEN_LUMINAIRE_ASSET'
              : 'SAVE_LUMINAIRE_ASSET_COPY',
        }),
      );
    if (/\/luminaires\/l1$/.test(url) && init?.method === 'PATCH') {
      const body = JSON.parse(String(init.body));
      workspaceLuminaires = workspaceLuminaires.map((row) =>
        row.id === 'l1' ? { ...row, ...body } : row,
      );
      return Promise.resolve(response(workspaceLuminaires[0]));
    }
    if (url.endsWith('/luminaire-assets')) return Promise.resolve(response(summaries));
    const luminaireMatch = /\/luminaires\/(l1|l2)\/asset-versions$/.exec(url);
    if (luminaireMatch && init?.method === 'POST') {
      const luminaireId = luminaireMatch[1]!;
      const body = JSON.parse(String(init.body)) as { assetType: 'Datasheet' | 'ProductImage' };
      const previous = histories[luminaireId]?.filter(
        (item) => item.assetType === body.assetType,
      ).length;
      const attached = version(luminaireId, body.assetType, (previous ?? 0) + 1);
      histories[luminaireId] = [attached, ...(histories[luminaireId] ?? [])];
      summaries = summaries.map((summary) =>
        summary.luminaireId === luminaireId
          ? {
              ...summary,
              [body.assetType === 'Datasheet' ? 'datasheet' : 'productImage']: attached,
            }
          : summary,
      );
      return Promise.resolve(response(attached));
    }
    if (luminaireMatch) return Promise.resolve(response(histories[luminaireMatch[1]!] ?? []));
    return Promise.resolve(response({}));
  });
  vi.stubGlobal('fetch', fetch);
  return fetch;
}

describe('ProjectDatasheetsImagesPage', () => {
  afterEach(() => {
    cleanup();
    cleanupV4();
    vi.unstubAllGlobals();
    delete window.scliDesktop;
    workspaceLuminaires = luminaires;
    summaries = [
      {
        luminaireId: 'l1',
        datasheet: version('l1', 'Datasheet'),
        productImage: version('l1', 'ProductImage'),
      },
      { luminaireId: 'l2', datasheet: null, productImage: version('l2', 'ProductImage') },
    ];
    histories = {
      l1: [version('l1', 'Datasheet'), version('l1', 'ProductImage')],
      l2: [version('l2', 'ProductImage')],
    };
  });

  it('renders the reference title, three KPIs, compact table, selection, and six-region inspector', async () => {
    stubApi();
    stubMatchMedia();
    renderV4(<V4Router />, ['/projects/p1/datasheets-images']);
    const title = await screen.findByRole('heading', { name: 'Datasheets & Images' });
    expect(title).toBeInTheDocument();
    expect(title.closest('.v4-page-header')).toHaveClass('v4-page-header');
    expect(title.closest('.v4-datasheets__main')).toBeNull();
    expect(
      await screen.findAllByText('1', { selector: '.v4-datasheets__kpis strong' }),
    ).toHaveLength(2);
    expect(screen.getByText('Missing Datasheets')).toBeInTheDocument();
    expect(screen.getByText('Images Missing')).toBeInTheDocument();
    expect(
      within(screen.getByLabelText('Asset completeness summary')).getByText('Complete'),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('searchbox', { name: 'Search by tag, type, manufacturer' }),
    ).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Asset completeness filter'), {
      target: { value: 'all' },
    });
    expect(await screen.findAllByText('DL01')).not.toHaveLength(0);
    fireEvent.click(screen.getByRole('radio', { name: 'Select WL01' }));
    expect(screen.getByRole('complementary', { name: 'WL01 asset inspector' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Linked Files' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Missing Items' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Notes' })).toBeInTheDocument();
  });

  it('defaults to four rows per page and paginates the eight-row Golden composition as 4 + 4', async () => {
    workspaceLuminaires = [
      ...luminaires,
      ...Array.from({ length: 6 }, (_, index) =>
        luminaire(`l${index + 3}`, `L${String(index + 3).padStart(2, '0')}`, 'Linear'),
      ),
    ];
    summaries = workspaceLuminaires.map((item) => ({
      luminaireId: item.id,
      datasheet: version(item.id, 'Datasheet'),
      productImage: version(item.id, 'ProductImage'),
    }));
    stubApi();
    stubMatchMedia();
    renderV4(<V4Router />, ['/projects/p1/datasheets-images']);

    await screen.findByRole('radio', { name: 'Select DL01' });
    expect(screen.getAllByRole('radio', { name: /^Select / })).toHaveLength(4);
    expect(screen.getByText('Showing 1 to 4 of 8 luminaires')).toBeInTheDocument();
    expect(screen.getByLabelText('Rows per page')).toHaveValue('4');
    expect(screen.getByRole('button', { name: 'Page 1 of 2' })).toHaveAttribute(
      'aria-current',
      'page',
    );

    fireEvent.click(screen.getByRole('button', { name: 'Next page' }));
    expect(await screen.findByRole('radio', { name: 'Select L05' })).toBeInTheDocument();
    expect(screen.getAllByRole('radio', { name: /^Select / })).toHaveLength(4);
    expect(screen.getByText('Showing 5 to 8 of 8 luminaires')).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Rows per page'), { target: { value: '8' } });
    expect(await screen.findByRole('radio', { name: 'Select DL01' })).toBeInTheDocument();
    expect(screen.getAllByRole('radio', { name: /^Select / })).toHaveLength(8);
    expect(screen.getByText('Showing 1 to 8 of 8 luminaires')).toBeInTheDocument();
  });

  it('uses quiet, non-duplicated inspector status treatments for complete and incomplete rows', async () => {
    const noAssetLuminaire = luminaire('l3', 'PL01', 'Pendant');
    workspaceLuminaires = [...luminaires, noAssetLuminaire];
    summaries = [...summaries, { luminaireId: 'l3', datasheet: null, productImage: null }];
    stubApi();
    stubMatchMedia();
    renderV4(<V4Router />, ['/projects/p1/datasheets-images']);

    await screen.findByRole('radio', { name: 'Select DL01' });
    const completeLinked = screen
      .getByRole('heading', { name: 'Linked Files' })
      .closest('section')!;
    const completeMissing = screen
      .getByRole('heading', { name: 'Missing Items' })
      .closest('section')!;
    expect(within(completeLinked).getByText('Complete')).toHaveClass(
      'v4-datasheets__complete-pill',
    );
    expect(within(completeMissing).getByLabelText('0 missing items')).toHaveTextContent('0');
    expect(
      within(completeMissing).getByText('All required assets are complete.'),
    ).toBeInTheDocument();
    expect(within(completeMissing).queryByText('Complete')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('radio', { name: 'Select WL01' }));
    const incompleteLinked = screen
      .getByRole('heading', { name: 'Linked Files' })
      .closest('section')!;
    const incompleteMissing = screen
      .getByRole('heading', { name: 'Missing Items' })
      .closest('section')!;
    expect(within(incompleteLinked).queryByText('Complete')).not.toBeInTheDocument();
    expect(within(incompleteLinked).queryByText('Missing Item')).not.toBeInTheDocument();
    expect(within(incompleteMissing).getByLabelText('1 missing item')).toHaveTextContent('1');

    fireEvent.click(screen.getByRole('radio', { name: 'Select PL01' }));
    const emptyMissing = screen.getByRole('heading', { name: 'Missing Items' }).closest('section')!;
    expect(within(emptyMissing).getByLabelText('2 missing items')).toHaveTextContent('2');
  });

  it('keeps the compact table cell grammar explicit and data-backed', async () => {
    stubApi();
    stubMatchMedia();
    renderV4(<V4Router />, ['/projects/p1/datasheets-images']);

    const completeRow = (await screen.findByRole('radio', { name: 'Select DL01' })).closest('tr')!;
    const completeCells = within(completeRow).getAllByRole('cell');
    const table = completeRow.closest('table')!;
    expect(within(table).getAllByRole('columnheader')).toHaveLength(7);
    expect(table.tHead?.nextElementSibling?.tagName).toBe('TBODY');
    expect(within(completeCells[1]!).getByText('DL01')).toBeInTheDocument();
    expect(within(completeCells[1]!).getByText('Downlight')).toBeInTheDocument();
    expect(within(completeCells[2]!).getByText('Downlight')).toBeInTheDocument();
    expect(within(completeCells[2]!).getByText('Downlight luminaire')).toBeInTheDocument();
    expect(within(completeCells[3]!).getByText('Complete')).toBeInTheDocument();
    expect(within(completeCells[3]!).getByText(/^v1 · /)).toBeInTheDocument();

    const incompleteRow = screen.getByRole('radio', { name: 'Select WL01' }).closest('tr')!;
    const incompleteCells = within(incompleteRow).getAllByRole('cell');
    expect(within(incompleteCells[3]!).getByText('Missing')).toBeInTheDocument();
    expect(within(incompleteCells[3]!).getByText('Not attached')).toBeInTheDocument();
  });

  it('preselects a missing asset, browses natively, and attaches a new canonical version', async () => {
    const fetch = stubApi();
    const selectLuminaireAssetFile = vi.fn().mockResolvedValue({
      assetType: 'Datasheet',
      fileName: 'WL01.pdf',
      filePath: 'C:\\assets\\WL01.pdf',
    });
    window.scliDesktop = { selectLuminaireAssetFile };
    stubMatchMedia();
    renderV4(<V4Router />, ['/projects/p1/datasheets-images']);
    fireEvent.change(await screen.findByLabelText('Asset completeness filter'), {
      target: { value: 'all' },
    });
    fireEvent.click(screen.getByRole('radio', { name: 'Select WL01' }));
    fireEvent.click(screen.getByRole('button', { name: 'Attach' }));
    expect(screen.getByRole('dialog', { name: 'Attach document' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Browse' }));
    await waitFor(() => expect(screen.getByDisplayValue('WL01.pdf')).toBeInTheDocument());
    expect(selectLuminaireAssetFile).toHaveBeenCalledWith('Datasheet');
    fireEvent.click(screen.getByRole('button', { name: 'Attach as New Version' }));
    await waitFor(() =>
      expect(fetch).toHaveBeenCalledWith(
        expect.stringContaining('/luminaires/l2/asset-versions'),
        expect.objectContaining({ method: 'POST' }),
      ),
    );
  });

  it('uses the bounded Product Image picker and treats cancel as a stable no-op', async () => {
    stubApi();
    const selectLuminaireAssetFile = vi.fn().mockResolvedValueOnce(null).mockResolvedValueOnce({
      assetType: 'ProductImage',
      fileName: 'WL01.webp',
      filePath: 'C:\\assets\\WL01.webp',
    });
    window.scliDesktop = { selectLuminaireAssetFile };
    summaries = summaries.map((summary) =>
      summary.luminaireId === 'l2' ? { ...summary, productImage: null } : summary,
    );
    stubMatchMedia();
    renderV4(<V4Router />, ['/projects/p1/datasheets-images']);
    fireEvent.change(await screen.findByLabelText('Asset completeness filter'), {
      target: { value: 'all' },
    });
    fireEvent.click(screen.getByRole('radio', { name: 'Select WL01' }));
    const inspector = screen.getByRole('complementary', { name: 'WL01 asset inspector' });
    const missingImage = within(inspector).getByText('No product image attached').closest('div')!;
    fireEvent.click(within(missingImage).getByRole('button', { name: 'Attach' }));

    const dialog = screen.getByRole('dialog', { name: 'Attach document' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Browse' }));
    await waitFor(() => expect(selectLuminaireAssetFile).toHaveBeenCalledWith('ProductImage'));
    expect(within(dialog).getByPlaceholderText('Choose a local file…')).toHaveValue('');
    expect(within(dialog).getByRole('button', { name: 'Attach as New Version' })).toBeDisabled();

    fireEvent.click(within(dialog).getByRole('button', { name: 'Browse' }));
    await waitFor(() => expect(within(dialog).getByDisplayValue('WL01.webp')).toBeInTheDocument());
    expect(within(dialog).getByRole('button', { name: 'Attach as New Version' })).toBeEnabled();
  });

  it('distinguishes migrated provenance and derives Current from the compatibility projection', async () => {
    const migrated = version('l1', 'Datasheet', 1, true);
    summaries = summaries.map((summary) =>
      summary.luminaireId === 'l1' ? { ...summary, datasheet: null } : summary,
    );
    histories.l1 = [migrated, version('l1', 'ProductImage')];
    stubApi();
    window.scliDesktop = {
      selectLuminaireAssetFile: vi.fn().mockResolvedValue({
        assetType: 'Datasheet',
        fileName: 'DL01-v2.pdf',
        filePath: 'C:\\assets\\DL01-v2.pdf',
      }),
    };
    stubMatchMedia();
    renderV4(<V4Router />, ['/projects/p1/datasheets-images']);
    fireEvent.change(await screen.findByLabelText('Asset completeness filter'), {
      target: { value: 'all' },
    });
    fireEvent.click(screen.getByRole('radio', { name: 'Select DL01' }));
    fireEvent.click(screen.getByRole('button', { name: 'History' }));

    const clearedHistory = screen.getByRole('dialog', { name: 'Datasheet version history' });
    expect(await within(clearedHistory).findByText('Migrated legacy asset')).toBeInTheDocument();
    expect(within(clearedHistory).getByText(/Observed:/)).toBeInTheDocument();
    expect(within(clearedHistory).getByText('Attached by: Unknown / Legacy')).toBeInTheDocument();
    expect(within(clearedHistory).queryByText('Current')).not.toBeInTheDocument();
    expect(within(clearedHistory).getByText('Previous')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Close version history' }));
    fireEvent.click(screen.getByRole('button', { name: 'Attach' }));
    fireEvent.click(screen.getByRole('button', { name: 'Browse' }));
    await screen.findByDisplayValue('DL01-v2.pdf');
    fireEvent.click(screen.getByRole('button', { name: 'Attach as New Version' }));
    await screen.findByText(/^v2 ·/);
    fireEvent.click(screen.getByRole('button', { name: 'View datasheet versions' }));

    const attachedHistory = screen.getByRole('dialog', { name: 'Datasheet version history' });
    expect(within(attachedHistory).getByText('Current')).toBeInTheDocument();
    expect(within(attachedHistory).getByText('Previous')).toBeInTheDocument();
    expect(within(attachedHistory).getByText('Attached by: Asset Owner')).toBeInTheDocument();
    expect(within(attachedHistory).getByText('Migrated legacy asset')).toBeInTheDocument();
  });

  it('uses the migrated label instead of presenting an invented attachment date in the table', async () => {
    summaries = summaries.map((summary) =>
      summary.luminaireId === 'l1'
        ? { ...summary, datasheet: version('l1', 'Datasheet', 1, true) }
        : summary,
    );
    stubApi();
    stubMatchMedia();
    renderV4(<V4Router />, ['/projects/p1/datasheets-images']);
    fireEvent.change(await screen.findByLabelText('Asset completeness filter'), {
      target: { value: 'all' },
    });
    expect(screen.getByText('v1 · Migrated')).toBeInTheDocument();
  });

  it('uses real asset versions and keeps the final inspector closed after dismissal', async () => {
    stubApi();
    stubMatchMedia();
    renderV4(<ProductionRouter />, ['/projects/p1/datasheets-images']);
    await screen.findByRole('button', { name: 'Close asset details' });
    expect(await screen.findByText('l1-v1.pdf')).toBeInTheDocument();
    expect(screen.getByText('by Asset Owner')).toBeInTheDocument();
    expect(screen.queryByText('DL01_Datasheet_v2.1.pdf')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Version history for l1-v1.pdf' }));
    expect(
      await screen.findByRole('dialog', { name: 'Datasheet version history' }),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Close version history' }));
    fireEvent.click(screen.getByRole('button', { name: 'Close asset details' }));
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: 'Close asset details' })).not.toBeInTheDocument(),
    );
  });
  it('attaches an immutable version from the final missing-item action', async () => {
    const fetch = stubApi();
    stubMatchMedia();
    window.scliDesktop = {
      selectLuminaireAssetFile: vi.fn().mockResolvedValue({
        assetType: 'Datasheet',
        fileName: 'WL01.pdf',
        filePath: 'C:\\assets\\WL01.pdf',
      }),
    };
    renderV4(<ProductionRouter />, ['/projects/p1/datasheets-images']);
    fireEvent.click(await screen.findByRole('button', { name: 'Assets for WL01' }));
    fireEvent.click(screen.getByRole('button', { name: 'Attach' }));
    const dialog = screen.getByRole('dialog', { name: 'Attach document' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Browse' }));
    await within(dialog).findByDisplayValue('WL01.pdf');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Attach as New Version' }));
    await waitFor(() =>
      expect(fetch).toHaveBeenCalledWith(
        expect.stringContaining('/luminaires/l2/asset-versions'),
        expect.objectContaining({ method: 'POST' }),
      ),
    );
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: 'Attach document' })).not.toBeInTheDocument(),
    );
    expect(screen.getByText('l2-v1.pdf')).toBeInTheDocument();
  });
  it('final KPIs filter and reset; canonical image, open/copy and scoped notes preserve other fields', async () => {
    const fetch = stubApi();
    stubMatchMedia();
    const execute = vi.fn().mockResolvedValue({ saved: true });
    window.scliDesktop = { executeDesktopHandoff: execute };
    renderV4(<ProductionRouter />, ['/projects/p1/datasheets-images']);
    await screen.findByRole('button', { name: 'Close asset details' });
    expect(screen.getAllByAltText('DL01 product')[0]).toHaveAttribute(
      'src',
      '/api/projects/p1/luminaires/l1/asset-versions/l1-ProductImage-1/content',
    );
    fireEvent.click(screen.getByRole('button', { name: /1 Missing Datasheets/ }));
    expect(await screen.findByRole('button', { name: 'Assets for WL01' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Assets for DL01' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /1 Missing Datasheets/ }));
    fireEvent.click(await screen.findByRole('button', { name: 'Assets for DL01' }));
    fireEvent.click(screen.getByRole('button', { name: 'l1-v1.pdf' }));
    await waitFor(() =>
      expect(execute).toHaveBeenCalledWith('handoff-test', 'OPEN_LUMINAIRE_ASSET'),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Save a copy of l1-v1.pdf' }));
    await waitFor(() =>
      expect(execute).toHaveBeenCalledWith('handoff-test', 'SAVE_LUMINAIRE_ASSET_COPY'),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Edit luminaire notes' }));
    const editor = screen.getByRole('dialog', { name: 'Luminaire notes' });
    expect(within(editor).queryByLabelText('Tag *')).not.toBeInTheDocument();
    fireEvent.change(within(editor).getByRole('textbox'), {
      target: { value: 'Notes only changed' },
    });
    fireEvent.click(within(editor).getByRole('button', { name: 'Save changes' }));
    await waitFor(() =>
      expect(fetch).toHaveBeenCalledWith(
        expect.stringContaining('/luminaires/l1'),
        expect.objectContaining({ method: 'PATCH' }),
      ),
    );
    expect(workspaceLuminaires[0]?.model).toBe('DL01 Pro');
    expect(workspaceLuminaires[0]?.notes).toBe('Notes only changed');
  });
});
