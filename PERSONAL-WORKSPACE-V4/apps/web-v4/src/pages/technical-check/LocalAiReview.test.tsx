import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { api } from '../../api/environment';
import { renderV4, cleanupV4, stubMatchMedia } from '../../test-utils/renderV4';
import { LocalAiReviewAction, LocalAiReviewPanel } from './LocalAiReview';
afterEach(() => {
  cleanup();
  cleanupV4();
  vi.restoreAllMocks();
});
it('keeps AI controls out of the stable edition', async () => {
  stubMatchMedia();
  const status = vi.spyOn(api, 'localAiStatus').mockResolvedValue({
    enabled: false,
    ready: false,
    model: 'qwen3-vl:2b-instruct',
    reason: 'Stable edition',
    localOnly: true,
  });
  renderV4(<LocalAiReviewAction projectId="p1" luminaireId="l1" />);
  await waitFor(() => expect(status).toHaveBeenCalled());
  expect(screen.queryByRole('button', { name: 'Local AI review' })).not.toBeInTheDocument();
});
it('explains unavailable local runtime and prevents scan', async () => {
  stubMatchMedia();
  vi.spyOn(api, 'localAiStatus').mockResolvedValue({
    enabled: true,
    ready: false,
    model: 'qwen3-vl:2b-instruct',
    reason: 'Local model missing',
    localOnly: true,
  });
  const start = vi.spyOn(api, 'startLocalAiReview');
  renderV4(<LocalAiReviewPanel projectId="p1" luminaireId="l1" onClose={vi.fn()} />);
  expect(await screen.findByText('Local model missing')).toBeInTheDocument();
  const scan = screen.getByRole('button', { name: 'Scan Datasheet' });
  expect(scan).toBeDisabled();
  fireEvent.click(scan);
  expect(start).not.toHaveBeenCalled();
});
