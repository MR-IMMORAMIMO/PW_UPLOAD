/** @vitest-environment jsdom */
import { useState } from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createMemoryRouter, Link, RouterProvider, useLocation } from 'react-router-dom';
import { V4OverlayProvider } from './V4OverlayProvider';
import { V4DirtyGuardProvider, useV4DirtySurface } from './V4DirtyGuard';

function DirtySurface({ onRequest }: { onRequest: (reason: string) => void }) {
  const [decision, setDecision] = useState<{
    proceed: () => void;
    cancel: () => void;
  } | null>(null);
  const [draft, setDraft] = useState('Unsaved lighting notes');
  useV4DirtySurface(true, (reason, proceed, cancel) => {
    onRequest(reason);
    setDecision({ proceed, cancel });
  });
  return (
    <>
      <Link to="/next">Navigate</Link>
      <label>
        Draft
        <input value={draft} onChange={(event) => setDraft(event.target.value)} />
      </label>
      {decision ? (
        <>
          <button
            type="button"
            onClick={() => {
              const proceed = decision.proceed;
              setDecision(null);
              proceed();
            }}
          >
            Discard and continue
          </button>
          <button
            type="button"
            onClick={() => {
              const cancel = decision.cancel;
              setDecision(null);
              cancel();
            }}
          >
            Keep editing
          </button>
        </>
      ) : null}
    </>
  );
}

function LocationProbe() {
  return <output aria-label="Current route">{useLocation().pathname}</output>;
}

function Harness({ onRequest }: { onRequest: (reason: string) => void }) {
  const router = createMemoryRouter(
    [
      {
        path: '*',
        element: (
          <V4DirtyGuardProvider>
            <DirtySurface onRequest={onRequest} />
            <LocationProbe />
          </V4DirtyGuardProvider>
        ),
      },
    ],
    { initialEntries: ['/'] },
  );
  return (
    <V4OverlayProvider>
      <RouterProvider router={router} />
    </V4OverlayProvider>
  );
}

describe('V4 dirty navigation authority', () => {
  afterEach(() => {
    delete window.scliDesktop;
  });

  it('intercepts routed links and delegates the discard decision to the dirty surface', async () => {
    const onRequest = vi.fn();
    render(<Harness onRequest={onRequest} />);
    fireEvent.click(screen.getByRole('link', { name: 'Navigate' }));
    await screen.findByRole('button', { name: 'Discard and continue' });
    expect(onRequest).toHaveBeenCalledWith('route-change');
    expect(screen.getByLabelText('Current route')).toHaveTextContent('/');
    expect(screen.getByRole('button', { name: 'Discard and continue' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Discard and continue' }));
    expect(await screen.findByLabelText('Current route')).toHaveTextContent('/next');
  });

  it('uses beforeunload only while a dirty surface is registered', () => {
    render(<Harness onRequest={vi.fn()} />);
    const event = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
  });

  it('answers the desktop close handshake only after the shared discard policy proceeds', () => {
    const closeRequested: Array<() => void> = [];
    const respondToClose = vi.fn();
    window.scliDesktop = {
      onCloseRequested: (listener) => {
        closeRequested.push(listener);
        return () => {
          closeRequested.length = 0;
        };
      },
      respondToClose,
    };
    const onRequest = vi.fn();
    render(<Harness onRequest={onRequest} />);
    act(() => closeRequested[0]?.());
    expect(onRequest).toHaveBeenCalledWith('desktop-close');
    expect(respondToClose).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Discard and continue' }));
    expect(respondToClose).toHaveBeenCalledOnce();
    expect(respondToClose).toHaveBeenCalledWith(true);
    expect(respondToClose).not.toHaveBeenCalledWith(false);
  });

  it('cancels the desktop close handshake while preserving the dirty surface and draft', () => {
    const closeRequested: Array<() => void> = [];
    const respondToClose = vi.fn();
    window.scliDesktop = {
      onCloseRequested: (listener) => {
        closeRequested.push(listener);
        return () => {
          closeRequested.length = 0;
        };
      },
      respondToClose,
    };
    const onRequest = vi.fn();
    render(<Harness onRequest={onRequest} />);
    fireEvent.change(screen.getByRole('textbox', { name: 'Draft' }), {
      target: { value: 'Revised unsaved lighting notes' },
    });

    act(() => closeRequested[0]?.());
    expect(onRequest).toHaveBeenCalledWith('desktop-close');
    fireEvent.click(screen.getByRole('button', { name: 'Keep editing' }));

    expect(respondToClose).toHaveBeenCalledOnce();
    expect(respondToClose).toHaveBeenCalledWith(false);
    expect(respondToClose).not.toHaveBeenCalledWith(true);
    expect(screen.getByRole('textbox', { name: 'Draft' })).toHaveValue(
      'Revised unsaved lighting notes',
    );
    expect(screen.queryByRole('button', { name: 'Discard and continue' })).not.toBeInTheDocument();
    const event = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
  });

  it('starts a fresh desktop handshake after cancel and can later proceed', () => {
    const closeRequested: Array<() => void> = [];
    const respondToClose = vi.fn();
    window.scliDesktop = {
      onCloseRequested: (listener) => {
        closeRequested.push(listener);
        return () => {
          closeRequested.length = 0;
        };
      },
      respondToClose,
    };
    const onRequest = vi.fn();
    render(<Harness onRequest={onRequest} />);

    act(() => closeRequested[0]?.());
    fireEvent.click(screen.getByRole('button', { name: 'Keep editing' }));
    act(() => closeRequested[0]?.());

    expect(onRequest).toHaveBeenCalledTimes(2);
    expect(screen.getByRole('button', { name: 'Discard and continue' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Discard and continue' }));
    expect(respondToClose).toHaveBeenNthCalledWith(1, false);
    expect(respondToClose).toHaveBeenNthCalledWith(2, true);
    expect(respondToClose).toHaveBeenCalledTimes(2);
  });
});
