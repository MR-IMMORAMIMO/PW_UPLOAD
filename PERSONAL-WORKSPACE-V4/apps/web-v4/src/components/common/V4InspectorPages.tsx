import { Children, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { V4Pagination } from './V4Pagination';

/** Packs complete inspector sections into the available height without nested scrolling. */
export function V4InspectorPages({ children }: { children: ReactNode }) {
  const sections = useMemo(() => Children.toArray(children), [children]);
  const container = useRef<HTMLDivElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const [groups, setGroups] = useState<number[][]>([]);
  const [page, setPage] = useState(0);
  useLayoutEffect(() => {
    const outer = container.current;
    const body = content.current;
    if (!outer || !body) return;
    const measure = () => {
      // Temporarily reveal the same mounted sections for measurement, then restore their state.
      const nodes = Array.from(body.children) as HTMLElement[];
      const heights = nodes.map((node) => {
        const hidden = node.hidden;
        node.hidden = false;
        const height = node.getBoundingClientRect().height;
        node.hidden = hidden;
        return height;
      });
      if (!outer.clientHeight) return;
      const total = heights.reduce((sum, height) => sum + height, 0);
      const available = Math.max(1, outer.clientHeight - (total > outer.clientHeight ? 44 : 0));
      const next: number[][] = [[]];
      let used = 0;
      heights.forEach((height, index) => {
        if (used + height > available && next[next.length - 1]!.length) {
          next.push([]);
          used = 0;
        }
        next[next.length - 1]!.push(index);
        used += height;
      });
      setGroups((previous) =>
        JSON.stringify(previous) === JSON.stringify(next) ? previous : next,
      );
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(outer);
    return () => observer.disconnect();
  }, [sections]);
  const pages = Math.max(1, groups.length);
  const current = Math.min(page, pages - 1);
  return (
    <div
      ref={container}
      style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}
    >
      <div ref={content} style={{ flex: 1, minHeight: 0 }}>
        {sections.map((section, index) => (
          <div key={index} hidden={groups.length > 0 && !groups[current]?.includes(index)}>
            {section}
          </div>
        ))}
      </div>
      <V4Pagination
        ariaLabel="Inspector pages"
        pageCount={pages}
        currentPage={current}
        onChange={setPage}
      />
    </div>
  );
}
