import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, ClipboardCheck, Download, PencilLine, RotateCcw, Send, X } from 'lucide-react';
import {
  timesheetStatuses,
  workCategories,
  workCategoryLabels,
  type ProjectTimesheet,
  type TimeEntry,
  type TimesheetStatus,
  type WorkCategory,
} from '@scli/domain';
import { api } from '../api';
import { useAppContext } from '../app-context';
import { LiveTimerCard } from '../components/live-timer';
import { useToast } from '../components/toast';
import { EmptyState, ErrorState, LoadingState, PageHeader } from '../components/ui';

function formatMinutes(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const remaining = minutes % 60;
  return `${hours}h ${String(remaining).padStart(2, '0')}m`;
}

function downloadSheet(sheet: ProjectTimesheet): void {
  const rows = [
    ['Project', sheet.projectCode, sheet.projectName],
    ['Lighting Designer', sheet.userNameSnapshot],
    ['Status', sheet.status],
    ['Total', formatMinutes(sheet.totalMinutes)],
    [],
    ['Date', 'Category', 'Note', 'Minutes'],
    ...sheet.entries.map((entry) => [
      entry.startedAt.slice(0, 10),
      workCategoryLabels[entry.workCategory],
      entry.note,
      String(entry.durationMinutes),
    ]),
  ];
  const csv = rows
    .map((row) => row.map((value) => `"${String(value ?? '').replaceAll('"', '""')}"`).join(','))
    .join('\r\n');
  const url = URL.createObjectURL(new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = `${sheet.projectCode}_${sheet.userNameSnapshot.replaceAll(' ', '_')}_Timesheet.csv`;
  link.click();
  URL.revokeObjectURL(url);
}

interface CorrectionState {
  sheet: ProjectTimesheet;
  entry: TimeEntry;
  workCategory: WorkCategory;
  note: string;
  durationMinutes: number;
  reason: string;
}

export function TimesheetsScreen() {
  const { currentUser } = useAppContext();
  const manager = currentUser.role === 'LineManager' || currentUser.role === 'Admin';
  const [status, setStatus] = useState<TimesheetStatus | 'All'>(manager ? 'Submitted' : 'All');
  const [rejecting, setRejecting] = useState<ProjectTimesheet | null>(null);
  const [reviewReason, setReviewReason] = useState('');
  const [correction, setCorrection] = useState<CorrectionState | null>(null);
  const queryClient = useQueryClient();
  const { showToast } = useToast();
  const sheetsQuery = useQuery({
    queryKey: ['timesheets', currentUser.id],
    queryFn: () => api.timesheets(),
    refetchInterval: 30_000,
  });
  const filtered = useMemo(
    () =>
      (sheetsQuery.data ?? []).filter((sheet) =>
        status === 'All' ? true : sheet.status === status,
      ),
    [sheetsQuery.data, status],
  );

  const invalidate = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['timesheets'] }),
      queryClient.invalidateQueries({ queryKey: ['time-tracking'] }),
      queryClient.invalidateQueries({ queryKey: ['notifications'] }),
      queryClient.invalidateQueries({ queryKey: ['projects'] }),
    ]);
  };

  const submitMutation = useMutation({
    mutationFn: (sheet: ProjectTimesheet) => api.submitTimesheet(sheet.projectId),
    onSuccess: async () => {
      await invalidate();
      showToast('Timesheet sent to the Line Manager.');
    },
    onError: (error) => showToast((error as Error).message, 'error'),
  });

  const reviewMutation = useMutation({
    mutationFn: ({
      sheet,
      decision,
      reason,
    }: {
      sheet: ProjectTimesheet;
      decision: 'approve' | 'reject';
      reason?: string;
    }) => api.reviewTimesheet(sheet.projectId, sheet.userId, decision, reason ? { reason } : {}),
    onSuccess: async (sheet) => {
      setRejecting(null);
      setReviewReason('');
      await invalidate();
      showToast(
        sheet.status === 'Approved' ? 'Timesheet approved.' : 'Timesheet returned to the designer.',
      );
    },
    onError: (error) => showToast((error as Error).message, 'error'),
  });

  const correctionMutation = useMutation({
    mutationFn: (value: CorrectionState) =>
      api.correctTimeEntry(value.sheet.projectId, value.entry.id, {
        workCategory: value.workCategory,
        note: value.note,
        durationMinutes: value.durationMinutes,
        reason: value.reason,
      }),
    onSuccess: async () => {
      setCorrection(null);
      await invalidate();
      showToast('Time entry corrected and added to the audit trail.');
    },
    onError: (error) => showToast((error as Error).message, 'error'),
  });

  return (
    <>
      <PageHeader
        eyebrow={manager ? 'Manager approval queue' : 'My tracked time'}
        title={manager ? 'Timesheet approvals' : 'Time & timesheets'}
        description={
          manager
            ? 'Review submitted project time, approve it, or return it with a clear reason.'
            : 'Track one project at a time, review your entries, then submit the completed project timesheet.'
        }
      />

      {!manager ? <LiveTimerCard /> : null}

      <div className="timesheet-toolbar">
        <div className="quick-filter-chips" role="group" aria-label="Filter timesheets">
          <button
            type="button"
            className={status === 'All' ? 'active' : ''}
            onClick={() => setStatus('All')}
          >
            All
          </button>
          {timesheetStatuses.map((item) => (
            <button
              type="button"
              key={item}
              className={status === item ? 'active' : ''}
              onClick={() => setStatus(item)}
            >
              {item}
              <span>{sheetsQuery.data?.filter((sheet) => sheet.status === item).length ?? 0}</span>
            </button>
          ))}
        </div>
      </div>

      {sheetsQuery.isLoading ? <LoadingState label="Loading timesheets…" /> : null}
      {sheetsQuery.error ? (
        <ErrorState
          message={(sheetsQuery.error as Error).message}
          onRetry={() => sheetsQuery.refetch()}
        />
      ) : null}
      {!sheetsQuery.isLoading && !filtered.length ? (
        <EmptyState
          title={
            manager && status === 'Submitted'
              ? 'Approval queue is clear'
              : 'No timesheets in this view'
          }
          description={
            manager
              ? 'Submitted designer time will appear here.'
              : 'Start a project timer to create your first entry.'
          }
        />
      ) : null}

      <div className="timesheet-list">
        {filtered.map((sheet) => (
          <article className="timesheet-card" key={`${sheet.projectId}-${sheet.userId}`}>
            <header>
              <div className="timesheet-title">
                <span className="timesheet-icon">
                  <ClipboardCheck size={20} />
                </span>
                <div>
                  <small>{sheet.projectCode}</small>
                  <h2>{sheet.projectName}</h2>
                  <p>{sheet.userNameSnapshot}</p>
                </div>
              </div>
              <div className="timesheet-total">
                <span className={`timesheet-status status-${sheet.status.toLowerCase()}`}>
                  {sheet.status}
                </span>
                <strong>{formatMinutes(sheet.totalMinutes)}</strong>
              </div>
            </header>

            {sheet.reviewReason ? (
              <div className={`review-note${sheet.status === 'Rejected' ? ' rejected' : ''}`}>
                <strong>
                  {sheet.status === 'Rejected' ? 'Returned with a note' : 'Manager note'}
                </strong>
                <span>{sheet.reviewReason}</span>
              </div>
            ) : null}

            <div className="timesheet-table-wrap">
              <table className="data-table compact-table">
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Category</th>
                    <th>Note</th>
                    <th>Time</th>
                    <th>
                      <span className="sr-only">Actions</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {sheet.entries.map((entry) => (
                    <tr key={entry.id}>
                      <td>
                        {new Intl.DateTimeFormat('en-AE', {
                          month: 'short',
                          day: 'numeric',
                        }).format(new Date(entry.startedAt))}
                      </td>
                      <td>{workCategoryLabels[entry.workCategory]}</td>
                      <td>{entry.note || '—'}</td>
                      <td>
                        <strong>{formatMinutes(entry.durationMinutes)}</strong>
                      </td>
                      <td>
                        {!manager &&
                        entry.status === 'Stopped' &&
                        (sheet.status === 'Draft' || sheet.status === 'Rejected') ? (
                          <button
                            className="icon-button"
                            type="button"
                            aria-label={`Edit ${workCategoryLabels[entry.workCategory]} entry`}
                            onClick={() =>
                              setCorrection({
                                sheet,
                                entry,
                                workCategory: entry.workCategory,
                                note: entry.note,
                                durationMinutes: entry.durationMinutes,
                                reason: '',
                              })
                            }
                          >
                            <PencilLine size={15} />
                          </button>
                        ) : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <footer>
              <button className="button ghost" type="button" onClick={() => downloadSheet(sheet)}>
                <Download size={16} /> Download CSV
              </button>
              {!manager && (sheet.status === 'Draft' || sheet.status === 'Rejected') ? (
                <button
                  className="button primary"
                  type="button"
                  disabled={
                    submitMutation.isPending ||
                    sheet.entries.some((entry) => entry.status !== 'Stopped')
                  }
                  onClick={() => submitMutation.mutate(sheet)}
                >
                  <Send size={16} /> Submit to manager
                </button>
              ) : null}
              {manager && sheet.status === 'Submitted' ? (
                <div className="approval-actions">
                  <button
                    className="button secondary"
                    type="button"
                    onClick={() => {
                      setRejecting(sheet);
                      setReviewReason('');
                    }}
                  >
                    <RotateCcw size={16} /> Return
                  </button>
                  <button
                    className="button primary"
                    type="button"
                    disabled={reviewMutation.isPending}
                    onClick={() => reviewMutation.mutate({ sheet, decision: 'approve' })}
                  >
                    <Check size={16} /> Approve
                  </button>
                </div>
              ) : null}
            </footer>

            {rejecting?.projectId === sheet.projectId && rejecting.userId === sheet.userId ? (
              <div className="review-composer">
                <label>
                  Reason for return
                  <textarea
                    value={reviewReason}
                    onChange={(event) => setReviewReason(event.target.value)}
                    placeholder="Tell the designer what must be corrected"
                  />
                </label>
                <div>
                  <button className="button ghost" type="button" onClick={() => setRejecting(null)}>
                    Cancel
                  </button>
                  <button
                    className="button danger"
                    type="button"
                    disabled={reviewReason.trim().length < 5 || reviewMutation.isPending}
                    onClick={() =>
                      reviewMutation.mutate({ sheet, decision: 'reject', reason: reviewReason })
                    }
                  >
                    Return timesheet
                  </button>
                </div>
              </div>
            ) : null}
          </article>
        ))}
      </div>

      {correction ? (
        <div className="dialog-backdrop" role="presentation">
          <section
            className="correction-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="correction-title"
          >
            <header>
              <div>
                <small>{correction.sheet.projectCode}</small>
                <h2 id="correction-title">Correct time entry</h2>
              </div>
              <button
                className="icon-button"
                type="button"
                aria-label="Close correction"
                onClick={() => setCorrection(null)}
              >
                <X size={18} />
              </button>
            </header>
            <div className="form-grid">
              <label className="field">
                Category
                <select
                  value={correction.workCategory}
                  onChange={(event) =>
                    setCorrection({
                      ...correction,
                      workCategory: event.target.value as WorkCategory,
                    })
                  }
                >
                  {workCategories.map((item) => (
                    <option key={item} value={item}>
                      {workCategoryLabels[item]}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                Minutes
                <input
                  type="number"
                  min="1"
                  max="1440"
                  value={correction.durationMinutes}
                  onChange={(event) =>
                    setCorrection({ ...correction, durationMinutes: Number(event.target.value) })
                  }
                />
              </label>
              <label className="field field-wide">
                Work note
                <textarea
                  value={correction.note}
                  onChange={(event) => setCorrection({ ...correction, note: event.target.value })}
                />
              </label>
              <label className="field field-wide">
                Correction reason<span className="required">Required</span>
                <textarea
                  value={correction.reason}
                  onChange={(event) => setCorrection({ ...correction, reason: event.target.value })}
                  placeholder="Why is this entry changing?"
                />
              </label>
            </div>
            <footer>
              <button className="button ghost" type="button" onClick={() => setCorrection(null)}>
                Cancel
              </button>
              <button
                className="button primary"
                type="button"
                disabled={
                  correction.reason.trim().length < 5 ||
                  correction.durationMinutes < 1 ||
                  correctionMutation.isPending
                }
                onClick={() => correctionMutation.mutate(correction)}
              >
                Save correction
              </button>
            </footer>
          </section>
        </div>
      ) : null}
    </>
  );
}
