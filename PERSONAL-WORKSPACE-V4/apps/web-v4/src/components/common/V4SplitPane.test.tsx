/** @vitest-environment jsdom */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { V4SplitPane } from './V4SplitPane';

function renderPane(collapsed = false) {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      constructor(private readonly callback: ResizeObserverCallback) {}
      observe(target: Element) {
        this.callback([{ target, contentRect: { width: 1200 } } as ResizeObserverEntry], this);
      }
      disconnect() {}
      unobserve() {}
    },
  );
  render(
    <V4SplitPane
      collapsed={collapsed}
      timeline={<div>Timeline</div>}
      inspector={<div>Inspector</div>}
    />,
  );
  const pane = screen.getByTestId('v4-split-pane');
  Object.defineProperty(pane, 'getBoundingClientRect', { value: () => ({ left: 0, width: 1200 }) });
  return pane;
}

describe('V4SplitPane', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('starts at the owner-locked approximately 66/34 ratio with an accessible separator', () => {
    const pane = renderPane();
    expect(
      screen.getByRole('slider', { name: 'Resize timeline and event details' }),
    ).toHaveAttribute('aria-valuenow', '66');
    expect(pane.style.gridTemplateColumns).toBe('');
    expect(pane.style.getPropertyValue('--v4-split-timeline-ratio')).toBe('66fr');
    expect(pane.style.getPropertyValue('--v4-split-inspector-ratio')).toBe('34fr');
  });

  it('supports keyboard resize and a double-click reset', () => {
    renderPane();
    const separator = screen.getByRole('slider');
    fireEvent.keyDown(separator, { key: 'ArrowLeft' });
    expect(separator).toHaveAttribute('aria-valuenow', '64');
    fireEvent.keyDown(separator, { key: 'ArrowRight' });
    fireEvent.doubleClick(separator);
    expect(separator).toHaveAttribute('aria-valuenow', '66');
  });

  it('clamps pointer drag to the safe inspector and timeline bounds', () => {
    renderPane();
    const separator = screen.getByRole('slider');
    fireEvent.pointerDown(separator, { pointerId: 1, clientX: 1 });
    fireEvent.pointerMove(separator, { pointerId: 1, clientX: 1199 });
    fireEvent.pointerUp(separator, { pointerId: 1, clientX: 1199 });
    expect(Number(separator.getAttribute('aria-valuenow'))).toBeGreaterThanOrEqual(55);
    expect(Number(separator.getAttribute('aria-valuenow'))).toBeLessThanOrEqual(73);
  });

  it('cleans up pointer ownership when the browser cancels a drag', () => {
    renderPane();
    const separator = screen.getByRole('slider') as HTMLDivElement;
    Object.assign(separator, {
      hasPointerCapture: vi.fn(() => true),
      releasePointerCapture: vi.fn(() => {
        throw new Error('already released');
      }),
    });
    fireEvent.pointerDown(separator, { pointerId: 1, clientX: 600 });
    expect(screen.getByTestId('v4-split-pane')).toHaveClass('v4-split-pane--dragging');
    expect(() => fireEvent.pointerCancel(separator, { pointerId: 1 })).not.toThrow();
    expect(screen.getByTestId('v4-split-pane')).not.toHaveClass('v4-split-pane--dragging');
  });

  it('mounts safely without ResizeObserver and keeps slider ARIA valid', () => {
    vi.unstubAllGlobals();
    render(
      <V4SplitPane
        collapsed={false}
        timeline={<div>Timeline</div>}
        inspector={<div>Inspector</div>}
      />,
    );
    const separator = screen.getByRole('slider');
    expect(Number(separator.getAttribute('aria-valuenow'))).toBeGreaterThanOrEqual(
      Number(separator.getAttribute('aria-valuemin')),
    );
    expect(Number(separator.getAttribute('aria-valuenow'))).toBeLessThanOrEqual(
      Number(separator.getAttribute('aria-valuemax')),
    );
  });

  it('keeps the narrow stack rule and hidden splitter in the stylesheet contract', async () => {
    const stylesheet = readFileSync(
      fileURLToPath(await import.meta.resolve('../../styles-v4.css')),
      'utf8',
    );
    expect(stylesheet).toMatch(
      /grid-template-columns: minmax\(0, var\(--v4-split-timeline-ratio, 66fr\)\) 16px minmax\(\s*320px,\s*var\(--v4-split-inspector-ratio, 34fr\)\s*\);/,
    );
    expect(stylesheet).toMatch(
      /@media \(max-width: 1060px\) \{[\s\S]*?\.v4-split-pane \{\s*grid-template-columns: minmax\(0, 1fr\);[\s\S]*?\.v4-split-pane__separator \{\s*display: none;/,
    );
  });

  it('removes the inspector and separator when collapsed', () => {
    renderPane(true);
    expect(screen.getByText('Timeline')).toBeInTheDocument();
    expect(screen.queryByRole('slider')).not.toBeInTheDocument();
    expect(screen.queryByText('Inspector')).not.toBeInTheDocument();
  });
});
