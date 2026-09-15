import { Children, useEffect, useRef, useState, type ReactNode } from 'react';
import { V4Pagination } from './V4Pagination';

/** Bounded list pages resize with the window instead of nesting a scrollbar. */
export function V4PagedRows({
  children,
  label,
  bounded = false,
}: {
  children: ReactNode;
  label: string;
  bounded?: boolean;
}) {
  const container = useRef<HTMLDivElement>(null);
  const [page, setPage] = useState(0);
  const [height, setHeight] = useState(() => window.innerHeight);
  const [capacity, setCapacity] = useState(2);
  useEffect(() => {
    const node = container.current;
    if (!bounded || !node || typeof ResizeObserver === 'undefined') return;
    const measure = () => {
      const rowHeight = node.firstElementChild?.getBoundingClientRect().height || 60;
      setCapacity(Math.max(1, Math.floor((node.clientHeight - 48) / rowHeight)));
    };
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    measure();
    return () => observer.disconnect();
  }, [bounded]);
  useEffect(() => {
    const resize = () => setHeight(window.innerHeight);
    window.addEventListener('resize', resize);
    return () => window.removeEventListener('resize', resize);
  }, []);
  const rows = Children.toArray(children);
  const size = bounded ? capacity : Math.max(2, Math.min(8, Math.floor((height - 520) / 80)));
  const pages = Math.max(1, Math.ceil(rows.length / size));
  const current = Math.min(page, pages - 1);
  return (
    <div
      ref={container}
      className="v4-paged-rows"
      style={bounded ? { height: '100%', minHeight: 0 } : undefined}
    >
      {rows.slice(current * size, current * size + size)}
      <V4Pagination ariaLabel={label} pageCount={pages} currentPage={current} onChange={setPage} />
    </div>
  );
}
