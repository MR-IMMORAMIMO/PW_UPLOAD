import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../api/environment';
import { V4FloatingWorkspace } from '../../components/common/V4FloatingWorkspace';
import { V4Button } from '../../components/common/V4Button';

export function LocalAiReviewAction({
  projectId,
  luminaireId,
}: {
  projectId: string;
  luminaireId: string;
}) {
  const [open, setOpen] = useState(false);
  const status = useQuery({
    queryKey: ['v4', 'local-ai-status'],
    queryFn: () => api.localAiStatus(),
    retry: false,
    staleTime: 30000,
  });
  if (!status.data?.enabled) return null;
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        Local AI review
      </button>
      {open ? (
        <LocalAiReviewPanel
          key={luminaireId}
          projectId={projectId}
          luminaireId={luminaireId}
          onClose={() => setOpen(false)}
        />
      ) : null}
    </>
  );
}

export function LocalAiReviewPanel({
  projectId,
  luminaireId,
  onClose,
}: {
  projectId: string;
  luminaireId: string;
  onClose: () => void;
}) {
  const client = useQueryClient();
  const [pageIndex, setPageIndex] = useState(0);
  const [fieldPage, setFieldPage] = useState(0);
  const key = ['v4', 'local-ai-review', projectId, luminaireId];
  const status = useQuery({
    queryKey: ['v4', 'local-ai-status'],
    queryFn: () => api.localAiStatus(),
    retry: false,
  });
  const report = useQuery({
    queryKey: key,
    queryFn: () => api.localAiReview(projectId, luminaireId),
    enabled: Boolean(status.data?.ready),
    refetchInterval: (query) => (query.state.data?.state === 'RUNNING' ? 1500 : false),
    retry: false,
  });
  const start = useMutation({
    mutationFn: () => api.startLocalAiReview(projectId, luminaireId),
    onSuccess: (value) => {
      client.setQueryData(key, value);
      setPageIndex(0);
      setFieldPage(0);
    },
  });
  const cancel = useMutation({
    mutationFn: () => api.cancelLocalAiReview(projectId, luminaireId),
    onSuccess: () => client.invalidateQueries({ queryKey: key }),
  });
  const page = report.data?.pages[pageIndex];
  const preview = useQuery({
    queryKey: [...key, 'page', report.data?.id, page?.pageNumber],
    queryFn: () => api.localAiPage(projectId, luminaireId, page!.pageNumber),
    enabled: Boolean(page),
    retry: false,
  });
  const running = report.data?.state === 'RUNNING';
  const error = start.error || cancel.error || report.error || preview.error || status.error;
  return (
    <V4FloatingWorkspace
      open
      title="Local AI review"
      description="Local-only · Qwen3-VL 2B · Light profile. Suggestions never change your Project or Technical Check results."
      panelClassName="v4-local-ai-review"
      onRequestClose={onClose}
      headerActions={
        <V4Button
          onClick={() => start.mutate()}
          disabled={!status.data?.ready || running || start.isPending}
        >
          {report.data ? 'Scan again' : 'Scan Datasheet'}
        </V4Button>
      }
      footer={
        <>
          <span>
            Review product identity, units and every suggested difference before using it.
          </span>
          {running ? (
            <V4Button onClick={() => cancel.mutate()} disabled={cancel.isPending}>
              Cancel scan
            </V4Button>
          ) : null}
          <V4Button onClick={onClose}>Close</V4Button>
        </>
      }
    >
      <div className="v4-local-ai-review__status" role="status">
        {status.data?.reason || 'Checking local runtime…'}
        {report.data ? (
          <span>
            {report.data.state} · {report.data.completedPages} / {report.data.totalPages || '?'}{' '}
            pages · Snapshot from {new Date(report.data.startedAt).toLocaleString()}
          </span>
        ) : null}
        {running ? (
          <span>
            Reading one page at a time. You can close this window; the scan continues while the app
            stays open.
          </span>
        ) : null}
      </div>
      {error ? <p role="alert">{error.message}</p> : null}
      {report.data?.error ? <p role="alert">{report.data.error}</p> : null}
      {report.data?.stale ? (
        <p role="alert">
          The Project values or Datasheet changed after this snapshot. Scan again before using these
          suggestions.
        </p>
      ) : null}
      {!page ? (
        <p>
          Attach the exact product Datasheet, then start a scan. Text, tables, notes and page images
          are reviewed locally. Scanned or ambiguous values always need manual confirmation.
        </p>
      ) : (
        <>
          <nav className="v4-local-ai-review__nav" aria-label="AI review pages">
            <V4Button
              disabled={pageIndex === 0}
              onClick={() => {
                setPageIndex(pageIndex - 1);
                setFieldPage(0);
              }}
            >
              Previous page
            </V4Button>
            <span>
              Page {page.pageNumber} · Detected code: {page.productCode || 'Not identified'}
            </span>
            <V4Button
              disabled={pageIndex + 1 >= (report.data?.pages.length ?? 0)}
              onClick={() => {
                setPageIndex(pageIndex + 1);
                setFieldPage(0);
              }}
            >
              Next page
            </V4Button>
          </nav>
          <div className="v4-local-ai-review__layout">
            <section aria-label="AI page findings">
              <p>{page.summary}</p>
              {page.observations.length ? (
                <details>
                  <summary>Page notes and limitations ({page.observations.length})</summary>
                  <ul>
                    {page.observations.map((note, i) => (
                      <li key={i}>{note}</li>
                    ))}
                  </ul>
                </details>
              ) : null}
              <div className="v4-local-ai-review__findings">
                {page.findings.slice(fieldPage * 3, fieldPage * 3 + 3).map((finding, i) => (
                  <article key={i}>
                    <strong>{finding.field.replace(/([A-Z])/g, ' $1')}</strong>
                    <span data-result={finding.result}>
                      {finding.result === 'CONSISTENT_EVIDENCE'
                        ? 'Consistent evidence · review required'
                        : finding.result === 'DIFFERENT_EVIDENCE'
                          ? 'Different evidence · review required'
                          : 'Needs review'}
                    </span>
                    <div>
                      Project snapshot: <b>{finding.projectValue || 'Not set'}</b> · AI reading:{' '}
                      <b>{finding.value}</b>
                    </div>
                    <blockquote>{finding.quote}</blockquote>
                    <small>{finding.reason}</small>
                  </article>
                ))}
                {!page.findings.length ? (
                  <p>No safely associated product fields were extracted on this page.</p>
                ) : null}
              </div>
              {page.findings.length > 3 ? (
                <nav className="v4-local-ai-review__nav" aria-label="AI finding pages">
                  <V4Button disabled={!fieldPage} onClick={() => setFieldPage(fieldPage - 1)}>
                    Previous findings
                  </V4Button>
                  <span>
                    {fieldPage + 1} / {Math.ceil(page.findings.length / 3)}
                  </span>
                  <V4Button
                    disabled={(fieldPage + 1) * 3 >= page.findings.length}
                    onClick={() => setFieldPage(fieldPage + 1)}
                  >
                    Next findings
                  </V4Button>
                </nav>
              ) : null}
            </section>
            <figure>
              {preview.data ? (
                <img
                  src={`data:image/png;base64,${preview.data.pngBase64}`}
                  alt={`Source Datasheet page ${page.pageNumber}`}
                />
              ) : (
                <p>Loading source page…</p>
              )}
              <figcaption>Exact attached Datasheet · Page {page.pageNumber}</figcaption>
            </figure>
          </div>
        </>
      )}
    </V4FloatingWorkspace>
  );
}
