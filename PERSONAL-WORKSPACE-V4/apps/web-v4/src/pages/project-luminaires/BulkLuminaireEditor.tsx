import { useState } from 'react';
import type { LuminaireRecord } from '@scli/domain';
import type { LuminaireRecordInput } from '@scli/contracts';
import { api } from '../../api/environment';
import { V4Drawer } from '../../components/common/V4Drawer';
import { V4Button } from '../../components/common/V4Button';
import { V4ConfirmDialog } from '../../components/common/V4ConfirmDialog';
import { LuminaireChoiceField } from '../../components/common/LuminaireChoiceField';
import { luminaireInput } from './LuminaireEditor';
import { useV4DirtySurface } from '../../components/interaction/V4DirtyGuard';

const fields = [
  'category',
  'description',
  'manufacturer',
  'model',
  'wattage',
  'lumens',
  'lightColor',
  'cri',
  'beamAngle',
  'ipRating',
  'mounting',
  'cutout',
  'driver',
  'control',
  'emergency',
  'location',
  'unit',
  'quantity',
  'notes',
  'dimensions',
  'bodyColorFinish',
] as const;
const names: Partial<Record<(typeof fields)[number], string>> = {
  lightColor: 'CCT',
  cri: 'CRI',
  beamAngle: 'Beam angle',
  ipRating: 'IP rating',
  bodyColorFinish: 'Body / finish',
};
export function BulkLuminaireEditor({
  projectId,
  records,
  mode,
  onClose,
  onChanged,
}: {
  projectId: string;
  records: LuminaireRecord[];
  mode: 'edit' | 'remove';
  onClose: () => void;
  onChanged: () => Promise<void>;
}) {
  const [enabled, setEnabled] = useState<Set<(typeof fields)[number]>>(new Set());
  const [values, setValues] = useState<Record<string, string>>({});
  const [pending, setPending] = useState(false);
  const [refreshError, setRefreshError] = useState<string | null>(null);
  const [results, setResults] = useState<Record<string, string>>({});
  const [leave, setLeave] = useState<{ proceed: () => void; cancel: () => void } | null>(null);
  const done = records.every((record) => ['Saved', 'Removed'].includes(results[record.id] ?? ''));
  const dirty = mode === 'edit' && enabled.size > 0 && !done;
  useV4DirtySurface(dirty || pending, (_reason, proceed, cancel) => {
    if (pending) return cancel();
    setLeave({ proceed, cancel });
  });
  const close = () => {
    if (!pending) {
      if (dirty) setLeave({ proceed: onClose, cancel: () => {} });
      else onClose();
    }
  };
  const run = async () => {
    setPending(true);
    setRefreshError(null);
    let failed = false;
    try {
      for (const record of records) {
        if (results[record.id] === 'Saved' || results[record.id] === 'Removed') continue;
        try {
          if (mode === 'remove') await api.deleteLuminaire(projectId, record.id);
          else {
            const fresh = (await api.projectWorkspace(projectId)).luminaires.find(
              (item) => item.id === record.id,
            );
            if (!fresh) throw new Error('Luminaire no longer exists.');
            const patch: Partial<LuminaireRecordInput> = {};
            for (const key of enabled) {
              if (key === 'quantity') patch.quantity = Number(values[key]);
              else patch[key] = values[key] ?? '';
            }
            await api.updateLuminaire(projectId, record.id, { ...luminaireInput(fresh), ...patch });
          }
          setResults((previous) => ({
            ...previous,
            [record.id]: mode === 'edit' ? 'Saved' : 'Removed',
          }));
        } catch (cause) {
          failed = true;
          setResults((previous) => ({
            ...previous,
            [record.id]: cause instanceof Error ? cause.message : 'Could not save this luminaire.',
          }));
        }
      }
    } finally {
      try {
        await onChanged();
      } catch (cause) {
        setRefreshError(
          cause instanceof Error ? cause.message : 'Changes saved but the list could not refresh.',
        );
      } finally {
        setPending(false);
      }
    }
    if (!failed && leave) {
      const next = leave;
      setLeave(null);
      onClose();
      next.proceed();
    }
  };
  const invalid =
    mode === 'edit' &&
    (!enabled.size ||
      (enabled.has('quantity') &&
        (!values.quantity?.trim() ||
          !Number.isFinite(Number(values.quantity)) ||
          Number(values.quantity) < 0)));
  return (
    <V4Drawer
      open
      presentation="float"
      title={mode === 'edit' ? 'Bulk edit luminaires' : 'Remove selected luminaires'}
      onClose={close}
      dismissible={!pending}
      className="v4-bulk-luminaire-editor"
      footer={
        <>
          <V4Button onClick={close} disabled={pending}>
            {done ? 'Close' : 'Cancel'}
          </V4Button>
          <V4Button
            variant={mode === 'remove' ? 'danger' : 'primary'}
            disabled={pending || invalid || done}
            onClick={() => void run()}
          >
            {pending
              ? 'Saving…'
              : mode === 'remove'
                ? 'Remove from project'
                : 'Apply selected fields'}
          </V4Button>
        </>
      }
    >
      <p>
        {records.length} luminaires selected.{' '}
        {mode === 'edit'
          ? 'Only checked fields will change. An empty checked field clears its value.'
          : 'Remove these luminaires from this project? Source files and Library products are retained.'}
      </p>
      {mode === 'edit' && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2,minmax(0,1fr))', gap: 14 }}>
          {fields.map((key) => (
            <div key={key}>
              <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <input
                  type="checkbox"
                  checked={enabled.has(key)}
                  disabled={pending || Object.keys(results).length > 0}
                  onChange={() =>
                    setEnabled((previous) => {
                      const next = new Set(previous);
                      if (next.has(key)) next.delete(key);
                      else next.add(key);
                      return next;
                    })
                  }
                />
                Change {names[key] ?? key}
              </label>
              {enabled.has(key) &&
                (key === 'category' ||
                key === 'mounting' ||
                key === 'control' ||
                key === 'emergency' ? (
                  <LuminaireChoiceField
                    disabled={pending || Object.keys(results).length > 0}
                    label={names[key] ?? key}
                    kind={key}
                    value={values[key] ?? ''}
                    onChange={(value) => setValues((previous) => ({ ...previous, [key]: value }))}
                  />
                ) : (
                  <input
                    aria-label={names[key] ?? key}
                    type={key === 'quantity' ? 'number' : 'text'}
                    value={values[key] ?? ''}
                    disabled={pending || Object.keys(results).length > 0}
                    onChange={(event) =>
                      setValues((previous) => ({ ...previous, [key]: event.target.value }))
                    }
                    style={{ width: '100%' }}
                  />
                ))}
            </div>
          ))}
        </div>
      )}
      {refreshError && <p role="alert">{refreshError}</p>}
      <ul aria-label="Selected luminaire results">
        {records.map((record) => (
          <li key={record.id}>
            {record.tag} — {results[record.id] ?? 'Pending'}
          </li>
        ))}
      </ul>
      <V4ConfirmDialog
        open={Boolean(leave)}
        title="Unsaved bulk changes"
        description="Apply your selected fields before closing?"
        cancelLabel="Continue editing"
        confirmLabel="Discard"
        destructive
        pending={pending}
        onCancel={() => {
          leave?.cancel();
          setLeave(null);
        }}
        onConfirm={() => {
          const next = leave;
          setLeave(null);
          onClose();
          next?.proceed();
        }}
        additionalAction={
          <V4Button
            variant="primary"
            disabled={invalid || pending}
            onClick={() => {
              void run();
            }}
          >
            Apply selected fields
          </V4Button>
        }
      />
    </V4Drawer>
  );
}
