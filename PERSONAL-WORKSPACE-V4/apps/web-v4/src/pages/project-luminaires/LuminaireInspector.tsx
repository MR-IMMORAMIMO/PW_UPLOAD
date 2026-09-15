import { SctSuccess as CheckCircle2 } from '../../components/common/SctIcons';
import {
  Copy,
  FileText,
  GitCompareArrows,
  Image as ImageIcon,
  Library,
  Pencil,
  ShieldCheck,
  Trash2,
  X,
} from '../../components/common/SctIcons';
import type { LuminaireRecord } from '@scli/domain';
import type { ProjectLuminaireLibraryStatus } from '@scli/api-client';
import type { RefObject } from 'react';
import { V4Button } from '../../components/common/V4Button';
import { V4StatusPill } from '../../components/common/V4StatusPill';
import { displayLuminaireTechnicalValue } from '../../components/common/luminaireTechnicalDisplay';
import { LuminaireImage } from './LuminaireImage';
import { luminaireCompleteness, luminaireFileName, luminaireIdentity } from './luminairesViewModel';

const value = (input: string) => input.trim() || '—';

const hasLibraryStatus = (
  input: ProjectLuminaireLibraryStatus | null | undefined,
): input is ProjectLuminaireLibraryStatus =>
  Boolean(
    input &&
    typeof input.status === 'string' &&
    typeof input.selectedVersionSequence === 'number' &&
    typeof input.latestVersionSequence === 'number',
  );

export function LuminaireInspector({
  item,
  onClose,
  onEdit,
  onDuplicate,
  onRemove,
  onOpenAsset,
  onAnalyzeDatasheet,
  analysisPending,
  libraryStatus,
  onOpenLibrary,
  onCompareLibrary,
  onEditLibraryDescription,
  promotionEligible,
  onAddToLibrary,
  addToLibraryButtonRef,
}: {
  item: LuminaireRecord;
  onClose: () => void;
  onEdit: () => void;
  onDuplicate: () => void;
  onRemove: () => void;
  onOpenAsset: (path: string) => void;
  onAnalyzeDatasheet: () => void;
  analysisPending: boolean;
  libraryStatus?: ProjectLuminaireLibraryStatus | null | undefined;
  onOpenLibrary?: (() => void) | undefined;
  onCompareLibrary?: (() => void) | undefined;
  onEditLibraryDescription?: (() => void) | undefined;
  promotionEligible?: boolean | undefined;
  onAddToLibrary?: (() => void) | undefined;
  addToLibraryButtonRef?: RefObject<HTMLButtonElement | null> | undefined;
}) {
  const completeness = luminaireCompleteness(item);
  const linkedLibraryStatus = hasLibraryStatus(libraryStatus) ? libraryStatus : null;
  const technical: Array<[string, string]> = [
    ['Wattage', displayLuminaireTechnicalValue('wattage', item.wattage)],
    ['Lumens', displayLuminaireTechnicalValue('lumens', item.lumens)],
    ['CCT', displayLuminaireTechnicalValue('lightColor', item.lightColor)],
    ['CRI', displayLuminaireTechnicalValue('cri', item.cri)],
    ['Beam Angle', displayLuminaireTechnicalValue('beamAngle', item.beamAngle)],
    ['IP Rating', displayLuminaireTechnicalValue('ipRating', item.ipRating)],
    ['Mounting', item.mounting],
    ['Finish', item.bodyColorFinish],
    ['Dimensions', item.dimensions],
    ['Driver', item.driver],
    ['Control', item.control],
  ];
  return (
    <aside className="v4-luminaires__inspector" aria-label={`${item.tag} luminaire details`}>
      <header className="v4-luminaires__inspector-header">
        <div>
          <div className="v4-luminaires__inspector-title">
            <h2>{item.tag}</h2>
            <span data-state={completeness}>{completeness}</span>
          </div>
          <p>{luminaireIdentity(item)}</p>
        </div>
        <V4Button
          variant="icon"
          size="compact"
          aria-label="Close luminaire details"
          onClick={onClose}
        >
          <X aria-hidden="true" />
        </V4Button>
      </header>

      <div className="v4-luminaires__inspector-body">
        <section className="v4-luminaires__identity" aria-label="Product identity">
          <div className="v4-luminaires__hero-image">
            <LuminaireImage path={item.imagePath} alt={`${item.tag} product`} />
          </div>
          <dl>
            <div>
              <dt>Tag</dt>
              <dd>{item.tag}</dd>
            </div>
            <div>
              <dt>Manufacturer</dt>
              <dd>{value(item.manufacturer)}</dd>
            </div>
            <div>
              <dt>Model</dt>
              <dd>{value(item.model)}</dd>
            </div>
            <div>
              <dt>Ordering Code</dt>
              <dd>{value(item.orderingCode ?? '')}</dd>
            </div>
            {linkedLibraryStatus ? (
              <>
                <div>
                  <dt>Product Type</dt>
                  <dd>{value(item.productType ?? '')}</dd>
                </div>
                <div>
                  <dt>Variant</dt>
                  <dd>{value(item.variantLabel ?? '')}</dd>
                </div>
              </>
            ) : null}
          </dl>
        </section>

        <section className="v4-luminaires__technical" aria-label="Technical information">
          <dl>
            {technical.map(([label, fieldValue]) => (
              <div key={label}>
                <dt>{label}</dt>
                <dd>{value(fieldValue)}</dd>
              </div>
            ))}
          </dl>
        </section>

        {linkedLibraryStatus ? (
          <section
            className="v4-luminaires__source-card v4-luminaires__source-card--library"
            aria-label="Master Library source"
          >
            <header>
              <span className="v4-luminaires__source-icon">
                <Library aria-hidden="true" />
              </span>
              <div>
                <small>Source</small>
                <h3>Master Library</h3>
              </div>
              <V4StatusPill
                variant={linkedLibraryStatus.status === 'UPDATE_AVAILABLE' ? 'warning' : 'success'}
              >
                {linkedLibraryStatus.status === 'UPDATE_AVAILABLE' ? 'Update available' : 'Current'}
              </V4StatusPill>
            </header>
            <p className="v4-luminaires__source-product">
              <strong>{value(item.manufacturer)}</strong>
              <span>{value(item.model)}</span>
            </p>
            <dl className="v4-luminaires__source-versions">
              <div>
                <dt>Selected</dt>
                <dd>v{linkedLibraryStatus.selectedVersionSequence}</dd>
              </div>
              <div>
                <dt>Latest</dt>
                <dd>v{linkedLibraryStatus.latestVersionSequence}</dd>
              </div>
            </dl>
            <p className="v4-luminaires__source-trust">
              <ShieldCheck aria-hidden="true" /> Technical fields are bound to an immutable
              published Version. Project-owned fields remain local.
            </p>
            <div className="v4-luminaires__source-actions">
              {linkedLibraryStatus.status === 'UPDATE_AVAILABLE' ? (
                <>
                  <V4Button
                    size="compact"
                    leadingIcon={<GitCompareArrows />}
                    onClick={onCompareLibrary}
                  >
                    Compare Changes
                  </V4Button>
                  <V4Button variant="primary" size="compact" onClick={onCompareLibrary}>
                    Update Project
                  </V4Button>
                </>
              ) : (
                <>
                  <V4Button size="compact" onClick={onOpenLibrary}>
                    Open in Library
                  </V4Button>
                  <V4Button
                    size="compact"
                    leadingIcon={<GitCompareArrows />}
                    onClick={onCompareLibrary}
                  >
                    Compare
                  </V4Button>
                </>
              )}
              <V4Button variant="tertiary" size="compact" onClick={onEditLibraryDescription}>
                Edit Description Override
              </V4Button>
            </div>
          </section>
        ) : null}

        {!linkedLibraryStatus ? (
          <section
            className="v4-luminaires__source-card v4-luminaires__source-card--project"
            aria-label="Project-only source"
          >
            <header>
              <span className="v4-luminaires__source-icon">
                <Library aria-hidden="true" />
              </span>
              <div>
                <small>Source</small>
                <h3>Project-only</h3>
              </div>
              <V4StatusPill variant="neutral">Project-only</V4StatusPill>
            </header>
            <p>Not linked to Master Luminaire Library.</p>
            {promotionEligible ? (
              <V4Button
                ref={addToLibraryButtonRef}
                variant="primary"
                size="compact"
                leadingIcon={<Library />}
                onClick={onAddToLibrary}
              >
                Add to Master Library
              </V4Button>
            ) : null}
          </section>
        ) : null}

        <section className="v4-luminaires__notes" aria-labelledby="v4-luminaire-notes-heading">
          <h3 id="v4-luminaire-notes-heading">Notes</h3>
          <p>{item.notes.trim() || 'No notes'}</p>
        </section>

        <section className="v4-luminaires__assets" aria-label="Luminaire assets">
          <div className="v4-luminaires__asset-row">
            <button
              type="button"
              className="v4-luminaires__asset-card"
              disabled={!item.datasheetPath}
              onClick={() => onOpenAsset(item.datasheetPath)}
            >
              <FileText aria-hidden="true" />
              <span>
                <strong>Datasheet</strong>
                <small>
                  {item.datasheetPath ? luminaireFileName(item.datasheetPath) : 'Missing Datasheet'}
                </small>
              </span>
              {item.datasheetPath ? (
                <i>
                  Open <CheckCircle2 aria-hidden="true" />
                </i>
              ) : (
                <i>Missing</i>
              )}
            </button>
            {item.datasheetPath ? (
              <button
                type="button"
                className="v4-luminaires__asset-analyze"
                disabled={analysisPending}
                onClick={onAnalyzeDatasheet}
              >
                {analysisPending ? 'Analyzing…' : 'Analyze Datasheet'}
              </button>
            ) : null}
          </div>
          <button
            type="button"
            className="v4-luminaires__asset-card"
            disabled={!item.imagePath}
            onClick={() => onOpenAsset(item.imagePath)}
          >
            <ImageIcon aria-hidden="true" />
            <span>
              <strong>Product Image</strong>
              <small>
                {item.imagePath
                  ? `1 image · ${luminaireFileName(item.imagePath)}`
                  : 'Missing Image'}
              </small>
            </span>
            {item.imagePath ? <i>Open</i> : <i>Missing</i>}
          </button>
        </section>
      </div>

      <footer className="v4-luminaires__inspector-actions">
        {!libraryStatus ? (
          <V4Button size="compact" leadingIcon={<Pencil />} onClick={onEdit}>
            Edit
          </V4Button>
        ) : null}
        <V4Button size="compact" leadingIcon={<Copy />} onClick={onDuplicate}>
          Duplicate
        </V4Button>
        <V4Button variant="danger" size="compact" leadingIcon={<Trash2 />} onClick={onRemove}>
          Remove
        </V4Button>
      </footer>
    </aside>
  );
}
