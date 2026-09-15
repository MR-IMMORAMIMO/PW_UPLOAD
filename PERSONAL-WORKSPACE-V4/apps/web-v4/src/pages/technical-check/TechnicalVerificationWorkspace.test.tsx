/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, screen, within } from '@testing-library/react';
import type { LuminaireRecord } from '@scli/domain';
import { cleanupV4, renderV4, stubMatchMedia } from '../../test-utils/renderV4';
import type { TechnicalCheckGroup, TechnicalCheckRow } from './technicalCheckViewModel';
import { TechnicalVerificationWorkspace } from './TechnicalVerificationWorkspace';

const luminaire: LuminaireRecord = {
  id: 'lum-1',
  projectId: 'project-1',
  tag: 'DL01',
  category: 'Downlight',
  imagePath: '',
  description: 'Architectural downlight',
  manufacturer: 'LumenWorks',
  model: 'DL-150',
  orderingCode: 'LW-DL150',
  productType: 'DL family',
  variantLabel: '3000K / 36°',
  wattage: '12W',
  lumens: '',
  lightColor: '3000K',
  cri: '> 80',
  beamAngle: '',
  ipRating: 'IP65',
  mounting: 'Recessed',
  cutout: '125mm',
  driver: 'Remote',
  control: 'DALI',
  emergency: 'No',
  datasheetPath: 'managed://datasheets/lum-1/rev-1',
  location: 'Lobby',
  unit: 'No.',
  quantity: 12,
  notes: '',
  sourceName: '',
  dimensions: 'Ø145 × 90mm',
  bodyColorFinish: 'White',
  rowVersion: 1,
  createdAt: '2026-08-28T08:00:00.000Z',
  updatedAt: '2026-08-28T08:00:00.000Z',
};

function row(
  id: string,
  fieldKey: TechnicalCheckRow['fieldKey'],
  fieldLabel: string,
  patch: Partial<TechnicalCheckRow> = {},
): TechnicalCheckRow {
  return {
    id,
    luminaire,
    fieldKey,
    fieldLabel,
    scheduleValue: '12W',
    datasheetValue: '15W',
    status: 'Mismatch',
    resultLabel: 'Conflict',
    fileName: 'DL01_datasheet.pdf',
    pageNumber: 2,
    evidence: 'Rated input power: 15 W',
    confidence: 96,
    alternatives: [],
    analysisStatus: 'Ready',
    analysisMessage: 'Verified locally.',
    analyzedAt: '2026-08-28T08:00:00.000Z',
    engine: 'SCLI P5C Datasheet Verification 1.0',
    privacyMode: 'LocalOnly',
    severity: null,
    canUseDatasheetValue: true,
    verificationFingerprint: 'fingerprint-1',
    verificationResult: 'CONFLICT',
    method: 'NATIVE_TEXT',
    confidenceBand: 'HIGH',
    unit: 'W',
    basis: 'Rated input power',
    libraryLinked: false,
    documentId: 'document-1',
    ...patch,
  };
}

function group(checks: TechnicalCheckRow[]): TechnicalCheckGroup {
  return {
    id: luminaire.id,
    luminaire: checks[0]?.luminaire ?? luminaire,
    checks,
    findingCount: checks.filter((check) => check.status !== 'Matched').length,
    affectedFields: checks.map((check) => check.fieldLabel),
    overallStatus: 'Mismatch',
    overallLabel: 'Needs Review',
    severity: null,
  };
}

const noop = () => undefined;
const returnFocusRef = { current: document.createElement('button') };

function renderWorkspace(
  checks: TechnicalCheckRow[],
  storageVerified = true,
  navigation: { onPrevious?: () => void; onNext?: () => void } = {},
) {
  return renderV4(
    <TechnicalVerificationWorkspace
      group={group(checks)}
      asset={undefined}
      queuePosition={0}
      queueLength={2}
      pending={false}
      storageVerified={storageVerified}
      returnFocusRef={returnFocusRef}
      onClose={noop}
      onPrevious={navigation.onPrevious ?? noop}
      onNext={navigation.onNext ?? noop}
      onUseValue={noop}
      onOpenLibraryCorrection={noop}
      onReplaceDatasheet={noop}
      onAdoptLegacy={noop}
      onRerun={noop}
    />,
  );
}

describe('TechnicalVerificationWorkspace', () => {
  it('keeps an unsaved field when a filter change is cancelled', () => {
    stubMatchMedia();
    renderWorkspace([row('model', 'model', 'Model')]);
    const inspector = within(screen.getByRole('complementary', { name: 'Selected field detail' }));
    fireEvent.click(inspector.getByText('Edit Project value here'));
    fireEvent.change(inspector.getByLabelText('Project value'), {
      target: { value: 'Unsaved model' },
    });
    fireEvent.click(screen.getByLabelText('Show differences only'));
    expect(
      screen.getByRole('alertdialog', { name: 'Discard Project field changes' }),
    ).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Continue editing' }));
    expect(screen.getByLabelText('Show differences only')).toBeChecked();
    expect(inspector.getByLabelText('Project value')).toHaveValue('Unsaved model');
  });
  it('keeps direct editing and review reachable while a wrong-Datasheet warning is present', () => {
    stubMatchMedia();
    renderWorkspace([
      row('model', 'model', 'Model', {
        verificationResult: 'POSSIBLE_WRONG_DATASHEET',
        canUseDatasheetValue: false,
      }),
    ]);
    const inspector = within(screen.getByRole('complementary', { name: 'Selected field detail' }));
    fireEvent.click(inspector.getByRole('button', { name: 'Edit value' }));
    fireEvent.click(inspector.getByText('Edit Project value here'));
    expect(inspector.getByLabelText('Project value')).toBeVisible();
    expect(inspector.getByRole('button', { name: 'Save Project value' })).toBeVisible();
    fireEvent.click(inspector.getByRole('button', { name: 'Review reading' }));
    expect(inspector.getByRole('region', { name: 'Review reading actions' })).toBeVisible();
    expect(
      inspector.queryByRole('navigation', { name: 'Field detail pages' }),
    ).not.toBeInTheDocument();
    expect(inspector.getByRole('region', { name: 'Field information' })).toBeVisible();
  });

  afterEach(() => {
    cleanup();
    cleanupV4();
  });

  it('groups engineering fields, defaults to differences, and exposes bounded evidence actions', () => {
    stubMatchMedia();
    renderWorkspace([
      row('manufacturer', 'manufacturer', 'Manufacturer', {
        scheduleValue: 'LumenWorks',
        datasheetValue: 'LumenWorks',
        status: 'Matched',
        resultLabel: 'Match',
        verificationResult: 'MATCH',
        canUseDatasheetValue: false,
      }),
      row('wattage', 'wattage', 'Wattage'),
      row('lumens', 'lumens', 'Lumens', {
        scheduleValue: '',
        datasheetValue: '1250 lm',
        status: 'MissingSchedule',
        resultLabel: 'Missing in Table',
        verificationResult: 'MISSING_IN_TABLE',
      }),
      row('mounting', 'mounting', 'Mounting', {
        scheduleValue: 'Recessed',
        datasheetValue: 'Recessed',
        status: 'Matched',
        resultLabel: 'Match',
        verificationResult: 'MATCH',
        canUseDatasheetValue: false,
      }),
    ]);

    const dialog = screen.getByRole('dialog', { name: 'Technical Verification — DL01' });
    expect(within(dialog).getByRole('heading', { name: 'Identity' })).toBeInTheDocument();
    expect(within(dialog).getByRole('heading', { name: 'Electrical' })).toBeInTheDocument();
    expect(within(dialog).getByRole('heading', { name: 'Photometric' })).toBeInTheDocument();
    expect(within(dialog).queryByRole('button', { name: 'Mounting' })).toBeNull();
    expect(within(dialog).getByLabelText('Show differences only')).toBeChecked();
    expect(within(dialog).getByText(/Page 2 · Native PDF · HIGH confidence/)).toBeInTheDocument();
    expect(within(dialog).getByText('Rated input power')).toBeInTheDocument();

    fireEvent.click(within(dialog).getByLabelText('Show differences only'));
    expect(within(dialog).getByRole('button', { name: 'Mounting' })).toBeInTheDocument();
  });

  it('enforces the Library ownership firewall and wrong-Datasheet suspension', () => {
    stubMatchMedia();
    const view = renderWorkspace([
      row('manufacturer', 'manufacturer', 'Manufacturer', {
        scheduleValue: 'LumenWorks',
        datasheetValue: 'Other Lighting',
        status: 'NeedsReview',
        resultLabel: 'Possible Wrong Datasheet',
        verificationResult: 'POSSIBLE_WRONG_DATASHEET',
        canUseDatasheetValue: false,
      }),
      row('wattage', 'wattage', 'Wattage', { libraryLinked: true }),
    ]);

    const dialog = screen.getByRole('dialog', { name: 'Technical Verification — DL01' });
    expect(
      within(dialog).getByRole('heading', { name: 'POSSIBLE WRONG DATASHEET' }),
    ).toBeInTheDocument();
    expect(
      within(dialog).getAllByRole('button', { name: 'Replace Datasheet' }).length,
    ).toBeGreaterThan(0);
    expect(within(dialog).queryByRole('button', { name: /Use Datasheet Value/ })).toBeNull();

    view.unmount();
    renderWorkspace([row('wattage', 'wattage', 'Wattage', { libraryLinked: true })]);
    const libraryDialog = screen.getByRole('dialog', {
      name: 'Technical Verification — DL01',
    });
    fireEvent.click(within(libraryDialog).getByRole('button', { name: 'Review reading' }));
    expect(
      within(libraryDialog).getByRole('button', { name: 'Keep Library Snapshot' }),
    ).toBeEnabled();
    expect(
      within(libraryDialog).getByRole('button', { name: 'Open Library Correction Draft' }),
    ).toBeEnabled();
    expect(within(libraryDialog).queryByRole('button', { name: /Use Datasheet Value/ })).toBeNull();
  });

  it('renders canonical Ordering Code, Model, and Variant as distinct identity concepts', () => {
    stubMatchMedia();
    renderWorkspace([
      row('orderingCode', 'orderingCode', 'Ordering Code', {
        luminaire: { ...luminaire, orderingCode: '' },
        scheduleValue: '',
        datasheetValue: 'A2000427',
        status: 'MissingSchedule',
        resultLabel: 'Missing in Table',
        verificationResult: 'MISSING_IN_TABLE',
        canUseDatasheetValue: true,
      }),
    ]);

    const dialog = screen.getByRole('dialog', { name: 'Technical Verification — DL01' });
    const identity = within(dialog).getByLabelText('Verification overview');
    expect(within(identity).getByText('Manufacturer')).toBeInTheDocument();
    expect(within(identity).getByText('Ordering Code')).toBeInTheDocument();
    expect(within(identity).getByText('Model')).toBeInTheDocument();
    expect(within(identity).getByText('Variant / Product Label')).toBeInTheDocument();
    expect(within(identity).getByText('Datasheet')).toBeInTheDocument();
    // Canonical Ordering Code is distinct from Model; missing canonical shows as em dash.
    expect(within(identity).getByText('—')).toBeInTheDocument();
    expect(within(identity).getByText('DL-150')).toBeInTheDocument();
    expect(within(identity).getByText('3000K / 36°')).toBeInTheDocument();
    // The legacy model is never presented as a Product Family.
    expect(within(identity).queryByText('Product Family / Model')).not.toBeInTheDocument();
  });

  it('uses canonical Ordering Code in the compact header when present', () => {
    stubMatchMedia();
    renderWorkspace([
      row('wattage', 'wattage', 'Wattage', {
        luminaire: {
          ...luminaire,
          manufacturer: 'ERCO',
          orderingCode: 'A2000427',
          model: 'Iku Downlight',
        },
      }),
    ]);

    const dialog = screen.getByRole('dialog', { name: 'Technical Verification — DL01' });
    expect(within(dialog).getByText('ERCO · A2000427 · DL01_datasheet.pdf')).toBeInTheDocument();
    // The legacy model is never substituted for the canonical Ordering Code.
    expect(within(dialog).queryByText('ERCO · Iku Downlight · DL01_datasheet.pdf')).toBeNull();
  });

  it('never substitutes legacy Model for a missing Ordering Code in the compact header', () => {
    stubMatchMedia();
    renderWorkspace([
      row('orderingCode', 'orderingCode', 'Ordering Code', {
        luminaire: { ...luminaire, manufacturer: 'ERCO', orderingCode: '', model: 'A2000427' },
        scheduleValue: '',
        datasheetValue: 'A2000427',
        status: 'MissingSchedule',
        resultLabel: 'Missing in Table',
        verificationResult: 'MISSING_IN_TABLE',
        canUseDatasheetValue: true,
      }),
    ]);

    const dialog = screen.getByRole('dialog', { name: 'Technical Verification — DL01' });
    // The compact header must not present the legacy model as canonical article identity.
    expect(within(dialog).queryByText('ERCO · A2000427 · DL01_datasheet.pdf')).toBeNull();
    expect(
      within(dialog).getByText('ERCO · Ordering code not set · DL01_datasheet.pdf'),
    ).toBeInTheDocument();
    // The Model identity row still shows the legacy value in its own labelled field.
    const identity = within(dialog).getByLabelText('Verification overview');
    expect(within(identity).getByText('A2000427')).toBeInTheDocument();
    expect(within(identity).getByText('—')).toBeInTheDocument();
  });

  it('shows the corrected canonical Ordering Code in the compact header after Owner adoption', () => {
    stubMatchMedia();
    renderWorkspace([
      row('orderingCode', 'orderingCode', 'Ordering Code', {
        luminaire: {
          ...luminaire,
          manufacturer: 'ERCO',
          orderingCode: 'A2000427',
          model: 'A2000427',
        },
        scheduleValue: 'A2000427',
        datasheetValue: 'A2000427',
        status: 'Matched',
        resultLabel: 'Match',
        verificationResult: 'MATCH',
        canUseDatasheetValue: false,
      }),
    ]);

    const dialog = screen.getByRole('dialog', { name: 'Technical Verification — DL01' });
    // The value now comes from canonical Ordering Code, so the header may show it.
    expect(within(dialog).getByText('ERCO · A2000427 · DL01_datasheet.pdf')).toBeInTheDocument();
    // No "Product Family / Model" conflation returns.
    expect(within(dialog).queryByText('Product Family / Model')).toBeNull();
  });

  it('groups physical fields under a compact Physical section', () => {
    stubMatchMedia();
    renderWorkspace([
      row('cutout', 'cutout', 'Cut-out', {
        scheduleValue: '',
        datasheetValue: 'Ø125 mm',
        status: 'MissingSchedule',
        resultLabel: 'Missing in Table',
        verificationResult: 'MISSING_IN_TABLE',
        canUseDatasheetValue: true,
      }),
      row('dimensions', 'dimensions', 'Dimensions', {
        scheduleValue: '',
        datasheetValue: 'Ø160 × 110 mm',
        status: 'MissingSchedule',
        resultLabel: 'Missing in Table',
        verificationResult: 'MISSING_IN_TABLE',
        canUseDatasheetValue: true,
      }),
      row('bodyColorFinish', 'bodyColorFinish', 'Body Color / Finish', {
        scheduleValue: '',
        datasheetValue: 'White (RAL9002)',
        status: 'MissingSchedule',
        resultLabel: 'Missing in Table',
        verificationResult: 'MISSING_IN_TABLE',
        canUseDatasheetValue: true,
      }),
    ]);

    const dialog = screen.getByRole('dialog', { name: 'Technical Verification — DL01' });
    expect(within(dialog).getByRole('heading', { name: 'Physical' })).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Cut-out' })).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Dimensions' })).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Body Color / Finish' })).toBeInTheDocument();
    // Physical rows are not duplicated under Other (the empty Other section
    // is omitted entirely by the workspace section filter).
    expect(within(dialog).queryByRole('heading', { name: 'Other' })).toBeNull();
  });

  it('keeps legacy adoption gated by verified Project storage', () => {
    stubMatchMedia();
    renderWorkspace(
      [
        row('analysis', 'analysis', 'Datasheet Analysis', {
          scheduleValue: '',
          datasheetValue: '',
          status: 'NeedsAdoption',
          resultLabel: 'Legacy Datasheet Needs Adoption',
          verificationResult: 'LEGACY_ASSET_REQUIRES_ADOPTION',
          canUseDatasheetValue: false,
          documentId: null,
          pageNumber: null,
        }),
      ],
      false,
    );

    expect(screen.getByText('Connect / verify Project folder first.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Adopt Legacy Datasheets' })).toBeDisabled();
  });

  it('navigates fields in the same luminaire without closing the workspace', () => {
    stubMatchMedia();
    const onPrevious = vi.fn();
    const onNext = vi.fn();
    renderWorkspace(
      [row('wattage', 'wattage', 'Wattage'), row('lumens', 'lumens', 'Lumens')],
      true,
      {
        onPrevious,
        onNext,
      },
    );

    const dialog = screen.getByRole('dialog', { name: 'Technical Verification — DL01' });
    expect(within(dialog).getByText('DL01 — 1 of 2 needing review')).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Previous Field' })).toBeDisabled();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Next Field' }));
    expect(onNext).not.toHaveBeenCalled();
    expect(
      within(screen.getByRole('complementary', { name: 'Selected field detail' })).getByRole(
        'heading',
        { name: 'Lumens' },
      ),
    ).toBeVisible();
    expect(within(dialog).getByRole('button', { name: 'Next Field' })).toBeDisabled();
    expect(onPrevious).not.toHaveBeenCalled();
    expect(dialog).toBeInTheDocument();
  });

  it('keeps failed and missing partial results actionable without inventing evidence', () => {
    stubMatchMedia();
    const view = renderWorkspace([
      row('analysis', 'analysis', 'Datasheet Analysis', {
        scheduleValue: '',
        datasheetValue: '',
        status: 'ProcessingFailed',
        resultLabel: 'Processing Failed',
        verificationResult: null,
        canUseDatasheetValue: false,
        documentId: null,
        pageNumber: null,
      }),
    ]);

    expect(screen.getByRole('heading', { name: 'Processing Failed' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Retry Processing' })).toBeEnabled();
    expect(screen.queryByRole('button', { name: /Use Datasheet Value/ })).toBeNull();

    view.unmount();
    renderWorkspace([
      row('datasheet', 'datasheet', 'Datasheet', {
        scheduleValue: '',
        datasheetValue: '',
        status: 'MissingDatasheet',
        resultLabel: 'Missing Datasheet',
        verificationResult: 'MISSING_IN_DATASHEET',
        canUseDatasheetValue: false,
        documentId: null,
        pageNumber: null,
      }),
    ]);
    expect(screen.getByRole('heading', { name: 'Missing Datasheet' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Attach Datasheet' })).toBeEnabled();
    expect(screen.queryByText(/Page \d/)).toBeNull();
  });
});
