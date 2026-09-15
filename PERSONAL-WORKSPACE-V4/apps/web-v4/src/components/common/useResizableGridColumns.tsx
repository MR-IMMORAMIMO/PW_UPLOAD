import { useRef, useState, type CSSProperties } from 'react';

export function useResizableGridColumns(key: string, defaults: number[]) {
  const storage = `sct:grid-widths:v1:${key}`;
  const [widths, setWidths] = useState<number[] | null>(() => {
    try {
      const parsed: unknown = JSON.parse(localStorage.getItem(storage) ?? 'null');
      return Array.isArray(parsed) &&
        parsed.length === defaults.length &&
        parsed.every((n) => typeof n === 'number' && n >= 20 && n <= 1200)
        ? parsed
        : null;
    } catch {
      return null;
    }
  });
  const drag = useRef<{ x: number; width: number } | null>(null);
  const save = (next: number[] | null) => {
    setWidths(next);
    try {
      localStorage.setItem(storage, JSON.stringify(next));
    } catch {
      /* Session-only resizing remains available. */
    }
  };
  const resize = (index: number, size: number) => {
    const next = [...(widths ?? defaults)];
    next[index] = Math.max(Math.min(defaults[index] ?? 72, 72), Math.min(1200, size));
    save(next);
  };
  const reset = (
    <button type="button" className="v4-table-reset" disabled={!widths} onClick={() => save(null)}>
      Reset column widths
    </button>
  );
  const handle = (index: number, label: string) => (
    <button
      type="button"
      className="v4-column-resize"
      aria-label={`Resize ${label} column`}
      title="Drag or use arrow keys to resize. Double-click to fit."
      onClick={(e) => e.stopPropagation()}
      onPointerDown={(e) => {
        e.preventDefault();
        e.stopPropagation();
        e.currentTarget.setPointerCapture(e.pointerId);
        drag.current = {
          x: e.clientX,
          width:
            widths?.[index] ??
            e.currentTarget.parentElement?.getBoundingClientRect().width ??
            defaults[index]!,
        };
      }}
      onPointerMove={(e) => {
        if (drag.current) resize(index, drag.current.width + e.clientX - drag.current.x);
      }}
      onPointerUp={() => {
        drag.current = null;
      }}
      onLostPointerCapture={() => {
        drag.current = null;
      }}
      onKeyDown={(e) => {
        if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
          e.preventDefault();
          e.stopPropagation();
          resize(
            index,
            (widths?.[index] ?? defaults[index]!) + (e.key === 'ArrowRight' ? 16 : -16),
          );
        }
      }}
      onDoubleClick={(e) => {
        e.stopPropagation();
        const container = e.currentTarget.closest('[data-resizable-grid]');
        const canvas = document.createElement('canvas');
        const context = canvas.getContext('2d');
        if (!context || !container) return;
        let size = 72;
        for (const row of container.querySelectorAll('[data-resizable-row]')) {
          const cell = row.children[index];
          if (!(cell instanceof HTMLElement)) continue;
          context.font = getComputedStyle(cell).font || '13px sans-serif';
          size = Math.max(size, context.measureText(cell.textContent ?? '').width + 40);
        }
        resize(index, size);
      }}
    />
  );
  const style: CSSProperties = widths
    ? {
        gridTemplateColumns: widths.map((width) => `${width}px`).join(' '),
        minWidth: widths.reduce((sum, width) => sum + width, 0) + 100,
      }
    : {};
  return { style, reset, handle };
}
