import { formatBusinessDateTime } from '../../date-time/businessDateTime';
import { useQueryClient } from '@tanstack/react-query';
import { TechnicalProjectFieldEditor } from './TechnicalProjectFieldEditor';
import { V4ConfirmDialog } from '../../components/common/V4ConfirmDialog';
import { useV4DirtySurface } from '../../components/interaction/V4DirtyGuard';
import { useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { useParams } from 'react-router-dom';
import { DatasheetProductImages } from './DatasheetProductImages';
import { DatasheetFieldConfirmation } from './DatasheetFieldConfirmation';
import { LocalAiReviewAction } from './LocalAiReview';
import {
  SctWarning as AlertCircle,
  SctBack as ArrowLeft,
  SctNext as ArrowRight,
  SctSuccess as CheckCircle2,
  SctInfo as HelpCircle,
  SctQueue as List,
  SctExpand as Maximize2,
  SctRemove as Minus,
  SctRemove as MinusCircle,
  SctMore as MoreHorizontal,
  SctWarning as ShieldAlert,
} from '../../components/common/SctIcons';
import {
  Check,
  ExternalLink,
  FileSearch,
  FileText,
  RefreshCw,
  Ruler,
  Search,
  Shield,
  Sun,
  X,
  Zap,
} from '../../components/common/SctIcons';
import type { LuminaireAssetSummary } from '@scli/domain';
import { V4FloatingWorkspace } from '../../components/common/V4FloatingWorkspace';
import { api } from '../../api/environment';
import type { TechnicalCheckGroup, TechnicalCheckRow } from './technicalCheckViewModel';
import './technicalVerification.css';

interface EngineeringSection {
  key: 'identity' | 'electrical' | 'photometric' | 'physical' | 'protection-control' | 'other';
  label: string;
  icon: typeof List;
  fields: readonly TechnicalCheckRow['fieldKey'][];
}

const engineeringSections: readonly EngineeringSection[] = [
  {
    key: 'identity',
    label: 'Identity',
    icon: List,
    fields: ['manufacturer', 'orderingCode', 'model', 'variantLabel'],
  },
  {
    key: 'electrical',
    label: 'Electrical',
    icon: Zap,
    fields: ['wattage', 'emergency'],
  },
  {
    key: 'photometric',
    label: 'Photometric',
    icon: Sun,
    fields: ['lumens', 'lightColor', 'cri', 'beamAngle'],
  },
  {
    key: 'physical',
    label: 'Physical',
    icon: Ruler,
    fields: ['cutout', 'dimensions', 'bodyColorFinish'],
  },
  {
    key: 'protection-control',
    label: 'Protection & Control',
    icon: Shield,
    fields: ['ipRating', 'control', 'driver'],
  },
  {
    key: 'other',
    label: 'Other',
    icon: MoreHorizontal,
    fields: ['mounting', 'datasheet', 'productImage', 'analysis'],
  },
];

function isMatch(row: TechnicalCheckRow) {
  return row.verificationResult === 'MATCH' || row.status === 'Matched';
}

function isConflict(row: TechnicalCheckRow) {
  return row.verificationResult === 'CONFLICT' || row.status === 'Mismatch';
}

function isMissing(row: TechnicalCheckRow) {
  return (
    row.verificationResult === 'MISSING_IN_TABLE' ||
    row.verificationResult === 'MISSING_IN_DATASHEET' ||
    ['MissingSchedule', 'MissingDatasheet', 'MissingRequired'].includes(row.status)
  );
}

function isUnverified(row: TechnicalCheckRow) {
  return (
    row.verificationResult === 'UNVERIFIED' ||
    row.verificationResult === 'POSSIBLE_WRONG_DATASHEET' ||
    ['NeedsReview', 'NeedsAdoption', 'ProcessingFailed', 'Unavailable', 'Unsupported'].includes(
      row.status,
    )
  );
}

function exactResult(row: TechnicalCheckRow) {
  if (row.verificationResult) return row.verificationResult;
  const statusResult: Partial<Record<TechnicalCheckRow['status'], string>> = {
    Matched: 'MATCH',
    Mismatch: 'CONFLICT',
    MissingSchedule: 'MISSING_IN_TABLE',
    MissingDatasheet: 'MISSING_IN_DATASHEET',
    NeedsReview: 'UNVERIFIED',
    NeedsAdoption: 'NEEDS_ADOPTION',
    ProcessingFailed: 'PROCESSING_FAILED',
    MissingImage: 'MISSING_PRODUCT_IMAGE',
    MissingRequired: 'MISSING_IN_TABLE',
    Unavailable: 'UNAVAILABLE',
    Unsupported: 'UNSUPPORTED',
  };
  return statusResult[row.status] ?? row.resultLabel.toUpperCase().replaceAll(' ', '_');
}

function summaryFor(checks: readonly TechnicalCheckRow[]) {
  return {
    matched: checks.filter(isMatch).length,
    conflicts: checks.filter(isConflict).length,
    missing: checks.filter(isMissing).length,
    unverified: checks.filter(isUnverified).length,
  };
}

function evidenceDescription(row: TechnicalCheckRow) {
  if (isConflict(row))
    return `The Datasheet ${row.fieldLabel} does not match the current Project value.`;
  if (row.verificationResult === 'MISSING_IN_TABLE' || row.status === 'MissingSchedule')
    return `The Datasheet contains ${row.fieldLabel}, but the current Project value is blank.`;
  if (row.verificationResult === 'MISSING_IN_DATASHEET' || row.status === 'MissingDatasheet')
    return `The current Project value was not found in the attached Datasheet.`;
  if (isUnverified(row))
    return 'The Datasheet evidence is not reliable enough to make a technical conflict decision.';
  return 'The Project and Datasheet values agree.';
}

/** Golden status-pill tone for a verification result. */
function resultPillTone(result: string): 'green' | 'red' | 'amber' | 'blue' | 'gray' {
  if (result === 'MATCH') return 'green';
  if (result === 'CONFLICT' || result === 'PROCESSING_FAILED') return 'red';
  if (result === 'MISSING_IN_TABLE' || result === 'MISSING_IN_DATASHEET') return 'amber';
  if (result === 'UNVERIFIED' || result === 'POSSIBLE_WRONG_DATASHEET') return 'blue';
  return 'gray';
}

function resultPillLabel(result: string): string {
  switch (result) {
    case 'MATCH':
      return 'Match';
    case 'CONFLICT':
      return 'Conflict';
    case 'MISSING_IN_TABLE':
    case 'MISSING_IN_DATASHEET':
      return 'Missing';
    case 'UNVERIFIED':
      return 'Unverified';
    case 'POSSIBLE_WRONG_DATASHEET':
      return 'Possible Wrong Datasheet';
    case 'NEEDS_ADOPTION':
      return 'Needs Adoption';
    case 'PROCESSING_FAILED':
      return 'Processing Failed';
    case 'MISSING_PRODUCT_IMAGE':
      return 'Missing Image';
    case 'UNAVAILABLE':
      return 'Unavailable';
    case 'UNSUPPORTED':
      return 'Unsupported';
    default:
      return result.replaceAll('_', ' ');
  }
}

function confidenceTone(band: TechnicalCheckRow['confidenceBand']): 'green' | 'amber' | 'red' {
  if (band === 'HIGH') return 'green';
  if (band === 'MEDIUM') return 'amber';
  return 'red';
}

function confidenceLabel(band: TechnicalCheckRow['confidenceBand']): string {
  if (band === 'HIGH') return 'High';
  if (band === 'MEDIUM') return 'Medium';
  if (band === 'LOW') return 'Low';
  return '—';
}

function groupStatusTone(group: TechnicalCheckGroup): 'green' | 'red' | 'amber' | 'blue' | 'gray' {
  switch (group.overallStatus) {
    case 'Matched':
      return 'green';
    case 'Mismatch':
    case 'ProcessingFailed':
      return 'red';
    case 'MissingSchedule':
    case 'MissingDatasheet':
    case 'MissingImage':
    case 'MissingRequired':
    case 'NeedsAdoption':
      return 'amber';
    case 'NeedsReview':
      return 'blue';
    default:
      return 'gray';
  }
}

export interface TechnicalVerificationWorkspaceProps {
  group: TechnicalCheckGroup | null;
  initialRowId?: string | null;
  asset: LuminaireAssetSummary | undefined;
  queuePosition: number | null;
  queueLength: number;
  pending: boolean;
  storageVerified: boolean;
  returnFocusRef: RefObject<HTMLElement | null>;
  onClose: () => void;
  onPrevious: () => void;
  onNext: () => void;
  onUseValue: (row: TechnicalCheckRow) => void;
  onOpenLibraryCorrection: () => void;
  onReplaceDatasheet: () => void;
  onAdoptLegacy: () => void;
  onRerun: () => void;
  /** Full review queue (all luminaires needing review) for the left navigator. */
  queue?: readonly TechnicalCheckGroup[];
  /** Navigate the review to another luminaire in the queue. */
  onSelectGroup?: (groupId: string) => void;
  /** Open the attached Datasheet (existing datasheets-images surface). */
  onOpenDatasheet?: () => void;
}

export function TechnicalVerificationWorkspace({
  group,
  initialRowId,
  asset,
  queuePosition,
  queueLength,
  pending,
  storageVerified,
  returnFocusRef,
  onClose,
  onUseValue,
  onOpenLibraryCorrection,
  onReplaceDatasheet,
  onAdoptLegacy,
  onRerun,
  queue,
  onSelectGroup,
  onOpenDatasheet,
}: TechnicalVerificationWorkspaceProps) {
  const [showAll, setShowAll] = useState(false);
  const cache = useQueryClient();
  const [keepBusy, setKeepBusy] = useState(false);
  const [keepError, setKeepError] = useState('');
  const [kept, setKept] = useState<string | null>(null);
  const keepOperation = useRef(new Map<string, string>());
  const [selectedRowId, setSelectedRowId] = useState<string | null>(null);
  const [fieldDirty, setFieldDirty] = useState(false);
  const [discardField, setDiscardField] = useState<{
    proceed: () => void;
    cancel: () => void;
  } | null>(null);
  const [editorGeneration, setEditorGeneration] = useState(0);
  const guardField = (proceed: () => void) => {
    if (fieldDirty) setDiscardField({ proceed, cancel: () => undefined });
    else proceed();
  };
  useV4DirtySurface(fieldDirty, (_reason, proceed, cancel) => setDiscardField({ proceed, cancel }));
  const [preview, setPreview] = useState<{
    rowId: string;
    verificationFingerprint: TechnicalCheckRow['verificationFingerprint'];
    pageNumber: number;
    pngBase64: string;
    width: number;
    height: number;
    region: TechnicalCheckRow['region'];
  } | null>(null);
  const [previewPending, setPreviewPending] = useState(false);
  const { projectId } = useParams();
  const [imagePickerOpen, setImagePickerOpen] = useState(false);
  const [previewError, setPreviewError] = useState('');
  const [previewScale, setPreviewScale] = useState(1);
  const [previewMaximized, setPreviewMaximized] = useState(false);
  const [navQuery, setNavQuery] = useState('');
  const [navPage, setNavPage] = useState(0);
  const navigatorList = useRef<HTMLDivElement>(null);
  const [NAV_PAGE_SIZE, setNavigatorPageSize] = useState(4);
  const detailBody = useRef<HTMLDivElement>(null);
  const jumpToDetail = (label: string) => {
    const section = detailBody.current?.querySelector(`[aria-label="${label}"]`);
    if (section instanceof HTMLElement) section.scrollIntoView?.({ block: 'start' });
  };
  useEffect(() => {
    const node = navigatorList.current;
    if (!node || typeof ResizeObserver === 'undefined') return;
    const measure = () =>
      setNavigatorPageSize(Math.max(1, Math.floor((node.clientHeight + 7) / 110)));
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, [group?.id]);
  useEffect(() => {
    if (detailBody.current) detailBody.current.scrollTop = 0;
    setKeepError('');
  }, [selectedRowId, group?.id]);
  const initialFocusRef = useRef<HTMLButtonElement | null>(null);
  const checks = group?.checks ?? [];
  const wrongDatasheet = checks.some(
    (row) => row.verificationResult === 'POSSIBLE_WRONG_DATASHEET',
  );
  const summary = summaryFor(checks);
  const sections = useMemo(
    () =>
      engineeringSections
        .map((definition) => ({
          ...definition,
          checks: checks.filter(
            (row) =>
              definition.fields.includes(row.fieldKey) &&
              (definition.key === 'identity' || showAll || !isMatch(row)),
          ),
        }))
        .filter((section) => section.key === 'identity' || section.checks.length > 0),
    [checks, showAll],
  );
  const visibleChecks = sections.flatMap((section) => section.checks);
  const selectedRow =
    visibleChecks.find((row) => row.id === selectedRowId) ??
    visibleChecks.find((row) => !isMatch(row)) ??
    visibleChecks[0] ??
    null;
  const identityManufacturer = checks.find((row) => row.fieldKey === 'manufacturer');
  const identityOrderingCode = checks.find((row) => row.fieldKey === 'orderingCode');
  const fileName =
    asset?.datasheet?.fileName ||
    checks.find((row) => row.fileName)?.fileName ||
    'No Datasheet attached';

  const navigatorGroups = useMemo(() => {
    const source = queue && queue.length > 0 ? queue : group ? [group] : [];
    const query = navQuery.trim().toLocaleLowerCase();
    const filtered = query
      ? source.filter((candidate) =>
          [
            candidate.luminaire.tag,
            candidate.luminaire.manufacturer,
            candidate.luminaire.orderingCode,
          ]
            .filter(Boolean)
            .some((value) => value!.toLocaleLowerCase().includes(query)),
        )
      : source;
    return filtered;
  }, [group, navQuery, queue]);
  const navPageCount = Math.max(1, Math.ceil(navigatorGroups.length / NAV_PAGE_SIZE));
  const navPageGroups = navigatorGroups.slice(
    navPage * NAV_PAGE_SIZE,
    navPage * NAV_PAGE_SIZE + NAV_PAGE_SIZE,
  );
  useEffect(() => {
    if (navPage >= navPageCount) setNavPage(navPageCount - 1);
  }, [navPage, navPageCount]);

  useEffect(() => {
    setShowAll(
      Boolean(initialRowId && checks.some((row) => row.id === initialRowId && isMatch(row))),
    );
    setSelectedRowId(initialRowId ?? null);
    setPreview(null);
    setPreviewError('');
    setPreviewScale(1);
    setPreviewMaximized(false);
    setNavQuery('');
    setNavPage(0);
    if (detailBody.current) detailBody.current.scrollTop = 0;
  }, [group?.id, initialRowId]);

  if (!group) return null;
  const fieldPosition = visibleChecks.findIndex((row) => row.id === selectedRow?.id);
  const hasPrevious = fieldPosition > 0;
  const hasNext = fieldPosition >= 0 && fieldPosition < visibleChecks.length - 1;
  const queueLabel =
    queuePosition === null
      ? `${group.luminaire.tag} — Resolved`
      : `${group.luminaire.tag} — ${queuePosition + 1} of ${queueLength} needing review`;
  const partialRow = checks.find(
    (row) =>
      (row.fieldKey === 'analysis' || row.fieldKey === 'datasheet') &&
      [
        'NeedsAdoption',
        'ProcessingFailed',
        'MissingDatasheet',
        'Unavailable',
        'Unsupported',
      ].includes(row.status),
  );
  const loadEvidencePreview = async (row: TechnicalCheckRow) => {
    jumpToDetail('Field evidence');
    if (!row.documentId || !row.pageNumber) return;
    setPreviewPending(true);
    setPreviewError('');
    try {
      const result = await api.documentPreview(row.documentId, row.pageNumber);
      setPreview({
        rowId: row.id,
        verificationFingerprint: row.verificationFingerprint,
        pageNumber: result.pageNumber,
        pngBase64: result.pngBase64,
        width: result.width,
        height: result.height,
        region: row.region ?? result.evidence.find((item) => item.snippet === row.evidence)?.region,
      });
    } catch (error) {
      setPreviewError(
        error instanceof Error
          ? error.message
          : 'Evidence preview could not be loaded. Please retry.',
      );
    } finally {
      setPreviewPending(false);
    }
  };

  const keepProjectValue = async (row: TechnicalCheckRow) => {
    if (!projectId || !row.verificationFingerprint || keepBusy) return;
    const key = row.id + row.verificationFingerprint;
    if (!keepOperation.current.has(key)) keepOperation.current.set(key, crypto.randomUUID());
    setKeepBusy(true);
    setKeepError('');
    try {
      await api.keepLuminaireProjectValue(projectId, row.luminaire.id, {
        fieldKey: row.fieldKey,
        verificationFingerprint: row.verificationFingerprint,
        operationId: keepOperation.current.get(key),
      });
      setKept(key);
      await cache.invalidateQueries({ queryKey: ['v4'] });
    } catch (error) {
      setKeepError(error instanceof Error ? error.message : 'The review could not be saved.');
    } finally {
      setKeepBusy(false);
    }
  };
  const openDatasheet = () => {
    if (onOpenDatasheet) onOpenDatasheet();
  };

  return (
    <V4FloatingWorkspace
      open
      title={`Technical Verification — ${group.luminaire.tag}`}
      description={`${group.luminaire.manufacturer || 'Manufacturer not set'} · ${group.luminaire.orderingCode || 'Ordering code not set'} · ${fileName}`}
      panelClassName="v4-technical-verification"
      bodyClassName="v4-technical-verification__body"
      initialFocusRef={initialFocusRef}
      returnFocusRef={returnFocusRef}
      dismissible={!pending}
      onRequestClose={() => guardField(onClose)}
      headerActions={
        <>
          {projectId ? (
            <LocalAiReviewAction projectId={projectId} luminaireId={group.luminaire.id} />
          ) : null}
          <button
            type="button"
            className="v4-technical-verification__open-datasheet"
            onClick={() => setImagePickerOpen(true)}
            disabled={!projectId}
          >
            Product image from Datasheet
          </button>
          <button
            type="button"
            className="v4-technical-verification__open-datasheet"
            onClick={openDatasheet}
          >
            <FileText aria-hidden="true" /> Open Datasheet <ExternalLink aria-hidden="true" />
          </button>
        </>
      }
      footer={
        <div className="v4-technical-verification__footer-content">
          <button
            ref={initialFocusRef}
            type="button"
            className="v4-technical-verification__footer-nav"
            onClick={() => {
              if (hasPrevious)
                guardField(() => setSelectedRowId(visibleChecks[fieldPosition - 1]!.id));
            }}
            disabled={!hasPrevious || pending}
          >
            <ArrowLeft aria-hidden="true" /> Previous Field
          </button>
          <div className="v4-technical-verification__footer-legend" aria-label="Review legend">
            <span data-tone="red">
              <i /> {summary.conflicts} Conflicts
            </span>
            <span data-tone="amber">
              <i /> {summary.missing} Missing
            </span>
            <span data-tone="blue">
              <i /> {summary.unverified} Unverified
            </span>
          </div>
          <button
            type="button"
            className="v4-technical-verification__footer-nav"
            onClick={() => {
              if (hasNext) guardField(() => setSelectedRowId(visibleChecks[fieldPosition + 1]!.id));
            }}
            disabled={!hasNext || pending}
          >
            Next Field <ArrowRight aria-hidden="true" />
          </button>
          <div className="v4-technical-verification__footer-actions">
            <small>Completing closes this review. Unresolved checks remain unresolved.</small>
            <button type="button" onClick={() => guardField(onClose)} disabled={pending}>
              Close Review
            </button>
            <button
              type="button"
              className="is-primary"
              onClick={() => guardField(onClose)}
              disabled={pending}
            >
              <CheckCircle2 aria-hidden="true" /> Complete Review
            </button>
          </div>
        </div>
      }
    >
      {wrongDatasheet ? (
        <section className="v4-technical-verification__wrong-datasheet" role="status">
          <ShieldAlert aria-hidden="true" />
          <div>
            <h3>POSSIBLE WRONG DATASHEET</h3>
            <p>
              Technical comparison is suspended because the Datasheet identity does not match this
              Luminaire.
            </p>
            <dl>
              <div>
                <dt>Project Luminaire</dt>
                <dd>
                  {identityManufacturer?.scheduleValue || group.luminaire.manufacturer || '—'} ·{' '}
                  {identityOrderingCode?.scheduleValue || group.luminaire.orderingCode || '—'}
                </dd>
              </div>
              <div>
                <dt>Attached Datasheet</dt>
                <dd>
                  {identityManufacturer?.datasheetValue || '—'} ·{' '}
                  {identityOrderingCode?.datasheetValue || '—'}
                </dd>
              </div>
            </dl>
            <button type="button" onClick={onReplaceDatasheet}>
              Replace Datasheet
            </button>
          </div>
        </section>
      ) : null}

      {partialRow ? (
        <section
          className="v4-technical-verification__partial-state"
          data-state={partialRow.status}
        >
          <FileText aria-hidden="true" />
          <div>
            <h3>{partialRow.resultLabel}</h3>
            <p>{partialRow.analysisMessage || partialRow.evidence}</p>
            {partialRow.status === 'NeedsAdoption' ? (
              <>
                <p>
                  {storageVerified
                    ? 'This Datasheet must be adopted into verified Project storage before analysis.'
                    : 'Connect / verify Project folder first.'}
                </p>
                <button
                  type="button"
                  onClick={onAdoptLegacy}
                  disabled={!storageVerified || pending}
                >
                  Adopt Legacy Datasheets
                </button>
              </>
            ) : partialRow.status === 'MissingDatasheet' ? (
              <button type="button" onClick={onReplaceDatasheet}>
                Attach Datasheet
              </button>
            ) : (
              <button type="button" onClick={onRerun} disabled={pending}>
                <RefreshCw aria-hidden="true" /> Retry Processing
              </button>
            )}
          </div>
        </section>
      ) : null}

      {imagePickerOpen && projectId ? (
        <DatasheetProductImages
          projectId={projectId}
          luminaireId={group.luminaire.id}
          onClose={() => setImagePickerOpen(false)}
        />
      ) : null}
      <section className="v4-technical-verification__identity" aria-label="Verification overview">
        <dl>
          <div>
            <dt>Manufacturer</dt>
            <dd>{group.luminaire.manufacturer || '—'}</dd>
          </div>
          <div>
            <dt>Ordering Code</dt>
            <dd>{group.luminaire.orderingCode || '—'}</dd>
          </div>
          <div>
            <dt>Model</dt>
            <dd>{group.luminaire.model || '—'}</dd>
          </div>
          <div>
            <dt>Variant / Product Label</dt>
            <dd>{group.luminaire.variantLabel || group.luminaire.description || '—'}</dd>
          </div>
          <div>
            <dt>Datasheet</dt>
            <dd>{fileName}</dd>
          </div>
          <div>
            <dt>Overall Status</dt>
            <dd>{wrongDatasheet ? 'POSSIBLE WRONG DATASHEET' : group.overallLabel}</dd>
          </div>
        </dl>
      </section>

      <div className="v4-technical-verification__layout">
        <aside className="v4-technical-verification__navigator" aria-label="Luminaire navigator">
          <div className="v4-technical-verification__nav-head">
            <span className="v4-technical-verification__panel-title">Luminaires</span>
            <span className="v4-technical-verification__nav-count">{navigatorGroups.length}</span>
          </div>
          <div className="v4-technical-verification__nav-search">
            <label className="v4-technical-verification__nav-search-field">
              <Search aria-hidden="true" />
              <input
                type="search"
                aria-label="Search luminaires"
                placeholder="Search luminaires..."
                value={navQuery}
                onChange={(event) => {
                  setNavQuery(event.target.value);
                  setNavPage(0);
                }}
              />
            </label>
          </div>
          <div ref={navigatorList} className="v4-technical-verification__nav-list">
            {navPageGroups.map((candidate) => {
              const selected = candidate.id === group.id;
              const tone = groupStatusTone(candidate);
              return (
                <button
                  key={candidate.id}
                  type="button"
                  className={`v4-technical-verification__lum-card${selected ? ' is-selected' : ''}`}
                  aria-pressed={selected}
                  onClick={() => guardField(() => onSelectGroup?.(candidate.id))}
                >
                  <span className="v4-technical-verification__lum-top">
                    <strong>{candidate.luminaire.tag}</strong>
                    <span className={`v4-technical-verification__pill is-${tone}`}>
                      {candidate.overallLabel}
                    </span>
                  </span>
                  <span className="v4-technical-verification__lum-desc">
                    {candidate.luminaire.description ||
                      candidate.luminaire.variantLabel ||
                      candidate.luminaire.model ||
                      'No description'}
                  </span>
                  <span className="v4-technical-verification__lum-foot">
                    <span>
                      <FileText aria-hidden="true" />
                      {candidate.luminaire.datasheetPath ? 'Datasheet' : 'No Datasheet'}
                    </span>
                    <span>
                      {candidate.luminaire.orderingCode || '—'} <ArrowRight aria-hidden="true" />
                    </span>
                  </span>
                </button>
              );
            })}
          </div>
          <div className="v4-technical-verification__nav-footer">
            <span>
              Showing {navigatorGroups.length === 0 ? 0 : navPage * NAV_PAGE_SIZE + 1} to{' '}
              {Math.min((navPage + 1) * NAV_PAGE_SIZE, navigatorGroups.length)} of{' '}
              {navigatorGroups.length} luminaires
            </span>
            <div className="v4-technical-verification__nav-pages">
              <button
                type="button"
                aria-label="Previous luminaires"
                disabled={navPage === 0}
                onClick={() => setNavPage((current) => Math.max(0, current - 1))}
              >
                <ArrowLeft aria-hidden="true" />
              </button>
              <span>{navPage + 1}</span>
              <button
                type="button"
                aria-label="Next luminaires"
                disabled={navPage >= navPageCount - 1}
                onClick={() => setNavPage((current) => Math.min(navPageCount - 1, current + 1))}
              >
                <ArrowRight aria-hidden="true" />
              </button>
            </div>
          </div>
        </aside>

        <main className="v4-technical-verification__center">
          <div className="v4-technical-verification__summary" aria-label="Verification summary">
            <div className="v4-technical-verification__sum-card" data-tone="green">
              <span className="v4-technical-verification__sum-icon">
                <CheckCircle2 aria-hidden="true" />
              </span>
              <span>
                <b>{summary.matched}</b>
                <small>Matches</small>
              </span>
            </div>
            <div className="v4-technical-verification__sum-card" data-tone="red">
              <span className="v4-technical-verification__sum-icon">
                <AlertCircle aria-hidden="true" />
              </span>
              <span>
                <b>{summary.conflicts}</b>
                <small>Conflicts</small>
              </span>
            </div>
            <div className="v4-technical-verification__sum-card" data-tone="amber">
              <span className="v4-technical-verification__sum-icon">
                <MinusCircle aria-hidden="true" />
              </span>
              <span>
                <b>{summary.missing}</b>
                <small>Missing</small>
              </span>
            </div>
            <div className="v4-technical-verification__sum-card" data-tone="blue">
              <span className="v4-technical-verification__sum-icon">
                <HelpCircle aria-hidden="true" />
              </span>
              <span>
                <b>{summary.unverified}</b>
                <small>Unverified</small>
              </span>
            </div>
            <div className="v4-technical-verification__summary-side">
              <span className="v4-technical-verification__queue-label">{queueLabel}</span>
              <label className="v4-technical-verification__difference-toggle">
                <input
                  type="checkbox"
                  checked={!showAll}
                  onChange={(event) => {
                    const nextShowAll = !event.target.checked;
                    guardField(() => setShowAll(nextShowAll));
                  }}
                />
                <i aria-hidden="true" />
                Show differences only
              </label>
            </div>
          </div>

          <div className="v4-technical-verification__table-card">
            <div className="v4-technical-verification__table-scroll">
              {sections.map((section) => (
                <section
                  key={section.key}
                  aria-labelledby={`verification-${group.id}-${section.key}`}
                >
                  <h3 id={`verification-${group.id}-${section.key}`}>
                    <section.icon aria-hidden="true" /> {section.label}
                  </h3>
                  {section.checks.length ? (
                    <table>
                      <thead>
                        <tr>
                          <th>Field</th>
                          <th>Project Value</th>
                          <th>Datasheet Value</th>
                          <th>Status</th>
                          <th>Confidence</th>
                          <th>Action</th>
                        </tr>
                      </thead>
                      <tbody>
                        {section.checks.map((row) => {
                          const result = exactResult(row);
                          const tone = resultPillTone(result);
                          return (
                            <tr
                              key={row.id}
                              className={selectedRow?.id === row.id ? 'is-selected' : undefined}
                              data-result={result}
                              onClick={() => guardField(() => setSelectedRowId(row.id))}
                            >
                              <th scope="row">
                                <button
                                  type="button"
                                  onClick={(event) => {
                                    event.stopPropagation();
                                    guardField(() => setSelectedRowId(row.id));
                                  }}
                                >
                                  {row.fieldLabel}
                                </button>
                              </th>
                              <td>{row.scheduleValue || '—'}</td>
                              <td>
                                {row.datasheetValue ||
                                  (row.verificationResult === 'MISSING_IN_DATASHEET'
                                    ? 'Not found'
                                    : '—')}
                              </td>
                              <td>
                                <span className={`v4-technical-verification__pill is-${tone}`}>
                                  {resultPillLabel(result)}
                                </span>
                              </td>
                              <td>
                                <span className="v4-technical-verification__confidence">
                                  <i
                                    data-tone={confidenceTone(row.confidenceBand)}
                                    aria-hidden="true"
                                  />
                                  {confidenceLabel(row.confidenceBand)}
                                </span>
                              </td>
                              <td>
                                {row.documentId ? (
                                  <button
                                    type="button"
                                    className="v4-technical-verification__row-action"
                                    aria-label="Open datasheet"
                                    title={`Open datasheet for ${row.fieldLabel}`}
                                    onClick={(event) => {
                                      event.stopPropagation();
                                      openDatasheet();
                                    }}
                                  >
                                    <ExternalLink aria-hidden="true" />
                                  </button>
                                ) : null}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  ) : (
                    <p className="v4-technical-verification__empty-section">
                      No identity fields were returned.
                    </p>
                  )}
                </section>
              ))}
            </div>
          </div>
        </main>

        <aside className="v4-technical-verification__detail" aria-label="Selected field detail">
          {selectedRow ? (
            <>
              <header className="v4-technical-verification__detail-head">
                <span className="v4-technical-verification__panel-title">Field Details</span>
                <button
                  type="button"
                  className="v4-technical-verification__detail-close"
                  aria-label="Clear field selection"
                  onClick={() => guardField(() => setSelectedRowId(null))}
                >
                  <X aria-hidden="true" />
                </button>
              </header>
              <div className="v4-technical-verification__detail-shortcuts">
                <button type="button" onClick={() => jumpToDetail('Review reading actions')}>
                  Review reading
                </button>
                <button type="button" onClick={() => jumpToDetail('Edit Project field')}>
                  Edit value
                </button>
              </div>
              <div className="v4-technical-verification__detail-body" ref={detailBody}>
                <section aria-label="Field information">
                  <div className="v4-technical-verification__selected-title">
                    <h3>{selectedRow.fieldLabel}</h3>
                    <span
                      className={`v4-technical-verification__pill is-${resultPillTone(exactResult(selectedRow))}`}
                    >
                      {resultPillLabel(exactResult(selectedRow))}
                    </span>
                  </div>
                  <p className="v4-technical-verification__explainer">
                    {evidenceDescription(selectedRow)}
                  </p>
                  <div className="v4-technical-verification__fact-grid">
                    <div className="v4-technical-verification__fact">
                      <span>Page</span>
                      <strong>{selectedRow.pageNumber ?? '—'}</strong>
                    </div>
                    <div className="v4-technical-verification__fact">
                      <span>Method</span>
                      <strong>
                        {selectedRow.method === 'OCR'
                          ? 'OCR'
                          : selectedRow.method
                            ? 'Native PDF'
                            : '—'}
                      </strong>
                    </div>
                    <div className="v4-technical-verification__fact">
                      <span>Confidence</span>
                      <strong>
                        <i
                          className="v4-technical-verification__confidence-dot"
                          data-tone={confidenceTone(selectedRow.confidenceBand)}
                          aria-hidden="true"
                        />
                        {confidenceLabel(selectedRow.confidenceBand)}
                      </strong>
                    </div>
                  </div>
                  <div className="v4-technical-verification__evidence">
                    <h4>Evidence</h4>
                    <p className="v4-technical-verification__evidence-meta">
                      {selectedRow.pageNumber
                        ? `Page ${selectedRow.pageNumber}`
                        : 'Page unavailable'}{' '}
                      ·{' '}
                      {selectedRow.method === 'OCR'
                        ? 'OCR'
                        : selectedRow.method
                          ? 'Native PDF'
                          : 'Method unavailable'}{' '}
                      · {selectedRow.confidenceBand || 'UNRATED'} confidence
                    </p>
                    <p>
                      {selectedRow.evidence ||
                        selectedRow.analysisMessage ||
                        'No bounded evidence is available.'}
                    </p>
                    <dl>
                      <div>
                        <dt>Value</dt>
                        <dd>{selectedRow.datasheetValue || 'Not found'}</dd>
                      </div>
                      {selectedRow.unit ? (
                        <div>
                          <dt>Unit</dt>
                          <dd>{selectedRow.unit}</dd>
                        </div>
                      ) : null}
                      {selectedRow.basis ? (
                        <div>
                          <dt>Basis</dt>
                          <dd>{selectedRow.basis}</dd>
                        </div>
                      ) : null}
                    </dl>
                  </div>
                </section>
                <section aria-label="Field evidence">
                  <div
                    className={`v4-technical-verification__preview${previewMaximized ? ' is-maximized' : ''}`}
                  >
                    {preview?.rowId === selectedRow.id &&
                    preview.verificationFingerprint === selectedRow.verificationFingerprint ? (
                      <>
                        <div className="v4-technical-verification__preview-tools">
                          <span>
                            {preview.pageNumber} of {preview.pageNumber}
                          </span>
                          <span className="v4-technical-verification__preview-zoom">
                            <button
                              type="button"
                              aria-label="Zoom out"
                              disabled={previewScale <= 0.5}
                              onClick={() =>
                                setPreviewScale((current) => Math.max(0.5, current - 0.25))
                              }
                            >
                              <Minus aria-hidden="true" />
                            </button>
                            <button
                              type="button"
                              aria-label="Zoom in"
                              disabled={previewScale >= 2}
                              onClick={() =>
                                setPreviewScale((current) => Math.min(2, current + 0.25))
                              }
                            >
                              <Maximize2 aria-hidden="true" />
                            </button>
                            <button
                              type="button"
                              aria-label={previewMaximized ? 'Restore preview' : 'Maximize preview'}
                              aria-pressed={previewMaximized}
                              onClick={() => setPreviewMaximized((current) => !current)}
                            >
                              <ExternalLink aria-hidden="true" />
                            </button>
                          </span>
                        </div>
                        <div className="v4-technical-verification__preview-canvas">
                          {preview.region && preview.width && preview.height ? (
                            <svg
                              className="v4-datasheet-evidence-crop"
                              role="img"
                              aria-label="Highlighted Datasheet evidence region"
                              viewBox={`${Math.max(0, preview.region.x - 16)} ${Math.max(0, preview.region.y - 16)} ${preview.region.width + 32} ${preview.region.height + 32}`}
                            >
                              <image
                                href={`data:image/png;base64,${preview.pngBase64}`}
                                width={preview.width}
                                height={preview.height}
                              />
                              <rect
                                x={preview.region.x}
                                y={preview.region.y}
                                width={preview.region.width}
                                height={preview.region.height}
                                fill="none"
                                stroke="var(--v4-accent)"
                                strokeWidth="2"
                              />
                            </svg>
                          ) : (
                            <p className="v4-datasheet-evidence-note">
                              Page evidence — an exact region was not identified. Check the quoted
                              text on this page.
                            </p>
                          )}
                          <img
                            src={`data:image/png;base64,${preview.pngBase64}`}
                            alt={`Bounded Datasheet evidence page ${preview.pageNumber}`}
                            style={{ transform: `scale(${previewScale})` }}
                          />
                        </div>
                      </>
                    ) : (
                      <div className="v4-technical-verification__preview-empty">
                        <FileSearch aria-hidden="true" />
                        <span>Load the bounded Datasheet page to inspect evidence.</span>
                        {previewError ? <span role="alert">{previewError}</span> : null}
                        <button
                          type="button"
                          disabled={
                            !selectedRow.documentId || !selectedRow.pageNumber || previewPending
                          }
                          onClick={() => void loadEvidencePreview(selectedRow)}
                        >
                          {previewPending ? 'Loading Evidence…' : 'View Evidence'}
                        </button>
                      </div>
                    )}
                  </div>
                </section>
                <section aria-label="Review reading actions">
                  <div className="v4-technical-verification__owner-actions">
                    <h4>Actions</h4>
                    {keepError && <p role="alert">{keepError}</p>}
                    {kept === selectedRow.id + selectedRow.verificationFingerprint && (
                      <p role="status">
                        Reviewed — kept Project value. The comparison result is unchanged.
                      </p>
                    )}
                    {selectedRow.reviewNotes?.length ? (
                      <ul className="v4-datasheet-review-notes">
                        {selectedRow.reviewNotes.map((note) => (
                          <li key={note}>
                            {note.startsWith('KEPT_PROJECT_VALUE:')
                              ? 'Reviewed — kept Project value: ' +
                                note.slice(19).replace(/\d{4}-\d{2}-\d{2}T[^ ]+/, (date) =>
                                  formatBusinessDateTime(date, {
                                    dateStyle: 'medium',
                                    timeStyle: 'short',
                                  }),
                                )
                              : note.startsWith('CONFIRMED_AT:')
                                ? 'Confirmed: ' +
                                  formatBusinessDateTime(note.slice(13), {
                                    dateStyle: 'medium',
                                    timeStyle: 'short',
                                  })
                                : note.replaceAll('_', ' ').replaceAll(':', ': ')}
                          </li>
                        ))}
                      </ul>
                    ) : null}
                    {projectId ? (
                      <DatasheetFieldConfirmation
                        key={`${selectedRow.id}:${selectedRow.verificationFingerprint}`}
                        projectId={projectId}
                        luminaireId={group.luminaire.id}
                        row={selectedRow}
                        evidenceSeen={
                          preview?.rowId === selectedRow.id &&
                          preview.verificationFingerprint === selectedRow.verificationFingerprint
                        }
                        identityMismatch={wrongDatasheet}
                        onSaved={onRerun}
                      />
                    ) : null}
                    {selectedRow.canUseDatasheetValue &&
                    (wrongDatasheet || isUnverified(selectedRow)) ? (
                      <button
                        type="button"
                        className="is-primary"
                        disabled={pending}
                        onClick={() => onUseValue(selectedRow)}
                      >
                        Use reviewed Datasheet value
                      </button>
                    ) : null}
                    {selectedRow.libraryLinked ? (
                      <>
                        <strong>Library-controlled value</strong>
                        <button
                          type="button"
                          disabled={keepBusy || !selectedRow.verificationFingerprint}
                          onClick={() => void keepProjectValue(selectedRow)}
                        >
                          Keep Library Snapshot
                        </button>
                        <button type="button" onClick={onOpenLibraryCorrection}>
                          Open Library Correction Draft
                        </button>
                      </>
                    ) : wrongDatasheet ? (
                      <button type="button" onClick={onReplaceDatasheet}>
                        Replace Datasheet
                      </button>
                    ) : isUnverified(selectedRow) ? (
                      <>
                        <button
                          type="button"
                          disabled={
                            !selectedRow.documentId || !selectedRow.pageNumber || previewPending
                          }
                          onClick={() => void loadEvidencePreview(selectedRow)}
                        >
                          View Evidence
                        </button>
                        <button type="button" onClick={onReplaceDatasheet}>
                          Replace Datasheet
                        </button>
                      </>
                    ) : (
                      <>
                        <button type="button">
                          {selectedRow.verificationResult === 'MISSING_IN_DATASHEET'
                            ? 'Keep Current Value'
                            : 'Keep Project Value'}
                        </button>
                        {selectedRow.canUseDatasheetValue ? (
                          <button
                            type="button"
                            className="is-primary"
                            onClick={() => onUseValue(selectedRow)}
                            disabled={pending}
                          >
                            <Check aria-hidden="true" />{' '}
                            {selectedRow.verificationResult === 'MISSING_IN_TABLE'
                              ? 'Add / Use Datasheet Value'
                              : 'Use Datasheet Value'}
                            : {selectedRow.datasheetValue}
                          </button>
                        ) : null}
                      </>
                    )}
                    <button type="button" onClick={openDatasheet}>
                      <ExternalLink aria-hidden="true" /> Open Datasheet
                    </button>
                  </div>
                </section>
                <section
                  aria-label="Edit Project field"
                  className="v4-technical-verification__owner-actions"
                >
                  <TechnicalProjectFieldEditor
                    key={`${group.luminaire.id}:${selectedRow.fieldKey}:${editorGeneration}`}
                    onDirtyChange={setFieldDirty}
                    luminaire={group.luminaire}
                    selectedField={selectedRow.fieldKey}
                    onSaved={() => {
                      if (asset?.datasheet) onRerun();
                    }}
                  />
                </section>
              </div>
            </>
          ) : (
            <p className="v4-technical-verification__detail-empty">
              Select a differing field to review its evidence and Owner actions.
            </p>
          )}
        </aside>
      </div>
      <V4ConfirmDialog
        open={Boolean(discardField)}
        title="Discard Project field changes?"
        description="This Project value has not been saved."
        cancelLabel="Continue editing"
        confirmLabel="Discard changes"
        destructive
        onCancel={() => {
          discardField?.cancel();
          setDiscardField(null);
        }}
        onConfirm={() => {
          const next = discardField;
          setDiscardField(null);
          setFieldDirty(false);
          setEditorGeneration((value) => value + 1);
          next?.proceed();
        }}
      />
    </V4FloatingWorkspace>
  );
}
