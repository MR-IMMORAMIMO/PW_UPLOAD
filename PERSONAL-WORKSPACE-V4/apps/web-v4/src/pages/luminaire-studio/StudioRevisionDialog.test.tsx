import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import type { CanonicalRevisionRecord, ProjectWorkspace } from '@scli/domain';
import { api } from '../../api/environment';
import { cleanupV4, renderV4, stubMatchMedia } from '../../test-utils/renderV4';
import { StudioRevisionDialog } from './StudioRevisionDialog';

vi.mock('../../api/environment', () => ({
  api: { projectRevisions: vi.fn(), projectWorkspace: vi.fn() },
}));
const revisionDefaults = {
  projectId: 'p1',
  revisionSequence: 1,
  purpose: null,
  internalNote: null,
  projectSnapshot: null,
  luminaireSnapshot: null,
  snapshotHash: null,
  createdById: null,
  createdByName: null,
  legacySourceId: null,
  failureReason: null,
  createdAt: '2026-09-01T00:00:00.000Z',
  finalizedAt: null,
  updatedAt: '2026-09-01T00:00:00.000Z',
};
beforeEach(() => {
  stubMatchMedia();
  vi.mocked(api.projectRevisions).mockResolvedValue([
    {
      ...revisionDefaults,
      revisionId: 'r1',
      revisionLabel: 'REV_01',
      lifecycleState: 'PREPARING',
      provenanceClassification: 'CANONICAL',
      projectSnapshot: { canonicalOperation: 'MANUAL_DELIVERABLES' },
    },
    {
      ...revisionDefaults,
      revisionId: 'r2',
      revisionSequence: 2,
      revisionLabel: 'REV_02',
      lifecycleState: 'FINALIZED',
      provenanceClassification: 'CANONICAL',
    },
  ] satisfies CanonicalRevisionRecord[]);
  vi.mocked(api.projectWorkspace).mockResolvedValue({
    luminaires: [
      { id: 'l1', tag: 'DL01', description: 'Downlight' },
      { id: 'l2', tag: 'WL01', description: 'Wall light' },
    ],
  } as ProjectWorkspace);
});
afterEach(() => {
  cleanupV4();
  vi.clearAllMocks();
});

it('offers only open revisions and generates specifications for the selected luminaire', async () => {
  const generate = vi.fn().mockResolvedValue({
    artifacts: [
      {
        name: 'Specifications.pdf',
        url: '/api/projects/p1/luminaire-studio/outputs/output-1/download',
      },
    ],
  });
  renderV4(
    <StudioRevisionDialog
      projectId="p1"
      specifications
      initialRevisionId="r1"
      generate={generate}
      onClose={vi.fn()}
    />,
  );
  await screen.findByText('DL01 — Downlight');
  fireEvent.click(screen.getByLabelText('WL01 — Wall light'));
  fireEvent.click(screen.getByRole('button', { name: 'Generate selected files' }));
  await waitFor(() =>
    expect(generate).toHaveBeenCalledWith({
      targetRevisionId: 'r1',
      kind: 'datasheets',
      format: 'PDF',
      selection: ['l1'],
    }),
  );
  expect(screen.queryByText('REV_02')).not.toBeInTheDocument();
  expect(
    await screen.findByRole('link', { name: 'Open / download Specifications.pdf' }),
  ).toHaveAttribute('href', '/api/projects/p1/luminaire-studio/outputs/output-1/download');
});

it('retries the failed format without generating the already completed file again', async () => {
  const generate = vi
    .fn()
    .mockResolvedValueOnce({})
    .mockRejectedValueOnce(new Error('Renderer unavailable'))
    .mockResolvedValue({});
  renderV4(
    <StudioRevisionDialog
      projectId="p1"
      specifications={false}
      initialRevisionId="r1"
      generate={generate}
      onClose={vi.fn()}
    />,
  );
  await screen.findByText('REV_01');
  fireEvent.click(screen.getByLabelText('XLSX'));
  fireEvent.click(screen.getByRole('button', { name: 'Generate selected files' }));
  await screen.findByText('Renderer unavailable');
  fireEvent.click(screen.getByRole('button', { name: 'Generate selected files' }));
  await waitFor(() => expect(generate).toHaveBeenCalledTimes(3));
  expect(generate.mock.calls.map(([input]) => input.format)).toEqual(['PDF', 'XLSX', 'XLSX']);
});
