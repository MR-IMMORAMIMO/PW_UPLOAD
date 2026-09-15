import { useState } from 'react';
import type { ImportRowRead } from '@scli/contracts';
import { compareTechnicalValue } from '@scli/domain';
import { V4Drawer } from '../../components/common/V4Drawer';
import { V4Button } from '../../components/common/V4Button';

const fields = [
  ['wattage', 'WATTAGE', 'Power'],
  ['lumens', 'LUMENS', 'Lumens'],
  ['lightColor', 'CCT', 'Colour temperature'],
  ['cri', 'CRI', 'CRI'],
  ['beamAngle', 'BEAM_OPTIC', 'Beam angle'],
  ['ipRating', 'IP', 'IP rating'],
  ['mounting', 'MOUNTING', 'Mounting'],
  ['cutout', 'CUTOUT', 'Cutout'],
  ['driver', 'DRIVER', 'Driver'],
  ['control', 'CONTROL', 'Control'],
  ['emergency', 'EMERGENCY', 'Emergency'],
  ['dimensions', 'DIMENSIONS', 'Dimensions'],
  ['bodyColorFinish', 'BODY_COLOR_FINISH', 'Body colour / finish'],
] as const;

export function ImportLibraryComparison({ row }: { row: ImportRowRead }) {
  const [open, setOpen] = useState(false);
  const match =
    row.reconciliation?.schemaVersion === 2 ? row.reconciliation.variant.exactMatch : null;
  if (!match)
    return (
      <p>
        No exact existing variant to compare. Review the proposed values before creating a draft.
      </p>
    );
  const rows = fields.map(([field, canonical, label]) => {
    const evidence = row.normalizationEvidence.find((item) => item.canonicalField === canonical);
    const raw = evidence?.normalizedValue;
    let imported =
      evidence?.success === true && (typeof raw === 'string' || typeof raw === 'number')
        ? String(raw)
        : '';
    let needsReview = evidence?.success === false;
    if (imported && typeof raw === 'number' && (field === 'wattage' || field === 'lumens')) {
      const basis = evidence?.basis ?? evidence?.unit;
      const unit =
        field === 'wattage'
          ? basis === 'W_PER_M' || basis === 'W/m'
            ? 'W/m'
            : basis === 'W'
              ? 'W'
              : null
          : basis === 'LM_PER_M' || basis === 'lm/m'
            ? 'lm/m'
            : basis === 'LM' || basis === 'lm'
              ? 'lm'
              : null;
      imported += unit ? ` ${unit}` : ' (unit needs review)';
      needsReview ||= unit === null;
    }
    const current = match.technical[field];
    return {
      label,
      current,
      imported,
      status: needsReview ? 'Review required' : compareTechnicalValue(field, current, imported),
    };
  });
  const reconciliation = row.reconciliation?.schemaVersion === 2 ? row.reconciliation : null;
  const metadata = [
    ['Manufacturer', match.manufacturerName, reconciliation?.manufacturer.name],
    ['Product family', match.productName, reconciliation?.product.family],
    ['Product type', match.productType, reconciliation?.product.productType.resolvedValue],
    ['Description', match.productDescription, reconciliation?.product.description.resolvedValue],
  ].map(([label, current, imported]) => ({
    label,
    current,
    imported,
    status: !imported
      ? 'Not provided — preserve existing'
      : current?.trim().toLowerCase() === imported.trim().toLowerCase()
        ? 'Same'
        : 'Different',
  }));
  return (
    <>
      <V4Button onClick={() => setOpen(true)}>View Comparison</V4Button>
      <V4Drawer
        open={open}
        presentation="float"
        title="Existing and imported values"
        onClose={() => setOpen(false)}
        description={`${match.manufacturerName} · ${match.productName} · ${match.orderingCode}`}
        footer={<V4Button onClick={() => setOpen(false)}>Close</V4Button>}
      >
        <p>
          Blank imported fields preserve existing values. Formatting differences do not change the
          specification. Published versions remain unchanged.
        </p>
        <table className="v4-imports__comparison-table" aria-label="Library technical comparison">
          <thead>
            <tr>
              <th>Field</th>
              <th>Existing</th>
              <th>Imported</th>
              <th>Comparison</th>
            </tr>
          </thead>
          <tbody>
            {[...metadata, ...rows].map((item) => (
              <tr key={item.label}>
                <th scope="row">{item.label}</th>
                <td>{item.current || '—'}</td>
                <td>{item.imported || '—'}</td>
                <td>{item.status}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </V4Drawer>
    </>
  );
}
