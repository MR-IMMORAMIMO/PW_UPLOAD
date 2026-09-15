import { LuminaireImage } from './LuminaireImage';
import { LuminaireChoiceField } from '../../components/common/LuminaireChoiceField';
import { useMemo, useState, type RefObject } from 'react';
import { useMutation, useInfiniteQuery } from '@tanstack/react-query';
import { SctLibrary as BookOpen } from '../../components/common/SctIcons';
import { Search } from '../../components/common/SctIcons';
import { api } from '../../api/environment';
import { V4Button } from '../../components/common/V4Button';
import { V4Field } from '../../components/common/V4Field';
import { V4FloatingWorkspace } from '../../components/common/V4FloatingWorkspace';
import { V4StatusPill } from '../../components/common/V4StatusPill';
import { displayLuminaireTechnicalValue } from '../../components/common/luminaireTechnicalDisplay';
import './fromLibraryDialog.css';

export function FromLibraryDialog({
  projectId,
  onClose,
  onAdded,
  returnFocusRef,
}: {
  projectId: string;
  onClose: () => void;
  onAdded: (luminaireId: string) => void;
  returnFocusRef?: RefObject<HTMLElement | null> | undefined;
}) {
  const [search, setSearch] = useState('');
  const [selectedVersionId, setSelectedVersionId] = useState<string | null>(null);
  const [tag, setTag] = useState('');
  const [category, setCategory] = useState('');
  const [location, setLocation] = useState('');
  const [unit, setUnit] = useState('No.');
  const [quantity, setQuantity] = useState('1');
  const [notes, setNotes] = useState('');
  const [descriptionOverride, setDescriptionOverride] = useState('');
  const query = useInfiniteQuery({
    queryKey: ['v4', 'library', 'project-picker', search],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) =>
      api.luminaireLibraryProducts({
        search: search || undefined,
        status: 'ACTIVE',
        limit: '60',
        cursor: pageParam,
      }),
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
  const versions = useMemo(
    () =>
      (query.data?.pages.flatMap((page) => page.items) ?? []).flatMap((product) =>
        product.variants
          .filter((entry) => entry.variant.status === 'ACTIVE' && entry.latestVersion)
          .map((entry) => ({
            product,
            variant: entry.variant,
            version: entry.latestVersion!,
            imageId: entry.assetAvailability?.productImageAssetVersionId ?? null,
          })),
      ),
    [query.data],
  );
  const selected = versions.find((item) => item.version.versionId === selectedVersionId) ?? null;
  const add = useMutation({
    mutationFn: () =>
      api.addProjectLuminaireFromLibrary(projectId, {
        versionId: selectedVersionId!,
        tag,
        category,
        location,
        unit,
        quantity: Number(quantity),
        notes,
        descriptionOverride: descriptionOverride.trim() || null,
        idempotencyKey: crypto.randomUUID(),
      }),
    onSuccess: (result) => onAdded(result.luminaireId),
  });
  return (
    <V4FloatingWorkspace
      open
      title="Add Luminaire · From Master Library"
      description="Choose a published luminaire, then enter its project tag and quantity."
      dismissible={!add.isPending}
      onRequestClose={onClose}
      returnFocusRef={returnFocusRef}
      bodyClassName="v4-p5a-workspace-body"
      footer={
        <div className="v4-p5a-workspace-footer">
          <p>Technical specifications come from the selected Library version.</p>
          <div>
            <V4Button variant="tertiary" onClick={onClose} disabled={add.isPending}>
              Cancel
            </V4Button>
            <V4Button
              variant="primary"
              leadingIcon={<BookOpen />}
              disabled={
                !selected ||
                !tag.trim() ||
                !quantity.trim() ||
                !Number.isFinite(Number(quantity)) ||
                Number(quantity) < 0 ||
                add.isPending
              }
              onClick={() => add.mutate()}
            >
              Add to Project
            </V4Button>
          </div>
        </div>
      }
    >
      <div className="v4-luminaires-library-picker">
        <section className="v4-luminaires-library-picker__catalog">
          <label>
            <Search aria-hidden="true" />
            <input
              type="search"
              aria-label="Search Master Library"
              placeholder="Search manufacturer, product or variant…"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </label>
          {query.isLoading ? <p role="status">Loading Library…</p> : null}
          {query.isError ? <p role="alert">Master Library could not be loaded.</p> : null}
          <div>
            {versions.map((item) => (
              <button
                type="button"
                key={item.version.versionId}
                className={selectedVersionId === item.version.versionId ? 'is-selected' : ''}
                onClick={() => setSelectedVersionId(item.version.versionId)}
              >
                <span>
                  <small>{item.product.manufacturer.name}</small>
                  <strong>{item.product.product.name}</strong>
                  <em>{item.variant.variantLabel}</em>
                </span>
                <V4StatusPill variant="info">v{item.version.versionSequence}</V4StatusPill>
              </button>
            ))}
          </div>
          {query.hasNextPage && (
            <V4Button
              disabled={query.isFetchingNextPage}
              onClick={() => void query.fetchNextPage()}
            >
              {query.isFetchingNextPage ? 'Loading…' : 'Load more products'}
            </V4Button>
          )}
        </section>
        <section className="v4-luminaires-library-picker__details">
          {selected ? (
            <>
              <header>
                <BookOpen aria-hidden="true" />
                <div>
                  <h3>
                    {selected.product.product.name} · {selected.variant.variantLabel}
                  </h3>
                  <p>Published v{selected.version.versionSequence}</p>
                </div>
              </header>
              <div className="final-luminaire-image" style={{ width: 120, height: 120 }}>
                <LuminaireImage
                  path={
                    selected.imageId
                      ? `/api/luminaire-library/assets/versions/${encodeURIComponent(selected.imageId)}/content`
                      : ''
                  }
                  alt={selected.product.product.name}
                />
              </div>
              <dl>
                <div>
                  <dt>Ordering Code</dt>
                  <dd>{selected.version.snapshot.orderingCode || '—'}</dd>
                </div>
                <div>
                  <dt>Wattage</dt>
                  <dd>
                    {displayLuminaireTechnicalValue('wattage', selected.version.snapshot.wattage)}
                  </dd>
                </div>
                <div>
                  <dt>Lumens</dt>
                  <dd>
                    {displayLuminaireTechnicalValue('lumens', selected.version.snapshot.lumens)}
                  </dd>
                </div>
                <div>
                  <dt>CCT</dt>
                  <dd>
                    {displayLuminaireTechnicalValue(
                      'lightColor',
                      selected.version.snapshot.lightColor,
                    )}
                  </dd>
                </div>
                <div>
                  <dt>CRI</dt>
                  <dd>{displayLuminaireTechnicalValue('cri', selected.version.snapshot.cri)}</dd>
                </div>
                <div>
                  <dt>Beam</dt>
                  <dd>
                    {displayLuminaireTechnicalValue(
                      'beamAngle',
                      selected.version.snapshot.beamAngle,
                    )}
                  </dd>
                </div>
                <div>
                  <dt>Control</dt>
                  <dd>{selected.version.snapshot.control || '—'}</dd>
                </div>
              </dl>
              <div className="v4-luminaires-library-picker__form">
                <V4Field label="Tag" controlId="from-library-tag" required>
                  <input
                    id="from-library-tag"
                    value={tag}
                    onChange={(event) => setTag(event.target.value)}
                  />
                </V4Field>
                <LuminaireChoiceField
                  label="Project Category"
                  kind="category"
                  value={category}
                  onChange={setCategory}
                />
                <V4Field label="Location" controlId="from-library-location">
                  <input
                    id="from-library-location"
                    value={location}
                    onChange={(event) => setLocation(event.target.value)}
                  />
                </V4Field>
                <V4Field label="Unit" controlId="from-library-unit">
                  <input
                    id="from-library-unit"
                    value={unit}
                    onChange={(event) => setUnit(event.target.value)}
                  />
                </V4Field>
                <V4Field label="Quantity" controlId="from-library-quantity">
                  <input
                    id="from-library-quantity"
                    type="number"
                    min="0"
                    value={quantity}
                    onChange={(event) => setQuantity(event.target.value)}
                  />
                </V4Field>
                <V4Field label="Project Notes" controlId="from-library-notes">
                  <textarea
                    id="from-library-notes"
                    value={notes}
                    onChange={(event) => setNotes(event.target.value)}
                  />
                </V4Field>
                <V4Field
                  label="Project Description Override"
                  controlId="from-library-description-override"
                  helpText="The only Project-owned technical override."
                >
                  <textarea
                    id="from-library-description-override"
                    value={descriptionOverride}
                    placeholder={selected.version.snapshot.technicalDescription}
                    onChange={(event) => setDescriptionOverride(event.target.value)}
                  />
                </V4Field>
              </div>
              {add.error ? (
                <p role="alert">
                  {add.error instanceof Error ? add.error.message : 'Luminaire could not be added.'}
                </p>
              ) : null}
            </>
          ) : (
            <div className="v4-luminaires-library-picker__empty">
              <BookOpen />
              <h3>Select a published Variant</h3>
              <p>Draft-only Variants cannot be selected into Projects.</p>
            </div>
          )}
        </section>
      </div>
    </V4FloatingWorkspace>
  );
}
