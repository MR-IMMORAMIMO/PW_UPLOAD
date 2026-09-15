import { C } from '../tokens';

// Shared quality/confidence progress bar + percentage label
// Used by LuminaireLibrary and SmartImport tables

interface QualityBarProps {
  pct: number | null;
  showLabel?: boolean;
}

export function qualityColor(pct: number): string {
  return pct >= 93 ? C.greenRunning : pct >= 88 ? '#f59e0b' : C.red;
}

export default function QualityBar({ pct, showLabel = true }: QualityBarProps) {
  if (pct === null) return <span style={{ color: C.textMuted }}>—</span>;
  const color = qualityColor(pct);
  return (
    <div className="flex items-center gap-1.5">
      {showLabel && (
        <span className="text-[11px] font-semibold" style={{ color: C.text, minWidth: 28 }}>
          {pct}%
        </span>
      )}
      <div
        className="rounded-full overflow-hidden"
        style={{ width: 52, height: 5, background: C.borderLight }}
      >
        <div className="h-full rounded-full" style={{ width: `${pct}%`, background: color }} />
      </div>
    </div>
  );
}
