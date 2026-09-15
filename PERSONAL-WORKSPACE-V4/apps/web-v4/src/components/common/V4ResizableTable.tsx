import {
  Children,
  cloneElement,
  isValidElement,
  useLayoutEffect,
  useRef,
  useState,
  type TableHTMLAttributes,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';

type Header = {
  cell: HTMLTableCellElement;
  host: HTMLElement;
  key: string;
  label: string;
  width: number;
  minimum: number;
};
const storageKey = (key: string) => `sct:table-widths:v1:${key}`;
function withResizeHosts(children: ReactNode): ReactNode {
  return Children.map(children, (child) => {
    if (!isValidElement<{ children?: ReactNode }>(child)) return child;
    if (child.type === 'th')
      return cloneElement(
        child,
        {},
        <>
          {child.props.children}
          <span data-resize-host="" />
        </>,
      );
    if (child.type === 'thead' || child.type === 'tr')
      return cloneElement(child, {}, withResizeHosts(child.props.children));
    return child;
  });
}
function readWidths(key: string): Record<string, number> {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(storageKey(key)) ?? '{}');
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
    return Object.fromEntries(
      Object.entries(value).filter(
        (entry): entry is [string, number] =>
          typeof entry[1] === 'number' &&
          Number.isFinite(entry[1]) &&
          entry[1] >= 32 &&
          entry[1] <= 1200,
      ),
    );
  } catch {
    return {};
  }
}

/** Explicit opt-in for data tables. Header controls are portals so existing
 * sort handlers, React-owned cell content and accessible names remain intact. */
export function V4ResizableTable({
  tableKey,
  children,
  style,
  ...props
}: TableHTMLAttributes<HTMLTableElement> & { tableKey: string }) {
  const table = useRef<HTMLTableElement>(null);
  const [headers, setHeaders] = useState<Header[]>([]);
  const [widths, setWidths] = useState<Record<string, number>>(() => readWidths(tableKey));
  const drag = useRef<{ key: string; x: number; width: number } | null>(null);
  useLayoutEffect(() => {
    const cells = [...(table.current?.tHead?.rows[0]?.cells ?? [])];
    const next = cells.flatMap((cell, index) => {
      const host = cell.querySelector<HTMLElement>('[data-resize-host]');
      if (!host) return [];
      const label = [...cell.childNodes]
        .filter((node) => !(node instanceof Element && node.hasAttribute('data-resize-host')))
        .map((node) => node.textContent ?? '')
        .join('')
        .trim();
      return [
        {
          cell,
          host,
          label: label || `Column ${index + 1}`,
          key: cell.dataset.columnKey || label || `utility-${index}`,
          width: Math.max(label ? 72 : 32, cell.getBoundingClientRect().width || 100),
          minimum: label ? 72 : 32,
        },
      ];
    });
    setHeaders((previous) =>
      previous.length === next.length &&
      previous.every(
        (entry, index) => entry.cell === next[index]?.cell && entry.key === next[index]?.key,
      )
        ? previous
        : next,
    );
  }, [children]);
  const persist = (next: Record<string, number>) => {
    setWidths(next);
    try {
      localStorage.setItem(storageKey(tableKey), JSON.stringify(next));
    } catch {
      /* Widths remain usable when browser storage is unavailable. */
    }
  };
  const resize = (header: Header, value: number) =>
    persist({
      ...widths,
      [header.key]: Math.max(header.minimum, Math.min(1200, Math.round(value))),
    });
  const fit = (header: Header, index: number) => {
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d');
    if (!context) return;
    let width = header.minimum;
    for (const row of [...(table.current?.rows ?? [])]) {
      const cell = row.cells[index];
      if (!cell) continue;
      const computed = getComputedStyle(cell);
      context.font = computed.font || '13px sans-serif';
      const content = cell.cloneNode(true) as HTMLElement;
      content.querySelectorAll('.v4-column-resize').forEach((element) => element.remove());
      width = Math.max(
        width,
        ...(content.textContent ?? '')
          .split('\n')
          .map((line) => context.measureText(line.trim()).width + 40),
      );
    }
    resize(header, width);
  };
  const customized = headers.length > 0 && Object.keys(widths).length > 0;
  return (
    <>
      {headers.length > 0 && (
        <button
          className="v4-table-reset"
          type="button"
          disabled={!customized}
          onClick={() => persist({})}
          aria-label={`Reset ${tableKey} column widths`}
        >
          Reset column widths
        </button>
      )}
      <table
        {...props}
        ref={table}
        data-column-widths={customized ? 'custom' : 'auto'}
        style={{
          ...style,
          ...(customized
            ? {
                tableLayout: 'fixed',
                minWidth: '100%',
                width: headers.reduce(
                  (sum, header) => sum + (widths[header.key] ?? header.width),
                  0,
                ),
              }
            : {}),
        }}
      >
        {customized && (
          <colgroup>
            {headers.map((header, index) => (
              <col
                key={`${header.key}-${index}`}
                style={{ width: widths[header.key] ?? header.width }}
              />
            ))}
          </colgroup>
        )}
        {withResizeHosts(
          Children.map(children, (child) =>
            customized && isValidElement(child) && child.type === 'colgroup' ? null : child,
          ),
        )}
      </table>
      {headers.map((header, index) =>
        createPortal(
          <button
            type="button"
            className="v4-column-resize"
            aria-label={`Resize ${header.label} column`}
            title="Drag to resize · Double-click to fit content · Arrow keys to adjust"
            onClick={(event) => event.stopPropagation()}
            onDoubleClick={(event) => {
              event.stopPropagation();
              fit(header, index);
            }}
            onPointerDown={(event) => {
              event.stopPropagation();
              event.preventDefault();
              event.currentTarget.setPointerCapture(event.pointerId);
              drag.current = {
                key: header.key,
                x: event.clientX,
                width: widths[header.key] ?? header.width,
              };
            }}
            onPointerMove={(event) => {
              if (drag.current?.key === header.key)
                resize(header, drag.current.width + event.clientX - drag.current.x);
            }}
            onPointerUp={() => {
              drag.current = null;
            }}
            onLostPointerCapture={() => {
              drag.current = null;
            }}
            onKeyDown={(event) => {
              if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
                event.preventDefault();
                event.stopPropagation();
                resize(
                  header,
                  (widths[header.key] ?? header.width) + (event.key === 'ArrowRight' ? 16 : -16),
                );
              }
              if (event.key === 'Home') {
                event.preventDefault();
                fit(header, index);
              }
            }}
          />,
          header.host,
          `${tableKey}-${header.key}-${index}`,
        ),
      )}
    </>
  );
}
