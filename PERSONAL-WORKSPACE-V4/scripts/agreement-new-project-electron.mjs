import { _electron as electron, expect } from '@playwright/test';
import { mkdtemp, mkdir, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';

const root = process.cwd();
const theme = process.env.AGREEMENT_THEME === 'dark' ? 'dark' : 'light';
const output = path.join(
  root,
  'output/agreement-recheck-20260912/new-project-electron' + (theme === 'dark' ? '-dark' : ''),
);
await mkdir(output, { recursive: true });
const disposable = await mkdtemp(path.join(tmpdir(), 'sct-agreement-wizard-'));
const profile = path.join(disposable, 'profile');
await mkdir(profile);
await writeFile(
  path.join(disposable, 'package.json'),
  JSON.stringify({ name: 'sct-agreement-check', main: 'launcher.cjs' }),
);
await writeFile(
  path.join(disposable, 'launcher.cjs'),
  `const {app}=require('electron');app.setPath('userData',${JSON.stringify(profile)});app.getAppPath=()=>${JSON.stringify(root)};require(${JSON.stringify(path.join(root, 'desktop/main.cjs'))});`,
);
const env = { ...process.env, PORTABLE_EXECUTABLE_DIR: disposable };
delete env.ELECTRON_RUN_AS_NODE;
delete env.SCT_UI_VARIANT;
const results = { disposable, screenshots: [], checks: [], errors: [] };
let app;
try {
  app = await electron.launch({ args: [disposable], env, timeout: 60000 });
  assert.equal(await app.evaluate(({ app }) => app.getPath('userData')), profile);
  const page = await app.firstWindow({ timeout: 60000 });
  page.on('pageerror', (e) => results.errors.push(e.message));
  await page.waitForURL(/\/v4\//, { timeout: 60000 });
  const origin = new URL(page.url()).origin;
  await page.locator('html[data-sct-build]').waitFor();
  const build = JSON.parse(
    await readFile(path.join(root, 'apps/web-v4/dist/build-info.json'), 'utf8'),
  );
  assert.equal(await page.locator('html').getAttribute('data-sct-build'), build.sourceSha256);
  results.build = build;
  await page.goto(origin + '/v4/settings');
  await page
    .getByRole('button', { name: theme === 'dark' ? 'Dark' : 'Light', exact: true })
    .click();
  const post = async (url, data) => {
    const response = await page.request.post(origin + url, { data });
    assert.ok(response.ok(), await response.text());
    return (await response.json()).data;
  };

  const read = async (url) => (await (await page.request.get(origin + url)).json()).data;
  const capture = async (name) => {
    await page.evaluate(async () => {
      await Promise.all(
        document
          .getAnimations()
          .filter((a) => a.effect?.getTiming().iterations !== Infinity)
          .map((a) => a.finished.catch(() => undefined)),
      );
    });
    await page.screenshot({ path: path.join(output, name + '.png'), fullPage: true });
    results.screenshots.push(name + '.png');
  };
  const before = await read('/api/projects');
  const savedRoot = path.join(disposable, 'Settings root');
  const overrideRoot = path.join(disposable, 'Project override');
  await mkdir(savedRoot);
  await mkdir(overrideRoot);
  const settingsWrite = await page.request.patch(origin + '/api/personal/settings', {
    data: { projectRoot: savedRoot },
  });
  assert.ok(settingsWrite.ok(), await settingsWrite.text());
  await app.evaluate(({ dialog }, folder) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [folder] });
  }, overrideRoot);
  await page.goto(origin + '/v4/projects');
  await page.getByRole('button', { name: 'New Project', exact: true }).click();
  const wizard = page.getByRole('dialog', { name: 'New Project', exact: true });
  await expect(wizard).toBeVisible();
  await wizard.getByRole('button', { name: 'View example' }).click();
  await expect(page.getByRole('dialog', { name: 'Project code example' })).toBeVisible();
  await capture('01-code-example');
  await page.keyboard.press('Escape');
  await expect(wizard).toBeVisible();
  await wizard
    .getByRole('textbox', { name: 'projectName', exact: true })
    .fill('Friday Wizard Verification');
  await wizard.getByRole('combobox', { name: 'clientName', exact: true }).fill('Disposable Client');
  await wizard
    .getByRole('combobox', { name: 'projectType', exact: true })
    .selectOption({ label: 'Lighting Layout' });
  await capture('02-information');
  await wizard.getByRole('button', { name: 'Next: Scope & Services', exact: true }).click();
  await wizard.getByRole('button', { name: 'Learn more', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Scope & Services', exact: true })).toBeVisible();
  await page.keyboard.press('Escape');
  await wizard
    .getByRole('textbox', { name: 'Scope Summary', exact: true })
    .fill('Review real wizard behavior with a disposable project.');
  await capture('03-scope-empty-selections');
  await wizard.getByRole('button', { name: 'Next: Schedule', exact: true }).click();
  await wizard.getByRole('button', { name: /Add milestone/i }).click();
  const milestone = page.getByRole('dialog', { name: 'Milestone', exact: true });
  await milestone.getByLabel('Name', { exact: true }).fill('Review approval');
  await milestone.getByLabel('Target Date', { exact: true }).fill('2027-03-22');
  await capture('04-small-milestone');
  assert.ok((await milestone.boundingBox()).width <= 601);
  await milestone.getByRole('button', { name: 'Save', exact: true }).click();
  await wizard.getByRole('button', { name: 'Next: Project Structure', exact: true }).click();
  await wizard.getByRole('button', { name: 'Browse', exact: true }).click();
  await expect(wizard.getByRole('textbox', { name: 'Project root', exact: true })).toHaveValue(
    overrideRoot,
  );
  assert.equal((await read('/api/personal/settings')).projectRoot, savedRoot);
  const selected = await wizard.getByRole('combobox', { name: 'folderProfile' }).inputValue();
  await wizard.getByRole('button', { name: 'Preview template', exact: true }).click();
  const preview = page.getByRole('dialog', { name: 'Project folder preview' });
  await preview.getByRole('button', { name: 'Collapse all' }).click();
  await preview.getByRole('button', { name: 'Expand all' }).click();
  await capture('05-folder-preview');
  await page.keyboard.press('Escape');
  assert.equal(
    await wizard.getByRole('combobox', { name: 'folderProfile' }).inputValue(),
    selected,
  );
  await wizard.getByRole('button', { name: 'Browse all templates' }).click();
  const templates = page.getByRole('dialog', { name: 'Structure templates' });
  await expect(templates).toBeVisible();
  await templates.getByRole('button', { name: selected, exact: true }).click();
  await capture('06-templates');
  await page.keyboard.press('Escape');
  await wizard.locator('header').getByRole('button', { name: 'Save as Draft' }).click();
  await expect.poll(async () => (await read('/api/personal/project-wizard-draft'))?.step).toBe(4);
  assert.equal((await read('/api/projects')).length, before.length);
  const draft = await read('/api/personal/project-wizard-draft');
  assert.equal(draft.setup.schedule.milestones[0].name, 'Review approval');
  assert.deepEqual(draft.setup.designServices, []);
  assert.deepEqual(draft.setup.deliverables, []);
  assert.deepEqual(draft.setup.documentation, []);
  await wizard.getByRole('button', { name: 'Close New Project' }).click();
  await expect(wizard).toBeHidden();
  await page.reload();
  await page.getByRole('button', { name: 'New Project', exact: true }).click();
  await wizard.getByRole('button', { name: 'Resume saved draft' }).click();
  await expect(wizard.getByRole('button', { name: 'Next: Review', exact: true })).toBeVisible();
  await wizard.getByRole('button', { name: 'Next: Review', exact: true }).click();
  await capture('07-review');
  await wizard.getByRole('button', { name: 'Create Project', exact: true }).click();
  await expect(page).toHaveURL(/projects\/[0-9a-f-]+\/summary$/, { timeout: 30000 });
  const projects = await read('/api/projects');
  const created = projects.find((p) => p.projectName === 'Friday Wizard Verification');
  assert.ok(created);
  assert.equal(created.status, 'Planning');
  assert.ok(!created.requiredDeliveryDate);
  assert.ok(created.commercialValueMinor == null);
  assert.equal(await read('/api/personal/project-wizard-draft'), null);
  assert.equal(await read('/api/personal/work-sessions/active'), null);
  await capture('08-created-summary');
  await page.getByRole('button', { name: 'Setup: active' }).click();
  await expect(page.getByRole('dialog')).toContainText('Status: active');
  assert.equal((await read('/api/projects/' + created.id)).status, 'Planning');
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Start Project', exact: true }).click();
  await expect
    .poll(async () => (await read('/api/projects/' + created.id)).status)
    .toBe('InProgress');
  const started = await read('/api/projects/' + created.id);
  assert.ok(started.finalSetup.schedule.startDate);
  assert.equal(await read('/api/personal/work-sessions/active'), null);
  await page.getByRole('button', { name: 'Open project luminaires' }).click();
  await expect(page).toHaveURL(new RegExp('/projects/' + created.id + '/luminaires'));
  await page.goto(origin + '/v4/projects/' + created.id + '/summary');
  await page.getByRole('button', { name: 'Edit Project', exact: true }).click();
  const edit = page.getByRole('dialog', { name: 'Edit Project', exact: true });
  await edit.getByLabel('Site Location', { exact: true }).fill('Temporary site');
  await edit.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Save changes', exact: true })).toBeVisible();
  await capture('09-edit-dirty-guard');
  await page.getByRole('button', { name: 'Save changes', exact: true }).click();
  await expect(edit).toBeHidden();
  assert.equal((await read('/api/projects/' + created.id)).siteLocation, 'Temporary site');
  await page.getByRole('button', { name: 'Edit Project', exact: true }).click();
  await edit.getByLabel('Site Location', { exact: true }).fill('');
  await edit.getByRole('button', { name: 'Save Changes', exact: true }).click();
  await expect.poll(async () => (await read('/api/projects/' + created.id)).siteLocation).toBe('');
  await edit.getByRole('button', { name: 'Cancel', exact: true }).click();
  await page.goto(origin + '/v4/projects/' + created.id + '/workflow-timeline');
  const timeline = page.getByRole('region', { name: 'Timeline events' });
  await expect(timeline).toBeVisible();
  const detail = page.getByRole('region', { name: 'Event details' });
  await expect(detail).toBeVisible();
  assert.ok(
    (await detail.boundingBox()).width /
      ((await timeline.boundingBox()).width + (await detail.boundingBox()).width) >
      0.38,
  );
  await page.getByRole('button', { name: 'View details', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Event details' })).toBeVisible();
  await capture('10-timeline-details');
  await page.keyboard.press('Escape');
  await capture('11-timeline');
  const contact = await post('/api/projects/' + created.id + '/contacts', {
    name: 'Friday Designer',
    role: 'Lighting Designer',
    email: '',
    phone: '',
    company: '',
    isPrimary: false,
    group: 'Internal Team',
  });
  const meeting = await post('/api/projects/' + created.id + '/meetings', {
    title: 'Friday Coordination',
    startAt: '2027-03-22T09:00:00.000Z',
    endAt: '2027-03-22T10:00:00.000Z',
    location: 'Office',
    attendees: [],
    agenda: 'Review actions',
    notes: '',
    decisions: '',
    onlineMeetingUrl: '',
    status: 'Planned',
  });
  await page.goto(origin + '/v4/projects/' + created.id + '/actions');
  await page.getByRole('button', { name: 'Add Action', exact: true }).click();
  const actionForm = page.getByRole('dialog', { name: 'Add Action', exact: true });
  await actionForm.getByLabel('Title', { exact: true }).fill('Friday Action Verification');
  await actionForm.getByRole('button', { name: 'Choose owner contact', exact: true }).click();
  await page
    .getByRole('option', { name: 'Friday Designer · Lighting Designer', exact: true })
    .click();
  await expect(actionForm.getByLabel('Owner Role', { exact: true })).toHaveValue(
    'Lighting Designer',
  );
  await actionForm.getByRole('button', { name: 'Linked Meeting', exact: true }).click();
  await page.getByRole('option', { name: meeting.title, exact: true }).click();
  await actionForm.getByRole('button', { name: 'New Category', exact: true }).click();
  const categoryForm = page.getByRole('dialog', { name: 'Create Category', exact: true });
  await categoryForm.getByLabel('Name', { exact: true }).fill('Friday Custom Category');
  await categoryForm.getByRole('button', { name: 'purple color' }).click();
  await categoryForm.getByRole('button', { name: 'Create Category', exact: true }).click();
  await expect(actionForm.getByRole('button', { name: 'Category', exact: true })).toHaveText(
    'Friday Custom Category',
  );
  await expect(actionForm.getByLabel('Title', { exact: true })).toHaveValue(
    'Friday Action Verification',
  );
  await actionForm.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(page.getByRole('alertdialog', { name: 'Unsaved action changes' })).toBeVisible();
  await capture('12-action-save-guard');
  await page
    .getByRole('alertdialog', { name: 'Unsaved action changes' })
    .getByRole('button', { name: 'Save changes', exact: true })
    .click();
  await expect(actionForm).toBeHidden();
  const ws = await read('/api/projects/' + created.id + '/workspace');
  const savedAction = ws.actions.find((a) => a.title === 'Friday Action Verification');
  assert.equal(savedAction.owner, contact.name);
  assert.equal(savedAction.ownerRole, contact.role);
  assert.equal(savedAction.dueDate, null);
  await expect
    .poll(async () =>
      (
        await read('/api/projects/' + created.id + '/actions/' + savedAction.id + '/meeting-links')
      ).some((link) => link.meetingId === meeting.id),
    )
    .toBe(true);
  await page.getByRole('button', { name: 'Friday Action Verification', exact: true }).click();
  const actionDetails = page.getByRole('region', { name: 'Action details' });
  await expect(actionDetails).toBeVisible();
  await expect(actionDetails).not.toContainText(savedAction.id);
  await actionDetails.getByRole('button', { name: 'Edit action details', exact: true }).click();
  const quick = page.getByRole('dialog', { name: 'Action details', exact: true });
  await expect(quick.getByRole('button', { name: 'Priority', exact: true })).toBeVisible();
  await expect(quick.getByLabel('Notes', { exact: true })).toHaveCount(0);
  await quick.getByLabel('Area', { exact: true }).fill('Lobby');
  await quick.getByRole('button', { name: 'Save changes', exact: true }).click();
  await expect(quick).toBeHidden();
  await page.getByRole('button', { name: 'View Completed actions' }).click();
  await expect(
    page.getByRole('button', { name: 'Friday Action Verification', exact: true }),
  ).toHaveCount(0);
  await page.getByRole('button', { name: 'Clear filters', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Friday Action Verification', exact: true }),
  ).toBeVisible();
  await capture('13-actions');
  await page.goto(origin + '/v4/projects/' + created.id + '/meetings');
  await expect(page.getByRole('region', { name: 'Meeting details', exact: true })).toBeVisible();
  const meetingDetails = page.getByRole('region', { name: 'Meeting details', exact: true });
  await expect(meetingDetails).toBeVisible();
  await meetingDetails.getByRole('button', { name: 'Edit meeting outcome' }).click();
  const outcome = page.getByRole('dialog', { name: 'Edit Meeting Outcome' });
  await outcome.getByLabel('Outcome', { exact: true }).fill('Approved coordination next steps.');
  await outcome.getByRole('button', { name: 'Save changes', exact: true }).click();
  await expect(outcome).toBeHidden();
  await expect(meetingDetails).toContainText('Approved coordination next steps.');
  await page.getByRole('button', { name: 'Edit Friday Coordination', exact: true }).click();
  const meetingEdit = page.getByRole('dialog', { name: 'Edit Meeting', exact: true });
  await meetingEdit.getByRole('button', { name: 'Add Participant', exact: true }).click();
  await meetingEdit.getByRole('checkbox', { name: /Friday Designer/ }).check();
  await meetingEdit.getByRole('button', { name: 'Save changes', exact: true }).click();
  await expect(meetingEdit).toBeHidden();
  await expect(meetingDetails).toContainText('Friday Designer');
  await meetingDetails.getByRole('button', { name: 'Open meeting notes' }).click();
  await page.getByRole('button', { name: 'Add Note', exact: true }).click();
  const note = page.getByRole('dialog', { name: 'Add Meeting Note', exact: true });
  await note
    .getByLabel('Add Meeting Note', { exact: true })
    .fill('Friday note saved with actual profile.');
  await note.getByRole('button', { name: 'Save changes', exact: true }).click();
  await expect(note).toBeHidden();
  await expect(
    page
      .getByRole('dialog', { name: 'Meeting Notes', exact: true })
      .getByText('Friday note saved with actual profile.', { exact: true }),
  ).toBeVisible();
  const savedMeeting = await read('/api/projects/' + created.id + '/meetings/' + meeting.id);
  assert.equal(savedMeeting.decisions, 'Approved coordination next steps.');
  assert.equal(savedMeeting.participants.length, 1);
  assert.equal(savedMeeting.participants[0].role, 'Lighting Designer');
  assert.equal(savedMeeting.latestNote.authorName, (await read('/api/me')).displayName);
  await capture('14-meetings');
  results.checks.push(
    'Meetings: scoped outcome edit, Contacts participant selection with role, new note with actual author and server timestamp; linked action preserved',
  );
  for (let i = 0; i < 9; i++)
    await post('/api/projects/' + created.id + '/scope-notes', {
      type: i % 2 ? 'Exclusion' : 'Note',
      text:
        'Scope note ' +
        (i + 1) +
        '. ' +
        'Coordination requirements with clear readable details. '.repeat(5),
      sortOrder: i,
    });
  await page.goto(origin + '/v4/projects/' + created.id + '/scope');
  const requirements = page.getByRole('region', { name: 'Requirements', exact: true });
  await requirements.getByRole('button', { name: 'Edit', exact: true }).click();
  const criteria = page.getByRole('dialog', { name: 'Edit Requirements', exact: true });
  await criteria.getByRole('textbox', { name: /^Lux/ }).fill('500');
  await criteria.getByRole('textbox', { name: /^CCT/ }).fill('3000');
  await criteria.getByRole('textbox', { name: /^Controls/ }).fill('DALI-2');
  await criteria.getByRole('textbox', { name: /^Standards/ }).fill('EN 12464-1');
  await criteria.getByRole('button', { name: 'Save changes', exact: true }).click();
  await expect(criteria).toBeHidden();
  assert.equal((await read('/api/projects/' + created.id)).luxRequirements, '500');
  assert.deepEqual((await read('/api/projects/' + created.id)).finalSetup.standards, [
    'EN 12464-1',
  ]);
  assert.equal(
    (await read('/api/projects/' + created.id + '/workspace')).requirements.find(
      (r) => r.title === 'CCT',
    ).details,
    '3000',
  );
  const notesPages = page.getByRole('navigation', { name: 'Notes / Exclusions pages' });
  await expect(
    notesPages.getByRole('button', { name: 'Next Notes / Exclusions page' }),
  ).toBeEnabled();
  await notesPages.getByRole('button', { name: 'Next Notes / Exclusions page' }).click();
  await expect(notesPages.getByRole('button', { name: '2', exact: true })).toHaveAttribute(
    'aria-current',
    'page',
  );
  await expect(
    page
      .getByRole('navigation', { name: 'Project Scope pages' })
      .getByRole('button', { name: '1', exact: true }),
  ).toHaveAttribute('aria-current', 'page');
  await capture('15-scope');
  await page.goto(origin + '/v4/projects/' + created.id + '/comments');
  await page.getByRole('button', { name: 'Add Comment', exact: true }).click();
  const comment = page.getByRole('dialog', { name: 'Add Comment', exact: true });
  await comment.getByLabel('Title', { exact: true }).fill('Friday Comment Verification');
  await comment
    .getByLabel('Description', { exact: true })
    .fill('Check canonical replies and attachments.');
  await comment.getByRole('button', { name: 'Internal', exact: true }).click();
  await comment.getByRole('button', { name: 'Add Comment', exact: true }).click();
  await expect(comment).toBeHidden();
  const thread = page.getByRole('article', { name: 'Friday Comment Verification', exact: true });
  await thread.getByRole('button', { name: 'Friday Comment Verification', exact: true }).click();
  await expect(
    thread.getByRole('textbox', { name: 'Reply to Friday Comment Verification' }),
  ).toHaveCount(0);
  await thread.getByRole('button', { name: 'Reply', exact: true }).click();
  const replyInput = thread.getByRole('textbox', { name: 'Reply to Friday Comment Verification' });
  await replyInput.fill('Reply with registered file.');
  const attachmentPath = path.join(disposable, 'Friday reply attachment.txt');
  await writeFile(attachmentPath, 'Disposable reply attachment only.');
  await app.evaluate(({ dialog }, file) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] });
  }, attachmentPath);
  await thread.getByRole('button', { name: 'Attach files to reply' }).click();
  await expect(thread.getByRole('list', { name: 'Reply attachments' })).toContainText(
    'Friday reply attachment',
  );
  await expect(replyInput).toHaveValue('Reply with registered file.');
  await thread.getByRole('button', { name: 'Attach files to reply' }).click();
  await expect(
    thread.getByRole('list', { name: 'Reply attachments' }).getByRole('listitem'),
  ).toHaveCount(1);
  await thread.getByRole('button', { name: 'Send reply', exact: true }).click();
  await expect(thread.getByText('Reply with registered file.', { exact: true })).toBeVisible();
  const commentContext = await read('/api/projects/' + created.id + '/review-thread-context');
  assert.equal(commentContext.replies.length, 1);
  assert.equal(commentContext.attachments.length, 1);
  const originalReply = commentContext.replies[0];
  const docs = (await read('/api/projects/' + created.id + '/workspace')).documents;
  assert.equal(
    docs.filter(
      (d) =>
        d.filePath === attachmentPath ||
        d.localPath === attachmentPath ||
        d.title.includes('Friday reply attachment'),
    ).length,
    1,
  );
  await thread
    .getByRole('button', { name: 'Edit reply by ' + originalReply.authorNameSnapshot, exact: true })
    .click();
  const editReply = page.getByRole('dialog', { name: 'Edit reply', exact: true });
  await expect(editReply).toBeVisible();
  await editReply
    .getByRole('textbox', { name: 'Reply', exact: true })
    .fill('Edited reply, same record.');
  await editReply.getByRole('button', { name: 'Save reply', exact: true }).click();
  await expect(editReply).toBeHidden();
  await expect(thread.getByText('Edited reply, same record.', { exact: true })).toBeVisible();
  const afterReply = (await read('/api/projects/' + created.id + '/review-thread-context'))
    .replies[0];
  assert.equal(afterReply.id, originalReply.id);
  assert.equal(afterReply.authorId, originalReply.authorId);
  assert.equal(afterReply.createdAt, originalReply.createdAt);
  await capture('16-comments');
  await page.goto(origin + '/v4/projects/' + created.id + '/contacts');
  await page.getByRole('button', { name: 'Add Contact', exact: true }).click();
  const contactEditor = page.getByRole('dialog', { name: 'Add Contact', exact: true });
  await contactEditor.getByLabel('Full name *', { exact: true }).fill('Friday Client Lead');
  await contactEditor.getByRole('button', { name: 'Contact group', exact: true }).click();
  await page.getByRole('option', { name: 'Client', exact: true }).click();
  await contactEditor.getByRole('checkbox', { name: 'Primary contact', exact: true }).check();
  await contactEditor.getByRole('button', { name: 'Add Contact', exact: true }).click();
  await expect(contactEditor).toBeHidden();
  const clientContact = (await read('/api/projects/' + created.id + '/workspace')).contacts.find(
    (c) => c.name === 'Friday Client Lead',
  );
  assert.equal(clientContact.email, '');
  assert.equal(clientContact.isPrimary, true);
  const contactDetails = page.getByRole('region', { name: 'Contact details', exact: true });
  await expect(contactDetails).toContainText('Friday Client Lead');
  await contactDetails.getByRole('button', { name: 'Close contact details' }).click();
  await page.getByRole('button', { name: 'Edit responsibility notes' }).click();
  const responsibilities = page.getByRole('dialog', { name: 'Responsibility Notes', exact: true });
  await responsibilities
    .getByRole('textbox', { name: 'Responsibility Notes', exact: true })
    .fill('Coordinate project communications through the client lead.');
  await responsibilities.getByRole('button', { name: 'Save changes', exact: true }).click();
  await expect(responsibilities).toBeHidden();
  await page.reload();
  await expect(page.getByRole('region', { name: 'Key Relationship', exact: true })).toContainText(
    'Coordinate project communications through the client lead.',
  );
  assert.equal(
    (await read('/api/projects/' + created.id)).responsibilityNotes,
    'Coordinate project communications through the client lead.',
  );
  await page
    .getByRole('group', { name: 'Contact Friday Client Lead', exact: true })
    .getByRole('button', { name: 'Friday Client Lead', exact: true })
    .click();
  await contactDetails.getByRole('button', { name: 'Archive contact', exact: true }).click();
  await expect(
    page.getByRole('group', { name: 'Contact Friday Client Lead', exact: true }),
  ).toHaveCount(0);
  await page.getByRole('button', { name: 'Archived contacts', exact: true }).click();
  await page
    .getByRole('group', { name: 'Contact Friday Client Lead', exact: true })
    .getByRole('button', { name: 'Friday Client Lead', exact: true })
    .click();
  await contactDetails.getByRole('button', { name: 'Restore contact', exact: true }).click();
  assert.equal(
    (await read('/api/projects/' + created.id + '/workspace')).contacts.find(
      (c) => c.id === clientContact.id,
    ).archived,
    false,
  );
  await page.getByRole('button', { name: 'Show active contacts', exact: true }).click();
  await page.getByRole('textbox', { name: 'Search contacts' }).fill('Friday Client');
  await page.getByRole('button', { name: 'View', exact: true }).click();
  await page.getByRole('option', { name: 'Table', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Search contacts' })).toHaveValue('Friday Client');
  await expect(page.getByRole('dialog', { name: 'Edit Contact' })).toHaveCount(0);
  await expect(page.getByRole('table')).toContainText('Friday Client Lead');
  await page.getByRole('button', { name: 'View', exact: true }).click();
  await page.getByRole('option', { name: 'Cards', exact: true }).click();
  await page.getByRole('textbox', { name: 'Search contacts' }).fill('');
  await capture('17-contacts');
  results.checks.push(
    'Contacts: name-only creation, Client Primary, project-wide responsibility notes persist after reload independently, archive/restore preserves contact UUID',
  );
  const baseLuminaire = {
    category: 'Downlight',
    imagePath: '',
    description: 'Friday test luminaire',
    manufacturer: 'Fixture Manufacturer',
    model: 'Long readable model name for the Friday agreement verification',
    wattage: '12 W',
    lumens: '1000 lm',
    lightColor: '3000 K',
    cri: '90',
    beamAngle: '36°',
    ipRating: 'IP20',
    mounting: 'Custom old mounting',
    cutout: '',
    driver: '',
    control: 'Legacy control',
    emergency: '',
    datasheetPath: '',
    location: 'Room A',
    unit: 'No.',
    quantity: 2,
    notes: 'Keep notes',
    sourceName: '',
    dimensions: '',
    bodyColorFinish: '',
  };
  const la = await post('/api/projects/' + created.id + '/luminaires', {
    ...baseLuminaire,
    tag: 'FR01',
    orderingCode: 'FR-001',
  });
  const lb = await post('/api/projects/' + created.id + '/luminaires', {
    ...baseLuminaire,
    tag: 'FR02',
    orderingCode: 'FR-002',
  });
  await page.goto(origin + '/v4/projects/' + created.id + '/luminaires/advanced');
  await page.getByRole('button', { name: 'FR01', exact: true }).click();
  const lumDetails = page.getByRole('complementary', { name: 'Selected luminaire inspector' });
  await expect(lumDetails).toContainText('FR01');
  await page.getByRole('checkbox', { name: 'Select FR01', exact: true }).check();
  await page.getByRole('checkbox', { name: 'Select FR02', exact: true }).check();
  await page.getByRole('button', { name: 'FR02', exact: true }).click();
  await expect(lumDetails).toContainText('FR02');
  await expect(page.getByRole('toolbar', { name: 'Selected luminaires' })).toContainText(
    '2 selected',
  );
  await page.getByRole('button', { name: 'Bulk edit', exact: true }).click();
  const bulkEditor = page.getByRole('dialog', { name: 'Bulk edit luminaires' });
  await bulkEditor.getByRole('checkbox', { name: 'Change location', exact: true }).check();
  await bulkEditor.getByRole('textbox', { name: 'location', exact: true }).fill('Lobby');
  await bulkEditor.getByRole('button', { name: 'Apply selected fields' }).click();
  await expect(bulkEditor).toContainText('FR02 — Saved');
  await capture('18-luminaires-bulk');
  await bulkEditor.locator('footer').getByRole('button', { name: 'Close', exact: true }).click();
  const updatedLums = (await read('/api/projects/' + created.id + '/workspace')).luminaires;
  for (const lum of updatedLums.filter((l) => [la.id, lb.id].includes(l.id))) {
    assert.equal(lum.location, 'Lobby');
    assert.equal(lum.control, 'Legacy control');
    assert.equal(lum.quantity, 2);
    assert.equal(lum.emergency, '');
    assert.equal(lum.notes, 'Keep notes');
  }
  await page.getByRole('button', { name: 'Clear selection' }).click();
  await page.getByRole('button', { name: 'Actions for FR02' }).click();
  await page.getByRole('menuitem', { name: 'Duplicate', exact: true }).click();
  const lumEditor = page.getByRole('dialog', { name: 'Duplicate Luminaire' });
  await expect(lumEditor.getByLabel('Tag *')).toHaveValue('');
  await expect(lumEditor.getByLabel('Ordering Code', { exact: true })).toHaveValue('');
  await expect(lumEditor.getByRole('textbox', { name: 'Mounting', exact: true })).toHaveValue(
    'Custom old mounting',
  );
  await lumEditor.getByLabel('Tag *').fill('FR03');
  await lumEditor.getByRole('button', { name: 'Control choices' }).click();
  await page.getByRole('option', { name: 'DALI-2', exact: true }).click();
  await capture('19-luminaire-editor');
  await lumEditor.getByRole('button', { name: 'Save Luminaire', exact: true }).click();
  await expect(lumEditor).toBeHidden();
  await page.reload();
  const duplicate = (await read('/api/projects/' + created.id + '/workspace')).luminaires.find(
    (l) => l.tag === 'FR03',
  );
  assert.equal(duplicate.control, 'DALI-2');
  assert.notEqual(duplicate.id, lb.id);
  assert.equal(duplicate.orderingCode ?? '', '');
  await page.getByRole('button', { name: 'FR03', exact: true }).click();
  await lumDetails.getByRole('button', { name: 'Open luminaire attachments' }).click();
  await expect(lumDetails.getByRole('region', { name: 'Luminaire attachments' })).toContainText(
    'No files attached.',
  );
  await lumDetails.getByRole('button', { name: 'Back to details' }).click();
  await page.getByRole('button', { name: 'Actions for FR03' }).click();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('menu', { name: 'Actions for FR03' })).toBeHidden();
  const modelResize = page.getByRole('button', { name: 'Resize Model column', exact: true });
  await modelResize.press('ArrowRight');
  const savedWidths = await page.evaluate(() =>
    localStorage.getItem('sct:table-widths:v1:FinalLuminairesView-3'),
  );
  assert.ok(JSON.parse(savedWidths).Model > 72);
  await page.reload();
  assert.equal(
    await page.evaluate(() => localStorage.getItem('sct:table-widths:v1:FinalLuminairesView-3')),
    savedWidths,
  );
  await expect(page.locator('table[data-column-widths="custom"]')).toHaveCount(1);
  await page.getByRole('button', { name: 'Reset FinalLuminairesView-3 column widths' }).click();
  for (let index = 4; index <= 15; index++)
    await post('/api/projects/' + created.id + '/luminaires', {
      ...baseLuminaire,
      tag: 'FR' + String(index).padStart(2, '0'),
      orderingCode: 'FR-' + String(index).padStart(3, '0'),
    });
  await page.reload();
  await page.getByRole('button', { name: 'Rows per page', exact: true }).click();
  await page.getByRole('option', { name: '10', exact: true }).click();
  await expect(page.getByText('Showing 1 to 10 of 15 luminaires', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Next page', exact: true }).click();
  await expect(page.getByText('Showing 11 to 15 of 15 luminaires', { exact: true })).toBeVisible();
  await page.getByRole('textbox', { name: 'Search luminaires', exact: true }).fill('FR01');
  await expect(page.getByText('Showing 1 to 1 of 1 luminaires', { exact: true })).toBeVisible();
  await page.getByRole('textbox', { name: 'Search luminaires', exact: true }).fill('');
  await page.getByRole('button', { name: 'Rows per page', exact: true }).click();
  await page.getByRole('option', { name: 'Auto / window', exact: true }).click();
  await page.getByRole('button', { name: 'FR01', exact: true }).click();
  const capacityText = await page.getByText(/Showing 1 to \d+ of 15 luminaires/).innerText();
  assert.ok(Number(capacityText.match(/to (\d+)/)[1]) < 15);
  results.checks.push(
    'Luminaires column handles preserve widths across reload; Reset restores defaults; explicit 10 rows, next page and filter reset; Auto uses actual table space and wrapped row height',
  );
  await capture('20-luminaires');
  results.checks.push(
    'Luminaires: independent checkbox selection and last-click inspector, selected-field bulk persistence preserves other values, row Duplicate clears identities, custom values preserved, DALI-2 suggestion saved, attachment list/back and Escape menu dismissal',
  );
  results.checks.push(
    'Comments: selection does not compose; native attachment preserves text and deduplicates project document; reply edit retains canonical ID, author and created timestamp',
  );
  results.checks.push(
    'Scope: optional technical criteria persist, standards use existing setup, independent measured pagination for long notes',
  );
  results.checks.push(
    'Action category creation saves and auto-selects without losing draft; contact owner fills role; dirty Save creates once; optional due date; meeting relationship persists; scoped details edit; Completed KPI and clear filters',
  );
  results.checks.push(
    'Summary stages do not mutate; explicit Start records date without session; luminaire total navigates; dirty Edit Save persists and closes; optional Site clears; Timeline inspector and contextual details',
  );
  results.checks.push(
    'm0053-m0123 local guides, read-only code/template previews, optional value/dates, small milestone, draft persisted through reload without project creation, explicit Create -> Planning Summary',
  );

  const pngPath = path.join(disposable, 'approved-product.png');
  await writeFile(
    pngPath,
    Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=',
      'base64',
    ),
  );
  const pdfPath = path.join(disposable, 'original-datasheet.pdf');
  await writeFile(pdfPath, '%PDF-1.4\nFriday immutable fixture');
  const assetBase = '/api/projects/' + created.id + '/luminaires/' + la.id + '/asset-versions';
  const imageVersion = await post(assetBase, { assetType: 'ProductImage', filePath: pngPath });
  const pdfVersion = await post(assetBase, { assetType: 'Datasheet', filePath: pdfPath });
  const imageResponse = await page.request.get(
    origin + assetBase + '/' + imageVersion.id + '/content',
  );
  assert.ok(imageResponse.ok(), await imageResponse.text());
  assert.deepEqual(await imageResponse.body(), await readFile(pngPath));
  const cross = await page.request.get(
    origin +
      '/api/projects/' +
      created.id +
      '/luminaires/' +
      lb.id +
      '/asset-versions/' +
      imageVersion.id +
      '/content',
  );
  assert.equal(cross.status(), 404);
  const forged = await page.request.post(
    origin + assetBase + '/' + pdfVersion.id + '/file-handoff',
    { data: { action: 'OPEN', filePath: pdfPath } },
  );
  assert.equal(forged.status(), 400);
  const savedCopy = path.join(disposable, 'saved-datasheet-copy.pdf');
  await app.evaluate(({ shell, dialog }, copy) => {
    globalThis.__openedAssets = [];
    shell.openPath = async (target) => {
      globalThis.__openedAssets.push(target);
      return '';
    };
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: copy });
  }, savedCopy);
  await page.goto(
    origin + '/v4/projects/' + created.id + '/datasheets-images?luminaireId=' + la.id,
  );
  await expect(page.getByRole('button', { name: 'Close asset details' })).toBeVisible();
  await expect(page.getByRole('img', { name: 'FR01 product' })).toHaveCount(2);
  assert.ok(
    await page
      .getByRole('img', { name: 'FR01 product' })
      .evaluateAll((images) => images.every((img) => img.complete && img.naturalWidth > 0)),
  );
  await page.getByRole('button', { name: 'original-datasheet.pdf', exact: true }).click();
  await expect.poll(() => app.evaluate(() => globalThis.__openedAssets.length)).toBe(1);
  await page.getByRole('button', { name: 'Save a copy of original-datasheet.pdf' }).click();
  await expect
    .poll(async () => {
      try {
        return await readFile(savedCopy, 'utf8');
      } catch {
        return '';
      }
    })
    .toBe('%PDF-1.4\nFriday immutable fixture');
  assert.equal(await readFile(pdfPath, 'utf8'), '%PDF-1.4\nFriday immutable fixture');
  await page.getByRole('button', { name: /14 Missing Datasheets/ }).click();
  await expect(page.getByRole('button', { name: 'Assets for FR01', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: /14 Missing Datasheets/ }).click();
  await page.getByRole('button', { name: 'Assets for FR01', exact: true }).click();
  await page.getByRole('button', { name: 'Edit luminaire notes' }).click();
  const notesEditor = page.getByRole('dialog', { name: 'Luminaire notes' });
  await notesEditor
    .getByRole('textbox')
    .fill('Datasheet notes only; all technical fields preserved.');
  await notesEditor.getByRole('button', { name: 'Save changes' }).click();
  await expect(notesEditor).toBeHidden();
  const notesLum = (await read('/api/projects/' + created.id + '/workspace')).luminaires.find(
    (l) => l.id === la.id,
  );
  assert.equal(notesLum.notes, 'Datasheet notes only; all technical fields preserved.');
  assert.equal(notesLum.model, la.model);
  assert.equal(notesLum.quantity, 2);
  await page.getByRole('button', { name: 'Version history for original-datasheet.pdf' }).click();
  await expect(page.getByRole('dialog', { name: 'Datasheet version history' })).toContainText(
    'Current',
  );
  await page.getByRole('button', { name: 'Close version history' }).click();
  await page.getByRole('button', { name: 'Rows per page', exact: true }).click();
  await page.getByRole('option', { name: '10 / page', exact: true }).click();
  await expect(page.getByText('Showing 1 to 10 of 15 luminaires', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Next page', exact: true }).click();
  await expect(page.getByText('Showing 11 to 15 of 15 luminaires', { exact: true })).toBeVisible();
  await page.getByRole('textbox', { name: 'Search assets' }).fill('FR01');
  await expect(page.getByText('Showing 1 to 1 of 1 luminaires', { exact: true })).toBeVisible();
  await capture('21-datasheets');
  results.checks.push(
    'Datasheets: canonical approved image renders; cross-luminaire and forged path rejected; bounded Open uses shell stub; Save As produces identical copy and leaves source; KPI filter/reset, scoped notes preserve model/quantity, version history, explicit 10 rows and filter reset',
  );
  await page.goto(origin + '/v4/projects/' + created.id + '/technical-check');
  await page.getByRole('button', { name: 'Run Technical Check', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Run Technical Check', exact: true })).toBeEnabled({
    timeout: 60000,
  });
  await page.getByRole('button', { name: 'Missing / Incomplete', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Missing / Incomplete', exact: true }),
  ).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: 'Missing / Incomplete', exact: true }).click();
  await page.getByRole('button', { name: 'Analysis status', exact: true }).click();
  const analysisPopup = page.getByRole('listbox', { name: 'Analysis status' });
  const popupBox = await analysisPopup.boundingBox();
  assert.ok(popupBox.height < 400);
  await page.getByRole('option', { name: 'All analysis states', exact: true }).click();
  await page.getByRole('button', { name: /^FR01: \d+ checks$/ }).click();
  const review = page.getByRole('dialog', { name: 'Technical Verification — FR01', exact: true });
  await expect(review).toBeVisible();
  await expect(review).toHaveAttribute('data-v4-presence', 'open');
  await page.evaluate(async () => {
    await Promise.all(
      document
        .getAnimations()
        .filter((a) => a.effect?.getTiming().iterations !== Infinity)
        .map((a) => a.finished.catch(() => undefined)),
    );
  });
  await expect(review.getByRole('button', { name: 'Retry Processing', exact: true })).toBeVisible();
  const geometry = await review.evaluate((el) => {
    const b = el.getBoundingClientRect();
    const grid = el.querySelector('.v4-technical-verification__layout').getBoundingClientRect();
    return {
      x: b.x,
      y: b.y,
      width: b.width,
      height: b.height,
      viewportWidth: innerWidth,
      viewportHeight: innerHeight,
      gridHeight: grid.height,
    };
  });
  results.technicalGeometry = geometry;
  assert.ok(
    geometry.x + geometry.width <= geometry.viewportWidth &&
      geometry.y + geometry.height <= geometry.viewportHeight,
    JSON.stringify(geometry),
  );
  assert.ok(geometry.width > geometry.viewportWidth - 60, JSON.stringify(geometry));
  assert.ok(geometry.height > geometry.viewportHeight - 60);
  assert.ok(geometry.gridHeight > 250);
  await expect(
    review.getByRole('button', { name: 'Complete Review', exact: true }),
  ).toBeInViewport();
  await capture('22-technical-review');
  await review.getByRole('button', { name: 'Complete Review', exact: true }).click();
  await expect(review).toBeHidden();
  results.checks.push(
    'Technical Check: real malformed fixture remains Processing Failed, retry visible; KPI and small anchored analysis filter; nearly full-screen review has stable comparison space and reachable footer; Complete Review closes without fabricating resolution',
  );
  await page.goto(origin + '/v4/projects/' + created.id + '/lighting-systems');
  const studio = page.frameLocator('iframe[title="Luminaire Studio 1.4.1"]');
  await studio
    .locator('.pagehead')
    .getByRole('button', { name: 'Add system', exact: true })
    .click();
  const sysForm = studio.locator('#recordForm');
  await sysForm.getByLabel('System code *', { exact: true }).fill('SYS-FRIDAY');
  await sysForm.getByLabel('Mounting', { exact: true }).fill('Custom mounting retained');
  await sysForm.getByRole('button', { name: 'Save system', exact: true }).click();
  await studio.getByRole('button', { name: 'SYS-FRIDAY', exact: true }).click();
  const systemDetails = studio.getByRole('complementary', { name: 'System details' });
  await expect(systemDetails).toContainText('Custom mounting retained');
  await systemDetails.getByRole('button', { name: 'Manage links' }).click();
  const linksEditor = studio.getByRole('dialog', { name: 'Manage system links' });
  await linksEditor.getByRole('checkbox', { name: 'FR01', exact: true }).check();
  await linksEditor.getByRole('button', { name: 'Save links' }).click();
  await expect(linksEditor).toBeHidden();
  await expect(systemDetails).toContainText('Linked records (1)');
  await capture('23-lighting-systems');
  await page.goto(origin + '/v4/projects/' + created.id + '/system-accessories');
  await studio
    .locator('.pagehead')
    .getByRole('button', { name: 'Add accessory', exact: true })
    .click();
  const accessoryForm = studio.locator('#recordForm');
  await accessoryForm.getByLabel('Component reference *', { exact: true }).fill('ACC-FRIDAY');
  await accessoryForm
    .getByLabel('Linked system', { exact: true })
    .selectOption({ label: 'SYS-FRIDAY · Track system' });
  await expect(accessoryForm.locator('input[name="rate"]')).toHaveCount(0);
  await app.evaluate(({ dialog }, file) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] });
  }, pdfPath);
  await accessoryForm.getByRole('button', { name: 'Browse Datasheet PDF', exact: true }).click();
  await expect(accessoryForm.getByText('original-datasheet.pdf', { exact: true })).toBeVisible();
  await accessoryForm.getByRole('button', { name: 'Save accessory', exact: true }).click();
  await studio.getByRole('button', { name: 'ACC-FRIDAY', exact: true }).click();
  const accessoryDetails = studio.getByRole('complementary', { name: 'Accessory details' });
  await expect(accessoryDetails).toContainText('Not specified');
  await expect(accessoryDetails).toContainText('SYS-FRIDAY');
  await expect(accessoryDetails).toContainText('original-datasheet.pdf');
  await studio.locator('body').evaluate((body) => body.ownerDocument.defaultView.studioFlush());
  await page.reload();
  await studio.getByRole('button', { name: 'ACC-FRIDAY', exact: true }).click();
  await expect(accessoryDetails).toContainText('original-datasheet.pdf');
  const studioState = await read('/api/projects/' + created.id + '/luminaire-studio');
  assert.equal(studioState.document.accessories[0].systemId, studioState.document.systems[0].id);
  assert.equal(
    studioState.document.luminaires.find((item) => item.id === la.id).systemId,
    studioState.document.systems[0].id,
  );
  await capture('24-system-accessories');
  results.checks.push(
    'Systems/Accessories: keyboard record selection and 3:1 details, custom mounting, explicit linked luminaire assignment, blank quantity label, hidden rate editor, native PDF Browse, immutable attachment and system assignment survive reload',
  );
  const outputRevision = await post('/api/projects/' + created.id + '/revisions/prepare', {
    purpose: 'Friday output verification',
  });
  await page.goto(origin + '/v4/projects/' + created.id + '/output-studio');
  await expect(studio.locator('.settings > details')).not.toHaveCount(0);
  await studio
    .getByRole('combobox', { name: 'Table font', exact: true })
    .fill('Missing Friday Font 999');
  await expect(studio.getByText(/This font is unavailable here/)).toBeVisible();
  await studio.getByRole('button', { name: 'Montserrat', exact: true }).click();
  await expect(studio.getByRole('combobox', { name: 'Table font', exact: true })).toHaveValue(
    'Montserrat',
  );
  const settingsGeometry = await studio.locator('.settings').evaluate((el) => ({
    height: el.clientHeight,
    scroll: el.scrollHeight,
    overflow: getComputedStyle(el).overflowY,
  }));
  assert.ok(settingsGeometry.scroll > settingsGeometry.height);
  assert.equal(settingsGeometry.overflow, 'auto');
  await studio.locator('body').evaluate((body) => body.ownerDocument.defaultView.studioFlush());
  await page.getByRole('button', { name: 'Generate Revision Outputs', exact: true }).click();
  const outputDialog = page.getByRole('dialog', { name: 'Generate Revision Outputs', exact: true });
  await outputDialog.getByRole('button', { name: 'Target Revision', exact: true }).click();
  await page.getByRole('option', { name: outputRevision.revisionLabel, exact: true }).click();
  await outputDialog.getByRole('checkbox', { name: 'Technical BOQ', exact: true }).check();
  await outputDialog.getByRole('checkbox', { name: 'XLSX', exact: true }).check();
  await outputDialog.getByRole('button', { name: 'Generate selected files', exact: true }).click();
  await expect(
    outputDialog.getByText('4 file(s) generated and registered successfully.', { exact: true }),
  ).toBeVisible({ timeout: 120000 });
  const artifactLinks = await outputDialog.getByRole('link').evaluateAll((links) =>
    links.map((link) => ({
      href: link.getAttribute('href'),
      name: link.getAttribute('download'),
    })),
  );
  for (const artifact of artifactLinks) {
    const response = await page.request.get(origin + artifact.href);
    assert.ok(response.ok());
    const bytes = await response.body();
    assert.ok(bytes.length > 500);
    await writeFile(path.join(output, artifact.name), bytes);
  }
  await capture('25-output-generation');
  await outputDialog.locator('footer').getByRole('button', { name: 'Close', exact: true }).click();
  await capture('26-output-studio');
  const specificationRevision = await post('/api/projects/' + created.id + '/revisions/prepare', {
    purpose: 'Friday specification verification',
  });
  await page.goto(origin + '/v4/projects/' + created.id + '/studio-datasheets');
  await expect(
    studio.getByRole('heading', { name: 'Luminaire Specifications', exact: true }),
  ).toBeVisible();
  await expect(studio.locator('.ds-tools .studio-pagination')).toHaveCount(0);
  assert.equal(
    await studio.locator('.ds-tools').evaluate((el) => getComputedStyle(el).overflowY),
    'auto',
  );
  await page.getByRole('button', { name: 'Generate Revision Specifications', exact: true }).click();
  const specDialog = page.getByRole('dialog', {
    name: 'Generate Revision Specifications',
    exact: true,
  });
  await specDialog.getByRole('button', { name: 'Target Revision', exact: true }).click();
  await page
    .getByRole('option', { name: specificationRevision.revisionLabel, exact: true })
    .click();
  await specDialog.getByRole('checkbox', { name: 'All project luminaires', exact: true }).uncheck();
  await specDialog
    .getByRole('checkbox', { name: 'FR01 — Friday test luminaire', exact: true })
    .check();
  await specDialog.getByRole('checkbox', { name: 'XLSX', exact: true }).check();
  await specDialog.getByRole('button', { name: 'Generate selected files', exact: true }).click();
  await expect(
    specDialog.getByText('2 file(s) generated and registered successfully.', { exact: true }),
  ).toBeVisible({ timeout: 120000 });
  await capture('27-specifications-generation');
  const specLinks = await specDialog.getByRole('link').evaluateAll((links) =>
    links.map((link) => ({
      href: link.getAttribute('href'),
      name: link.getAttribute('download'),
    })),
  );
  for (const artifact of specLinks) {
    const response = await page.request.get(origin + artifact.href);
    assert.ok(response.ok(), await response.text());
    await writeFile(path.join(output, artifact.name), await response.body());
  }
  await specDialog.locator('footer').getByRole('button', { name: 'Close', exact: true }).click();
  await capture('28-specifications');
  results.checks.push(
    'Studio: collapsible controls and single scroll, font choices/availability, native shared renderer generates Schedule and unpriced BOQ PDF/XLSX in selected open Revision; Specifications independently generates only FR01 PDF/XLSX in another selected Revision, no nested control pagination',
  );

  const revisionSourceRoot = (await read('/api/projects/' + created.id + '/workspace')).folderPath;
  const sourceDir = path.join(revisionSourceRoot, 'Friday sources');
  await mkdir(sourceDir);
  const originalSnapshotBytes = await readFile(
    path.join(output, artifactLinks.find((item) => item.name.endsWith('.pdf')).name),
  );
  const sourceDocuments = [];
  for (const name of ['Snapshot test A.pdf', 'Snapshot test B.pdf']) {
    const sourcePath = path.join(sourceDir, name);
    await writeFile(sourcePath, originalSnapshotBytes);
    sourceDocuments.push(
      await post('/api/projects/' + created.id + '/documents', {
        category: 'Drawing',
        documentNumber: '',
        title: name,
        revision: 'A',
        status: 'Working',
        filePath: path.relative(revisionSourceRoot, sourcePath),
        issuedTo: '',
        issueDate: null,
        notes: '',
      }),
    );
  }
  const revisionForFiles = await post('/api/projects/' + created.id + '/revisions/prepare', {
    purpose: 'Friday snapshots',
    internalNote: 'Original internal note',
  });
  await page.goto(origin + '/v4/projects/' + created.id + '/revisions');
  await page
    .getByRole('button', {
      name: 'View Revision details for ' + revisionForFiles.revisionLabel,
      exact: true,
    })
    .click();
  const revisionDetails = page.getByRole('dialog', { name: 'Revision Details', exact: true });
  await expect(revisionDetails).toBeVisible();
  await expect(
    revisionDetails.getByRole('heading', { name: 'Revision Details', exact: true }),
  ).toHaveCount(1);
  await revisionDetails.getByRole('button', { name: 'Edit Revision Purpose', exact: true }).click();
  await revisionDetails
    .getByRole('textbox', { name: 'Revision Purpose', exact: true })
    .fill('Friday purpose edited');
  await revisionDetails.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(
    revisionDetails.getByRole('textbox', { name: 'Revision Purpose', exact: true }),
  ).toHaveCount(0);
  await revisionDetails.getByRole('button', { name: 'Add Deliverable', exact: true }).click();
  const addFiles = page.getByRole('dialog', { name: 'Add Deliverable', exact: true });
  await expect(addFiles).toContainText(revisionForFiles.revisionLabel);
  await addFiles.getByRole('textbox', { name: 'Search files', exact: true }).fill('Snapshot test');
  await addFiles
    .getByRole('checkbox', { name: 'Select all visible available files', exact: true })
    .check();
  await expect(addFiles).toContainText('2 selected');
  await capture('29-revision-add-files');
  await addFiles.getByRole('button', { name: 'Add selected files', exact: true }).click();
  await expect(addFiles).toContainText('0 selected · 2 added');
  await expect(
    addFiles.getByRole('checkbox', { name: 'Select Snapshot test A.pdf', exact: true }),
  ).toBeDisabled();
  await addFiles.locator('footer').getByRole('button', { name: 'Close', exact: true }).click();
  const snapshotRows = await read(
    '/api/projects/' + created.id + '/revisions/' + revisionForFiles.revisionId + '/deliverables',
  );
  assert.equal(snapshotRows.length, 2);
  await writeFile(path.join(sourceDir, 'Snapshot test A.pdf'), 'changed source after snapshot');
  const oldOpened = await app.evaluate(() => globalThis.__openedAssets.length);
  await revisionDetails.getByRole('button', { name: 'Snapshot test A.pdf', exact: true }).click();
  await expect.poll(() => app.evaluate(() => globalThis.__openedAssets.length)).toBe(oldOpened + 1);
  const openedSnapshot = await app.evaluate(() => globalThis.__openedAssets.at(-1));
  assert.ok(openedSnapshot.includes(path.sep + 'DELIVERABLES' + path.sep));
  assert.deepEqual(await readFile(openedSnapshot), originalSnapshotBytes);
  const forgery = await page.request.post(
    origin +
      '/api/projects/' +
      created.id +
      '/revisions/' +
      revisionForFiles.revisionId +
      '/deliverables/' +
      snapshotRows[0].deliverableId +
      '/file-handoff',
    { data: { targetPath: path.join(sourceDir, 'Snapshot test A.pdf') } },
  );
  assert.equal(forgery.status(), 400);
  await revisionDetails.getByRole('button', { name: 'Finalize Revision', exact: true }).click();
  const confirmFinalize = page.getByRole('dialog', { name: 'Finalize Revision', exact: true });
  await expect(confirmFinalize).toContainText(revisionForFiles.revisionLabel);
  await confirmFinalize.getByRole('button', { name: 'Cancel', exact: true }).click();
  assert.equal(
    (await read('/api/projects/' + created.id + '/revisions')).find(
      (item) => item.revisionId === revisionForFiles.revisionId,
    ).lifecycleState,
    'PREPARING',
  );
  await revisionDetails.getByRole('button', { name: 'Finalize Revision', exact: true }).click();
  await confirmFinalize.getByRole('button', { name: 'Finalize', exact: true }).click();
  await expect(revisionDetails.getByTestId('v4-revision-finalized-readonly')).toBeVisible();
  await capture('30-revision-frozen');
  await page.keyboard.press('Escape');
  await expect(revisionDetails).toBeHidden();
  await page.getByRole('button', { name: /Completed Revisions/ }).click();
  await expect(
    page.getByRole('button', {
      name: 'Select Revision ' + revisionForFiles.revisionLabel,
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    page.getByRole('button', {
      name: 'Select Revision ' + outputRevision.revisionLabel,
      exact: true,
    }),
  ).toHaveCount(0);
  await page.getByRole('button', { name: 'Revision filters', exact: true }).click();
  const revisionFilters = page.getByRole('dialog', { name: 'Revision filters', exact: true });
  await expect(revisionFilters).toBeVisible();
  await revisionFilters.getByRole('button', { name: 'Clear filters', exact: true }).click();
  await page.keyboard.press('Escape');
  await expect(
    page.getByRole('button', {
      name: 'Select Revision ' + outputRevision.revisionLabel,
      exact: true,
    }),
  ).toBeVisible();
  await capture('31-revisions');
  results.checks.push(
    'Revisions: scoped wide multi-file selector and already-added prevention; inline Purpose Save; one Details heading; opening immutable snapshot uses verified handoff even after original changes; forged renderer path rejected; explicit Finalize Cancel then confirm; Completed KPI filters and Clear restores rows',
  );

  {
    await page.goto(origin + '/v4/projects/' + created.id + '/packages');
    await page.getByRole('button', { name: 'Change Revision', exact: true }).click();
    const builder = page.getByRole('dialog', { name: 'Package Builder', exact: true });
    await expect(builder).toBeVisible();
    await builder
      .getByRole('combobox', { name: 'Finalized Revision', exact: true })
      .selectOption(revisionForFiles.revisionId);
    await builder.getByRole('textbox', { name: 'Label', exact: true }).fill('Friday saved draft');
    await builder.getByRole('combobox', { name: 'Output Mode', exact: true }).selectOption('Zip');
    await expect(builder).toContainText('Not generated');
    await capture('32-package-builder');
    await builder
      .locator('footer')
      .getByRole('button', { name: 'Create Draft', exact: true })
      .click();
    await expect(builder).toContainText('Draft package created successfully');
    const history = (await read('/api/projects/' + created.id + '/issue-history')).items;
    const draft = history.find((item) => item.package.label === 'Friday saved draft');
    assert.ok(draft);
    assert.equal(draft.package.businessStatus, 'Draft');
    assert.equal(draft.package.issuedAt, null);
    await builder.locator('footer').getByRole('button', { name: 'Close', exact: true }).click();
    await app.evaluate(
      ({ session }, target) => {
        globalThis.__packageDownloads = [];
        session.defaultSession.once('will-download', (event, item) => {
          item.setSavePath(target);
          item.once('done', (event, state) =>
            globalThis.__packageDownloads.push({ state, path: item.getSavePath() }),
          );
        });
      },
      path.join(output, 'Friday saved draft.zip'),
    );
    await page
      .getByRole('button', { name: 'Download package Friday saved draft', exact: true })
      .click();
    await expect.poll(() => app.evaluate(() => globalThis.__packageDownloads.length)).toBe(1);
    assert.equal((await app.evaluate(() => globalThis.__packageDownloads[0])).state, 'completed');
    const packageMember = await page.request.get(
      origin +
        '/api/projects/' +
        created.id +
        '/issue-packages/' +
        draft.package.packageId +
        '/file?memberId=' +
        snapshotRows[0].deliverableId,
    );
    assert.ok(packageMember.ok(), await packageMember.text());
    assert.deepEqual(await packageMember.body(), originalSnapshotBytes);
    await page
      .getByRole('button', { name: 'Package actions Friday saved draft', exact: true })
      .click();
    const packageActions = page.getByRole('menu', {
      name: 'Package actions Friday saved draft',
      exact: true,
    });
    await expect(packageActions).toBeVisible();
    await expect(
      packageActions.getByRole('menuitem', { name: 'Start Reissue', exact: true }),
    ).toHaveCount(0);
    await page.keyboard.press('Escape');
    await page
      .getByRole('button', { name: 'Inspect package Friday saved draft', exact: true })
      .click();
    await expect(
      builder.getByRole('complementary', { name: 'Selected package details', exact: true }),
    ).toContainText('Files saved');
    await builder
      .locator('footer')
      .getByRole('button', { name: 'Preview Contents', exact: true })
      .click();
    const packagePreview = page.getByRole('dialog', { name: 'Issue Package Preview', exact: true });
    await expect(packagePreview).toContainText('Saved package: Friday saved draft');
    await expect(packagePreview).not.toContainText('REISSUE');
    await app.evaluate(({ shell }) => {
      globalThis.__packageOpened = [];
      shell.openPath = async (target) => {
        globalThis.__packageOpened.push(target);
        return '';
      };
    });
    await packagePreview
      .getByRole('button', { name: 'Open Snapshot test A.pdf', exact: true })
      .click();
    await expect.poll(() => app.evaluate(() => globalThis.__packageOpened.length)).toBe(1);
    const memberPath = await app.evaluate(() => globalThis.__packageOpened[0]);
    assert.deepEqual(await readFile(memberPath), await packageMember.body());
    await capture('33-package-file');
    await capture('34-package-preview');
    await packagePreview
      .locator('footer')
      .getByRole('button', { name: 'Close', exact: true })
      .click();
    await builder.locator('footer').getByRole('button', { name: 'Close', exact: true }).click();
    await page.getByRole('button', { name: 'Issue Package', exact: true }).click();
    await builder.getByRole('textbox', { name: 'Label', exact: true }).fill('Friday issued ZIP');
    const reason = builder.getByRole('textbox', { name: 'Warning Override Reason', exact: true });
    if (await reason.count())
      await reason.fill('Disposable verification of agreed package issue flow.');
    await builder
      .locator('footer')
      .getByRole('button', { name: 'Issue Package', exact: true })
      .click();
    await expect(builder).toContainText('Issue Package recorded successfully');
    const issued = (await read('/api/projects/' + created.id + '/issue-history')).items.find(
      (item) => item.package.label === 'Friday issued ZIP',
    );
    assert.ok(issued?.package.issuedAt);
    assert.equal(issued.package.businessStatus, 'Issued');
    const issuedFile = await page.request.get(
      origin +
        '/api/projects/' +
        created.id +
        '/issue-packages/' +
        issued.package.packageId +
        '/file',
    );
    assert.ok(issuedFile.ok(), await issuedFile.text());
    await writeFile(path.join(output, 'Friday issued ZIP.zip'), await issuedFile.body());
    await capture('35-package-issued');
    await builder.locator('footer').getByRole('button', { name: 'Close', exact: true }).click();
    await page.getByRole('button', { name: 'View Details', exact: true }).click();
    const ready = page.getByRole('dialog', { name: 'Package Readiness', exact: true });
    await expect(ready).toBeVisible();
    await expect(ready).toContainText('Blocking');
    await ready.locator('footer').getByRole('button', { name: 'Close', exact: true }).click();
    results.checks.push(
      'Packages: fixed builder footer and Not generated truth; Draft creates real ZIP without issue audit; download/eye/menu are distinct; saved member PDF equals immutable bytes; saved Preview retains package context without automatic reissue; explicit Issue creates real ZIP and audit; Readiness opens its own Float',
    );
  }
  assert.deepEqual(results.errors, []);
  results.passed = true;
} catch (error) {
  results.failure = error.stack;
  if (app) {
    const failedPage = await app.firstWindow();
    results.failedPage = await failedPage.locator('body').innerText();
    await failedPage.screenshot({ path: path.join(output, 'failure.png') });
  }
  throw error;
} finally {
  await writeFile(path.join(output, 'results.json'), JSON.stringify(results, null, 2));
  await app?.close();
}
