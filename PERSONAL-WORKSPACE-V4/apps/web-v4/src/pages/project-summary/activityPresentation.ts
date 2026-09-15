import { formatBusinessDateOnly, formatBusinessDateTime } from '../../date-time/businessDateTime';
import { formatProjectStatus } from '../../components/project/statusDisplay';

export function activityDisplayValue(value: string | null): string {
  if (!value?.trim()) return 'Not recorded';
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return formatBusinessDateOnly(value);
  if (/^\d{4}-\d{2}-\d{2}T/.test(value) && Number.isFinite(Date.parse(value)))
    return formatBusinessDateTime(value);
  return activityDisplayText(formatProjectStatus(value));
}
/** Display-only: technical references stay intact in the immutable source audit. */
export function activityDisplayText(text: string): string {
  return text
    .replace(
      /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi,
      'record reference',
    )
    .replace(/\b[0-9a-f]{40,128}\b/gi, 'file fingerprint');
}
export function activityOperation(
  action: string,
): 'add' | 'edit' | 'remove' | 'import' | 'export' | null {
  if (/import/i.test(action)) return 'import';
  if (/export|generat/i.test(action)) return 'export';
  if (/delet|remov|archiv/i.test(action)) return 'remove';
  if (/creat|add/i.test(action)) return 'add';
  if (/updat|edit|chang|correct/i.test(action)) return 'edit';
  return null;
}
