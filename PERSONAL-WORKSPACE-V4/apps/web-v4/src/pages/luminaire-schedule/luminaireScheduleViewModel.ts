import type {
  CanonicalLuminaireSnapshot,
  LuminaireRecord,
  OutputColumnDefinition,
  ScheduleArtifactPresence,
  TechnicalScheduleOutputHistoryItem,
} from '@scli/domain';

export type ScheduleRow = LuminaireRecord | CanonicalLuminaireSnapshot;

export function effectiveScheduleColumns(columns: OutputColumnDefinition[]) {
  return [...columns].filter((column) => column.visible).sort((a, b) => a.order - b.order);
}

export function orderedScheduleColumns(columns: OutputColumnDefinition[]) {
  return [...columns].sort((a, b) => a.order - b.order);
}

export function scheduleRowKey(row: ScheduleRow): string {
  return 'luminaireId' in row ? row.luminaireId : row.id;
}

export function scheduleCellValue(row: ScheduleRow, fieldKey: string): string {
  if (fieldKey === 'datasheetPath') return row.datasheetPath.trim() ? 'Available' : '—';
  if (fieldKey === 'attachmentReferences') {
    const count = 'attachmentReferences' in row ? row.attachmentReferences.length : 0;
    return count ? String(count) : '—';
  }
  const value = row[fieldKey as keyof ScheduleRow];
  if (typeof value === 'number') return value.toLocaleString('en-AE');
  if (typeof value === 'string') return value.trim() || '—';
  return '—';
}

export function formatScheduleDateTime(value: string | null): string {
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
  item: Pick<TechnicalScheduleOutputHistoryItem, 'artifactPresence' | 'output'>,
): string {
  if (item.output.lifecycleState === 'FAILED_RECOVERABLE') return 'Failed · Recoverable';
  if (item.artifactPresence === 'Present') return 'Available';
  if (item.artifactPresence === 'Missing') return 'Missing Artifact';
  return 'Unavailable';
}

export function outputAvailabilityTone(
  item: Pick<TechnicalScheduleOutputHistoryItem, 'artifactPresence' | 'output'>,
): 'success' | 'danger' | 'warning' | 'neutral' {
  if (item.output.lifecycleState === 'FAILED_RECOVERABLE') return 'danger';
  if (item.artifactPresence === 'Present') return 'success';
  if (item.artifactPresence === 'Missing') return 'warning';
  return 'neutral';
}

export function latestAvailableOutputId(
  outputs: TechnicalScheduleOutputHistoryItem[],
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

export function isCoreScheduleColumn(column: OutputColumnDefinition): boolean {
  return column.fieldKey === 'tag';
}

export function artifactPresenceLabel(state: ScheduleArtifactPresence): string {
  if (state === 'Present') return 'Present';
  if (state === 'Missing') return 'Missing';
  return 'Unavailable';
}
