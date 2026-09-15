import type { DocumentCategory, ProjectDocument } from '@scli/domain';
import { formatBusinessDateTime } from '../../date-time/businessDateTime';

/**
 * Project Files view model — pure, framework-agnostic.
 *
 * The Files page represents the mutable working-file register (ProjectDocument).
 * It is NOT Revision history, immutable snapshots, generated outputs, or issue
 * packages. Presence is derived from the server-computed `fileCenter` state
 * (Current / Missing / Outdated / NotGenerated) which is the existing authority.
 */

/** User-friendly category labels mapped from canonical persisted values. */
export const documentCategoryLabels: Record<DocumentCategory, string> = {
  Drawing: 'Drawing',
  LuxReport: 'DIALux / Lux Report',
  Visualization: 'Visualization',
  LuminaireSchedule: 'Luminaire Schedule',
  TechnicalBoq: 'Technical BOQ',
  Datasheet: 'Datasheet',
  MeetingMinutes: 'Meeting Minutes',
  CommentResponse: 'Comment Response',
  RevisionRegister: 'Revision Register',
  IssueSummary: 'Issue Summary',
  CoverSheet: 'Cover Sheet',
  Transmittal: 'Transmittal',
  Other: 'Other',
};

export const documentCategoryOptions: Array<{ value: DocumentCategory; label: string }> =
  Object.entries(documentCategoryLabels).map(([value, label]) => ({
    value: value as DocumentCategory,
    label,
  }));

/** Canonical persisted status labels. */
export const documentStatusLabels: Record<ProjectDocument['status'], string> = {
  Working: 'Working',
  InternalReview: 'Internal Review',
  Issued: 'Issued',
  Superseded: 'Superseded',
};

export type FilePresenceState = 'Present' | 'Missing' | 'Outdated' | 'NotGenerated';

/** Presence state for a working-file row, derived from the server fileCenter. */
export interface FileRowPresence {
  state: FilePresenceState;
  note: string;
}

export interface FileRow {
  id: string;
  title: string;
  category: DocumentCategory;
  categoryLabel: string;
  status: ProjectDocument['status'];
  statusLabel: string;
  revision: string;
  documentNumber: string;
  filePath: string;
  fileName: string;
  notes: string;
  issuedTo: string;
  issueDate: string | null;
  updatedAt: string;
  presence: FileRowPresence;
}

/** Extract a display file name from an absolute path. */
export function fileNameFromPath(filePath: string): string {
  const trimmed = filePath.trim();
  if (!trimmed) return '';
  const normalized = trimmed.replace(/\\/g, '/');
  const segments = normalized.split('/');
  return segments[segments.length - 1] ?? trimmed;
}

/**
 * Build the working-file rows for the Files page.
 *
 * `documents` is the mutable ProjectDocument register; `fileCenter` is the
 * server-computed presence authority (Current/Missing/Outdated/NotGenerated).
 * Rows are ordered by most-recently-updated first, matching the register read.
 */
export function buildFileRows(
  documents: readonly ProjectDocument[],
  fileCenter: ReadonlyArray<{
    documentId: string;
    state: 'Current' | 'Outdated' | 'Missing' | 'NotGenerated';
    note: string;
  }>,
): FileRow[] {
  const presenceByDocumentId = new Map(fileCenter.map((item) => [item.documentId, item]));
  return documents.map((document) => {
    const presence = presenceByDocumentId.get(document.id);
    const serverState = presence?.state ?? 'NotGenerated';
    return {
      id: document.id,
      title: document.title,
      category: document.category,
      categoryLabel: documentCategoryLabels[document.category] ?? document.category,
      status: document.status,
      statusLabel: documentStatusLabels[document.status] ?? document.status,
      revision: document.revision,
      documentNumber: document.documentNumber,
      filePath: document.filePath,
      fileName: fileNameFromPath(document.filePath),
      notes: document.notes,
      issuedTo: document.issuedTo,
      issueDate: document.issueDate,
      updatedAt: document.updatedAt,
      presence: {
        state: serverState === 'Current' ? 'Present' : serverState,
        note: presence?.note ?? 'No file has been linked to this register item yet.',
      },
    };
  });
}

export interface FileFilter {
  query: string;
  category: DocumentCategory | '';
  presence: FilePresenceState | '';
}

export function filterFileRows(rows: readonly FileRow[], filter: FileFilter): FileRow[] {
  const query = filter.query.trim().toLowerCase();
  return rows.filter((row) => {
    if (filter.category && row.category !== filter.category) return false;
    if (filter.presence && row.presence.state !== filter.presence) return false;
    if (!query) return true;
    return (
      row.title.toLowerCase().includes(query) ||
      row.fileName.toLowerCase().includes(query) ||
      row.documentNumber.toLowerCase().includes(query)
    );
  });
}

export function presenceOptions(): Array<{ value: FilePresenceState | ''; label: string }> {
  return [
    { value: '', label: 'All states' },
    { value: 'Present', label: 'Present' },
    { value: 'Missing', label: 'Missing' },
    { value: 'Outdated', label: 'Outdated' },
    { value: 'NotGenerated', label: 'No file linked' },
  ];
}

export function formatUpdatedAt(value: string): string {
  return (
    formatBusinessDateTime(value, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: true,
    }) || '—'
  );
}
