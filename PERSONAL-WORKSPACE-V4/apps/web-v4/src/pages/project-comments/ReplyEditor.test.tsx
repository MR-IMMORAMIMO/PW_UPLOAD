/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import type { ProjectReviewReply } from '@scli/domain';
import { cleanupV4, renderV4, stubMatchMedia } from '../../test-utils/renderV4';
import { ReplyEditor } from './ReplyEditor';

const reply: ProjectReviewReply = {
  id: 'reply',
  projectId: 'project',
  reviewItemId: 'thread',
  body: 'Original reply',
  authorId: 'original',
  authorNameSnapshot: 'Original Author',
  authorRoleSnapshot: 'Client',
  origin: 'Client',
  createdAt: '2026-09-01T08:00:00.000Z',
  updatedAt: '2026-09-01T08:00:00.000Z',
};
describe('Reply editor', () => {
  afterEach(() => {
    cleanup();
    cleanupV4();
  });
  it('preserves unsaved content after a conflict and allows a retry without changing attribution', async () => {
    stubMatchMedia();
    const save = vi
      .fn()
      .mockRejectedValueOnce(new Error('Reply changed. Reopen it.'))
      .mockResolvedValueOnce(undefined);
    const close = vi.fn();
    renderV4(<ReplyEditor reply={reply} onSave={save} onClose={close} />);
    expect(screen.getByText(/Original Author/)).toBeVisible();
    fireEvent.change(screen.getByLabelText('Reply'), { target: { value: 'Revised reply' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save reply' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Reply changed');
    expect(close).not.toHaveBeenCalled();
    expect(screen.getByLabelText('Reply')).toHaveValue('Revised reply');
    fireEvent.click(screen.getByRole('button', { name: 'Save reply' }));
    await waitFor(() => expect(close).toHaveBeenCalledOnce());
    expect(save).toHaveBeenLastCalledWith('Revised reply');
  });
  it('requires an explicit discard and blocks empty edits', () => {
    stubMatchMedia();
    const close = vi.fn();
    renderV4(<ReplyEditor reply={reply} onSave={vi.fn()} onClose={close} />);
    fireEvent.change(screen.getByLabelText('Reply'), { target: { value: '' } });
    expect(screen.getByRole('button', { name: 'Save reply' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.getByRole('alertdialog', { name: 'Unsaved reply changes' })).toBeVisible();
    expect(close).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Continue editing' }));
    expect(screen.getByLabelText('Reply')).toHaveValue('');
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    fireEvent.click(screen.getByRole('button', { name: 'Discard changes' }));
    expect(close).toHaveBeenCalledOnce();
  });
});
