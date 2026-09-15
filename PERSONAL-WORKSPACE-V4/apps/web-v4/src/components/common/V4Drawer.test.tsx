/** @vitest-environment jsdom */
/**
 * V4Drawer behavioral tests (PW-V4-F3-P1-H1).
 *
 * Proves the reusable accessible drawer primitive:
 *   A. renders as dialog when open
 *   B. receives focus on open
 *   C. Escape closes it
 *   D. explicit close control closes it
 *   E. previous focused element is restored after close
 *   F. accessible name/label remains present
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { cleanupV4 } from '../../test-utils/renderV4';
import { V4Drawer } from './V4Drawer';

function renderDrawer(open = true, onClose = vi.fn()) {
  return {
    onClose,
    ...render(
      <div>
        <button type="button" data-testid="trigger">
          Open drawer
        </button>
        <V4Drawer
          open={open}
          title="Attention"
          description="Review the items that need your attention."
          onClose={onClose}
        >
          <p>Drawer content</p>
        </V4Drawer>
      </div>,
    ),
  };
}

describe('V4Drawer', () => {
  afterEach(() => {
    cleanupV4();
  });

  it('A: renders as a dialog when open, with accessible name (F)', () => {
    renderDrawer();
    const dialog = screen.getByRole('dialog', { name: 'Attention' });
    expect(dialog).toBeInTheDocument();
    expect(screen.getByTestId('v4-drawer')).toBeInTheDocument();
    expect(screen.getByText('Drawer content')).toBeInTheDocument();
    expect(screen.getByText('Review the items that need your attention.')).toBeInTheDocument();
  });

  it('A: renders nothing when closed', () => {
    renderDrawer(false);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.queryByTestId('v4-drawer')).not.toBeInTheDocument();
  });

  it('B: receives focus on open', () => {
    renderDrawer();
    const dialog = screen.getByRole('dialog');
    expect(document.activeElement).toBe(dialog);
  });

  it('B: does not refocus the panel when its close callback changes while open', () => {
    const { rerender } = render(
      <V4Drawer open title="Attention" onClose={() => undefined}>
        <input aria-label="Drawer input" />
      </V4Drawer>,
    );
    const input = screen.getByLabelText('Drawer input');
    input.focus();

    rerender(
      <V4Drawer open title="Attention" onClose={() => undefined}>
        <input aria-label="Drawer input" />
      </V4Drawer>,
    );

    expect(document.activeElement).toBe(input);
  });

  it('keeps continuous typing and deletion focus inside a controlled drawer field', async () => {
    const user = userEvent.setup();
    render(
      <V4Drawer open title="Edit" onClose={vi.fn()}>
        <input aria-label="Name" defaultValue="Alpha" />
      </V4Drawer>,
    );
    const input = screen.getByRole('textbox', { name: 'Name' });
    await user.click(input);
    await user.keyboard('{Control>}a{/Control}Beta{Backspace}a');
    expect(input).toHaveValue('Beta');
    expect(input).toHaveFocus();
  });

  it('C: Escape closes the drawer', () => {
    const { onClose } = renderDrawer();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('D: explicit close control closes it', () => {
    const { onClose } = renderDrawer();
    fireEvent.click(screen.getByTestId('v4-drawer').querySelector('.v4-drawer__close') as Element);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('D: backdrop click closes it', () => {
    const { onClose } = renderDrawer();
    fireEvent.click(screen.getByTestId('v4-drawer-backdrop'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('E: restores focus to the previously focused element after close', () => {
    // The consumer focuses an element, then opens the drawer.
    const trigger = document.createElement('button');
    document.body.appendChild(trigger);
    trigger.focus();
    expect(document.activeElement).toBe(trigger);

    const { rerender } = renderDrawer();
    // Focus is now on the dialog panel.
    expect(document.activeElement).toBe(screen.getByRole('dialog'));

    rerender(
      <div>
        <button type="button" data-testid="trigger">
          Open drawer
        </button>
        <V4Drawer open={false} title="Attention" onClose={() => undefined}>
          <p>Drawer content</p>
        </V4Drawer>
      </div>,
    );
    // Cleanup effect restores focus to the trigger captured on open.
    expect(document.activeElement).toBe(trigger);
    trigger.remove();
  });
});
