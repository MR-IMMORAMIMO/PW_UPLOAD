/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import type { LuminaireRecord } from '@scli/domain';
import { V4Router as ProductionRouter } from '../../router/V4Router';
import { Route, Routes } from 'react-router-dom';
import { ProjectLuminairesWorkspace } from './ProjectLuminairesWorkspace';
function V4Router() {
  return (
    <Routes>
      <Route path="/projects/:projectId/luminaires" element={<ProjectLuminairesWorkspace />} />
      <Route path="*" element={<ProductionRouter />} />
    </Routes>
  );
}
import { cleanupV4, renderV4, stubMatchMedia } from '../../test-utils/renderV4';
import { clearLocalImageCacheForTests } from '../../desktop/localImage';

const record = (
  id: string,
  tag: string,
  overrides: Partial<LuminaireRecord> = {},
): LuminaireRecord => ({
  id,
  projectId: 'p1',
  tag,
  category: 'Downlight',
  imagePath: 'https://example.test/product.png',
  description: 'Core downlight',
  manufacturer: 'Philips',
  model: `CoreLine ${tag}`,
  wattage: '20 W',
  lumens: '1800 lm',
  lightColor: '3000 K (Warm White)',
  cri: 'CRI 90',
  beamAngle: '60°',
  ipRating: 'IP20',
  mounting: 'Recessed',
  cutout: 'Ø150 mm',
  driver: 'CertaDrive 700mA',
  control: 'On/Off',
  emergency: 'No',
  datasheetPath: `C:\\fixtures\\${tag}.pdf`,
  location: 'Office',
  unit: 'No.',
  quantity: 12,
  notes: `Notes for ${tag}`,
  sourceName: 'DIALux',
  dimensions: 'Ø168 × 90 mm',
  bodyColorFinish: 'White',
  rowVersion: 1,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  ...overrides,
});
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
const response = (data: unknown, ok = true, message = 'Request failed') => ({
  ok,
  status: ok ? 200 : 500,
  headers: { get: () => 'c1' },
  json: () => Promise.resolve(ok ? { data } : { error: { message } }),
});

function workspace(luminaires: LuminaireRecord[]) {
  return {
    projectId: 'p1',
    folderPath: null,
    folderProfile: 'default',
    folderStructure: [],
    outputFolders: {},
    services: [],
    scopeItems: [],
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
    updatedAt: '2026-01-01T00:00:00.000Z',
  };
}

function stubApi(
  initial = [record('l1', 'DL01'), record('l2', 'DL02', { datasheetPath: '', imagePath: '' })],
) {
  let luminaires = [...initial];
  const fetch = vi.fn((url: string, init?: RequestInit) => {
    if (url.endsWith('/library-draft-candidate')) {
      const id = url.split('/').at(-2)!;
      const item = luminaires.find((luminaire) => luminaire.id === id)!;
      return Promise.resolve(
        response({
          eligibility: {
            eligible: true,
            reasonCode: 'ELIGIBLE',
            reason: 'Project-only Luminaire is eligible.',
          },
          source: {
            projectId: 'p1',
            luminaireId: id,
            manufacturerName: item.manufacturer,
            productName: item.model,
            productType: '',
            description: item.description,
            variant: {
              variantLabel: `${item.wattage} / ${item.lightColor} / ${item.control}`,
              orderingCode: '',
              wattage: item.wattage,
              lumens: item.lumens,
              lightColor: item.lightColor,
              cri: item.cri,
              beamAngle: item.beamAngle,
              ipRating: item.ipRating,
              mounting: item.mounting,
              cutout: item.cutout,
              driver: item.driver,
              control: item.control,
              emergency: item.emergency,
              dimensions: item.dimensions,
              bodyColorFinish: item.bodyColorFinish,
            },
          },
          excludedProjectFields: [
            { field: 'tag', label: 'Tag', value: item.tag },
            { field: 'category', label: 'Project Category', value: item.category },
            { field: 'location', label: 'Location', value: item.location },
            { field: 'unit', label: 'Unit', value: item.unit },
            { field: 'quantity', label: 'Quantity', value: String(item.quantity) },
            { field: 'notes', label: 'Project Notes', value: item.notes },
          ],
          manufacturerMatches: [],
          duplicateSuggestions: [],
          assets: [
            { assetType: 'ProductImage', present: true, fileName: 'fixture.png' },
            { assetType: 'Datasheet', present: true, fileName: 'fixture.pdf' },
            { assetType: 'IES', present: true, fileName: 'fixture.ies' },
            { assetType: 'LDT', present: true, fileName: 'fixture.ldt' },
          ],
        }),
      );
    }
    if (url.endsWith('/create-library-draft') && init?.method === 'POST') {
      return Promise.resolve(
        response({
          sourceProjectId: 'p1',
          sourceLuminaireId: 'l1',
          manufacturer: { manufacturerId: 'maker-1' },
          product: { productId: 'product-1' },
          variant: { variantId: 'variant-1' },
          assets: [],
        }),
      );
    }
    if (url.endsWith('/luminaires/import-preview') && init?.method === 'POST') {
      return Promise.resolve(
        response({
          source: 'DialuxCsv',
          rows: [
            {
              rowId: 'row-1',
              status: 'Added',
              matchStatus: 'None',
              existingId: null,
              candidates: [],
              changedFields: [],
              record: { tag: 'DL99', description: 'Imported downlight', quantity: 1, unit: 'No.' },
            },
          ],
        }),
      );
    }
    if (url.endsWith('/luminaires/import-commit') && init?.method === 'POST') {
      return Promise.resolve(response({ added: 1, updated: 0, ignored: 0 }));
    }
    if (url.endsWith('/workspace')) return Promise.resolve(response(workspace(luminaires)));
    if (url.endsWith('/api/projects/p1')) return Promise.resolve(response(project));
    if (url.endsWith('/luminaires') && init?.method === 'POST') {
      const body = JSON.parse(String(init.body)) as LuminaireRecord;
      const created = record('created', body.tag, body);
      luminaires = [...luminaires, created];
      return Promise.resolve(response(created));
    }
    if (/\/luminaires\/[^/]+$/.test(url) && init?.method === 'PATCH') {
      const id = url.split('/').at(-1)!;
      const body = JSON.parse(String(init.body)) as Partial<LuminaireRecord>;
      const updated = { ...luminaires.find((item) => item.id === id)!, ...body };
      luminaires = luminaires.map((item) => (item.id === id ? updated : item));
      return Promise.resolve(response(updated));
    }
    if (/\/luminaires\/[^/]+$/.test(url) && init?.method === 'DELETE') {
      const id = url.split('/').at(-1)!;
      luminaires = luminaires.filter((item) => item.id !== id);
      return Promise.resolve(response({ deleted: true }));
    }
    return Promise.resolve(response({}));
  });
  vi.stubGlobal('fetch', fetch);
  return fetch;
}

function renderPage() {
  stubMatchMedia();
  renderV4(<V4Router />, ['/projects/p1/luminaires']);
}

describe('ProjectLuminairesPage', () => {
  afterEach(() => {
    cleanup();
    clearLocalImageCacheForTests();
    delete window.scliDesktop;
    cleanupV4();
  });

  it('renders the reference toolbar, technical table, thumbnails, pagination and six-region inspector', async () => {
    stubApi();
    renderPage();
    expect(await screen.findByRole('heading', { name: 'Luminaires' })).toBeInTheDocument();
    expect(await screen.findByRole('searchbox', { name: 'Search luminaires' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Filters/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Columns/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Import/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add Luminaire' })).toBeInTheDocument();
    const thumbnail = screen.getByRole('img', { name: 'DL01 thumbnail' });
    expect(thumbnail).toHaveAttribute('src', 'https://example.test/product.png');
    fireEvent.error(thumbnail);
    expect(screen.getByLabelText('Image preview unavailable')).toBeInTheDocument();
    const inspector = screen.getByRole('complementary', { name: 'DL01 luminaire details' });
    expect(within(inspector).getByRole('heading', { name: 'DL01' })).toBeInTheDocument();
    expect(within(inspector).getByLabelText('Product identity')).toBeInTheDocument();
    expect(within(inspector).getByLabelText('Technical information')).toHaveTextContent(
      'Wattage20 W',
    );
    expect(within(inspector).getByRole('heading', { name: 'Notes' })).toBeInTheDocument();
    expect(within(inspector).getByLabelText('Luminaire assets')).toHaveTextContent('Datasheet');
    expect(within(inspector).getByRole('button', { name: /Edit/ })).toHaveClass(
      'v4-button--secondary',
    );
    expect(within(inspector).getByRole('button', { name: 'Remove' })).toHaveClass(
      'v4-button--danger',
    );
    expect(screen.getByText('Showing 1 to 2 of 2 luminaires')).toBeInTheDocument();
  });

  it('uses the shared unit-aware display authority in the table and Inspector', async () => {
    stubApi([
      record('l1', 'DL01', {
        wattage: '10.6',
        lumens: '1222',
        lightColor: '3000K',
        cri: '92',
        beamAngle: '24',
        ipRating: '20',
      }),
    ]);
    renderPage();
    const row = await screen.findByRole('row', { name: /DL01/ });
    expect(row).toHaveTextContent('10.6 W');
    expect(row).toHaveTextContent('1222 lm');
    expect(row).toHaveTextContent('3000 K');
    expect(row).toHaveTextContent('CRI 92');
    expect(row).toHaveTextContent('24°');
    expect(row).toHaveTextContent('IP20');
    const inspector = screen.getByRole('complementary', { name: 'DL01 luminaire details' });
    const technical = within(inspector).getByLabelText('Technical information');
    expect(technical).toHaveTextContent('Wattage10.6 W');
    expect(technical).toHaveTextContent('Lumens1222 lm');
    expect(technical).toHaveTextContent('CCT3000 K');
    expect(technical).toHaveTextContent('CRICRI 92');
    expect(technical).toHaveTextContent('Beam Angle24°');
    expect(technical).toHaveTextContent('IP RatingIP20');
  });

  it('updates the fixed inspector image through the same cached authority when a row is selected', async () => {
    const firstPath = 'C:\\fixtures\\DL01.png';
    const secondPath = 'C:\\fixtures\\DL02.png';
    const firstSource = 'data:image/png;base64,iVBORw0KGgo=';
    const secondSource = 'data:image/png;base64,iVBORw0KGgs=';
    const readLocalImage = vi.fn((path: string) =>
      Promise.resolve({ ok: true, src: path === firstPath ? firstSource : secondSource }),
    );
    window.scliDesktop = { readLocalImage };
    stubApi([
      record('l1', 'DL01', { imagePath: firstPath }),
      record('l2', 'DL02', { datasheetPath: '', imagePath: secondPath }),
    ]);
    renderPage();
    await screen.findByText('Showing 1 to 2 of 2 luminaires');
    const firstInspector = screen.getByRole('complementary', { name: 'DL01 luminaire details' });
    expect(
      await within(firstInspector).findByRole('img', { name: 'DL01 product' }),
    ).toHaveAttribute('src', firstSource);
    expect(readLocalImage.mock.calls.filter(([path]) => path === firstPath)).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: 'DL02' }));
    const inspector = screen.getByRole('complementary', { name: 'DL02 luminaire details' });
    expect(inspector).toHaveTextContent('Missing DS');
    expect(await within(inspector).findByRole('img', { name: 'DL02 product' })).toHaveAttribute(
      'src',
      secondSource,
    );
    expect(readLocalImage.mock.calls.filter(([path]) => path === secondPath)).toHaveLength(1);
  });

  it('opens add/edit/duplicate as a large editor and requires a unique duplicate Tag', async () => {
    const fetch = stubApi();
    renderPage();
    await screen.findByText('Showing 1 to 2 of 2 luminaires');
    fireEvent.click(screen.getByRole('button', { name: 'Add Luminaire' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Custom / Project-only' }));
    expect(screen.getByRole('dialog', { name: 'Add Luminaire' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Close luminaire editor' }));
    fireEvent.click(screen.getByRole('button', { name: 'Duplicate' }));
    const dialog = screen.getByRole('dialog', { name: 'Duplicate Luminaire' });
    const tag = within(dialog).getByPlaceholderText('DL01');
    expect(tag).toHaveValue('');
    expect(within(dialog).getByLabelText('Ordering Code')).toHaveValue('');
    expect(within(dialog).getByRole('textbox', { name: 'Power' })).toHaveValue('20');
    expect(within(dialog).getByLabelText('Power unit')).toHaveValue('W');
    expect(within(dialog).getByRole('textbox', { name: 'Mounting' })).toHaveValue('Recessed');
    fireEvent.change(tag, { target: { value: 'DL02' } });
    expect(within(dialog).getByText('Tag must be unique for this project.')).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Save Luminaire' })).toBeDisabled();
    fireEvent.change(tag, { target: { value: 'DL03' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save Luminaire' }));
    await waitFor(() =>
      expect(fetch).toHaveBeenCalledWith(
        expect.stringContaining('/luminaires'),
        expect.objectContaining({ method: 'POST' }),
      ),
    );
  });

  it('keeps every canonical input reachable and preserves custom legacy strings on edit', async () => {
    const fetch = stubApi([
      record('l1', 'DL01', {
        wattage: 'Driver dependent',
        lightColor: 'Tunable White 2700–6500 K',
        beamAngle: 'Asymmetric',
        ipRating: 'Marine rated',
        mounting: 'Custom bracket',
        control: 'SineWave Bus',
        emergency: 'Generator-backed',
      }),
    ]);
    renderPage();
    await screen.findByText('Showing 1 to 1 of 1 luminaires');
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    const dialog = screen.getByRole('dialog', { name: 'Edit Luminaire' });
    for (const section of [
      'Identity',
      'Photometric',
      'Installation',
      'Electrical / Control',
      'Project',
      'Assets',
      'Notes',
    ])
      expect(within(dialog).getAllByText(section).length).toBeGreaterThan(0);
    for (const label of [
      'Category',
      'Description',
      'Manufacturer',
      'Ordering Code',
      'Model',
      'CRI',
      'Cut-out',
      'Dimensions',
      'Body Colour / Finish',
      'Driver',
      'Location / Level',
      'Unit',
      'Quantity',
      'Source Name',
      'Product Image',
      'Datasheet PDF',
      'Notes',
    ])
      expect(within(dialog).getAllByLabelText(label, { exact: true }).length).toBeGreaterThan(0);
    expect(within(dialog).getByLabelText('Power custom value')).toHaveValue('Driver dependent');
    expect(within(dialog).getByLabelText('CCT custom value')).toHaveValue(
      'Tunable White 2700–6500 K',
    );
    expect(within(dialog).getByLabelText('Beam / Optic custom value')).toHaveValue('Asymmetric');
    expect(within(dialog).getByLabelText('IP Rating custom value')).toHaveValue('Marine rated');
    expect(within(dialog).getByRole('textbox', { name: 'Mounting' })).toHaveValue('Custom bracket');
    expect(within(dialog).getByRole('textbox', { name: 'Control' })).toHaveValue('SineWave Bus');
    expect(within(dialog).getByRole('textbox', { name: 'Emergency' })).toHaveValue(
      'Generator-backed',
    );
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save Luminaire' }));
    await waitFor(() => {
      const patchCall = fetch.mock.calls.find(
        ([url, init]) => String(url).endsWith('/luminaires/l1') && init?.method === 'PATCH',
      );
      expect(patchCall).toBeDefined();
      const body = JSON.parse(String(patchCall?.[1]?.body)) as LuminaireRecord;
      expect(body).toMatchObject({
        wattage: 'Driver dependent',
        lightColor: 'Tunable White 2700–6500 K',
        beamAngle: 'Asymmetric',
        ipRating: 'Marine rated',
        mounting: 'Custom bracket',
        control: 'SineWave Bus',
        emergency: 'Generator-backed',
      });
    });
  });

  it('browses, previews, clears and saves canonical local asset paths through the existing picker', async () => {
    const imagePath = 'C:\\fixtures\\selected-product.png';
    const datasheetPath = 'C:\\fixtures\\selected-datasheet.pdf';
    const selectFile = vi
      .fn()
      .mockResolvedValueOnce(imagePath)
      .mockResolvedValueOnce(datasheetPath)
      .mockResolvedValueOnce(imagePath);
    window.scliDesktop = {
      selectFile,
      readLocalImage: vi.fn().mockResolvedValue({
        ok: true,
        src: 'data:image/png;base64,iVBORw0KGgo=',
      }),
    };
    const fetch = stubApi();
    renderPage();
    await screen.findByText('Showing 1 to 2 of 2 luminaires');
    fireEvent.click(screen.getByRole('button', { name: 'Add Luminaire' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Custom / Project-only' }));
    const dialog = screen.getByRole('dialog', { name: 'Add Luminaire' });
    const browse = within(dialog).getAllByRole('button', { name: /Browse/ });
    fireEvent.click(browse[0]!);
    expect(
      await within(dialog).findByRole('img', { name: 'Selected product image' }),
    ).toHaveAttribute('src', 'data:image/png;base64,iVBORw0KGgo=');
    fireEvent.click(browse[1]!);
    await waitFor(() =>
      expect(within(dialog).getByLabelText('Datasheet PDF')).toHaveValue('selected-datasheet.pdf'),
    );
    expect(selectFile).toHaveBeenNthCalledWith(1, [
      { name: 'Product Images', extensions: ['png', 'jpg', 'jpeg', 'webp'] },
    ]);
    expect(selectFile).toHaveBeenNthCalledWith(2, [
      { name: 'PDF Datasheets', extensions: ['pdf'] },
    ]);
    fireEvent.click(within(dialog).getAllByRole('button', { name: 'Clear' })[0]!);
    expect(within(dialog).getByLabelText('Product Image')).toHaveValue('');
    fireEvent.click(browse[0]!);
    await waitFor(() =>
      expect(within(dialog).getByLabelText('Product Image')).toHaveValue(
        imagePath.split('\\').pop(),
      ),
    );
    fireEvent.change(within(dialog).getByLabelText(/Tag/), { target: { value: 'dl90' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save Luminaire' }));
    await waitFor(() => {
      const createCall = fetch.mock.calls.find(
        ([url, init]) => String(url).endsWith('/luminaires') && init?.method === 'POST',
      );
      const body = JSON.parse(String(createCall?.[1]?.body)) as LuminaireRecord;
      expect(body).toMatchObject({ tag: 'DL90', imagePath, datasheetPath });
    });
  });

  it('accepts preset and custom mounting, control and emergency strings without schema enums', async () => {
    const fetch = stubApi([record('l1', 'DL01')]);
    renderPage();
    await screen.findByText('Showing 1 to 1 of 1 luminaires');
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    const dialog = screen.getByRole('dialog', { name: 'Edit Luminaire' });
    const mounting = within(dialog).getByRole('textbox', { name: 'Mounting' });
    const control = within(dialog).getByRole('textbox', { name: 'Control' });
    const emergency = within(dialog).getByRole('textbox', { name: 'Emergency' });
    fireEvent.change(mounting, { target: { value: 'Pole Mounted' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Control choices' }));
    fireEvent.click(screen.getByRole('option', { name: 'DALI' }));
    fireEvent.change(emergency, { target: { value: 'Central Battery' } });
    expect(mounting).toHaveValue('Pole Mounted');
    expect(control).toHaveValue('DALI');
    expect(emergency).toHaveValue('Central Battery');
    fireEvent.change(mounting, { target: { value: 'Bespoke ceiling hook' } });
    fireEvent.change(control, { target: { value: 'Project bus' } });
    fireEvent.change(emergency, { target: { value: 'Remote inverter' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save Luminaire' }));
    await waitFor(() => {
      const patchCall = fetch.mock.calls.find(
        ([url, init]) => String(url).endsWith('/luminaires/l1') && init?.method === 'PATCH',
      );
      const body = JSON.parse(String(patchCall?.[1]?.body)) as LuminaireRecord;
      expect(body).toMatchObject({
        mounting: 'Bespoke ceiling hook',
        control: 'Project bus',
        emergency: 'Remote inverter',
      });
    });
  });

  it('round-trips Ordering Code independently from Model in Edit and Add', async () => {
    const fetch = stubApi([record('l1', 'DL01', { orderingCode: 'A2000427', model: 'Iku' })]);
    renderPage();
    await screen.findByText('Showing 1 to 1 of 1 luminaires');
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    const dialog = screen.getByRole('dialog', { name: 'Edit Luminaire' });
    const orderingCode = within(dialog).getByLabelText('Ordering Code');
    const model = within(dialog).getByLabelText('Model');
    expect(orderingCode).toHaveValue('A2000427');
    expect(model).toHaveValue('Iku');
    fireEvent.change(orderingCode, { target: { value: 'A2000428' } });
    fireEvent.change(model, { target: { value: 'Iku 2' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save Luminaire' }));
    await waitFor(() => {
      const patchCall = fetch.mock.calls.find(
        ([url, init]) => String(url).endsWith('/luminaires/l1') && init?.method === 'PATCH',
      );
      const body = JSON.parse(String(patchCall?.[1]?.body)) as LuminaireRecord;
      expect(body).toMatchObject({ orderingCode: 'A2000428', model: 'Iku 2' });
    });
    // Add Luminaire exposes the same independent field.
    fireEvent.click(screen.getByRole('button', { name: 'Add Luminaire' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Custom / Project-only' }));
    const addDialog = screen.getByRole('dialog', { name: 'Add Luminaire' });
    expect(within(addDialog).getByLabelText('Ordering Code')).toHaveValue('');
    fireEvent.change(within(addDialog).getByLabelText(/Tag/), { target: { value: 'dl90' } });
    fireEvent.change(within(addDialog).getByLabelText('Ordering Code'), {
      target: { value: 'A2000427' },
    });
    fireEvent.change(within(addDialog).getByLabelText('Model'), {
      target: { value: 'Iku Downlight' },
    });
    fireEvent.click(within(addDialog).getByRole('button', { name: 'Save Luminaire' }));
    await waitFor(() => {
      const createCall = fetch.mock.calls.find(
        ([url, init]) => String(url).endsWith('/luminaires') && init?.method === 'POST',
      );
      const body = JSON.parse(String(createCall?.[1]?.body)) as LuminaireRecord;
      expect(body).toMatchObject({
        tag: 'DL90',
        orderingCode: 'A2000427',
        model: 'Iku Downlight',
      });
    });
  });

  it('confirms removal and safely selects the next available row', async () => {
    stubApi();
    renderPage();
    await screen.findByText('Showing 1 to 2 of 2 luminaires');
    fireEvent.click(screen.getByRole('button', { name: 'Remove' }));
    const confirm = screen.getByRole('alertdialog', { name: 'Remove luminaire' });
    expect(confirm).toHaveTextContent('Remove DL01?');
    fireEvent.click(within(confirm).getByRole('button', { name: 'Remove Luminaire' }));
    await screen.findByRole('complementary', { name: 'DL02 luminaire details' });
    expect(
      screen.queryByRole('complementary', { name: 'DL01 luminaire details' }),
    ).not.toBeInTheDocument();
  });

  it('filters missing assets, controls visible columns and opens canonical import choices', async () => {
    const fetch = stubApi();
    renderPage();
    await screen.findByText('Showing 1 to 2 of 2 luminaires');
    fireEvent.click(screen.getByRole('button', { name: /Filters/ }));
    fireEvent.click(screen.getByRole('option', { name: 'Missing Datasheet' }));
    expect(screen.getByText('Showing 1 to 1 of 1 luminaires')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Columns/ }));
    expect(screen.getByText('Tag and Image stay visible')).toBeInTheDocument();
    for (const group of ['Identity', 'Photometric', 'Installation', 'Electrical', 'Project'])
      expect(screen.getByRole('region', { name: `${group} columns` })).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText('Power'));
    expect(screen.queryByRole('columnheader', { name: /Power/ })).not.toBeInTheDocument();
    fireEvent.click(screen.getByLabelText('Control'));
    expect(screen.getByRole('columnheader', { name: /Control/ })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Reset to Default' }));
    expect(screen.getByRole('columnheader', { name: /Power/ })).toBeInTheDocument();
    expect(screen.queryByRole('columnheader', { name: /Control/ })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Import/ }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'DIALux CSV' }));
    expect(screen.getByRole('dialog', { name: 'Luminaire Import' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'DIALux CSV' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    fireEvent.change(screen.getByLabelText('Or paste CSV / TSV data'), {
      target: { value: 'TAG,DESCRIPTION\nDL99,Imported downlight' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Preview Import' }));
    expect(await screen.findByText('Imported downlight')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Apply Selected Changes' }));
    await waitFor(() =>
      expect(fetch).toHaveBeenCalledWith(
        expect.stringContaining('/import-commit'),
        expect.objectContaining({ method: 'POST' }),
      ),
    );
  });

  it('reviews Project-only promotion, keeps Project fields excluded, and creates a Draft explicitly', async () => {
    const fetch = stubApi([record('l1', 'C-UAT-01')]);
    renderPage();
    const action = await screen.findByRole(
      'button',
      { name: 'Add to Master Library' },
      { timeout: 5000 },
    );
    fireEvent.click(action);
    expect(
      await screen.findByRole('heading', { name: 'Create Library Draft from C-UAT-01' }),
    ).toBeInTheDocument();
    expect(action).toHaveClass('v4-button--primary');
    const excluded = screen.getByText('Excluded Project-only data');
    expect(excluded).toBeInTheDocument();
    fireEvent.click(excluded);
    expect(screen.getByText('Project Category')).toBeInTheDocument();
    expect(screen.getByText('Project Notes')).toBeInTheDocument();
    for (const name of ['fixture.png', 'fixture.pdf', 'fixture.ies', 'fixture.ldt']) {
      expect(screen.getByText(name)).toBeInTheDocument();
    }
    const create = screen.getByRole('button', { name: 'Create Draft' });
    expect(create).toHaveClass('v4-button--primary');
    expect(create).toBeDisabled();
    fireEvent.change(screen.getByLabelText(/Product Type/), { target: { value: 'Pendant' } });
    expect(create).toBeEnabled();
    fireEvent.click(create);
    await waitFor(() =>
      expect(fetch).toHaveBeenCalledWith(
        '/api/projects/p1/luminaires/l1/create-library-draft',
        expect.objectContaining({ method: 'POST' }),
      ),
    );
    const request = fetch.mock.calls.find(([url]) =>
      String(url).endsWith('/create-library-draft'),
    )?.[1];
    const body = JSON.parse(String(request?.body)) as Record<string, unknown>;
    expect(body).not.toHaveProperty('tag');
    expect(body).not.toHaveProperty('category');
    expect(body).not.toHaveProperty('location');
    expect(body).not.toHaveProperty('quantity');
    expect(body).not.toHaveProperty('notes');
  });
});

describe('Final Luminaires production route', () => {
  afterEach(cleanupV4);
  it('shows the requested canonical record and its own specifications without example data', async () => {
    stubMatchMedia();
    stubApi([
      record('l1', 'TAG-A', {
        manufacturer: 'Actual supplier',
        model: 'Actual model',
        wattage: '17',
        notes: 'Actual note',
      }),
      record('l2', 'TAG-B', {
        manufacturer: 'Second supplier',
        model: 'Second model',
        wattage: '29',
      }),
    ]);
    renderV4(<ProductionRouter />, ['/projects/p1/luminaires/advanced?luminaireId=l2']);
    await screen.findByRole('button', { name: 'Close luminaire details' });
    expect(screen.getAllByText('29 W').length).toBeGreaterThan(0);
    expect(screen.queryByText('Philips_CoreLine_DN140B_LED20S.pdf')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    expect(await screen.findByRole('dialog', { name: 'Edit Luminaire' })).toBeInTheDocument();
  });
  it('does not substitute another record for an unknown deep link', async () => {
    stubMatchMedia();
    stubApi([record('l1', 'TAG-A')]);
    renderV4(<ProductionRouter />, ['/projects/p1/luminaires/advanced?luminaireId=missing']);
    expect(
      await screen.findByText('The linked luminaire is not available in this project.'),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Close luminaire details' }),
    ).not.toBeInTheDocument();
  });
});
