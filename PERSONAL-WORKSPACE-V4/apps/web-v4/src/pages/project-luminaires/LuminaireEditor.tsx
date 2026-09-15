import { useMemo, useState } from 'react';
import { V4ModalLayer } from '../../components/interaction/V4ModalLayer';
import { V4ConfirmDialog } from '../../components/common/V4ConfirmDialog';
import { V4Button } from '../../components/common/V4Button';
import { LuminaireChoiceField } from '../../components/common/LuminaireChoiceField';
import { luminaireFileName } from './luminairesViewModel';
import { ExternalLink, FolderOpen, LoaderCircle, Save, X } from '../../components/common/SctIcons';
import type { LuminaireRecord } from '@scli/domain';
import type { LuminaireRecordInput } from '@scli/contracts';
import { invalidateLocalImage } from '../../desktop/localImage';
import { LuminaireImage } from './LuminaireImage';
import {
  formatBeam,
  formatCct,
  formatCri,
  formatIpRating,
  formatUnitValue,
  parseBeam,
  parseCct,
  parseCri,
  parseIpRating,
  parseUnitValue,
  type TechnicalAdapterState,
} from './luminaireTechnicalAdapters';

export const emptyLuminaire: LuminaireRecordInput = {
  tag: '',
  category: '',
  imagePath: '',
  description: '',
  manufacturer: '',
  model: '',
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
  datasheetPath: '',
  location: '',
  unit: 'No.',
  quantity: 0,
  notes: '',
  sourceName: '',
  dimensions: '',
  bodyColorFinish: '',
};

export function luminaireInput(record: LuminaireRecord): LuminaireRecordInput {
  const {
    id: _id,
    projectId: _projectId,
    createdAt: _createdAt,
    updatedAt: _updatedAt,
    ...input
  } = record;
  void _id;
  void _projectId;
  void _createdAt;
  void _updatedAt;
  return input;
}

function TextField({
  label,
  value,
  placeholder,
  wide,
  required,
  help,
  error,
  onChange,
}: {
  label: string;
  value: string;
  placeholder?: string;
  wide?: boolean;
  required?: boolean;
  help?: string;
  error?: string | null;
  onChange: (value: string) => void;
}) {
  return (
    <label className={wide ? 'v4-luminaires__field--wide' : undefined}>
      <span>
        {label}
        {required ? ' *' : ''}
      </span>
      <input
        value={value}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
      />
      {help ? <small className="v4-luminaires__field-help">{help}</small> : null}
      {error ? <small role="alert">{error}</small> : null}
    </label>
  );
}

function UnitField<Unit extends string>({
  label,
  canonical,
  units,
  defaultUnit,
  onChange,
}: {
  label: string;
  canonical: string;
  units: readonly Unit[];
  defaultUnit: Unit;
  onChange: (value: string) => void;
}) {
  const [state, setState] = useState<TechnicalAdapterState<Unit>>(() =>
    parseUnitValue(canonical, units, defaultUnit),
  );
  const commit = (next: TechnicalAdapterState<Unit>) => {
    setState(next);
    onChange(formatUnitValue(next));
  };
  return (
    <label>
      <span>{label}</span>
      <div className="v4-luminaires__technical-input">
        <select
          aria-label={`${label} mode`}
          value={state.mode}
          onChange={(event) => {
            if (event.target.value === 'custom')
              commit({ mode: 'custom', value: formatUnitValue(state) });
            else commit({ mode: 'standard', value: '', unit: defaultUnit });
          }}
        >
          <option value="standard">Value</option>
          <option value="custom">Custom</option>
        </select>
        {state.mode === 'standard' ? (
          <>
            <input
              aria-label={label}
              inputMode="decimal"
              value={state.value}
              onChange={(event) => commit({ ...state, value: event.target.value })}
            />
            <select
              aria-label={`${label} unit`}
              value={state.unit}
              onChange={(event) => commit({ ...state, unit: event.target.value as Unit })}
            >
              {units.map((unit) => (
                <option key={unit}>{unit}</option>
              ))}
            </select>
          </>
        ) : (
          <input
            className="v4-luminaires__technical-custom"
            aria-label={`${label} custom value`}
            value={state.value}
            onChange={(event) => commit({ mode: 'custom', value: event.target.value })}
          />
        )}
      </div>
    </label>
  );
}

function FixedTechnicalField<Unit extends string>({
  label,
  canonical,
  prefix,
  suffix,
  standardLabel,
  parse,
  format,
  onChange,
}: {
  label: string;
  canonical: string;
  prefix?: string;
  suffix?: string;
  standardLabel: string;
  parse: (value: string) => TechnicalAdapterState<Unit>;
  format: (state: TechnicalAdapterState<Unit>) => string;
  onChange: (value: string) => void;
}) {
  const [state, setState] = useState<TechnicalAdapterState<Unit>>(() => parse(canonical));
  const commit = (next: TechnicalAdapterState<Unit>) => {
    setState(next);
    onChange(format(next));
  };
  return (
    <label>
      <span>{label}</span>
      <div className="v4-luminaires__technical-input">
        <select
          aria-label={`${label} mode`}
          value={state.mode}
          onChange={(event) => {
            if (event.target.value === 'custom') commit({ mode: 'custom', value: format(state) });
            else commit(parse(''));
          }}
        >
          <option value="standard">{standardLabel}</option>
          <option value="custom">Custom</option>
        </select>
        {state.mode === 'standard' ? (
          <div className="v4-luminaires__affixed-input">
            {prefix ? <span>{prefix}</span> : null}
            <input
              aria-label={label}
              inputMode="decimal"
              value={state.value}
              onChange={(event) => commit({ ...state, value: event.target.value })}
            />
            {suffix ? <span>{suffix}</span> : null}
          </div>
        ) : (
          <input
            className="v4-luminaires__technical-custom"
            aria-label={`${label} custom value`}
            value={state.value}
            onChange={(event) => commit({ mode: 'custom', value: event.target.value })}
          />
        )}
      </div>
    </label>
  );
}

function CriField({
  canonical,
  onChange,
}: {
  canonical: string;
  onChange: (value: string) => void;
}) {
  const [value, setValue] = useState(() => parseCri(canonical));
  return (
    <label>
      <span>CRI</span>
      <div className="v4-luminaires__affixed-input">
        <span>CRI</span>
        <input
          aria-label="CRI"
          value={value}
          placeholder="90 or >90"
          onChange={(event) => {
            setValue(event.target.value);
            onChange(formatCri(event.target.value));
          }}
        />
      </div>
    </label>
  );
}

function AssetField({
  label,
  value,
  filters,
  image,
  onChange,
}: {
  label: string;
  value: string;
  filters: Array<{ name: string; extensions: string[] }>;
  image?: boolean;
  onChange: (value: string) => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const browse = async () => {
    setError(null);
    const picker = window.scliDesktop?.selectFile;
    if (!picker) {
      setError('Desktop file browsing is unavailable.');
      return;
    }
    try {
      const selected = await picker(filters);
      if (selected) {
        if (image) invalidateLocalImage(selected);
        onChange(selected);
      }
    } catch {
      setError('The file picker could not be opened.');
    }
  };
  return (
    <div className="v4-luminaires__asset-field">
      <span>{label}</span>
      <div className="v4-luminaires__asset-entry">
        <input
          aria-label={label}
          readOnly
          title={value}
          value={luminaireFileName(value)}
          placeholder="No local file selected"
        />
        <button type="button" onClick={() => void browse()}>
          <FolderOpen aria-hidden="true" /> Browse
        </button>
        <button type="button" disabled={!value} onClick={() => onChange('')}>
          Clear
        </button>
        {value && window.scliDesktop?.openPath ? (
          <button type="button" onClick={() => void window.scliDesktop?.openPath?.(value)}>
            <ExternalLink aria-hidden="true" /> Open
          </button>
        ) : null}
      </div>
      {image && value ? (
        <div className="v4-luminaires__asset-preview" aria-label="Selected product image preview">
          <LuminaireImage path={value} alt="Selected product image" />
        </div>
      ) : null}
      {error ? <small role="alert">{error}</small> : null}
    </div>
  );
}

function EditorSection({
  number,
  title,
  children,
}: {
  number: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <fieldset className="v4-luminaires__editor-section">
      <legend>
        <span>{number}</span> {title}
      </legend>
      <div className="v4-luminaires__section-grid">{children}</div>
    </fieldset>
  );
}

export function LuminaireEditor(props: {
  open: boolean;
  title: string;
  initial: LuminaireRecordInput;
  pending: boolean;
  error: string | null;
  duplicate: boolean;
  existingTags: readonly string[];
  onClose: () => void;
  onSave: (draft: LuminaireRecordInput) => Promise<void>;
}) {
  if (!props.open) return null;
  return <OpenLuminaireEditor {...props} />;
}

function OpenLuminaireEditor({
  title,
  initial,
  pending,
  error,
  duplicate,
  existingTags,
  onClose,
  onSave,
}: Parameters<typeof LuminaireEditor>[0]) {
  const [draft, setDraft] = useState(initial);
  const [quantity, setQuantity] = useState(String(initial.quantity));
  const [leave, setLeave] = useState(false);
  const close = () => {
    if (pending) return;
    if (JSON.stringify(draft) !== JSON.stringify(initial) || quantity !== String(initial.quantity))
      setLeave(true);
    else onClose();
  };
  const normalizedTags = useMemo(
    () => new Set(existingTags.map((tag) => tag.trim().toLocaleUpperCase('en'))),
    [existingTags],
  );
  const tagCollision = normalizedTags.has(draft.tag.trim().toLocaleUpperCase('en'));
  const valid = Boolean(
    draft.tag.trim() &&
    quantity.trim() &&
    Number.isFinite(Number(quantity)) &&
    Number(quantity) >= 0 &&
    !tagCollision,
  );
  const update = <K extends keyof LuminaireRecordInput>(key: K, next: LuminaireRecordInput[K]) =>
    setDraft((current) => ({ ...current, [key]: next }));

  return (
    <V4ModalLayer
      open
      className="v4-luminaires__modal-backdrop"
      panelClassName="v4-luminaires__editor"
      role="dialog"
      ariaLabel={title}
      onRequestClose={close}
      dismissible={!pending}
    >
      <header>
        <div>
          <span>Project luminaire</span>
          <h2>{title}</h2>
          {duplicate ? (
            <p>Copied values are ready. Enter a unique Tag and Ordering Code before saving.</p>
          ) : null}
        </div>
        <button
          type="button"
          aria-label="Close luminaire editor"
          onClick={close}
          disabled={pending}
        >
          <X aria-hidden="true" />
        </button>
      </header>
      <div className="v4-luminaires__editor-body">
        <EditorSection number="01" title="Identity">
          <TextField
            label="Tag"
            required
            value={draft.tag}
            placeholder="DL01"
            help="Saved and displayed in uppercase."
            error={tagCollision ? 'Tag must be unique for this project.' : null}
            onChange={(value) => update('tag', value)}
          />
          <LuminaireChoiceField
            kind="category"
            label="Category"
            value={draft.category}
            onChange={(value) => update('category', value)}
          />
          <TextField
            label="Manufacturer"
            value={draft.manufacturer}
            onChange={(value) => update('manufacturer', value)}
          />
          <TextField
            label="Ordering Code"
            value={draft.orderingCode ?? ''}
            placeholder="A2000427"
            onChange={(value) => update('orderingCode', value)}
          />
          <TextField
            label="Model"
            wide
            value={draft.model}
            onChange={(value) => update('model', value)}
          />
          <TextField
            label="Description"
            value={draft.description}
            wide
            onChange={(value) => update('description', value)}
          />
        </EditorSection>
        <EditorSection number="02" title="Photometric">
          <UnitField
            label="Power"
            canonical={draft.wattage}
            units={['W', 'W/m']}
            defaultUnit="W"
            onChange={(value) => update('wattage', value)}
          />
          <UnitField
            label="Luminous Flux"
            canonical={draft.lumens}
            units={['lm', 'lm/m']}
            defaultUnit="lm"
            onChange={(value) => update('lumens', value)}
          />
          <FixedTechnicalField
            label="CCT"
            canonical={draft.lightColor}
            suffix="K"
            standardLabel="CCT"
            parse={parseCct}
            format={formatCct}
            onChange={(value) => update('lightColor', value)}
          />
          <CriField canonical={draft.cri} onChange={(value) => update('cri', value)} />
          <FixedTechnicalField
            label="Beam / Optic"
            canonical={draft.beamAngle}
            suffix="°"
            standardLabel="Numeric Angle"
            parse={parseBeam}
            format={formatBeam}
            onChange={(value) => update('beamAngle', value)}
          />
          <FixedTechnicalField
            label="IP Rating"
            canonical={draft.ipRating}
            prefix="IP"
            standardLabel="Rating"
            parse={parseIpRating}
            format={formatIpRating}
            onChange={(value) => update('ipRating', value)}
          />
        </EditorSection>
        <EditorSection number="03" title="Installation">
          <LuminaireChoiceField
            kind="mounting"
            label="Mounting"
            value={draft.mounting}
            onChange={(value) => update('mounting', value)}
          />
          <TextField
            label="Cut-out"
            value={draft.cutout}
            onChange={(value) => update('cutout', value)}
          />
          <TextField
            label="Dimensions"
            value={draft.dimensions}
            onChange={(value) => update('dimensions', value)}
          />
          <TextField
            label="Body Colour / Finish"
            value={draft.bodyColorFinish}
            onChange={(value) => update('bodyColorFinish', value)}
          />
        </EditorSection>
        <EditorSection number="04" title="Electrical / Control">
          <TextField
            label="Driver"
            value={draft.driver}
            onChange={(value) => update('driver', value)}
          />
          <LuminaireChoiceField
            kind="control"
            label="Control"
            value={draft.control}
            onChange={(value) => update('control', value)}
          />
          <LuminaireChoiceField
            kind="emergency"
            label="Emergency"
            value={draft.emergency}
            onChange={(value) => update('emergency', value)}
          />
        </EditorSection>
        <EditorSection number="05" title="Project">
          <TextField
            label="Location / Level"
            value={draft.location}
            onChange={(value) => update('location', value)}
          />
          <TextField label="Unit" value={draft.unit} onChange={(value) => update('unit', value)} />
          <label>
            <span>Quantity</span>
            <input
              type="number"
              min="0"
              step="0.01"
              value={quantity}
              onChange={(event) => {
                setQuantity(event.target.value);
                const parsed = Number(event.target.value);
                if (event.target.value.trim() && Number.isFinite(parsed))
                  update('quantity', parsed);
              }}
            />
          </label>
          <TextField
            label="Source Name"
            value={draft.sourceName}
            onChange={(value) => update('sourceName', value)}
          />
        </EditorSection>
        <EditorSection number="06" title="Assets">
          <AssetField
            label="Product Image"
            value={draft.imagePath}
            image
            filters={[{ name: 'Product Images', extensions: ['png', 'jpg', 'jpeg', 'webp'] }]}
            onChange={(value) => update('imagePath', value)}
          />
          <AssetField
            label="Datasheet PDF"
            value={draft.datasheetPath}
            filters={[{ name: 'PDF Datasheets', extensions: ['pdf'] }]}
            onChange={(value) => update('datasheetPath', value)}
          />
        </EditorSection>
        <EditorSection number="07" title="Notes">
          <label className="v4-luminaires__field--full">
            <span>Notes</span>
            <textarea
              rows={4}
              value={draft.notes}
              onChange={(event) => update('notes', event.target.value)}
            />
          </label>
        </EditorSection>
      </div>
      {error ? (
        <p className="v4-luminaires__form-error" role="alert">
          {error}
        </p>
      ) : null}
      <footer>
        <button type="button" onClick={close} disabled={pending}>
          Cancel
        </button>
        <button
          type="button"
          className="v4-luminaires__primary"
          disabled={!valid || pending}
          onClick={() => void onSave({ ...draft, tag: draft.tag.trim().toLocaleUpperCase('en') })}
        >
          {pending ? (
            <LoaderCircle className="v4-luminaires__spin" aria-hidden="true" />
          ) : (
            <Save aria-hidden="true" />
          )}{' '}
          Save Luminaire
        </button>
      </footer>
      <V4ConfirmDialog
        open={leave}
        title="Unsaved luminaire changes"
        description="Save these changes before closing?"
        cancelLabel="Continue editing"
        confirmLabel="Discard"
        destructive
        onCancel={() => setLeave(false)}
        onConfirm={onClose}
        additionalAction={
          <V4Button
            variant="primary"
            disabled={!valid || pending}
            onClick={() => {
              setLeave(false);
              void onSave({ ...draft, tag: draft.tag.trim().toLocaleUpperCase('en') });
            }}
          >
            Save changes
          </V4Button>
        }
      />
    </V4ModalLayer>
  );
}
