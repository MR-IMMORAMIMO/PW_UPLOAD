import { useId } from 'react';
import { V4FilterSelect } from './V4FilterSelect';

// Suggestions only: existing and custom values remain unchanged in canonical fields.
export const luminaireChoices = {
  category: [
    'Downlight',
    'Spotlight',
    'Linear',
    'Track Light',
    'Wall Light',
    'Pendant',
    'Panel',
    'Floodlight',
    'Bollard',
    'In-ground',
    'Underwater',
    'Exit Sign',
  ],
  mounting: [
    'Ceiling Recessed',
    'Wall Recessed',
    'Floor Recessed',
    'Surface-mounted',
    'Suspended',
    'Track-mounted',
    'Pole-mounted',
    'Ground-recessed',
    'Recessed',
    'Semi-Recessed',
    'Surface Mounted',
    'Pendant / Suspended',
    'Track Mounted',
    'Wall Mounted',
    'Ceiling Mounted',
    'Floor Mounted',
    'Ground Recessed / In-ground',
    'Pole Mounted',
    'Bollard',
    'Underwater',
    'Joinery / Furniture Mounted',
  ],
  control: [
    'On/Off',
    'DALI',
    'DALI-2',
    '0–10V',
    '1–10V',
    'Phase-cut',
    'Push Dim',
    'Casambi',
    'DMX',
    'KNX',
  ],
  emergency: [
    'Non-emergency',
    'Integral Battery',
    'Central Battery',
    'No',
    'Self-Contained',
    'Maintained',
    'Non-Maintained',
  ],
} as const;

export function LuminaireChoiceField({
  label,
  value,
  kind,
  onChange,
  disabled = false,
}: {
  disabled?: boolean;
  label: string;
  value: string;
  kind: keyof typeof luminaireChoices;
  onChange: (value: string) => void;
}) {
  const id = useId();
  return (
    <div className="v4-luminaire-choice">
      <label htmlFor={id}>{label}</label>
      <div style={{ display: 'flex', gap: 6, minWidth: 0 }}>
        <input
          disabled={disabled}
          id={id}
          value={value}
          placeholder="Select or enter custom"
          onChange={(event) => onChange(event.target.value)}
          style={{ minWidth: 0, flex: 1 }}
        />
        <V4FilterSelect
          disabled={disabled}
          label={`${label} choices`}
          value={value}
          searchable
          options={[
            { value: '', label: 'Not specified' },
            ...[...new Set<string>([...luminaireChoices[kind], ...(value ? [value] : [])])].map(
              (item) => ({ value: item, label: item }),
            ),
          ]}
          onChange={onChange}
          triggerStyle={{ maxWidth: 160 }}
        />
      </div>
    </div>
  );
}
