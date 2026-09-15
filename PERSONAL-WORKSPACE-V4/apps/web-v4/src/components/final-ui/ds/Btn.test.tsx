/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import Btn from './Btn';
afterEach(cleanup);
it('blocks duplicate actions while loading and restores the action when finished', () => {
  const click = vi.fn();
  const view = render(
    <Btn loading onClick={click}>
      Generate
    </Btn>,
  );
  const button = screen.getByRole('button', { name: 'Generate' });
  fireEvent.click(button);
  fireEvent.click(button);
  expect(click).not.toHaveBeenCalled();
  expect(button).toHaveAttribute('aria-busy', 'true');
  view.rerender(<Btn onClick={click}>Generate</Btn>);
  fireEvent.click(button);
  expect(click).toHaveBeenCalledOnce();
  expect(button).toHaveAttribute('type', 'button');
});
