import { useMemo, useRef, useState, type RefObject } from 'react';
import { useMutation } from '@tanstack/react-query';
import type { LuminaireLibraryVariantDraft } from '@scli/domain';
import type {
  ProjectLuminaireLibraryDraftCandidate,
  ProjectLuminaireLibraryDraftResult,
} from '@scli/api-client';
import { SctIes as Waves } from '../../components/common/SctIcons';
import {
  SctPdf as FileText,
  Image as ImageIcon,
  Library,
  ShieldCheck,
} from '../../components/common/SctIcons';
import { api } from '../../api/environment';
import { V4Button } from '../../components/common/V4Button';
import { V4Field } from '../../components/common/V4Field';
import { V4FloatingWorkspace } from '../../components/common/V4FloatingWorkspace';
import { V4StatusPill } from '../../components/common/V4StatusPill';
import { formatLuminaireVariantSummary } from '../../components/common/luminaireTechnicalDisplay';
import './fromLibraryDialog.css';

const variantFields: Array<[keyof LuminaireLibraryVariantDraft, string]> = [
  ['variantLabel', 'Variant / Configuration'],
  ['orderingCode', 'Ordering Code'],
  ['wattage', 'Wattage'],
  ['lumens', 'Lumens'],
  ['lightColor', 'CCT / Light Color'],
  ['cri', 'CRI'],
  ['beamAngle', 'Beam / Optic'],
  ['ipRating', 'IP Rating'],
  ['mounting', 'Mounting'],
  ['cutout', 'Cut-out'],
  ['driver', 'Driver'],
  ['control', 'Control'],
  ['emergency', 'Emergency'],
  ['bodyColorFinish', 'Finish'],
  ['dimensions', 'Dimensions'],
];

export function CreateLibraryDraftDialog({
  projectId,
  luminaireId,
  candidate,
  onClose,
  onCreated,
  returnFocusRef,
}: {
  projectId: string;
  luminaireId: string;
  candidate: ProjectLuminaireLibraryDraftCandidate;
  onClose: () => void;
  onCreated: (result: ProjectLuminaireLibraryDraftResult) => void;
  returnFocusRef?: RefObject<HTMLElement | null> | undefined;
}) {
  const idempotencyKey = useRef(crypto.randomUUID());
  const activeManufacturer = candidate.manufacturerMatches.find(
    (manufacturer) => manufacturer.status === 'ACTIVE',
  );
  const [productMode, setProductMode] = useState<'CREATE_NEW' | 'USE_EXISTING'>('CREATE_NEW');
  const [selectedProductId, setSelectedProductId] = useState<string | null>(null);
  const [keepSeparate, setKeepSeparate] = useState(false);
  const [productName, setProductName] = useState(candidate.source.productName);
  const [productType, setProductType] = useState(candidate.source.productType);
  const [description, setDescription] = useState(candidate.source.description);
  const [variant, setVariant] = useState(candidate.source.variant);
  const products = useMemo(
    () => [
      ...new Map(candidate.duplicateSuggestions.map((item) => [item.productId, item])).values(),
    ],
    [candidate.duplicateSuggestions],
  );
  const hardDuplicate = products.find((item) => item.hardConflict) ?? null;
  const create = useMutation({
    mutationFn: () =>
      api.createProjectLuminaireLibraryDraft(projectId, luminaireId, {
        manufacturer: activeManufacturer
          ? { mode: 'USE_EXISTING', manufacturerId: activeManufacturer.manufacturerId }
          : { mode: 'CREATE_NEW', name: candidate.source.manufacturerName },
        product:
          productMode === 'USE_EXISTING'
            ? { mode: 'USE_EXISTING', productId: selectedProductId! }
            : {
                mode: 'CREATE_NEW',
                name: productName,
                productType,
                description,
                duplicateDecision: products.length ? 'KEEP_SEPARATE' : 'NO_MATCHES',
              },
        variant,
        idempotencyKey: idempotencyKey.current,
      }),
    onSuccess: onCreated,
  });
  const duplicateChoiceReady =
    products.length === 0 || productMode === 'USE_EXISTING' || (!hardDuplicate && keepSeparate);
  const ready =
    candidate.eligibility.eligible &&
    variant.variantLabel.trim() &&
    (productMode === 'USE_EXISTING'
      ? Boolean(selectedProductId)
      : Boolean(productName.trim() && productType.trim() && duplicateChoiceReady));
  const sourceTag =
    candidate.excludedProjectFields.find((field) => field.field === 'tag')?.value ??
    'Project Luminaire';
  const readyAssetCount = candidate.assets.filter((asset) => asset.present).length;
  const variantSummary = formatLuminaireVariantSummary(variant);

  return (
    <V4FloatingWorkspace
      open
      title={`Create Library Draft from ${sourceTag}`}
      description="Review product details and files, then create a Library draft for review."
      dismissible={!create.isPending}
      onRequestClose={onClose}
      returnFocusRef={returnFocusRef}
      bodyClassName="v4-project-library-draft-workspace"
      footer={
        <div className="v4-p5a-workspace-footer">
          <p>Creates a draft for review. Publishing is a separate step.</p>
          <div>
            <V4Button variant="tertiary" onClick={onClose} disabled={create.isPending}>
              Cancel
            </V4Button>
            <V4Button
              variant="primary"
              leadingIcon={<Library />}
              disabled={!ready || create.isPending}
              onClick={() => create.mutate()}
            >
              {create.isPending ? 'Creating Draft…' : 'Create Draft'}
            </V4Button>
          </div>
        </div>
      }
    >
      <div className="v4-project-library-draft">
        <aside className="v4-project-library-draft__source" aria-label="Project source summary">
          <header>
            <span>
              <Library aria-hidden="true" />
            </span>
            <div>
              <small>Project source</small>
              <h3>{sourceTag}</h3>
            </div>
            <V4StatusPill variant="neutral">Project-only</V4StatusPill>
          </header>
          <dl>
            <div>
              <dt>Manufacturer</dt>
              <dd>{candidate.source.manufacturerName || '—'}</dd>
            </div>
            <div>
              <dt>Product</dt>
              <dd>{candidate.source.productName || '—'}</dd>
            </div>
            <div>
              <dt>Assets</dt>
              <dd>{readyAssetCount} files attached</dd>
            </div>
          </dl>
          <p className="v4-project-library-draft__trust">
            <ShieldCheck aria-hidden="true" /> Reusable technical data and eligible files are copied
            into managed Library storage.
          </p>
          <details className="v4-project-library-draft__excluded-details">
            <summary>
              <span>Excluded Project-only data</span>
              <small>{candidate.excludedProjectFields.length} fields stay with the Project</small>
            </summary>
            <dl className="v4-project-library-draft__excluded">
              {candidate.excludedProjectFields.map((field) => (
                <div key={field.field}>
                  <dt>{field.label}</dt>
                  <dd>{field.value.trim() || '—'}</dd>
                </div>
              ))}
            </dl>
          </details>
        </aside>

        <div className="v4-project-library-draft__review">
          <section>
            <header>
              <div>
                <small>Library identity</small>
                <h3>Product Draft</h3>
              </div>
              {activeManufacturer ? (
                <V4StatusPill variant="success">Manufacturer matched</V4StatusPill>
              ) : (
                <V4StatusPill variant="info">New manufacturer</V4StatusPill>
              )}
            </header>
            <div className="v4-project-library-draft__grid">
              <V4Field label="Manufacturer" controlId="promotion-manufacturer">
                <input
                  id="promotion-manufacturer"
                  readOnly
                  value={activeManufacturer?.name ?? candidate.source.manufacturerName}
                />
              </V4Field>
              <V4Field
                label="Product / Family Name"
                controlId="promotion-product"
                required
                helpText="Enter the reusable human-readable family. Do not use the ordering code as the family name."
              >
                <input
                  id="promotion-product"
                  value={productName}
                  disabled={productMode === 'USE_EXISTING'}
                  onChange={(event) => setProductName(event.target.value)}
                />
              </V4Field>
              <V4Field
                label="Product Type"
                controlId="promotion-product-type"
                required={productMode === 'CREATE_NEW'}
                helpText="Project Category is intentionally not used as Product Type."
              >
                <input
                  id="promotion-product-type"
                  value={productType}
                  disabled={productMode === 'USE_EXISTING'}
                  onChange={(event) => setProductType(event.target.value)}
                />
              </V4Field>
              <V4Field
                label="Technical Description"
                controlId="promotion-description"
                className="v4-project-library-draft__description"
              >
                <textarea
                  id="promotion-description"
                  value={description}
                  disabled={productMode === 'USE_EXISTING'}
                  onChange={(event) => setDescription(event.target.value)}
                />
              </V4Field>
            </div>
            <p className="v4-project-library-draft__notice">
              <ShieldCheck aria-hidden="true" />
              {activeManufacturer ? (
                <>
                  Reusing normalized Manufacturer identity{' '}
                  <strong>{activeManufacturer.name}</strong>.
                </>
              ) : (
                <>A new Manufacturer will be created because no normalized match exists.</>
              )}
            </p>
          </section>

          <section>
            <header>
              <div>
                <small>Reusable technical configuration</small>
                <h3>Variant Draft</h3>
                <p>{variantSummary || 'Complete the Variant identity below.'}</p>
              </div>
              <V4StatusPill variant="warning">Mutable Draft</V4StatusPill>
            </header>
            <div className="v4-project-library-draft__grid v4-project-library-draft__grid--technical">
              {variantFields.map(([field, label]) => (
                <V4Field
                  key={field}
                  label={label}
                  controlId={`promotion-${field}`}
                  required={field === 'variantLabel'}
                  helpText={
                    field === 'orderingCode' ? 'Manufacturer product / ordering number' : undefined
                  }
                >
                  <input
                    id={`promotion-${field}`}
                    value={variant[field]}
                    onChange={(event) =>
                      setVariant((current) => ({ ...current, [field]: event.target.value }))
                    }
                  />
                </V4Field>
              ))}
            </div>
          </section>

          <section>
            <header>
              <div>
                <small>Managed Library storage</small>
                <h3>Assets</h3>
              </div>
              <V4StatusPill variant={readyAssetCount ? 'success' : 'inactive'}>
                {readyAssetCount} files attached
              </V4StatusPill>
            </header>
            <div className="v4-project-library-draft__assets">
              {candidate.assets.map((asset) => (
                <div key={asset.assetType}>
                  <span className="v4-project-library-draft__asset-icon">
                    {asset.assetType === 'ProductImage' ? (
                      <ImageIcon aria-hidden="true" />
                    ) : asset.assetType === 'Datasheet' ? (
                      <FileText aria-hidden="true" />
                    ) : (
                      <Waves aria-hidden="true" />
                    )}
                  </span>
                  <span>
                    <strong>
                      {asset.assetType === 'ProductImage' ? 'Product Image' : asset.assetType}
                    </strong>
                    <small>
                      {asset.fileName?.replace(/^[a-f0-9]{64}[_-]/i, '') ??
                        'Optional file not attached'}
                    </small>
                  </span>
                  <V4StatusPill variant={asset.present ? 'success' : 'inactive'}>
                    {asset.present ? 'Attached' : 'Not attached (optional)'}
                  </V4StatusPill>
                </div>
              ))}
            </div>
          </section>

          <section>
            <header>
              <div>
                <small>Identity safeguard</small>
                <h3>Duplicate suggestions</h3>
              </div>
              <V4StatusPill variant={products.length ? 'warning' : 'success'}>
                {products.length ? `${products.length} review` : 'No matches'}
              </V4StatusPill>
            </header>
            {products.length ? (
              <div className="v4-project-library-draft__duplicates">
                {products.map((item) => (
                  <label key={item.productId}>
                    <input
                      type="radio"
                      name="promotion-product-choice"
                      checked={
                        productMode === 'USE_EXISTING' && selectedProductId === item.productId
                      }
                      onChange={() => {
                        setProductMode('USE_EXISTING');
                        setSelectedProductId(item.productId);
                        setKeepSeparate(false);
                      }}
                    />
                    <span>
                      <strong>{item.productName}</strong>
                      <small>{item.reason}</small>
                    </span>
                    <V4StatusPill variant="warning">{item.strength}</V4StatusPill>
                  </label>
                ))}
                <label
                  htmlFor="promotion-keep-separate"
                  aria-label="Keep Separate"
                  aria-disabled={Boolean(hardDuplicate)}
                >
                  <input
                    id="promotion-keep-separate"
                    type="radio"
                    name="promotion-product-choice"
                    checked={productMode === 'CREATE_NEW' && keepSeparate}
                    disabled={Boolean(hardDuplicate)}
                    onChange={() => {
                      setProductMode('CREATE_NEW');
                      setSelectedProductId(null);
                      setKeepSeparate(true);
                    }}
                  />
                  <span>
                    <strong>Keep Separate</strong>
                    <small>
                      {hardDuplicate
                        ? 'Unavailable because this Manufacturer and Ordering Code already identify an existing Variant.'
                        : 'Create a new Product and Variant Draft without merging identities.'}
                    </small>
                  </span>
                </label>
              </div>
            ) : (
              <p>No existing Product candidates were found for this Manufacturer.</p>
            )}
          </section>

          <p className="v4-project-library-draft__final-note">
            No Published Version or Project binding will be created. Publishing later also does not
            link this source Luminaire automatically.
          </p>
        </div>
        {create.error ? (
          <p role="alert">
            {create.error instanceof Error
              ? create.error.message
              : 'Library Draft creation failed.'}
          </p>
        ) : null}
      </div>
    </V4FloatingWorkspace>
  );
}
