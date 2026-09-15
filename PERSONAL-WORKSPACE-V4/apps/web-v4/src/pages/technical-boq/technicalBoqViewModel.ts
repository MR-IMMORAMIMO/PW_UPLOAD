import type {
  CanonicalLuminaireSnapshot,
  LuminaireRecord,
  OutputColumnDefinition,
  ScheduleArtifactPresence,
  TechnicalBoqOutputHistoryItem,
} from '@scli/domain';

export type BoqRow = LuminaireRecord | CanonicalLuminaireSnapshot;

export function effectiveBoqColumns(columns: OutputColumnDefinition[]) {
  return [...columns].filter((column) => column.visible).sort((a, b) => a.order - b.order);
}

export function orderedBoqColumns(columns: OutputColumnDefinition[]) {
  return [...columns].sort((a, b) => a.order - b.order);
}

export function boqRowKey(row: BoqRow): string {
  return 'luminaireId' in row ? row.luminaireId : row.id;
}

export function boqCellValue(row: BoqRow, fieldKey: string): string {
  if (fieldKey === 'datasheetPath') return row.datasheetPath.trim() ? 'Available' : '—';
  if (fieldKey === 'attachmentReferences') {
    const count = 'attachmentReferences' in row ? row.attachmentReferences.length : 0;
    return count ? String(count) : '—';
  }
  const value = row[fieldKey as keyof BoqRow];
  if (typeof value === 'number') return value.toLocaleString('en-AE');
  if (typeof value === 'string') return value.trim() || '—';
  return '—';
}

export function formatBoqDateTime(value: string | null): string {
  if (!value) return 'Not available';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Not available';
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Dubai',
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

export function outputAvailabilityLabel(
  item: Pick<TechnicalBoqOutputHistoryItem, 'artifactPresence' | 'output'>,
): string {
  if (item.output.lifecycleState === 'FAILED_RECOVERABLE') return 'Failed · Recoverable';
  if (item.artifactPresence === 'Present') return 'Present';
  if (item.artifactPresence === 'Missing') return 'Missing Artifact';
  return 'Unavailable';
}

export function outputAvailabilityTone(
  item: Pick<TechnicalBoqOutputHistoryItem, 'artifactPresence' | 'output'>,
): 'success' | 'danger' | 'warning' | 'neutral' {
  if (item.output.lifecycleState === 'FAILED_RECOVERABLE') return 'danger';
  if (item.artifactPresence === 'Present') return 'success';
  if (item.artifactPresence === 'Missing') return 'warning';
  return 'neutral';
}

export function latestAvailableBoqOutputId(
  outputs: TechnicalBoqOutputHistoryItem[],
): string | null {
  return (
    outputs.find(
      (item) => item.output.lifecycleState === 'FINALIZED' && item.artifactPresence === 'Present',
    )?.output.outputId ?? null
  );
}

export function artifactAbsolutePath(
  folderPath: string | null | undefined,
  locatorValue: string | null,
): string | null {
  if (!folderPath || !locatorValue) return null;
  const separator = folderPath.includes('\\') ? '\\' : '/';
  const root = folderPath.replace(/[\\/]+$/, '');
  const relative = locatorValue.replace(/^[\\/]+/, '').replace(/[\\/]+/g, separator);
  return `${root}${separator}${relative}`;
}

export function isCoreBoqColumn(column: OutputColumnDefinition): boolean {
  return column.fieldKey === 'tag';
}

export function artifactPresenceLabel(state: ScheduleArtifactPresence): string {
  if (state === 'Present') return 'Present';
  if (state === 'Missing') return 'Missing';
  return 'Unavailable';
}
