import { useMemo, useState, type CSSProperties, type ReactNode } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import {
  AlertCircle,
  CalendarDays,
  Check,
  CheckCircle2,
  Circle,
  ClipboardCheck,
  Clock3,
  Cloud,
  ExternalLink,
  FileDown,
  FilePlus2,
  FileWarning,
  FolderOpen,
  HardDrive,
  ListChecks,
  MessageSquareText,
  Plus,
  RefreshCw,
  Save,
  ShieldCheck,
  UserRoundPlus,
} from 'lucide-react';
import type {
  Project,
  ProjectActionItem,
  ProjectChecklistItem,
  ProjectDocument,
  ProjectMeeting,
  ProjectRequirement,
  ProjectReviewItem,
  ProjectRevision,
  ProjectWorkspace,
} from '@scli/domain';
import { api } from '../api';
import { desktop } from '../desktop';
import { workspaceDateKey } from '../local-date';
import {
  buildInformationReport,
  buildMeetingReport,
  buildRevisionRegisterReport,
} from '../project-reports';
import { useToast } from './toast';
import { EmptyState, formatDate, SectionHeading } from './ui';

interface ModuleProps {
  project: Project;
  workspace: ProjectWorkspace;
  invalidate: () => Promise<void>;
}

function today(): string {
  return workspaceDateKey();
}

function nextHour(): { start: string; end: string } {
  const start = new Date();
  start.setMinutes(0, 0, 0);
  start.setHours(start.getHours() + 1);
  const end = new Date(start);
  end.setHours(end.getHours() + 1);
  const local = (date: Date) => {
    const offset = date.getTimezoneOffset() * 60_000;
    return new Date(date.getTime() - offset).toISOString().slice(0, 16);
  };
  return { start: local(start), end: local(end) };
}

function toIso(value: string): string {
  return new Date(value).toISOString();
}

function people(value: string): string[] {
  return value
    .split(/[;,\n]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function fileSize(bytes: number): string {
  if (!bytes) return '—';
  if (bytes < 1_024) return `${bytes} B`;
  if (bytes < 1_048_576) return `${(bytes / 1_024).toFixed(1)} KB`;
  return `${(bytes / 1_048_576).toFixed(1)} MB`;
}

function reportFileName(project: Project, suffix: string): string {
  const projectReference = (project.projectCode || project.projectName || 'SCT_Project')
    .replaceAll(/[^a-zA-Z0-9 _.-]/g, '_')
    .trim();
  return `${projectReference}_${suffix}.pdf`;
}

async function saveProjectReport(
  project: Project,
  workspace: ProjectWorkspace,
  html: string,
  suffix: string,
): Promise<string | null> {
  if (!desktop.available()) return null;
  return desktop.exportPdf({
    html,
    suggestedName: reportFileName(project, suffix),
    ...(workspace.folderPath ? { defaultDirectory: workspace.folderPath } : {}),
  });
}

function StatusDot({ complete }: { complete: boolean }) {
  return complete ? <CheckCircle2 className="status-complete" /> : <Circle />;
}

function EditorCard({
  title,
  icon,
  children,
}: {
  title: string;
  icon: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="operations-editor content-card">
      <div className="operations-editor-title">
        {icon}
        <h3>{title}</h3>
      </div>
      {children}
    </section>
  );
}

export function ProjectHealthPanel({ workspace }: { workspace: ProjectWorkspace }) {
  const { health } = workspace;
  return (
    <section className="content-card health-panel">
      <div className="health-score" style={{ '--health-score': health.score } as CSSProperties}>
        <strong>{health.score}</strong>
        <span>Health</span>
      </div>
      <div className="health-content">
        <div className="health-heading">
          <div>
            <span className="eyebrow-label">Project readiness</span>
            <h2>Quality & information health</h2>
          </div>
          <span className="health-checklist">{health.checklistPercent}% checklist</span>
        </div>
        <div className="health-check-grid">
          {health.checks.map((check) => (
            <article
              className={`health-check ${check.passed ? 'passed' : check.severity.toLowerCase()}`}
              key={check.key}
            >
              {check.passed ? <Check size={15} /> : <AlertCircle size={15} />}
              <div>
                <strong>{check.label}</strong>
                <span>{check.detail}</span>
              </div>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}

function requirementInput(item: ProjectRequirement) {
  return {
    category: item.category,
    title: item.title,
    details: item.details,
    requestedFrom: item.requestedFrom,
    requestedAt: item.requestedAt,
    dueDate: item.dueDate,
    status: item.status,
    impact: item.impact,
    sourceType: item.sourceType,
    sourceReference: item.sourceReference,
    notes: item.notes,
    sortOrder: item.sortOrder,
  };
}

function checklistInput(item: ProjectChecklistItem) {
  return {
    category: item.category,
    title: item.title,
    serviceCode: item.serviceCode,
    required: item.required,
    completed: item.completed,
    waived: item.waived,
    waiverReason: item.waiverReason,
    sortOrder: item.sortOrder,
  };
}

export function InformationModule({ project, workspace, invalidate }: ModuleProps) {
  const { showToast } = useToast();
  const [requirement, setRequirement] = useState({
    category: 'Client Information',
    title: '',
    details: '',
    requestedFrom: '',
    requestedAt: today(),
    dueDate: '',
    status: 'Missing',
    impact: 'Medium',
    sourceType: 'Manual',
    sourceReference: '',
    notes: '',
    sortOrder: workspace.requirements.length,
  });
  const [checkTitle, setCheckTitle] = useState('');
  const [checkCategory, setCheckCategory] = useState('Custom QA');
  const requirementMutation = useMutation({
    mutationFn: () =>
      api.createRequirement(project.id, {
        ...requirement,
        requestedAt: requirement.requestedAt || null,
        dueDate: requirement.dueDate || null,
      }),
    onSuccess: async () => {
      await invalidate();
      setRequirement({ ...requirement, title: '', details: '', requestedFrom: '', dueDate: '' });
      showToast('Missing information item added.');
    },
    onError: (error) => showToast((error as Error).message, 'error'),
  });
  const updateRequirement = useMutation({
    mutationFn: ({
      item,
      status,
    }: {
      item: ProjectRequirement;
      status: ProjectRequirement['status'];
    }) => api.updateRequirement(project.id, item.id, { ...requirementInput(item), status }),
    onSuccess: invalidate,
    onError: (error) => showToast((error as Error).message, 'error'),
  });
  const updateChecklist = useMutation({
    mutationFn: ({ item, completed }: { item: ProjectChecklistItem; completed: boolean }) =>
      api.updateChecklistItem(project.id, item.id, {
        ...checklistInput(item),
        completed,
        waived: completed ? false : item.waived,
      }),
    onSuccess: invalidate,
    onError: (error) => showToast((error as Error).message, 'error'),
  });
  const addChecklist = useMutation({
    mutationFn: () =>
      api.createChecklistItem(project.id, {
        category: checkCategory,
        title: checkTitle,
        serviceCode: null,
        required: true,
        completed: false,
        waived: false,
        waiverReason: '',
        sortOrder: workspace.checklist.length,
      }),
    onSuccess: async () => {
      await invalidate();
      setCheckTitle('');
      showToast('Checklist item added.');
    },
    onError: (error) => showToast((error as Error).message, 'error'),
  });
  const checklistGroups = useMemo(() => {
    const groups = new Map<string, ProjectChecklistItem[]>();
    for (const item of workspace.checklist) {
      const list = groups.get(item.category) ?? [];
      list.push(item);
      groups.set(item.category, list);
    }
    return [...groups.entries()];
  }, [workspace.checklist]);
  return (
    <div className="operations-layout">
      <div className="operations-main-stack">
        <section className="content-card">
          <div className="operations-section-head">
            <SectionHeading
              title="Missing information register"
              detail={`${workspace.health.openRequirements} open · ${workspace.health.blockingRequirements} blocking`}
            />
            <button
              className="button secondary"
              type="button"
              onClick={async () => {
                const result = await saveProjectReport(
                  project,
                  workspace,
                  buildInformationReport(project, workspace),
                  'Project_Readiness',
                );
                showToast(
                  result
                    ? `Project readiness PDF saved to ${result}`
                    : 'PDF export is available in the portable desktop app.',
                  result ? 'success' : 'error',
                );
              }}
            >
              <FileDown /> Export PDF
            </button>
          </div>
          <div className="operations-list">
            {workspace.requirements.map((item) => (
              <article
                className={`operation-row impact-${item.impact.toLowerCase()}`}
                key={item.id}
              >
                <span className="operation-icon">
                  <AlertCircle />
                </span>
                <div className="operation-copy">
                  <div className="operation-title-line">
                    <strong>{item.title}</strong>
                    <span>{item.impact}</span>
                  </div>
                  <p>{item.details || item.category}</p>
                  <small>
                    {item.requestedFrom ? `From ${item.requestedFrom} · ` : ''}
                    {item.dueDate ? `Due ${formatDate(item.dueDate)}` : 'No due date'}
                  </small>
                </div>
                <select
                  aria-label={`Status for ${item.title}`}
                  value={item.status}
                  onChange={(event) =>
                    updateRequirement.mutate({
                      item,
                      status: event.target.value as ProjectRequirement['status'],
                    })
                  }
                >
                  {['Missing', 'Requested', 'Received', 'NotRequired'].map((status) => (
                    <option key={status}>{status}</option>
                  ))}
                </select>
              </article>
            ))}
            {!workspace.requirements.length ? (
              <EmptyState
                title="No missing information"
                description="Add only the information that is genuinely blocking or needed for this project."
              />
            ) : null}
          </div>
        </section>
        <section className="content-card">
          <SectionHeading
            title="Scope-driven checklist"
            detail={`${workspace.health.checklistPercent}% complete`}
          />
          <div className="checklist-groups">
            {checklistGroups.map(([category, items]) => (
              <section className="checklist-group" key={category}>
                <div className="checklist-group-title">
                  <strong>{category}</strong>
                  <span>
                    {items.filter((item) => item.completed || item.waived).length}/{items.length}
                  </span>
                </div>
                {items.map((item) => (
                  <label
                    className={`checklist-row${item.completed ? ' complete' : ''}`}
                    key={item.id}
                  >
                    <input
                      type="checkbox"
                      checked={item.completed}
                      onChange={(event) =>
                        updateChecklist.mutate({ item, completed: event.target.checked })
                      }
                    />
                    <StatusDot complete={item.completed} />
                    <span>{item.title}</span>
                    {item.serviceCode ? <small>{item.serviceCode}</small> : null}
                  </label>
                ))}
              </section>
            ))}
          </div>
        </section>
      </div>
      <aside className="operations-side-stack">
        <EditorCard title="Add missing information" icon={<AlertCircle />}>
          <form
            className="compact-form"
            onSubmit={(event) => {
              event.preventDefault();
              requirementMutation.mutate();
            }}
          >
            <label>
              Title
              <input
                required
                value={requirement.title}
                onChange={(event) => setRequirement({ ...requirement, title: event.target.value })}
              />
            </label>
            <label>
              Category
              <input
                value={requirement.category}
                onChange={(event) =>
                  setRequirement({ ...requirement, category: event.target.value })
                }
              />
            </label>
            <label>
              Details
              <textarea
                rows={3}
                value={requirement.details}
                onChange={(event) =>
                  setRequirement({ ...requirement, details: event.target.value })
                }
              />
            </label>
            <div className="compact-form-grid">
              <label>
                Impact
                <select
                  value={requirement.impact}
                  onChange={(event) =>
                    setRequirement({ ...requirement, impact: event.target.value })
                  }
                >
                  {['Low', 'Medium', 'High', 'Blocking'].map((value) => (
                    <option key={value}>{value}</option>
                  ))}
                </select>
              </label>
              <label>
                Due date
                <input
                  type="date"
                  value={requirement.dueDate}
                  onChange={(event) =>
                    setRequirement({ ...requirement, dueDate: event.target.value })
                  }
                />
              </label>
            </div>
            <label>
              Requested from
              <input
                value={requirement.requestedFrom}
                onChange={(event) =>
                  setRequirement({ ...requirement, requestedFrom: event.target.value })
                }
              />
            </label>
            <button
              className="button primary"
              disabled={!requirement.title || requirementMutation.isPending}
            >
              <Plus /> Add Item
            </button>
          </form>
        </EditorCard>
        <EditorCard title="Add checklist item" icon={<ListChecks />}>
          <form
            className="compact-form"
            onSubmit={(event) => {
              event.preventDefault();
              addChecklist.mutate();
            }}
          >
            <label>
              Category
              <input
                value={checkCategory}
                onChange={(event) => setCheckCategory(event.target.value)}
              />
            </label>
            <label>
              Check
              <input
                required
                value={checkTitle}
                onChange={(event) => setCheckTitle(event.target.value)}
              />
            </label>
            <button className="button secondary" disabled={!checkTitle || addChecklist.isPending}>
              <Plus /> Add Check
            </button>
          </form>
        </EditorCard>
      </aside>
    </div>
  );
}

function actionInput(item: ProjectActionItem) {
  return {
    title: item.title,
    details: item.details,
    owner: item.owner,
    ownerRole: item.ownerRole,
    dueDate: item.dueDate,
    status: item.status,
    priority: item.priority,
    sourceType: item.sourceType,
    sourceId: item.sourceId,
    revisionId: item.revisionId,
    categoryId: item.categoryId,
    notes: item.notes,
  };
}

export function ActionsModule({ project, workspace, invalidate }: ModuleProps) {
  const { showToast } = useToast();
  const [form, setForm] = useState({
    title: '',
    details: '',
    owner: 'Mohamed',
    ownerRole: '',
    dueDate: '',
    status: 'Open',
    priority: 'Normal',
    sourceType: 'Manual',
    sourceId: null,
    revisionId: null,
    categoryId: null,
    notes: '',
  });
  const create = useMutation({
    mutationFn: () => api.createAction(project.id, { ...form, dueDate: form.dueDate || null }),
    onSuccess: async () => {
      await invalidate();
      setForm({ ...form, title: '', details: '', dueDate: '' });
      showToast('Action added.');
    },
    onError: (error) => showToast((error as Error).message, 'error'),
  });
  const update = useMutation({
    mutationFn: ({
      item,
      status,
    }: {
      item: ProjectActionItem;
      status: ProjectActionItem['status'];
    }) => api.updateAction(project.id, item.id, { ...actionInput(item), status }),
    onSuccess: invalidate,
    onError: (error) => showToast((error as Error).message, 'error'),
  });
  const active = workspace.actions.filter(
    (item) => item.status !== 'Completed' && item.status !== 'Cancelled',
  );
  const completed = workspace.actions.filter((item) => item.status === 'Completed');
  return (
    <div className="operations-layout">
      <section className="content-card operations-main-stack">
        <div className="operations-section-head">
          <SectionHeading
            title="Action register"
            detail={`${active.length} open · ${workspace.health.overdueActions} overdue`}
          />
          <button
            className="button secondary"
            type="button"
            onClick={async () => {
              const result = await saveProjectReport(
                project,
                workspace,
                buildInformationReport(project, workspace),
                'Actions_and_Readiness',
              );
              showToast(
                result
                  ? `Action report PDF saved to ${result}`
                  : 'PDF export is available in the portable desktop app.',
                result ? 'success' : 'error',
              );
            }}
          >
            <FileDown /> Export PDF
          </button>
        </div>
        <div className="operations-list">
          {[...active, ...completed].map((item) => (
            <article
              className={`operation-row priority-${item.priority.toLowerCase()}${item.status === 'Completed' ? ' operation-complete' : ''}`}
              key={item.id}
            >
              <span className="operation-icon">
                <ClipboardCheck />
              </span>
              <div className="operation-copy">
                <div className="operation-title-line">
                  <strong>{item.title}</strong>
                  <span>{item.priority}</span>
                </div>
                <p>{item.details || 'No additional details.'}</p>
                <small>
                  {item.owner || 'Unassigned'} ·{' '}
                  {item.dueDate ? `Due ${formatDate(item.dueDate)}` : 'No due date'} ·{' '}
                  {item.sourceType}
                </small>
              </div>
              <select
                aria-label={`Status for ${item.title}`}
                value={item.status}
                onChange={(event) =>
                  update.mutate({ item, status: event.target.value as ProjectActionItem['status'] })
                }
              >
                {['Open', 'InProgress', 'Waiting', 'Completed', 'Cancelled'].map((status) => (
                  <option key={status}>{status}</option>
                ))}
              </select>
            </article>
          ))}
          {!workspace.actions.length ? (
            <EmptyState
              title="No project actions"
              description="Create actions from meetings, email, comments or your own project plan."
            />
          ) : null}
        </div>
      </section>
      <aside className="operations-side-stack">
        <EditorCard title="New action" icon={<ClipboardCheck />}>
          <form
            className="compact-form"
            onSubmit={(event) => {
              event.preventDefault();
              create.mutate();
            }}
          >
            <label>
              Action
              <input
                required
                value={form.title}
                onChange={(event) => setForm({ ...form, title: event.target.value })}
              />
            </label>
            <label>
              Details
              <textarea
                rows={4}
                value={form.details}
                onChange={(event) => setForm({ ...form, details: event.target.value })}
              />
            </label>
            <div className="compact-form-grid">
              <label>
                Owner
                <input
                  value={form.owner}
                  onChange={(event) => setForm({ ...form, owner: event.target.value })}
                />
              </label>
              <label>
                Due date
                <input
                  type="date"
                  value={form.dueDate}
                  onChange={(event) => setForm({ ...form, dueDate: event.target.value })}
                />
              </label>
            </div>
            <label>
              Priority
              <select
                value={form.priority}
                onChange={(event) => setForm({ ...form, priority: event.target.value })}
              >
                {['Normal', 'High', 'Urgent'].map((value) => (
                  <option key={value}>{value}</option>
                ))}
              </select>
            </label>
            <button className="button primary" disabled={!form.title || create.isPending}>
              <Plus /> Add Action
            </button>
          </form>
        </EditorCard>
      </aside>
    </div>
  );
}

function meetingInput(item: ProjectMeeting) {
  return {
    title: item.title,
    purpose: item.purpose,
    startAt: item.startAt,
    endAt: item.endAt,
    location: item.location,
    attendees: item.attendees,
    agenda: item.agenda,
    notes: item.notes,
    decisions: item.decisions,
    onlineMeetingUrl: item.onlineMeetingUrl,
    externalEventId: item.externalEventId,
    status: item.status,
  };
}

export function MeetingsModule({ project, workspace, invalidate }: ModuleProps) {
  const defaults = nextHour();
  const { showToast } = useToast();
  const [editing, setEditing] = useState<ProjectMeeting | null>(null);
  const [form, setForm] = useState({
    title: '',
    startAt: defaults.start,
    endAt: defaults.end,
    location: '',
    attendees: '',
    agenda: '',
    notes: '',
    decisions: '',
    status: 'Planned',
  });
  const create = useMutation({
    mutationFn: async () => {
      const input = {
        title: form.title,
        purpose: '',
        startAt: toIso(form.startAt),
        endAt: toIso(form.endAt),
        location: form.location,
        attendees: people(form.attendees),
        agenda: form.agenda,
        notes: form.notes,
        decisions: form.decisions,
        onlineMeetingUrl: '',
        externalEventId: null,
        status: form.status,
      };
      await api.createMeeting(project.id, input);
    },
    onSuccess: async () => {
      await invalidate();
      setForm({ ...form, title: '', attendees: '', agenda: '', notes: '', decisions: '' });
      showToast('Meeting note created.');
    },
    onError: (error) => showToast((error as Error).message, 'error'),
  });
  const update = useMutation({
    mutationFn: (item: ProjectMeeting) =>
      api.updateMeeting(project.id, item.id, meetingInput(item)),
    onSuccess: async () => {
      await invalidate();
      setEditing(null);
      showToast('Meeting notes saved.');
    },
    onError: (error) => showToast((error as Error).message, 'error'),
  });
  return (
    <div className="operations-layout">
      <section className="content-card operations-main-stack">
        <SectionHeading
          title="Meetings & decisions"
          detail={`${workspace.meetings.length} project meeting notes`}
        />
        <div className="meeting-cards">
          {workspace.meetings.map((meeting) => (
            <article className="meeting-card" key={meeting.id}>
              <div className="meeting-date">
                <CalendarDays />
                <strong>{formatDate(meeting.startAt, { month: 'short', day: 'numeric' })}</strong>
                <span>{formatDate(meeting.startAt, { hour: '2-digit', minute: '2-digit' })}</span>
              </div>
              <div className="meeting-copy">
                <div className="operation-title-line">
                  <strong>{meeting.title}</strong>
                  <span>{meeting.status}</span>
                </div>
                <p>{meeting.agenda || meeting.notes || 'Agenda and notes are not entered yet.'}</p>
                <small>
                  {meeting.location || 'No location'} · {meeting.attendees.length} attendee(s)
                </small>
                {meeting.decisions ? (
                  <div className="decision-note">
                    <ShieldCheck /> {meeting.decisions}
                  </div>
                ) : null}
              </div>
              <div className="row-actions">
                {meeting.onlineMeetingUrl ? (
                  <button
                    className="icon-button"
                    title="Open online meeting"
                    onClick={() => void desktop.openExternal(meeting.onlineMeetingUrl)}
                  >
                    <ExternalLink />
                  </button>
                ) : null}
                <button className="button secondary" onClick={() => setEditing(meeting)}>
                  Notes
                </button>
                <button
                  className="icon-button"
                  type="button"
                  title="Export meeting notes PDF"
                  onClick={async () => {
                    const result = await saveProjectReport(
                      project,
                      workspace,
                      buildMeetingReport(project, workspace, meeting),
                      `Meeting_${meeting.startAt.slice(0, 10)}`,
                    );
                    showToast(
                      result
                        ? `Meeting PDF saved to ${result}`
                        : 'PDF export is available in the portable desktop app.',
                      result ? 'success' : 'error',
                    );
                  }}
                >
                  <FileDown />
                </button>
              </div>
            </article>
          ))}
          {!workspace.meetings.length ? (
            <EmptyState
              title="No meetings yet"
              description="Create a local meeting record with agenda, attendees, notes and decisions."
            />
          ) : null}
        </div>
      </section>
      <aside className="operations-side-stack">
        <EditorCard title="New meeting" icon={<CalendarDays />}>
          <form
            className="compact-form"
            onSubmit={(event) => {
              event.preventDefault();
              create.mutate();
            }}
          >
            <label>
              Title
              <input
                required
                value={form.title}
                onChange={(event) => setForm({ ...form, title: event.target.value })}
              />
            </label>
            <div className="compact-form-grid">
              <label>
                Start
                <input
                  type="datetime-local"
                  required
                  value={form.startAt}
                  onChange={(event) => setForm({ ...form, startAt: event.target.value })}
                />
              </label>
              <label>
                End
                <input
                  type="datetime-local"
                  required
                  value={form.endAt}
                  onChange={(event) => setForm({ ...form, endAt: event.target.value })}
                />
              </label>
            </div>
            <label>
              Location
              <input
                value={form.location}
                onChange={(event) => setForm({ ...form, location: event.target.value })}
              />
            </label>
            <label>
              Attendees<small>Separate names or emails with commas.</small>
              <textarea
                rows={2}
                value={form.attendees}
                onChange={(event) => setForm({ ...form, attendees: event.target.value })}
              />
            </label>
            <label>
              Agenda
              <textarea
                rows={4}
                value={form.agenda}
                onChange={(event) => setForm({ ...form, agenda: event.target.value })}
              />
            </label>
            <button className="button primary" disabled={!form.title || create.isPending}>
              <Plus /> Create Meeting
            </button>
          </form>
        </EditorCard>
      </aside>
      {editing ? (
        <div className="operation-modal-backdrop" role="presentation">
          <form
            className="operation-modal"
            onSubmit={(event) => {
              event.preventDefault();
              update.mutate(editing);
            }}
          >
            <div className="modal-heading">
              <div>
                <span>Meeting notes</span>
                <h2>{editing.title}</h2>
              </div>
              <button
                className="icon-button"
                type="button"
                aria-label="Close meeting notes"
                onClick={() => setEditing(null)}
              >
                ×
              </button>
            </div>
            <label>
              Status
              <select
                value={editing.status}
                onChange={(event) =>
                  setEditing({ ...editing, status: event.target.value as ProjectMeeting['status'] })
                }
              >
                {['Planned', 'Held', 'Cancelled'].map((value) => (
                  <option key={value}>{value}</option>
                ))}
              </select>
            </label>
            <label>
              Agenda
              <textarea
                rows={4}
                value={editing.agenda}
                onChange={(event) => setEditing({ ...editing, agenda: event.target.value })}
              />
            </label>
            <label>
              Discussion notes
              <textarea
                rows={8}
                value={editing.notes}
                onChange={(event) => setEditing({ ...editing, notes: event.target.value })}
              />
            </label>
            <label>
              Decisions
              <textarea
                rows={5}
                value={editing.decisions}
                onChange={(event) => setEditing({ ...editing, decisions: event.target.value })}
              />
            </label>
            <button className="button primary">
              <Save /> Save Meeting Notes
            </button>
          </form>
        </div>
      ) : null}
    </div>
  );
}

function reviewInput(item: ProjectReviewItem) {
  return {
    reference: item.reference,
    title: item.title,
    description: item.description,
    area: item.area,
    luminaireTag: item.luminaireTag,
    drawingReference: item.drawingReference,
    sourceType: item.sourceType,
    sourceId: item.sourceId,
    status: item.status,
    response: item.response,
    revisionId: item.revisionId,
    receivedAt: item.receivedAt,
    dueDate: item.dueDate,
  };
}

export function ReviewsModule({ project, workspace, invalidate }: ModuleProps) {
  const { showToast } = useToast();
  const [editing, setEditing] = useState<ProjectReviewItem | null>(null);
  const [form, setForm] = useState({
    reference: '',
    title: '',
    description: '',
    area: '',
    luminaireTag: '',
    drawingReference: '',
    sourceType: 'Manual',
    sourceId: null,
    status: 'Open',
    response: '',
    revisionId: null,
    receivedAt: today(),
    dueDate: '',
  });
  const create = useMutation({
    mutationFn: () => api.createReviewItem(project.id, { ...form, dueDate: form.dueDate || null }),
    onSuccess: async () => {
      await invalidate();
      setForm({
        ...form,
        reference: '',
        title: '',
        description: '',
        area: '',
        luminaireTag: '',
        drawingReference: '',
        response: '',
        dueDate: '',
      });
      showToast('Comment added to the review register.');
    },
    onError: (error) => showToast((error as Error).message, 'error'),
  });
  const update = useMutation({
    mutationFn: (item: ProjectReviewItem) =>
      api.updateReviewItem(project.id, item.id, reviewInput(item)),
    onSuccess: async () => {
      await invalidate();
      setEditing(null);
      showToast('Review item updated.');
    },
    onError: (error) => showToast((error as Error).message, 'error'),
  });
  return (
    <div className="operations-layout">
      <section className="content-card operations-main-stack">
        <SectionHeading
          title="Comments & review register"
          detail={`${workspace.health.unresolvedReviews} unresolved`}
        />
        <div className="operations-list">
          {workspace.reviewItems.map((item) => (
            <article className={`operation-row review-${item.status.toLowerCase()}`} key={item.id}>
              <span className="operation-icon">
                <MessageSquareText />
              </span>
              <div className="operation-copy">
                <div className="operation-title-line">
                  <strong>
                    {item.reference ? `${item.reference} · ` : ''}
                    {item.title}
                  </strong>
                  <span>{item.status}</span>
                </div>
                <p>{item.description}</p>
                <small>
                  {item.sourceType} · Received {formatDate(item.receivedAt)}
                  {item.dueDate ? ` · Due ${formatDate(item.dueDate)}` : ''}
                  {item.luminaireTag ? ` · ${item.luminaireTag}` : ''}
                </small>
                {item.response ? (
                  <div className="response-note">Response: {item.response}</div>
                ) : null}
              </div>
              <button className="button secondary" onClick={() => setEditing(item)}>
                Review
              </button>
            </article>
          ))}
          {!workspace.reviewItems.length ? (
            <EmptyState
              title="No review comments"
              description="Capture comments from the client, consultant, email, meetings or marked-up drawings."
            />
          ) : null}
        </div>
      </section>
      <aside className="operations-side-stack">
        <EditorCard title="Add review comment" icon={<MessageSquareText />}>
          <form
            className="compact-form"
            onSubmit={(event) => {
              event.preventDefault();
              create.mutate();
            }}
          >
            <div className="compact-form-grid">
              <label>
                Reference
                <input
                  value={form.reference}
                  placeholder="C-01"
                  onChange={(event) => setForm({ ...form, reference: event.target.value })}
                />
              </label>
              <label>
                Source
                <select
                  value={form.sourceType}
                  onChange={(event) => setForm({ ...form, sourceType: event.target.value })}
                >
                  {['Manual', 'Email', 'Meeting', 'PDF', 'Drawing'].map((value) => (
                    <option key={value}>{value}</option>
                  ))}
                </select>
              </label>
            </div>
            <label>
              Comment title
              <input
                required
                value={form.title}
                onChange={(event) => setForm({ ...form, title: event.target.value })}
              />
            </label>
            <label>
              Comment
              <textarea
                rows={5}
                value={form.description}
                onChange={(event) => setForm({ ...form, description: event.target.value })}
              />
            </label>
            <div className="compact-form-grid">
              <label>
                Area / room
                <input
                  value={form.area}
                  onChange={(event) => setForm({ ...form, area: event.target.value })}
                />
              </label>
              <label>
                Luminaire tag
                <input
                  value={form.luminaireTag}
                  onChange={(event) => setForm({ ...form, luminaireTag: event.target.value })}
                />
              </label>
            </div>
            <div className="compact-form-grid">
              <label>
                Received
                <input
                  type="date"
                  value={form.receivedAt}
                  onChange={(event) => setForm({ ...form, receivedAt: event.target.value })}
                />
              </label>
              <label>
                Due
                <input
                  type="date"
                  value={form.dueDate}
                  onChange={(event) => setForm({ ...form, dueDate: event.target.value })}
                />
              </label>
            </div>
            <button className="button primary" disabled={!form.title || create.isPending}>
              <Plus /> Add Comment
            </button>
          </form>
        </EditorCard>
      </aside>
      {editing ? (
        <div className="operation-modal-backdrop" role="presentation">
          <form
            className="operation-modal"
            onSubmit={(event) => {
              event.preventDefault();
              update.mutate(editing);
            }}
          >
            <div className="modal-heading">
              <div>
                <span>Review response</span>
                <h2>{editing.title}</h2>
              </div>
              <button
                className="icon-button"
                type="button"
                aria-label="Close review response"
                onClick={() => setEditing(null)}
              >
                ×
              </button>
            </div>
            <label>
              Status
              <select
                value={editing.status}
                onChange={(event) =>
                  setEditing({
                    ...editing,
                    status: event.target.value as ProjectReviewItem['status'],
                  })
                }
              >
                {['Open', 'Accepted', 'InProgress', 'Resolved', 'Rejected'].map((value) => (
                  <option key={value}>{value}</option>
                ))}
              </select>
            </label>
            <label>
              Comment
              <textarea
                rows={6}
                value={editing.description}
                onChange={(event) => setEditing({ ...editing, description: event.target.value })}
              />
            </label>
            <label>
              Designer response
              <textarea
                rows={7}
                value={editing.response}
                onChange={(event) => setEditing({ ...editing, response: event.target.value })}
              />
            </label>
            <button className="button primary">
              <Save /> Save Response
            </button>
          </form>
        </div>
      ) : null}
    </div>
  );
}

function revisionInput(item: ProjectRevision) {
  return {
    revisionNumber: item.revisionNumber,
    reissueNumber: item.reissueNumber,
    title: item.title,
    status: item.status,
    receivedAt: item.receivedAt,
    dueDate: item.dueDate,
    issuedAt: item.issuedAt,
    summary: item.summary,
    changeLog: item.changeLog,
    sourceType: item.sourceType,
    sourceReference: item.sourceReference,
  };
}

function documentInput(item: ProjectDocument) {
  return {
    category: item.category,
    documentNumber: item.documentNumber,
    title: item.title,
    revision: item.revision,
    status: item.status,
    filePath: item.filePath,
    issuedTo: item.issuedTo,
    issueDate: item.issueDate,
    notes: item.notes,
  };
}

export function RevisionsFilesModule({ project, workspace, invalidate }: ModuleProps) {
  const { showToast } = useToast();
  const nextRevision =
    Math.max(
      0,
      ...workspace.revisions.map((item) => item.revisionNumber),
      ...workspace.exports.map((item) => item.revision),
    ) + 1;
  const [revision, setRevision] = useState({
    revisionNumber: nextRevision,
    reissueNumber: 0,
    title: 'Client comments revision',
    status: 'Draft',
    receivedAt: today(),
    dueDate: '',
    issuedAt: null,
    summary: '',
    changeLog: '',
    sourceType: 'Manual',
    sourceReference: '',
  });
  const [document, setDocument] = useState({
    category: 'Drawing',
    documentNumber: '',
    title: '',
    revision: `REV_${String(nextRevision).padStart(2, '0')}`,
    status: 'Working',
    filePath: '',
    issuedTo: '',
    issueDate: '',
    notes: '',
  });
  const fileIndexQuery = useQuery({
    queryKey: ['project-file-index', project.id],
    queryFn: () => api.projectFileIndex(project.id),
  });
  const scanFiles = useMutation({
    mutationFn: () => api.scanProjectFiles(project.id),
    onSuccess: async (index) => {
      await Promise.all([fileIndexQuery.refetch(), invalidate()]);
      showToast(`${index.fileCount} project file(s) indexed without opening their contents.`);
    },
    onError: (error) => showToast((error as Error).message, 'error'),
  });
  const createRevision = useMutation({
    mutationFn: () =>
      api.createRevision(project.id, { ...revision, dueDate: revision.dueDate || null }),
    onSuccess: async () => {
      await invalidate();
      setRevision({
        ...revision,
        revisionNumber: revision.revisionNumber + 1,
        reissueNumber: 0,
        title: '',
        summary: '',
        changeLog: '',
        dueDate: '',
      });
      showToast('Revision register updated.');
    },
    onError: (error) => showToast((error as Error).message, 'error'),
  });
  const updateRevision = useMutation({
    mutationFn: ({ item, status }: { item: ProjectRevision; status: ProjectRevision['status'] }) =>
      api.updateRevision(project.id, item.id, {
        ...revisionInput(item),
        status,
        issuedAt: status === 'Issued' ? today() : item.issuedAt,
      }),
    onSuccess: invalidate,
    onError: (error) => showToast((error as Error).message, 'error'),
  });
  const createDocument = useMutation({
    mutationFn: () =>
      api.createDocument(project.id, { ...document, issueDate: document.issueDate || null }),
    onSuccess: async () => {
      await invalidate();
      setDocument({
        ...document,
        documentNumber: '',
        title: '',
        filePath: '',
        issuedTo: '',
        notes: '',
      });
      showToast('Document registered.');
    },
    onError: (error) => showToast((error as Error).message, 'error'),
  });
  const updateDocument = useMutation({
    mutationFn: ({ item, status }: { item: ProjectDocument; status: ProjectDocument['status'] }) =>
      api.updateDocument(project.id, item.id, { ...documentInput(item), status }),
    onSuccess: invalidate,
    onError: (error) => showToast((error as Error).message, 'error'),
  });
  return (
    <div className="operations-layout">
      <div className="operations-main-stack">
        <section className="content-card">
          <div className="operations-section-head">
            <SectionHeading
              title="Linked folder file index"
              detail={
                fileIndexQuery.data?.indexedAt
                  ? `${fileIndexQuery.data.fileCount} file(s) · scanned ${formatDate(fileIndexQuery.data.indexedAt)}`
                  : 'Metadata-only project folder scan'
              }
            />
            <button
              className="button secondary"
              type="button"
              disabled={!workspace.folderPath || scanFiles.isPending}
              title={
                workspace.folderPath ? 'Scan file names and metadata' : 'Connect the folder first'
              }
              onClick={() => scanFiles.mutate()}
            >
              {scanFiles.isPending ? <RefreshCw className="spin" /> : <HardDrive />}
              {fileIndexQuery.data?.indexedAt ? 'Rescan Changed Files' : 'Scan Project Files'}
            </button>
          </div>
          {fileIndexQuery.data?.indexedAt ? (
            <>
              <div className="folder-index-summary">
                {Object.entries(fileIndexQuery.data.counts)
                  .filter(([, count]) => count > 0)
                  .map(([category, count]) => (
                    <span key={category}>
                      <strong>{count}</strong>
                      {category === 'TechnicalBoq' ? 'BOQ' : category}
                    </span>
                  ))}
              </div>
              <div className="folder-index-safety-note">
                {fileIndexQuery.data.oneDriveManaged ? <Cloud /> : <HardDrive />}
                <span>
                  {fileIndexQuery.data.oneDriveManaged
                    ? 'OneDrive-managed metadata only. Opening an online-only file may download it.'
                    : 'Local file names and metadata only. File contents were not opened.'}
                  {fileIndexQuery.data.truncated
                    ? ' The safety limit was reached; refine the folder or scan again.'
                    : ''}
                </span>
              </div>
              <details className="folder-index-files">
                <summary>Browse detected files ({fileIndexQuery.data.fileCount})</summary>
                <div className="folder-index-file-list">
                  {fileIndexQuery.data.items.slice(0, 250).map((item) => (
                    <article className="folder-index-file" key={item.id}>
                      <span>{item.category}</span>
                      <div>
                        <strong title={item.fileName}>{item.fileName}</strong>
                        <small title={item.relativePath}>{item.relativePath}</small>
                      </div>
                      <small>
                        {fileSize(item.sizeBytes)} ·{' '}
                        {item.availability === 'OneDriveManaged' ? 'OneDrive' : item.availability}
                      </small>
                      {item.availability !== 'Unavailable' ? (
                        <button
                          className="icon-button"
                          type="button"
                          title="Open file"
                          onClick={() => void desktop.openPath(item.filePath)}
                        >
                          <FolderOpen />
                        </button>
                      ) : null}
                    </article>
                  ))}
                </div>
                {fileIndexQuery.data.items.length > 250 ? (
                  <small>
                    Showing the first 250 files. Category totals include the full index.
                  </small>
                ) : null}
              </details>
            </>
          ) : (
            <EmptyState
              title={
                workspace.folderPath
                  ? 'Project files not indexed yet'
                  : 'Project folder not connected'
              }
              description={
                workspace.folderPath
                  ? 'Run a safe metadata scan to see available drawings, DIALux files, renders, schedules, BOQ and datasheets.'
                  : 'Connect an existing project folder from Scope & Folders first.'
              }
            />
          )}
        </section>
        <section className="content-card">
          <div className="operations-section-head">
            <SectionHeading
              title="Revision register"
              detail={`${workspace.revisions.length} controlled revision(s)`}
            />
            <button
              className="button secondary"
              type="button"
              onClick={async () => {
                const result = await saveProjectReport(
                  project,
                  workspace,
                  buildRevisionRegisterReport(project, workspace),
                  'Revision_and_Document_Register',
                );
                showToast(
                  result
                    ? `Revision register PDF saved to ${result}`
                    : 'PDF export is available in the portable desktop app.',
                  result ? 'success' : 'error',
                );
              }}
            >
              <FileDown /> Export PDF
            </button>
          </div>
          <div className="revision-register">
            {workspace.revisions.map((item) => (
              <article
                className={`revision-register-row revision-${item.status.toLowerCase()}`}
                key={item.id}
              >
                <div className="revision-number">
                  REV_{String(item.revisionNumber).padStart(2, '0')}
                  {item.reissueNumber ? `.${item.reissueNumber}` : ''}
                </div>
                <div className="operation-copy">
                  <div className="operation-title-line">
                    <strong>{item.title}</strong>
                    <span>{item.status}</span>
                  </div>
                  <p>{item.summary || 'No revision summary entered.'}</p>
                  <small>
                    {item.dueDate ? `Due ${formatDate(item.dueDate)}` : 'No due date'}
                    {item.issuedAt ? ` · Issued ${formatDate(item.issuedAt)}` : ''}
                  </small>
                  {item.changeLog ? <div className="response-note">{item.changeLog}</div> : null}
                </div>
                <div className="revision-row-actions">
                  <select
                    value={item.status}
                    disabled={item.locked}
                    aria-label={`Revision status ${item.revisionNumber}`}
                    onChange={(event) =>
                      updateRevision.mutate({
                        item,
                        status: event.target.value as ProjectRevision['status'],
                      })
                    }
                  >
                    {[
                      'Draft',
                      'InProgress',
                      'InternalReview',
                      'ReadyToIssue',
                      'Issued',
                      'Superseded',
                    ].map((value) => (
                      <option key={value}>{value}</option>
                    ))}
                  </select>
                  {item.locked ? (
                    <button
                      className="button secondary compact-button"
                      type="button"
                      onClick={() =>
                        setRevision({
                          ...revision,
                          revisionNumber: item.revisionNumber,
                          reissueNumber: item.reissueNumber + 1,
                          title: `Reissue · ${item.title}`,
                          summary: '',
                          changeLog: '',
                        })
                      }
                    >
                      Create reissue
                    </button>
                  ) : null}
                </div>
              </article>
            ))}
            {!workspace.revisions.length ? (
              <EmptyState
                title="No revisions registered"
                description="Create a revision when comments arrive, then track it until issue."
              />
            ) : null}
          </div>
        </section>
        <section className="content-card">
          <SectionHeading
            title="Project file center"
            detail={`${workspace.fileCenter.filter((item) => item.state === 'Current').length} current · ${workspace.fileCenter.filter((item) => item.state === 'Missing').length} missing`}
          />
          <div className="file-center-summary" aria-label="Project file health">
            {(['Current', 'Outdated', 'Missing', 'NotGenerated'] as const).map((state) => (
              <span className={`file-center-count state-${state.toLowerCase()}`} key={state}>
                <strong>
                  {workspace.fileCenter.filter((item) => item.state === state).length}
                </strong>
                {state === 'NotGenerated' ? 'Not generated' : state}
              </span>
            ))}
          </div>
          <div className="file-center-list">
            {workspace.fileCenter.map((item) => (
              <article className="file-center-row" key={item.documentId}>
                <span className={`file-center-state state-${item.state.toLowerCase()}`}>
                  {item.state === 'Current' ? <CheckCircle2 /> : <FileWarning />}
                  {item.state === 'NotGenerated' ? 'Not generated' : item.state}
                </span>
                <div className="operation-copy">
                  <div className="operation-title-line">
                    <strong>{item.title}</strong>
                    <span>{item.category}</span>
                  </div>
                  <p className="file-center-path" title={item.filePath || 'No file path linked'}>
                    {item.filePath || 'No file path linked'}
                  </p>
                  <small>
                    {fileSize(item.sizeBytes)}
                    {item.modifiedAt ? ` · Updated ${formatDate(item.modifiedAt)}` : ''}
                    {item.oneDrive ? ' · OneDrive' : ''}
                  </small>
                  <small>{item.note}</small>
                </div>
                {item.oneDrive ? (
                  <Cloud className="file-center-cloud" aria-label="OneDrive" />
                ) : null}
                {item.filePath && item.state !== 'Missing' ? (
                  <button
                    className="button secondary compact-button"
                    type="button"
                    onClick={() => void desktop.openPath(item.filePath)}
                  >
                    <FolderOpen /> Open
                  </button>
                ) : null}
              </article>
            ))}
            {!workspace.fileCenter.length ? (
              <EmptyState
                title="No project files yet"
                description="Generated exports and registered files will be monitored here."
              />
            ) : null}
          </div>
        </section>
        <section className="content-card">
          <SectionHeading
            title="Document & deliverables register"
            detail={`${workspace.documents.length} tracked file(s)`}
          />
          <div className="document-register">
            {workspace.documents.map((item) => (
              <article className="document-row" key={item.id}>
                <span className="operation-icon">
                  <FilePlus2 />
                </span>
                <div className="operation-copy">
                  <div className="operation-title-line">
                    <strong>{item.title}</strong>
                    <span>{item.revision || 'No revision'}</span>
                  </div>
                  <p>{item.documentNumber || item.category}</p>
                  <small title={item.filePath || 'File path not linked'}>
                    {item.filePath || 'File path not linked'}
                  </small>
                </div>
                <select
                  aria-label={`Status for ${item.title}`}
                  value={item.status}
                  onChange={(event) =>
                    updateDocument.mutate({
                      item,
                      status: event.target.value as ProjectDocument['status'],
                    })
                  }
                >
                  {['Working', 'InternalReview', 'Issued', 'Superseded'].map((value) => (
                    <option key={value}>{value}</option>
                  ))}
                </select>
                {item.filePath ? (
                  <button
                    className="icon-button"
                    title="Open file"
                    onClick={() => void desktop.openPath(item.filePath)}
                  >
                    <FolderOpen />
                  </button>
                ) : null}
              </article>
            ))}
            {!workspace.documents.length ? (
              <EmptyState
                title="No documents registered"
                description="Generated Schedule and BOQ files will appear here automatically."
              />
            ) : null}
          </div>
        </section>
      </div>
      <aside className="operations-side-stack">
        <EditorCard title="Create revision" icon={<RefreshCw />}>
          <form
            className="compact-form"
            onSubmit={(event) => {
              event.preventDefault();
              createRevision.mutate();
            }}
          >
            <div className="compact-form-grid">
              <label>
                Revision
                <input
                  type="number"
                  min="0"
                  value={revision.revisionNumber}
                  onChange={(event) =>
                    setRevision({ ...revision, revisionNumber: Number(event.target.value) })
                  }
                />
              </label>
              <label>
                Reissue
                <input
                  type="number"
                  min="0"
                  max="99"
                  value={revision.reissueNumber}
                  onChange={(event) =>
                    setRevision({ ...revision, reissueNumber: Number(event.target.value) })
                  }
                />
              </label>
              <label>
                Due date
                <input
                  type="date"
                  value={revision.dueDate}
                  onChange={(event) => setRevision({ ...revision, dueDate: event.target.value })}
                />
              </label>
            </div>
            <label>
              Title
              <input
                required
                value={revision.title}
                onChange={(event) => setRevision({ ...revision, title: event.target.value })}
              />
            </label>
            <label>
              Summary
              <textarea
                rows={4}
                value={revision.summary}
                onChange={(event) => setRevision({ ...revision, summary: event.target.value })}
              />
            </label>
            <label>
              Change log
              <textarea
                rows={4}
                value={revision.changeLog}
                onChange={(event) => setRevision({ ...revision, changeLog: event.target.value })}
              />
            </label>
            <button
              className="button primary"
              disabled={!revision.title || createRevision.isPending}
            >
              <Plus /> Create Revision
            </button>
          </form>
        </EditorCard>
        <EditorCard title="Register document" icon={<FilePlus2 />}>
          <form
            className="compact-form"
            onSubmit={(event) => {
              event.preventDefault();
              createDocument.mutate();
            }}
          >
            <label>
              Category
              <select
                value={document.category}
                onChange={(event) => setDocument({ ...document, category: event.target.value })}
              >
                {[
                  'Drawing',
                  'LuxReport',
                  'Visualization',
                  'LuminaireSchedule',
                  'TechnicalBoq',
                  'Datasheet',
                  'MeetingMinutes',
                  'Transmittal',
                  'Other',
                ].map((value) => (
                  <option key={value}>{value}</option>
                ))}
              </select>
            </label>
            <div className="compact-form-grid">
              <label>
                Document no.
                <input
                  value={document.documentNumber}
                  onChange={(event) =>
                    setDocument({ ...document, documentNumber: event.target.value })
                  }
                />
              </label>
              <label>
                Revision
                <input
                  value={document.revision}
                  onChange={(event) => setDocument({ ...document, revision: event.target.value })}
                />
              </label>
            </div>
            <label>
              Title
              <input
                required
                value={document.title}
                onChange={(event) => setDocument({ ...document, title: event.target.value })}
              />
            </label>
            <label>
              File path
              <span className="field-path-control">
                <input
                  value={document.filePath}
                  onChange={(event) => setDocument({ ...document, filePath: event.target.value })}
                />
                <button
                  className="button secondary"
                  type="button"
                  onClick={async () => {
                    const selected = await desktop.selectFile();
                    if (selected) setDocument({ ...document, filePath: selected });
                  }}
                >
                  Browse
                </button>
              </span>
            </label>
            <button
              className="button secondary"
              disabled={!document.title || createDocument.isPending}
            >
              <Plus /> Register File
            </button>
          </form>
        </EditorCard>
      </aside>
    </div>
  );
}

export function ContactsModule({ project, workspace, invalidate }: ModuleProps) {
  const { showToast } = useToast();
  const [contact, setContact] = useState({
    name: '',
    email: '',
    company: project.clientName,
    role: 'Client',
  });
  const createContact = useMutation({
    mutationFn: () => api.createContact(project.id, contact),
    onSuccess: async () => {
      await invalidate();
      setContact({ ...contact, name: '', email: '' });
      showToast('Project contact added.');
    },
    onError: (error) => showToast((error as Error).message, 'error'),
  });
  return (
    <div className="operations-layout">
      <div className="operations-main-stack">
        <section className="content-card">
          <SectionHeading title="Project contacts" detail="Client, consultant and project team" />
          <div className="contact-chips">
            {workspace.contacts.map((item) => (
              <article key={item.id}>
                <span>
                  <strong>{item.name}</strong>
                  <small>
                    {item.role} · {item.company}
                  </small>
                </span>
                <a href={`mailto:${item.email}`}>{item.email}</a>
              </article>
            ))}
            {!workspace.contacts.length ? (
              <p className="muted-copy">
                Add the client, consultant, sales contact, or any person involved in this project.
              </p>
            ) : null}
          </div>
        </section>
      </div>
      <aside className="operations-side-stack">
        <EditorCard title="Add project contact" icon={<UserRoundPlus />}>
          <form
            className="compact-form"
            onSubmit={(event) => {
              event.preventDefault();
              createContact.mutate();
            }}
          >
            <label>
              Name
              <input
                required
                value={contact.name}
                onChange={(event) => setContact({ ...contact, name: event.target.value })}
              />
            </label>
            <label>
              Email
              <input
                type="email"
                required
                value={contact.email}
                onChange={(event) => setContact({ ...contact, email: event.target.value })}
              />
            </label>
            <label>
              Company
              <input
                value={contact.company}
                onChange={(event) => setContact({ ...contact, company: event.target.value })}
              />
            </label>
            <label>
              Role
              <input
                value={contact.role}
                onChange={(event) => setContact({ ...contact, role: event.target.value })}
              />
            </label>
            <button
              className="button primary"
              disabled={!contact.name || !contact.email || createContact.isPending}
            >
              <Plus /> Add Contact
            </button>
          </form>
        </EditorCard>
      </aside>
    </div>
  );
}

export function ActivityModule({ workspace }: { workspace: ProjectWorkspace }) {
  return (
    <section className="content-card">
      <SectionHeading
        title="Project activity timeline"
        detail="Immutable local history of important workspace changes"
      />
      <ol className="workspace-timeline">
        {workspace.activity.map((item) => (
          <li key={item.id}>
            <span>
              <Clock3 />
            </span>
            <div>
              <strong>{item.title}</strong>
              <p>{item.detail || `${item.entityType} · ${item.action}`}</p>
              <small>
                {item.entityType} · {item.action} ·{' '}
                {formatDate(item.createdAt, {
                  month: 'short',
                  day: 'numeric',
                  hour: '2-digit',
                  minute: '2-digit',
                })}
              </small>
            </div>
          </li>
        ))}
        {!workspace.activity.length ? (
          <EmptyState
            title="No workspace activity yet"
            description="New actions, comments, meetings, revisions and documents will appear here."
          />
        ) : null}
      </ol>
    </section>
  );
}
