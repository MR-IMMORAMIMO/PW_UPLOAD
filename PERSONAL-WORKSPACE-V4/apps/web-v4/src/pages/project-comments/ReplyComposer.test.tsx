/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import type { ProjectDocument } from '@scli/domain';
import { cleanupV4, renderV4, stubMatchMedia } from '../../test-utils/renderV4';
import { ReplyComposer, type ReplySubmitInput } from './ReplyComposer';

const participant = {
  authorId: '11111111-1111-4111-8111-111111111111',
  name: 'Client Author',
  role: 'Client Representative',
  origin: 'Client' as const,
};
const projectDocument = {
  id: '22222222-2222-4222-8222-222222222222',
  title: 'Registered datasheet',
} as ProjectDocument;

const renderComposer = (
  options: {
    onSubmit?: (input: ReplySubmitInput) => Promise<boolean>;
    participants?: (typeof participant)[];
    documents?: ProjectDocument[];
    pending?: boolean;
  } = {},
) => {
  stubMatchMedia();
  const onSubmit =
    options.onSubmit ??
    vi.fn<(input: ReplySubmitInput) => Promise<boolean>>().mockResolvedValue(true);
  renderV4(
    <ReplyComposer
      threadId="thread-1"
      clientParticipants={options.participants ?? [participant]}
      documents={options.documents ?? [projectDocument]}
      pending={options.pending ?? false}
      error={null}
      warning={null}
      focusRequest={0}
      onSubmit={onSubmit}
    />,
  );
  return onSubmit;
};

describe('ReplyComposer', () => {
  afterEach(() => {
    cleanup();
    cleanupV4();
  });

  it('defaults to an Internal reply and prevents empty or duplicate pending sends', async () => {
    const onSubmit = renderComposer();
    expect(screen.getByRole('button', { name: 'Internal' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(screen.getByRole('button', { name: 'Send reply' })).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Write a reply'), {
      target: { value: 'Internal note' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Send reply' }));
    await waitFor(() =>
      expect(onSubmit).toHaveBeenCalledWith({
        body: 'Internal note',
        author: { origin: 'Internal' },
        documentId: null,
      }),
    );
  });

  it('reuses an existing Client author by stable authorId', async () => {
    const onSubmit = renderComposer();
    fireEvent.click(screen.getByRole('button', { name: 'Client' }));
    fireEvent.change(screen.getByLabelText('Write a reply'), {
      target: { value: 'Recorded client reply' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Send reply' }));
    await waitFor(() =>
      expect(onSubmit).toHaveBeenCalledWith({
        body: 'Recorded client reply',
        author: { origin: 'Client', existingClientAuthorId: participant.authorId },
        documentId: null,
      }),
    );
  });

  it('creates a new external Client participant with name and role', async () => {
    const onSubmit = renderComposer();
    fireEvent.click(screen.getByRole('button', { name: 'Client' }));
    fireEvent.click(screen.getByRole('button', { name: 'New participant' }));
    fireEvent.change(screen.getByLabelText('Author name'), { target: { value: 'New Person' } });
    fireEvent.change(screen.getByLabelText('Author role'), { target: { value: 'Architect' } });
    fireEvent.change(screen.getByLabelText('Write a reply'), {
      target: { value: 'External confirmation' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Send reply' }));
    await waitFor(() =>
      expect(onSubmit).toHaveBeenCalledWith({
        body: 'External confirmation',
        author: { origin: 'Client', authorName: 'New Person', authorRole: 'Architect' },
        documentId: null,
      }),
    );
  });

  it('links only a registered project document and retains the draft on failure', async () => {
    const onSubmit = vi.fn().mockResolvedValue(false);
    renderComposer({ onSubmit });
    fireEvent.click(screen.getByRole('button', { name: 'Link existing project document' }));
    fireEvent.click(screen.getByRole('button', { name: 'Existing project document' }));
    fireEvent.click(screen.getByRole('option', { name: projectDocument.title }));
    fireEvent.change(screen.getByLabelText('Write a reply'), {
      target: { value: 'Keep this draft' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Send reply' }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalled());
    expect(screen.getByLabelText('Write a reply')).toHaveValue('Keep this draft');
    expect(document.querySelector('input[type="file"]')).toBeNull();
  });
});
