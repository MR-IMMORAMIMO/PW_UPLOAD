import type { ReactNode } from 'react';

export type V4PaginationToken = number | 'ellipsis';

/** Deterministic, presentation-only token engine. Pages retain their own state and page size. */
export function v4PaginationTokens(pageCount: number, currentPage: number): V4PaginationToken[] {
  if (pageCount <= 0) return [];
  if (pageCount <= 7) return Array.from({ length: pageCount }, (_, index) => index);
  const current = Math.max(0, Math.min(currentPage, pageCount - 1));
  const start = Math.max(1, Math.min(current - 2, pageCount - 6));
  const middle = Array.from({ length: 5 }, (_, index) => start + index);
  return [
    0,
    ...(middle[0]! > 1 ? (['ellipsis'] as const) : []),
    ...middle,
    ...(middle.at(-1)! < pageCount - 2 ? (['ellipsis'] as const) : []),
    pageCount - 1,
  ];
}

export interface V4PaginationProps {
  pageCount: number;
  currentPage: number;
  onChange: (page: number) => void;
  ariaLabel: string;
  /** Converts the internal zero-based page number to caller display text. */
  pageLabel?: (page: number) => ReactNode;
}

export function V4Pagination({
  pageCount,
  currentPage,
  onChange,
  ariaLabel,
  pageLabel = (page) => page + 1,
}: V4PaginationProps) {
  if (pageCount < 2) return null;
  const current = Math.max(0, Math.min(currentPage, pageCount - 1));
  return (
    <nav className="v4-pagination" aria-label={ariaLabel}>
      <button
        type="button"
        aria-label="Previous page"
        disabled={current === 0}
        onClick={() => onChange(current - 1)}
      >
        ‹
      </button>
      {v4PaginationTokens(pageCount, current).map((token, index) =>
        token === 'ellipsis' ? (
          <span key={`ellipsis-${index}`} className="v4-pagination__ellipsis" aria-hidden="true">
            …
          </span>
        ) : (
          <button
            key={token}
            type="button"
            aria-current={token === current ? 'page' : undefined}
            aria-label={`Page ${token + 1} of ${pageCount}`}
            onClick={() => onChange(token)}
          >
            {pageLabel(token)}
          </button>
        ),
      )}
      <button
        type="button"
        aria-label="Next page"
        disabled={current === pageCount - 1}
        onClick={() => onChange(current + 1)}
      >
        ›
      </button>
    </nav>
  );
}
