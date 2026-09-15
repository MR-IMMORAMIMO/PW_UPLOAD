import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { V4Button } from '../common/V4Button';
import { ChevronLeft, ChevronRight } from '../common/SctIcons';

export function AdaptiveScopeCard({
  title,
  icon,
  rows,
  action,
}: {
  title: string;
  icon: ReactNode;
  rows: ReactNode[];
  action?: ReactNode;
}) {
  const body = useRef<HTMLDivElement>(null);
  const flow = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(1);
  const [total, setTotal] = useState(1);
  const [page, setPage] = useState(1);
  useLayoutEffect(() => {
    const element = body.current;
    if (!element) return;
    const resize = () => {
      if (element.clientWidth > 0) setWidth(element.clientWidth);
    };
    resize();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(resize);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  useLayoutEffect(() => {
    const element = flow.current;
    if (!element) return;
    const measure = () => setTotal(Math.max(1, Math.ceil(element.scrollWidth / width)));
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    for (const child of element.children) observer.observe(child);
    return () => observer.disconnect();
  }, [rows, width]);
  const current = Math.min(page, total);
  return (
    <section
      aria-label={title}
      style={{
        minWidth: 0,
        minHeight: 0,
        display: 'flex',
        flexDirection: 'column',
        padding: 16,
        border: '1px solid var(--v4-border-control)',
        borderRadius: 10,
        background: 'var(--v4-surface-raised)',
      }}
    >
      <header
        style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10, flexShrink: 0 }}
      >
        {icon}
        <h2 style={{ fontSize: 15, flex: 1, margin: 0 }}>{title}</h2>
        {action}
      </header>
      <div ref={body} style={{ flex: 1, minHeight: 72, overflow: 'hidden' }}>
        <div
          ref={flow}
          style={{
            height: '100%',
            width: '100%',
            columnWidth: width,
            columnGap: 0,
            columnFill: 'auto',
            transform: `translateX(-${(current - 1) * width}px)`,
          }}
        >
          {rows.length ? (
            rows.map((row, index) => (
              <div
                key={index}
                style={{
                  breakInside: 'avoid',
                  paddingRight: 12,
                  paddingBottom: 12,
                  overflowWrap: 'anywhere',
                }}
                onFocus={(event) => {
                  const bounds = event.currentTarget.getBoundingClientRect();
                  const viewport = body.current?.getBoundingClientRect();
                  if (viewport && (bounds.left < viewport.left || bounds.left >= viewport.right))
                    setPage(
                      Math.max(
                        1,
                        Math.min(
                          total,
                          current + Math.round((bounds.left - viewport.left) / width),
                        ),
                      ),
                    );
                }}
              >
                {row}
              </div>
            ))
          ) : (
            <p>No {title.toLowerCase()} recorded.</p>
          )}
        </div>
      </div>
      <nav
        aria-label={`${title} pages`}
        style={{ display: 'flex', alignItems: 'center', gap: 6, paddingTop: 8, flexShrink: 0 }}
      >
        <V4Button
          size="compact"
          disabled={current === 1}
          onClick={() => setPage(current - 1)}
          aria-label={`Previous ${title} page`}
        >
          <ChevronLeft aria-hidden="true" />
        </V4Button>
        {Array.from({ length: total }, (_, i) => i + 1)
          .filter((n) => n === 1 || n === total || Math.abs(n - current) <= 1)
          .map((n, index, visible) => (
            <span key={n}>
              {index > 0 && n - visible[index - 1]! > 1 ? '… ' : null}
              <V4Button
                size="compact"
                variant={n === current ? 'primary' : 'secondary'}
                aria-current={n === current ? 'page' : undefined}
                onClick={() => setPage(n)}
              >
                {n}
              </V4Button>
            </span>
          ))}
        <V4Button
          size="compact"
          disabled={current === total}
          onClick={() => setPage(current + 1)}
          aria-label={`Next ${title} page`}
        >
          <ChevronRight aria-hidden="true" />
        </V4Button>
        <span style={{ marginLeft: 'auto', fontSize: 11 }}>{rows.length} items</span>
      </nav>
    </section>
  );
}
