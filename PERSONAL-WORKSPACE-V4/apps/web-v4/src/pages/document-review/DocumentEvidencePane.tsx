import type { DocumentExtractionValueRead, IntelligenceDocumentRead } from '@scli/contracts';

export interface DocumentPreview {
  pageNumber: number;
  width: number;
  height: number;
  pngBase64: string;
}

export function DocumentEvidencePane({
  document,
  preview,
  evidence,
}: {
  document: IntelligenceDocumentRead | null;
  preview: DocumentPreview | null;
  evidence: DocumentExtractionValueRead[];
}) {
  if (!document) {
    return (
      <section className="document-review__evidence document-review__empty" aria-label="Evidence">
        <p>Select a document to review its source-backed evidence.</p>
      </section>
    );
  }
  return (
    <section className="document-review__evidence" aria-label="Evidence">
      <header>
        <div>
          <span className="document-review__eyebrow">Evidence workspace</span>
          <h2>{document.originalFileName}</h2>
        </div>
        <span className="document-review__page-label">Page {preview?.pageNumber ?? 1}</span>
      </header>
      <div className="document-review__preview">
        {preview ? (
          <img
            src={`data:image/png;base64,${preview.pngBase64}`}
            alt={`Bounded evidence preview, page ${preview.pageNumber}`}
          />
        ) : (
          <div className="document-review__preview-placeholder">
            Preview becomes available after the PDF parser opens page 1.
          </div>
        )}
      </div>
      <div className="document-review__values" aria-label="Extracted values">
        {evidence.length ? (
          evidence.slice(0, 30).map((value) => (
            <article key={value.id}>
              <div>
                <strong>{value.canonicalField.replaceAll('_', ' ')}</strong>
                <span>
                  Page {value.pageNumber} · {value.method} · {Math.round(value.confidence)}%
                </span>
              </div>
              <p>{String(value.normalizedValue ?? value.rawValue).slice(0, 500)}</p>
            </article>
          ))
        ) : (
          <p className="document-review__muted">No extracted evidence is available yet.</p>
        )}
      </div>
    </section>
  );
}
