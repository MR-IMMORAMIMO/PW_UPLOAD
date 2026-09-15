import type { Project, ProjectActionItem, ProjectMeeting, ProjectWorkspace } from '@scli/domain';
import { workspaceDateKey } from './local-date';

function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function lines(value: string): string {
  const safe = escapeHtml(value.trim());
  return safe ? safe.replaceAll(/\r?\n/g, '<br>') : '<span class="muted">Not recorded</span>';
}

function date(value: string | null | undefined, withTime = false): string {
  if (!value) return '-';
  const parsed = /^\d{4}-\d{2}-\d{2}$/.test(value)
    ? new Date(`${value}T12:00:00.000Z`)
    : new Date(value);
  if (Number.isNaN(parsed.getTime())) return escapeHtml(value);
  return new Intl.DateTimeFormat('en-AE', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    ...(withTime ? { hour: '2-digit', minute: '2-digit' } : {}),
    timeZone: 'Asia/Dubai',
  }).format(parsed);
}

function reportShell({
  project,
  title,
  subtitle,
  content,
}: {
  project: Project;
  title: string;
  subtitle: string;
  content: string;
}): string {
  const generatedAt = date(new Date().toISOString(), true);
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(title)}</title>
  <style>
    @page { size: A4; margin: 13mm 12mm 15mm; }
    * { box-sizing: border-box; }
    html { print-color-adjust: exact; -webkit-print-color-adjust: exact; }
    body {
      margin: 0;
      color: #173337;
      background: #ffffff;
      font-family: "Segoe UI", Arial, sans-serif;
      font-size: 10.5px;
      line-height: 1.48;
    }
    .masthead {
      display: grid;
      grid-template-columns: minmax(0, 1fr) auto;
      gap: 18px;
      align-items: start;
      border-top: 5px solid #00a7a1;
      padding: 15px 0 16px;
      margin-bottom: 16px;
      border-bottom: 1px solid #dcebea;
    }
    .brand { display: flex; align-items: center; gap: 10px; }
    .mark {
      width: 38px;
      height: 38px;
      display: grid;
      place-items: center;
      border-radius: 10px;
      color: #fff;
      background: #071718;
      font-size: 13px;
      font-weight: 800;
      letter-spacing: .08em;
    }
    .brand strong { display: block; color: #071718; font-size: 13px; letter-spacing: .08em; }
    .brand span { display: block; color: #6a8585; font-size: 8px; text-transform: uppercase; letter-spacing: .14em; }
    .document-meta { min-width: 170px; text-align: right; }
    .document-meta strong { display: block; color: #00a7a1; font-size: 10px; text-transform: uppercase; letter-spacing: .09em; }
    .document-meta span { color: #6a8585; }
    h1 { margin: 0; color: #071718; font-size: 25px; line-height: 1.12; letter-spacing: -.035em; }
    .subtitle { max-width: 620px; margin: 7px 0 0; color: #607b7c; font-size: 11px; }
    .project-strip {
      display: grid;
      grid-template-columns: 1.25fr 1.8fr 1.25fr 1fr;
      gap: 1px;
      overflow: hidden;
      margin: 14px 0 20px;
      border: 1px solid #dcebea;
      border-radius: 10px;
      background: #dcebea;
    }
    .project-strip div { min-width: 0; padding: 9px 10px; background: #f6faf9; }
    .project-strip span, .label {
      display: block;
      color: #729091;
      font-size: 7.5px;
      font-weight: 700;
      letter-spacing: .08em;
      text-transform: uppercase;
    }
    .project-strip strong { display: block; margin-top: 2px; color: #173337; overflow-wrap: anywhere; }
    section { margin: 0 0 18px; break-inside: auto; }
    section.keep-together { break-inside: avoid; }
    .section-title { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; margin: 0 0 8px; }
    .section-title h2 { margin: 0; color: #071718; font-size: 13px; }
    .section-title span { color: #729091; font-size: 8.5px; }
    .summary-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; margin-bottom: 18px; }
    .summary-card { padding: 10px; border: 1px solid #dcebea; border-radius: 9px; background: #f6faf9; }
    .summary-card strong { display: block; margin-top: 3px; color: #071718; font-size: 18px; }
    .summary-card.accent { border-color: #9bdedb; background: #edfafa; }
    .summary-card.accent strong { color: #008984; }
    table { width: 100%; border-collapse: separate; border-spacing: 0; table-layout: fixed; }
    thead { display: table-header-group; }
    tr { break-inside: avoid; }
    th {
      padding: 7px 8px;
      color: #ffffff;
      background: #173f42;
      border-right: 1px solid #315658;
      font-size: 7.5px;
      letter-spacing: .07em;
      text-align: left;
      text-transform: uppercase;
    }
    th:first-child { border-radius: 7px 0 0 0; }
    th:last-child { border: 0; border-radius: 0 7px 0 0; }
    td {
      padding: 6px 8px;
      vertical-align: top;
      border-right: 1px solid #e3eeed;
      border-bottom: 1px solid #e3eeed;
      background: #ffffff;
      overflow-wrap: anywhere;
      word-break: break-word;
    }
    td:first-child { border-left: 1px solid #e3eeed; }
    tbody tr:nth-child(even) td { background: #f9fbfb; }
    .status {
      display: inline-block;
      max-width: 100%;
      padding: 2px 6px;
      border-radius: 999px;
      color: #007b77;
      background: #e7f7f6;
      font-size: 7.5px;
      font-weight: 700;
      white-space: normal;
    }
    .status.open, .status.missing, .status.blocking, .status.urgent { color: #9e4b21; background: #fff0e7; }
    .detail-card { padding: 13px 14px; border: 1px solid #dcebea; border-radius: 10px; break-inside: avoid; }
    .detail-card + .detail-card { margin-top: 9px; }
    .detail-card h3 { margin: 0 0 6px; color: #071718; font-size: 11px; }
    .detail-card p { margin: 0; white-space: normal; overflow-wrap: anywhere; }
    .detail-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 9px; }
    .detail-field { min-width: 0; padding: 10px; border-radius: 8px; background: #f6faf9; }
    .detail-field.full { grid-column: 1 / -1; }
    .detail-field .label { margin-bottom: 4px; }
    .muted { color: #789092; font-style: italic; }
    .check { color: #008984; font-weight: 700; }
    .unchecked { color: #8ca0a0; }
    footer {
      margin-top: 24px;
      padding-top: 9px;
      border-top: 1px solid #dcebea;
      color: #789092;
      font-size: 7.5px;
      text-align: center;
    }
  </style>
</head>
<body>
  <header class="masthead">
    <div>
      <div class="brand">
        <div class="mark">ST</div>
        <div><strong>SCIENTECHNIC</strong><span>Lighting Design Workspace</span></div>
      </div>
      <div style="height:18px"></div>
      <h1>${escapeHtml(title)}</h1>
      <p class="subtitle">${escapeHtml(subtitle)}</p>
    </div>
    <div class="document-meta">
      <strong>Project Record</strong>
      <span>Generated ${generatedAt}</span>
    </div>
  </header>
  <div class="project-strip">
    <div><span>Project Code</span><strong>${escapeHtml(project.projectCode)}</strong></div>
    <div><span>Project</span><strong>${escapeHtml(project.projectName)}</strong></div>
    <div><span>Client</span><strong>${escapeHtml(project.clientName || '-')}</strong></div>
    <div><span>Revision</span><strong>REV_${String(project.revisionNumber).padStart(2, '0')}</strong></div>
  </div>
  ${content}
  <footer>SCT Workspace - Personal lighting design record</footer>
</body>
</html>`;
}

function summaryCard(label: string, value: string | number, accent = false): string {
  return `<div class="summary-card${accent ? ' accent' : ''}"><span class="label">${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></div>`;
}

function tableEmpty(message: string, columns: number): string {
  return `<tr><td colspan="${columns}"><span class="muted">${escapeHtml(message)}</span></td></tr>`;
}

export function buildInformationReport(project: Project, workspace: ProjectWorkspace): string {
  const openRequirements = workspace.requirements.filter(
    (item) => item.status === 'Missing' || item.status === 'Requested',
  ).length;
  const completedChecks = workspace.checklist.filter(
    (item) => item.completed || item.waived,
  ).length;
  const openActions = workspace.actions.filter(
    (item) => item.status !== 'Completed' && item.status !== 'Cancelled',
  ).length;
  const overdueActions = workspace.actions.filter(
    (item) =>
      item.dueDate &&
      item.dueDate < workspaceDateKey() &&
      item.status !== 'Completed' &&
      item.status !== 'Cancelled',
  ).length;

  return reportShell({
    project,
    title: 'Project Readiness Report',
    subtitle: 'Missing information, scope checklist and action register.',
    content: `
      <div class="summary-grid">
        ${summaryCard('Project Health', `${workspace.health.score}%`, true)}
        ${summaryCard('Open Information', openRequirements)}
        ${summaryCard('Checklist', `${completedChecks}/${workspace.checklist.length}`)}
        ${summaryCard('Open / Overdue Actions', `${openActions} / ${overdueActions}`)}
      </div>
      <section>
        <div class="section-title"><h2>Missing Information Register</h2><span>${workspace.requirements.length} item(s)</span></div>
        <table>
          <colgroup><col style="width:26%"><col style="width:34%"><col style="width:13%"><col style="width:14%"><col style="width:13%"></colgroup>
          <thead><tr><th>Information</th><th>Details / Source</th><th>Impact</th><th>Status</th><th>Due</th></tr></thead>
          <tbody>${
            workspace.requirements.length
              ? workspace.requirements
                  .map(
                    (item) => `<tr>
                <td><strong>${escapeHtml(item.title)}</strong><br><span class="muted">${escapeHtml(item.category)}</span></td>
                <td>${lines(item.details)}${item.requestedFrom ? `<br><span class="muted">Requested from ${escapeHtml(item.requestedFrom)}</span>` : ''}</td>
                <td><span class="status ${item.impact.toLowerCase()}">${escapeHtml(item.impact)}</span></td>
                <td><span class="status ${item.status.toLowerCase()}">${escapeHtml(item.status)}</span></td>
                <td>${date(item.dueDate)}</td>
              </tr>`,
                  )
                  .join('')
              : tableEmpty('No missing information has been registered.', 5)
          }</tbody>
        </table>
      </section>
      <section>
        <div class="section-title"><h2>Scope Checklist</h2><span>${workspace.health.checklistPercent}% complete</span></div>
        <table>
          <colgroup><col style="width:25%"><col style="width:55%"><col style="width:20%"></colgroup>
          <thead><tr><th>Category</th><th>Check</th><th>Result</th></tr></thead>
          <tbody>${
            workspace.checklist.length
              ? workspace.checklist
                  .map(
                    (item) => `<tr>
                <td>${escapeHtml(item.category)}</td>
                <td>${escapeHtml(item.title)}</td>
                <td class="${item.completed || item.waived ? 'check' : 'unchecked'}">${item.waived ? 'Waived' : item.completed ? 'Complete' : 'Pending'}</td>
              </tr>`,
                  )
                  .join('')
              : tableEmpty('No checklist items.', 3)
          }</tbody>
        </table>
      </section>
      <section class="keep-together">
        <div class="section-title"><h2>Action Register</h2><span>${workspace.actions.length} action(s)</span></div>
        ${actionsTable(workspace.actions)}
      </section>`,
  });
}

function actionsTable(actions: ProjectActionItem[]): string {
  return `<table>
    <colgroup><col style="width:31%"><col style="width:27%"><col style="width:14%"><col style="width:14%"><col style="width:14%"></colgroup>
    <thead><tr><th>Action</th><th>Details</th><th>Owner</th><th>Due</th><th>Status</th></tr></thead>
    <tbody>${
      actions.length
        ? actions
            .map(
              (item) => `<tr>
          <td><strong>${escapeHtml(item.title)}</strong><br><span class="status ${item.priority.toLowerCase()}">${escapeHtml(item.priority)}</span></td>
          <td>${lines(item.details)}</td>
          <td>${escapeHtml(item.owner || '-')}</td>
          <td>${date(item.dueDate)}</td>
          <td><span class="status ${item.status.toLowerCase()}">${escapeHtml(item.status)}</span></td>
        </tr>`,
            )
            .join('')
        : tableEmpty('No actions have been registered.', 5)
    }</tbody>
  </table>`;
}

export function buildMeetingReport(
  project: Project,
  workspace: ProjectWorkspace,
  meeting: ProjectMeeting,
): string {
  const linkedActions = workspace.actions.filter((item) => item.sourceId === meeting.id);
  return reportShell({
    project,
    title: 'Meeting Notes',
    subtitle: meeting.title,
    content: `
      <div class="summary-grid">
        ${summaryCard('Date', date(meeting.startAt))}
        ${summaryCard('Time', date(meeting.startAt, true).split(',').at(-1)?.trim() ?? '-')}
        ${summaryCard('Status', meeting.status, true)}
        ${summaryCard('Attendees', meeting.attendees.length)}
      </div>
      <section>
        <div class="detail-grid">
          <div class="detail-field"><span class="label">Location</span>${escapeHtml(meeting.location || '-')}</div>
          <div class="detail-field"><span class="label">Attendees</span>${escapeHtml(meeting.attendees.join(', ') || '-')}</div>
          <div class="detail-field full"><span class="label">Agenda</span>${lines(meeting.agenda)}</div>
          <div class="detail-field full"><span class="label">Discussion Notes</span>${lines(meeting.notes)}</div>
          <div class="detail-field full"><span class="label">Decisions</span>${lines(meeting.decisions)}</div>
        </div>
      </section>
      <section>
        <div class="section-title"><h2>Actions from this Meeting</h2><span>${linkedActions.length} action(s)</span></div>
        ${actionsTable(linkedActions)}
      </section>`,
  });
}

export function buildRevisionRegisterReport(project: Project, workspace: ProjectWorkspace): string {
  return reportShell({
    project,
    title: 'Revision & Document Register',
    subtitle: 'Controlled project revisions and deliverable file status.',
    content: `
      <div class="summary-grid">
        ${summaryCard('Revisions', workspace.revisions.length, true)}
        ${summaryCard('Issued Revisions', workspace.revisions.filter((item) => item.status === 'Issued').length)}
        ${summaryCard('Documents', workspace.documents.length)}
        ${summaryCard('Issued Documents', workspace.documents.filter((item) => item.status === 'Issued').length)}
      </div>
      <section>
        <div class="section-title"><h2>Revision Register</h2><span>${workspace.revisions.length} revision(s)</span></div>
        <table>
          <colgroup><col style="width:12%"><col style="width:25%"><col style="width:31%"><col style="width:15%"><col style="width:17%"></colgroup>
          <thead><tr><th>Revision</th><th>Title</th><th>Summary / Changes</th><th>Status</th><th>Issued / Due</th></tr></thead>
          <tbody>${
            workspace.revisions.length
              ? workspace.revisions
                  .map(
                    (item) => `<tr>
                <td><strong>REV_${String(item.revisionNumber).padStart(2, '0')}${item.reissueNumber ? `.${item.reissueNumber}` : ''}</strong></td>
                <td>${escapeHtml(item.title)}</td>
                <td>${lines(item.summary)}${item.changeLog ? `<br><span class="muted">Changes: ${lines(item.changeLog)}</span>` : ''}</td>
                <td><span class="status ${item.status.toLowerCase()}">${escapeHtml(item.status)}</span></td>
                <td>${item.issuedAt ? `Issued ${date(item.issuedAt)}` : item.dueDate ? `Due ${date(item.dueDate)}` : '-'}</td>
              </tr>`,
                  )
                  .join('')
              : tableEmpty('No revisions have been registered.', 5)
          }</tbody>
        </table>
      </section>
      <section>
        <div class="section-title"><h2>Document & Deliverables Register</h2><span>${workspace.documents.length} document(s)</span></div>
        <table>
          <colgroup><col style="width:17%"><col style="width:17%"><col style="width:27%"><col style="width:13%"><col style="width:13%"><col style="width:13%"></colgroup>
          <thead><tr><th>Category</th><th>Document No.</th><th>Title</th><th>Revision</th><th>Status</th><th>Issue Date</th></tr></thead>
          <tbody>${
            workspace.documents.length
              ? workspace.documents
                  .map(
                    (item) => `<tr>
                <td>${escapeHtml(item.category)}</td>
                <td>${escapeHtml(item.documentNumber || '-')}</td>
                <td><strong>${escapeHtml(item.title)}</strong></td>
                <td>${escapeHtml(item.revision || '-')}</td>
                <td><span class="status ${item.status.toLowerCase()}">${escapeHtml(item.status)}</span></td>
                <td>${date(item.issueDate)}</td>
              </tr>`,
                  )
                  .join('')
              : tableEmpty('No documents have been registered.', 6)
          }</tbody>
        </table>
      </section>`,
  });
}
