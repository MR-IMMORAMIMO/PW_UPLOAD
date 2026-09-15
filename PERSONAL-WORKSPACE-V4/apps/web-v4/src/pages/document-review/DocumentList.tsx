import type { IntelligenceDocumentRead } from '@scli/contracts';
import { V4StatusPill } from '../../components/common/V4StatusPill';

const label = (value: string) =>
  value
    .toLowerCase()
    .replaceAll('_', ' ')
    .replace(/\b\w/g, (letter) => letter.toUpperCase());

export function DocumentList({
  items,
  selectedId,
  onSelect,
}: {
  items: IntelligenceDocumentRead[];
  selectedId: string | null;
  onSelect: (document: IntelligenceDocumentRead) => void;
}) {
  return (
    <ul className="document-review__list" aria-label="Document review queue">
      {items.map((document) => (
        <li key={document.id} className="document-review__item">
          <button
            type="button"
            className="document-review__row"
            data-selected={document.id === selectedId}
            onClick={() => onSelect(document)}
          >
            <span className="document-review__row-title">{document.originalFileName}</span>
            <span className="document-review__row-meta">
              <V4StatusPill
                variant={
                  document.associationState === 'CONFLICTING'
                    ? 'critical'
                    : document.associationState === 'CONFIRMED'
                      ? 'success'
                      : 'warning'
                }
              >
                {label(document.associationState)}
              </V4StatusPill>
              <span>{label(document.classification)}</span>
            </span>
            <span className="document-review__row-summary">
              {label(document.processingState)} · {document.blockingFindings} blocking ·{' '}
              {document.warningFindings} warnings
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}
