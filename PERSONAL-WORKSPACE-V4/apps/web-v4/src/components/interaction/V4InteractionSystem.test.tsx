/** @vitest-environment jsdom */
import { useRef } from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { V4OverlayProvider } from './V4OverlayProvider';
import { V4ModalLayer } from './V4ModalLayer';
import { useV4Presence } from './useV4Presence';

function PresenceHarness({ open, duration = '180ms' }: { open: boolean; duration?: string }) {
  const presence = useV4Presence(open);
  if (!presence.mounted) return null;
  const setPresenceNode = (node: HTMLDivElement | null) => presence.ref(node);
  return (
    <div
      ref={setPresenceNode}
      data-testid="presence"
      data-state={presence.state}
      style={{ transitionDuration: duration }}
      onTransitionEnd={presence.onTransitionEnd}
    />
  );
}

function ModalHarness({
  parentOpen = true,
  childOpen = false,
  parentClose = vi.fn(),
  childClose = vi.fn(),
}) {
  const firstRef = useRef<HTMLButtonElement>(null);
  return (
    <V4OverlayProvider>
      <button type="button" data-testid="background">
        Background
      </button>
      <V4ModalLayer
        open={parentOpen}
        className="parent-layer"
        backdropClassName="parent-backdrop"
        panelClassName="parent-panel"
        initialFocusRef={firstRef}
        onRequestClose={parentClose}
        role="dialog"
        ariaLabel="Parent"
      >
        <button ref={firstRef} type="button">
          First
        </button>
        <button type="button">Last</button>
        <V4ModalLayer
          open={childOpen}
          kind="nested-dialog"
          className="child-layer"
          backdropClassName="child-backdrop"
          panelClassName="child-panel"
          onRequestClose={childClose}
          role="alertdialog"
          ariaLabel="Child"
        >
          <button type="button">Keep open</button>
        </V4ModalLayer>
      </V4ModalLayer>
    </V4OverlayProvider>
  );
}

describe('Phase 3B shared interaction system', () => {
  afterEach(() => {
    document.body.style.removeProperty('overflow');
    document.body.style.removeProperty('padding-right');
  });

  it('keeps exit content mounted, completes from transition authority, and ignores stale exit after reopen', () => {
    const view = render(<PresenceHarness open />);
    view.rerender(<PresenceHarness open={false} />);
    expect(screen.getByTestId('presence')).toHaveAttribute('data-state', 'exiting');
    view.rerender(<PresenceHarness open />);
    fireEvent.transitionEnd(screen.getByTestId('presence'));
    expect(screen.getByTestId('presence')).toBeInTheDocument();
    view.rerender(<PresenceHarness open={false} />);
    fireEvent.transitionEnd(screen.getByTestId('presence'));
    expect(screen.queryByTestId('presence')).not.toBeInTheDocument();
  });

  it('completes zero-duration presence without leaving a zombie surface', () => {
    const view = render(<PresenceHarness open duration="0ms" />);
    view.rerender(<PresenceHarness open={false} duration="0ms" />);
    expect(screen.queryByTestId('presence')).not.toBeInTheDocument();
  });

  it('locks and inerts once, traps focus, and lets one Escape close only the nested layer', () => {
    const parentClose = vi.fn();
    const childClose = vi.fn();
    render(<ModalHarness childOpen parentClose={parentClose} childClose={childClose} />);
    expect(document.body).toHaveStyle({ overflow: 'hidden' });
    expect(screen.getByTestId('background').closest('[inert]')).not.toBeNull();
    expect(document.querySelector('.parent-panel')).toHaveAttribute('inert');
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(childClose).toHaveBeenCalledOnce();
    expect(parentClose).not.toHaveBeenCalled();
  });

  it('contains Tab focus in the top modal', () => {
    render(<ModalHarness />);
    const first = screen.getByRole('button', { name: 'First' });
    const last = screen.getByRole('button', { name: 'Last' });
    act(() => last.focus());
    fireEvent.keyDown(window, { key: 'Tab' });
    expect(first).toHaveFocus();
    act(() => first.focus());
    fireEvent.keyDown(window, { key: 'Tab', shiftKey: true });
    expect(last).toHaveFocus();
  });
});
