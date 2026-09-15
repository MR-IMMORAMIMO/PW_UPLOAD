import { existsSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import { TEST_FUTURE_REQUIRED_DELIVERY_DATE } from '../test-authority';

let legacyRoot = '';
let legacyFolder = '';

test.beforeAll(() => {
  const directory = mkdtempSync(path.join(tmpdir(), 'scli-personal-e2e-'));
  legacyRoot = path.join(directory, '001_MY_PROJECTS');
  legacyFolder = path.join(legacyRoot, '042_SCLI260802_E2E_LEGACY_VILLA');
  mkdirSync(path.join(legacyRoot, '000_TEMPLETS'), { recursive: true });
  mkdirSync(path.join(legacyFolder, '03_DRAWINGS'), { recursive: true });
  writeFileSync(path.join(legacyFolder, '03_DRAWINGS', 'Villa Lighting Layout.dwg'), 'dwg');
});

test.afterAll(() => {
  if (legacyRoot) rmSync(path.dirname(legacyRoot), { recursive: true, force: true });
});

test.beforeEach(async ({ page, request }) => {
  const response = await request.post('/api/test/reset', {
    headers: { 'x-test-reset': 'scli-e2e' },
  });
  expect(response.ok()).toBe(true);
  await page.goto('/');
});

test('personal workspace keeps the V2 design while exposing the V3 lighting workflow', async ({
  page,
}) => {
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  // Sales Directory is not a primary sidebar item under the single contextual
  // rail; it belongs under Settings/master data. Assert its absence from the
  // primary rail rather than expecting a top-level nav link.
  await expect(page.getByRole('link', { name: 'Sales Directory' })).toHaveCount(0);
  await expect(page.getByText(/Outlook/i)).toHaveCount(0);

  await page.getByRole('button', { name: 'Customize' }).click();
  await expect(page.getByRole('region', { name: 'Customize dashboard' })).toBeVisible();
  await page.getByRole('button', { name: 'Switch to dark mode' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');

  await page.getByRole('button', { name: 'New Project' }).first().click();
  await page.getByLabel(/Project Name/).fill('V3 Personal Lighting Villa');
  await page.getByLabel(/Client Name/).fill('Private Client');
  const sales = page.getByLabel(/Salesperson/);
  await expect.poll(() => sales.locator('option').count()).toBeGreaterThan(1);
  await sales.selectOption({ index: 1 });
  await page.getByLabel(/Site Location/).fill('Dubai Hills');
  await page.getByLabel(/Lighting Scope/).fill('Complete villa lighting design and documentation.');
  await page.getByRole('button', { name: /Continue/ }).click();
  await page.getByRole('button', { name: /Continue/ }).click();
  await page.getByRole('button', { name: /Decide later/ }).click();
  await page.getByRole('button', { name: /Continue/ }).click();
  await page.getByRole('button', { name: /^Manual\b/ }).click();
  await page.getByRole('button', { name: /Continue/ }).click();
  await page.getByRole('button', { name: /Create Project Workspace/ }).click();

  await expect(page).toHaveURL(/\/projects\/[^/]+$/, { timeout: 15_000 });
  await expect(page.getByRole('heading', { name: 'V3 Personal Lighting Villa' })).toBeVisible();
  // The contextual sidebar is the single navigation authority. The approved
  // Project destinations are exposed as sidebar links, not horizontal tabs.
  await expect(page.getByRole('link', { name: 'Scope & Services' })).toBeVisible();
  await page.getByRole('link', { name: 'Technical Check' }).click();
  await expect(page.getByRole('heading', { name: 'AI Check' })).toBeVisible();
  await expect(page.getByText('100% Local · Free')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Schedule vs. Datasheet' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Datasheets & Images' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Issue Packages' })).toBeVisible();
});

test('imports and removes a legacy project without changing its physical folder', async ({
  page,
}) => {
  // Import Existing is a contextual secondary action on the Projects page
  // (not a permanent sidebar item under the single contextual rail).
  await page.getByRole('link', { name: 'Projects' }).click();
  await page.getByRole('link', { name: 'Import Existing' }).click();
  await expect(page.getByRole('heading', { name: 'Import Existing Projects' })).toBeVisible();
  await page.getByLabel('Projects root').fill(legacyRoot);
  await page.getByRole('button', { name: 'Scan Folder Names' }).click();
  await expect(page.getByText('042_SCLI260802_E2E_LEGACY_VILLA')).toBeVisible();
  await page.getByRole('button', { name: 'Inspect Selected Files' }).click();
  await expect(page.getByText(/1 Drawings/)).toBeVisible();
  await page.getByRole('button', { name: 'Import Selected Projects' }).click();
  await expect(page.getByRole('heading', { name: '1 projects imported safely' })).toBeVisible();

  await page.getByRole('link', { name: /042_SCLI260802_E2E_LEGACY_VILLA/ }).click();
  await expect(page.getByRole('heading', { name: 'E2E LEGACY VILLA' })).toBeVisible();
  page.once('dialog', (dialog) => dialog.accept('042_SCLI260802_E2E_LEGACY_VILLA'));
  await page.getByRole('button', { name: 'Remove from App' }).click();
  await expect(page).toHaveURL(/\/archive$/);
  expect(existsSync(legacyFolder)).toBe(true);
  expect(existsSync(path.join(legacyFolder, '03_DRAWINGS', 'Villa Lighting Layout.dwg'))).toBe(
    true,
  );
});

test('keeps long project content inside cards and page boundaries at responsive sizes', async ({
  page,
}) => {
  test.setTimeout(60_000);
  const assertNoPageOverflow = async () => {
    const overflowAudit = await page.evaluate(() => {
      const board = document.querySelector<HTMLElement>('.kanban-board');
      const content = document.querySelector<HTMLElement>('.page-content');
      window.scrollTo({ left: 99_999, top: window.scrollY });
      const left = window.scrollX;
      window.scrollTo({ left: 0, top: window.scrollY });
      return {
        left,
        board: board
          ? {
              width: board.getBoundingClientRect().width,
              scrollWidth: board.scrollWidth,
              overflowX: getComputedStyle(board).overflowX,
            }
          : null,
        contentWidth: content?.getBoundingClientRect().width,
      };
    });
    expect(overflowAudit.left, JSON.stringify(overflowAudit)).toBe(0);
  };

  for (const width of [1280, 1024, 800, 430]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/projects');
    await page.locator('.kanban-card').first().waitFor();
    await page
      .locator('.kanban-card > a')
      .first()
      .evaluate((element) => {
        element.textContent =
          'EXTRA LONG LIGHTING DESIGN PROJECT NAME FOR RESPONSIVE CONTAINMENT VERIFICATION';
      });
    await page
      .locator('.kanban-card > span')
      .first()
      .evaluate((element) => {
        element.textContent =
          'EXTREMELY LONG CLIENT NAME THAT MUST NEVER FORCE THE PROJECT CARD OUTSIDE ITS COLUMN';
      });

    const bounds = await page
      .locator('.kanban-card')
      .first()
      .evaluate((card) => ({
        card: card.getBoundingClientRect().width,
        parent: card.parentElement?.getBoundingClientRect().width ?? 0,
      }));
    expect(bounds.card).toBeLessThanOrEqual(bounds.parent + 1);
    const boardBounds = await page.evaluate(() => {
      const viewport = document.querySelector<HTMLElement>('.kanban-viewport');
      const content = document.querySelector<HTMLElement>('.page-content');
      if (!viewport || !content) return null;
      const viewportRect = viewport.getBoundingClientRect();
      const contentRect = content.getBoundingClientRect();
      return {
        viewportWidth: viewportRect.width,
        contentWidth: contentRect.width,
        viewportRight: viewportRect.right,
        contentRight: contentRect.right,
        overflowX: getComputedStyle(viewport).overflowX,
        scrollWidth: viewport.scrollWidth,
      };
    });
    expect(boardBounds).not.toBeNull();
    expect(boardBounds!.viewportWidth).toBeLessThanOrEqual(boardBounds!.contentWidth + 1);
    expect(boardBounds!.viewportRight).toBeLessThanOrEqual(boardBounds!.contentRight + 1);
    expect(boardBounds!.overflowX).toBe('auto');
    expect(boardBounds!.scrollWidth).toBeGreaterThan(boardBounds!.viewportWidth);
  }

  await page.setViewportSize({ width: 1024, height: 900 });
  await page.goto('/projects');
  await expect(
    page.locator('.kanban-column > header strong').filter({ hasText: 'Not Started Yet' }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'New Project' }).first().click();
  await page
    .getByLabel(/Project Name/)
    .fill('EXTRA LONG LIGHTING PROJECT TITLE THAT MUST WRAP SAFELY INSIDE THE PROJECT HERO');
  await page
    .getByLabel(/Client Name/)
    .fill('EXTRA LONG CLIENT NAME FOR RESPONSIVE LAYOUT VERIFICATION');
  const sales = page.getByLabel(/Salesperson/);
  await expect.poll(() => sales.locator('option').count()).toBeGreaterThan(1);
  await sales.selectOption({ index: 1 });
  await page.getByLabel(/Site Location/).fill('Dubai Hills');
  await page.getByLabel(/Lighting Scope/).fill('Complete villa lighting design and documentation.');
  await page.getByRole('button', { name: /Continue/ }).click();
  await page.getByRole('button', { name: /Continue/ }).click();
  await page.getByRole('button', { name: /Decide later/ }).click();
  await page.getByRole('button', { name: /Continue/ }).click();
  await page.getByRole('button', { name: /^Manual\b/ }).click();
  await page.getByRole('button', { name: /Continue/ }).click();
  await page.getByRole('button', { name: /Create Project Workspace/ }).click();
  await expect(page.locator('.personal-project-hero h1')).toBeVisible();
  await page
    .locator('.workspace-path span')
    .first()
    .evaluate((element) => {
      element.textContent =
        'C:\\ONE_DRIVE\\001_MY_PROJECTS\\EXTRA_LONG_PROJECT_FOLDER_NAME\\VERY_LONG_NESTED_DELIVERABLE_PATH\\CURRENT_REVISION';
    });
  const detailBounds = await page.evaluate(() => {
    const content = document.querySelector<HTMLElement>('.page-content')?.getBoundingClientRect();
    const hero = document
      .querySelector<HTMLElement>('.personal-project-hero')
      ?.getBoundingClientRect();
    const workspace = document
      .querySelector<HTMLElement>('.workspace-path')
      ?.getBoundingClientRect();
    const actions = document
      .querySelector<HTMLElement>('.workspace-path .row-actions')
      ?.getBoundingClientRect();
    return { content, hero, workspace, actions };
  });
  expect(detailBounds.hero!.right).toBeLessThanOrEqual(detailBounds.content!.right + 1);
  if (detailBounds.actions)
    expect(detailBounds.actions.right).toBeLessThanOrEqual(detailBounds.workspace!.right + 1);
  await assertNoPageOverflow();

  await page.getByRole('button', { name: 'Switch to dark mode' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await assertNoPageOverflow();
});

test('keeps themed controls and project modules readable without hidden internal overflow', async ({
  page,
}) => {
  test.setTimeout(90_000);

  const expectContained = async (selectors: string[]) => {
    const failures = await page.evaluate((targets) => {
      const visible = (element: HTMLElement) => {
        const style = getComputedStyle(element);
        const bounds = element.getBoundingClientRect();
        return style.display !== 'none' && style.visibility !== 'hidden' && bounds.width > 0;
      };
      return targets.flatMap((selector) =>
        [...document.querySelectorAll<HTMLElement>(selector)]
          .filter(visible)
          .filter((element) => element.scrollWidth > element.clientWidth + 2)
          .map((element) => ({
            selector,
            className: element.className,
            clientWidth: element.clientWidth,
            scrollWidth: element.scrollWidth,
          })),
      );
    }, selectors);
    expect(failures, JSON.stringify(failures)).toEqual([]);
  };

  await page.setViewportSize({ width: 1280, height: 960 });
  await page.goto('/projects');
  await page.locator('.kanban-card').first().waitFor();

  await page.getByRole('button', { name: 'Switch to dark mode' }).click();
  const nativeOptionColors = await page
    .locator('select option')
    .first()
    .evaluate((option) => {
      const style = getComputedStyle(option);
      return { color: style.color, background: style.backgroundColor };
    });
  expect(nativeOptionColors.color).toBe('rgb(29, 41, 43)');
  expect(nativeOptionColors.background).toBe('rgb(255, 255, 255)');

  await page.getByRole('button', { name: 'New Project' }).first().click();
  await page.getByLabel(/Project Name/).fill('UI Regression Lighting Project');
  await page.getByLabel(/Client Name/).fill('UI Regression Client');
  const sales = page.getByLabel(/Salesperson/);
  await expect.poll(() => sales.locator('option').count()).toBeGreaterThan(1);
  await sales.selectOption({ index: 1 });
  await page.getByLabel(/Site Location/).fill('Dubai');
  await page.getByLabel(/Lighting Scope/).fill('Complete UI regression test workspace.');
  await page.getByRole('button', { name: /Continue/ }).click();
  await page.getByRole('button', { name: /Continue/ }).click();
  await page.getByRole('button', { name: /Decide later/ }).click();
  await page.getByRole('button', { name: /Continue/ }).click();
  await page.getByRole('button', { name: /^Manual\b/ }).click();
  await page.getByRole('button', { name: /Continue/ }).click();
  await page.getByRole('button', { name: /Create Project Workspace/ }).click();
  await expect(page.locator('.personal-project-hero')).toBeVisible();
  const projectHref = new URL(page.url()).pathname;
  await page.getByRole('link', { name: 'Revisions & Outputs' }).click();
  const documentEditor = page
    .locator('.operations-editor')
    .filter({ hasText: 'Register document' });
  await documentEditor.getByLabel('Document no.').fill('LONG-DOCUMENT-001');
  await documentEditor.getByLabel('Title').fill('Long lighting layout document');
  await documentEditor
    .getByLabel('File path')
    .fill(
      'C:\\OneDrive - Company\\001_MY_PROJECTS\\001_SCLI260801_LONG_LIGHTING_PROJECT\\03_DRAWINGS\\WORKING\\REV_01\\VERY_LONG_LIGHTING_LAYOUT_FILE_NAME_FOR_CONTAINMENT_TEST.dwg',
    );
  await documentEditor.getByRole('button', { name: 'Register File' }).click();
  await expect(page.getByText('Long lighting layout document').first()).toBeVisible();

  for (const width of [1280, 1080]) {
    await page.setViewportSize({ width, height: 960 });
    await page.goto(projectHref!);
    await expect(page.locator('.personal-project-hero')).toBeVisible();

    // Output Setup content is reachable via the Submission Cycle sidebar link.
    await page.getByRole('link', { name: 'Submission Cycle' }).click();
    await expectContained([
      '.output-setup-layout',
      '.output-setup-layout > .content-card',
      '.column-editor',
      '.column-editor > div',
      '.column-advanced',
    ]);
    const columnToggles = page.locator('.column-toggle input');
    await expect(columnToggles.first()).toHaveAttribute('aria-label', /column$/);

    await page.getByRole('link', { name: 'Technical Check' }).click();
    await expect(page.getByRole('heading', { name: 'AI Check' })).toBeVisible();
    await expectContained([
      '.local-intelligence-center',
      '.local-intelligence-hero',
      '.local-intelligence-metrics',
      '.local-intelligence-grid',
      '.local-datasheet-card',
      '.local-file-classifier',
    ]);

    await page.getByRole('link', { name: 'Meetings' }).click();
    await expectContained([
      '.operations-layout',
      '.operations-side-stack',
      '.compact-form',
      '.compact-form-grid',
    ]);

    await page.getByRole('link', { name: 'Revisions & Outputs' }).click();
    await expectContained([
      '.operations-layout',
      '.operations-main-stack',
      '.revision-register-row',
      '.revision-row-actions',
      '.document-row',
      '.document-row .operation-copy',
    ]);
    const revisionActions = page.locator('.revision-row-actions').first();
    if (await revisionActions.count()) {
      const revisionActionBounds = await revisionActions.evaluate((element) => ({
        container: element.getBoundingClientRect().width,
        select: element.querySelector('select')?.getBoundingClientRect().width ?? 0,
      }));
      expect(revisionActionBounds.select).toBeLessThanOrEqual(revisionActionBounds.container + 1);
    }
    await expect(page.locator('.document-row .operation-copy small').first()).toHaveAttribute(
      'title',
      /VERY_LONG_LIGHTING_LAYOUT_FILE_NAME/,
    );

    await page.getByRole('link', { name: 'Issue Packages' }).click();
    await expectContained(['.revision-package-layout', '.package-file-copy']);
    await expectContained(['.package-file.unavailable .package-file-copy small:first-of-type']);
  }

  await page.setViewportSize({ width: 1280, height: 960 });
  await page.getByRole('button', { name: 'Switch to light mode' }).click();
  await page.goto('/reports');
  const chartContrast = await page
    .locator('.recharts-cartesian-axis-tick-value')
    .first()
    .evaluate((tick) => {
      const channels = getComputedStyle(tick)
        .fill.match(/[\d.]+/g)!
        .slice(0, 3)
        .map(Number);
      const luminance = (values: number[]) => {
        const linear = values.map((value) => {
          const channel = value / 255;
          return channel <= 0.04045 ? channel / 12.92 : Math.pow((channel + 0.055) / 1.055, 2.4);
        });
        return 0.2126 * linear[0]! + 0.7152 * linear[1]! + 0.0722 * linear[2]!;
      };
      const foreground = luminance(channels);
      const background = 1;
      return (background + 0.05) / (foreground + 0.05);
    });
  expect(chartContrast).toBeGreaterThanOrEqual(4.5);

  await page.goto('/sales');
  await expect(page.getByLabel('Search salesperson')).toBeVisible();
  await page.goto('/search?q=lighting');
  await expect(page.getByLabel('Search the workspace')).toBeVisible();
});

test('persists the complete personal project workflow across every working register', async ({
  page,
}) => {
  test.setTimeout(120_000);

  await page.getByRole('button', { name: 'New Project' }).first().click();
  await page.getByLabel(/Project Name/).fill('Complete Workflow QA Villa');
  await page.getByLabel(/Client Name/).fill('Workflow QA Client');
  const sales = page.getByLabel(/Salesperson/);
  await expect.poll(() => sales.locator('option').count()).toBeGreaterThan(1);
  await sales.selectOption({ index: 1 });
  await page.getByLabel(/Site Location/).fill('Dubai');
  await page.getByLabel(/Lighting Scope/).fill('End-to-end lighting design workflow verification.');
  await page.getByRole('button', { name: /Continue/ }).click();
  await page.getByRole('button', { name: /Continue/ }).click();
  await page.getByRole('button', { name: /Decide later/ }).click();
  await page.getByRole('button', { name: /Continue/ }).click();
  await page.getByRole('button', { name: /^Manual\b/ }).click();
  await page.getByRole('button', { name: /Continue/ }).click();
  await page.getByRole('button', { name: /Create Project Workspace/ }).click();
  await expect(page).toHaveURL(/\/projects\/[^/]+$/);
  const projectPath = new URL(page.url()).pathname;

  await page.getByRole('main').getByRole('button', { name: 'Start Work' }).click();
  await expect(page.getByRole('button', { name: 'Move to Client Review' })).toBeVisible();
  await page.getByRole('button', { name: 'More Actions' }).click();
  await page.getByRole('menuitem', { name: 'Put On Hold' }).click();
  await page.getByRole('button', { name: 'Keep Project' }).click();
  await page.getByRole('button', { name: 'More Actions' }).click();
  await page.getByRole('menuitem', { name: 'Cancel Project' }).click();
  await page.getByRole('button', { name: 'Keep Project' }).click();
  await page.getByRole('button', { name: 'Move to Client Review' }).click();
  await expect(page.getByRole('button', { name: 'Client Requested Changes' })).toBeVisible();

  // Brief & Info content is retained and deep-link reachable (not a sidebar item).
  await page.goto(`${projectPath}/information`);
  const requirementEditor = page.locator('.operations-editor').filter({
    hasText: 'Add missing information',
  });
  await requirementEditor.getByLabel('Title').fill('Final reflected ceiling plan');
  await requirementEditor.getByLabel('Category').fill('Architectural input');
  await requirementEditor.getByLabel('Details').fill('Required before final lighting layout.');
  await requirementEditor.getByLabel('Impact').selectOption('Blocking');
  await requirementEditor.getByRole('button', { name: 'Add Item' }).click();
  await expect(page.getByText('Final reflected ceiling plan').first()).toBeVisible();
  await page.getByLabel('Status for Final reflected ceiling plan').selectOption('Requested');

  const checklistEditor = page
    .locator('.operations-editor')
    .filter({ hasText: 'Add checklist item' });
  await checklistEditor.getByLabel('Category').fill('QA');
  await checklistEditor.getByLabel('Check').fill('Verify final ceiling plan');
  await checklistEditor.getByRole('button', { name: 'Add Check' }).click();
  await page.locator('.checklist-row').filter({ hasText: 'Verify final ceiling plan' }).click();
  await expect(page.getByRole('checkbox', { name: 'Verify final ceiling plan' })).toBeChecked();

  await page.getByRole('link', { name: 'Actions' }).click();
  const actionEditor = page.locator('.operations-editor').filter({ hasText: 'New action' });
  await actionEditor.getByLabel('Action').fill('Coordinate DALI zones');
  await actionEditor.getByLabel('Details').fill('Confirm zone boundaries with interior designer.');
  await actionEditor.getByLabel('Owner').fill('Mohamed');
  await actionEditor.getByLabel('Due date').fill('2026-08-10');
  await actionEditor.getByLabel('Priority').selectOption('High');
  await actionEditor.getByRole('button', { name: 'Add Action' }).click();
  await page.getByLabel('Status for Coordinate DALI zones').selectOption('Completed');
  await expect(
    page.locator('.operation-complete').filter({ hasText: 'Coordinate DALI zones' }),
  ).toBeVisible();

  await page.getByRole('link', { name: 'Meetings' }).click();
  const meetingEditor = page.locator('.operations-editor').filter({ hasText: 'New meeting' });
  await meetingEditor.getByLabel('Title').fill('Lighting coordination meeting');
  await meetingEditor.getByLabel('Start', { exact: true }).fill('2026-08-05T10:00');
  await meetingEditor.getByLabel('End', { exact: true }).fill('2026-08-05T11:00');
  await meetingEditor.getByLabel('Location', { exact: true }).fill('Design office');
  await meetingEditor.getByLabel(/Attendees/).fill('Mohamed, Interior Designer');
  await meetingEditor.getByLabel('Agenda').fill('Coordinate ceiling and control zones.');
  await meetingEditor.getByRole('button', { name: 'Create Meeting' }).click();
  await expect(page.getByText('Lighting coordination meeting').first()).toBeVisible();
  await page.getByRole('button', { name: 'Notes', exact: true }).click();
  const meetingModal = page.locator('form.operation-modal');
  await meetingModal.getByLabel('Status').selectOption('Held');
  await meetingModal.getByLabel('Discussion notes').fill('Ceiling layout coordinated.');
  await meetingModal.getByLabel('Decisions').fill('Use three DALI zones.');
  await meetingModal.getByRole('button', { name: 'Save Meeting Notes' }).click();
  await expect(page.getByText('Use three DALI zones.')).toBeVisible();

  await page.getByRole('link', { name: 'Comments' }).click();
  const reviewEditor = page.locator('.operations-editor').filter({ hasText: 'Add review comment' });
  await reviewEditor.getByLabel('Reference').fill('C-01');
  await reviewEditor.getByLabel('Comment title').fill('Adjust majlis CCT');
  await reviewEditor
    .getByLabel('Comment', { exact: true })
    .fill('Change proposed light colour to 2700K.');
  await reviewEditor.getByLabel('Luminaire tag').fill('DL01');
  await reviewEditor.getByRole('button', { name: 'Add Comment' }).click();
  await page.getByRole('button', { name: 'Review' }).click();
  const reviewModal = page.locator('form.operation-modal');
  await reviewModal.getByLabel('Status').selectOption('Resolved');
  await reviewModal.getByLabel('Designer response').fill('Schedule updated to 2700K.');
  await reviewModal.getByRole('button', { name: 'Save Response' }).click();
  await expect(page.getByText('Response: Schedule updated to 2700K.')).toBeVisible();

  await page.getByRole('link', { name: 'Contacts' }).click();
  const contactEditor = page
    .locator('.operations-editor')
    .filter({ hasText: 'Add project contact' });
  await contactEditor.getByLabel('Name').fill('QA Consultant');
  await contactEditor.getByLabel('Email').fill('qa.consultant@example.com');
  await contactEditor.getByLabel('Company').fill('QA Consultants');
  await contactEditor.getByLabel('Role').fill('Lighting reviewer');
  await contactEditor.getByRole('button', { name: 'Add Contact' }).click();
  await expect(page.getByText('QA Consultant').first()).toBeVisible();

  // Deliverables content is retained and deep-link reachable (not a sidebar item).
  await page.goto(`${projectPath}/deliverables`);
  const deliverableStatus = page.locator('select[aria-label^="Status for"]').first();
  const deliverableLabel = await deliverableStatus.getAttribute('aria-label');
  const completedMutation = page.waitForResponse(
    (response) =>
      response.request().method() === 'PATCH' && response.url().includes('/deliverables/'),
  );
  await deliverableStatus.selectOption('Completed');
  const completedResponse = await completedMutation;
  expect(completedResponse.ok()).toBe(true);
  await expect(deliverableStatus).toHaveValue('Completed');
  const deliverableProgress = page.locator('input[aria-label^="Progress for"]').first();
  const intermediateProgressMutation = page.waitForResponse(
    (response) =>
      response.request().method() === 'PATCH' && response.url().includes('/deliverables/'),
  );
  await deliverableProgress.fill('99');
  const intermediateProgressResponse = await intermediateProgressMutation;
  expect(intermediateProgressResponse.ok()).toBe(true);
  expect(intermediateProgressResponse.request().postDataJSON()).toMatchObject({
    status: 'Completed',
    progressPercent: 99,
  });
  await expect(deliverableProgress).toHaveValue('99');
  const progressMutation = page.waitForResponse(
    (response) =>
      response.request().method() === 'PATCH' && response.url().includes('/deliverables/'),
  );
  await deliverableProgress.fill('100');
  const progressResponse = await progressMutation;
  expect(progressResponse.ok()).toBe(true);
  expect(progressResponse.request().postDataJSON()).toMatchObject({
    status: 'Completed',
    progressPercent: 100,
  });
  await expect(deliverableStatus).toHaveValue('Completed');

  await page.getByRole('link', { name: 'Luminaires' }).click();
  await page.getByRole('button', { name: 'Add Luminaire' }).click();
  const luminaireDialog = page.getByRole('dialog', { name: 'Add Luminaire' });
  await luminaireDialog.getByLabel('Type / Tag').fill('DL01');
  await luminaireDialog.getByLabel('Category').fill('Downlight');
  await luminaireDialog.getByLabel('Description').fill('Trimless recessed downlight');
  await luminaireDialog.getByLabel('Manufacturer').fill('QA Brand');
  await luminaireDialog.getByLabel('Model').fill('QA-DL-01');
  await luminaireDialog.getByLabel('Wattage').fill('8W');
  await luminaireDialog.getByLabel('CCT / Light Colour').fill('2700K');
  await luminaireDialog.getByLabel('Unit').fill('No.');
  await luminaireDialog.getByLabel('Quantity').fill('12');
  await luminaireDialog.getByLabel('Datasheet Path or URL').fill('C:\\QA\\DL01-datasheet.pdf');
  await luminaireDialog.getByRole('button', { name: 'Save Luminaire' }).click();
  await expect(page.getByRole('cell', { name: 'DL01', exact: true })).toBeVisible();

  // Output Setup content is retained and deep-link reachable.
  await page.goto(`${projectPath}/outputs`);
  await page.getByLabel('Hide Type column').first().uncheck();
  await page.getByLabel('tag heading').first().fill('Fixture Type');
  await page.getByRole('button', { name: 'Save Output Setup' }).click();
  await expect(page.getByLabel('Show Fixture Type column').first()).not.toBeChecked();

  await page.getByRole('link', { name: 'Revisions & Outputs' }).click();
  const revisionEditor = page.locator('.operations-editor').filter({ hasText: 'Create revision' });
  await revisionEditor.getByLabel('Revision').fill('1');
  await revisionEditor.getByLabel('Title').fill('Client review revision');
  await revisionEditor.getByLabel('Summary').fill('CCT and DALI zoning updates.');
  await revisionEditor.getByRole('button', { name: 'Create Revision' }).click();
  await expect(page.getByText('Client review revision').first()).toBeVisible();

  await page.reload();
  await expect.poll(() => new URL(page.url()).pathname).toBe(`${projectPath}/revisions`);
  await expect(page.getByRole('button', { name: 'Client Requested Changes' })).toBeVisible();

  await page.goto(`${projectPath}/information`);
  await expect(page.getByLabel('Status for Final reflected ceiling plan')).toHaveValue('Requested');
  await expect(page.getByRole('checkbox', { name: 'Verify final ceiling plan' })).toBeChecked();
  await page.getByRole('link', { name: 'Actions' }).click();
  await expect(page.getByLabel('Status for Coordinate DALI zones')).toHaveValue('Completed');
  await page.getByRole('link', { name: 'Luminaires' }).click();
  await expect(page.getByRole('cell', { name: 'QA-DL-01', exact: true })).toBeVisible();
  await page.goto(`${projectPath}/outputs`);
  await expect(page.getByLabel('Show Fixture Type column').first()).not.toBeChecked();
  await expect(page.getByLabel('tag heading').first()).toHaveValue('Fixture Type');
  await page.getByRole('link', { name: 'Revisions & Outputs' }).click();
  await expect(page.getByText('Client review revision').first()).toBeVisible();
  expect(deliverableLabel).toMatch(/^Status for /);
});

test('edits personal project metadata through the Edit Project form', async ({ page, request }) => {
  const createResponse = await request.post('/api/projects', {
    data: {
      projectName: 'Dubai Hills Villa',
      clientName: 'Private Client',
      projectType: 'Villa Lighting Design',
      description: 'Complete villa lighting design and documentation.',
      siteLocation: 'Dubai Hills',
      designStage: 'Concept',
      lightingScope: 'Complete villa lighting design and documentation.',
      priority: 'Normal',
      complexity: 'Medium',
      estimatedHours: 24,
      requiredDeliveryDate: TEST_FUTURE_REQUIRED_DELIVERY_DATE,
      crmReference: 'CRM-48572',
      idempotencyKey: crypto.randomUUID(),
    },
  });
  expect(createResponse.ok()).toBe(true);
  const created = (await createResponse.json()).data.project as {
    id: string;
    projectCode: string;
  };

  await page.goto(`/projects/${created.id}`);
  await expect(page.getByRole('heading', { name: 'Dubai Hills Villa' })).toBeVisible();
  await expect(page.getByText('CRM-48572')).toBeVisible();

  await page.getByRole('button', { name: 'Edit Project' }).click();
  const dialog = page.getByRole('dialog', { name: 'Edit project details' });
  await expect(dialog).toBeVisible();

  await expect(dialog.getByLabel('Project Code')).toHaveCount(0);
  await expect(dialog.getByLabel(/Folder/)).toHaveCount(0);
  const editInputValues = await dialog
    .locator('input')
    .evaluateAll((elements) => elements.map((element) => (element as HTMLInputElement).value));
  expect(editInputValues).not.toContain(created.projectCode);

  await dialog.getByLabel(/Project Name/).fill('Dubai Hills Villa - Updated');
  await dialog.getByLabel(/Client Name/).fill('Al Barari Client');
  await dialog.getByLabel(/CRM Reference/).fill('CRM-99110');
  await dialog.getByLabel(/Project Type/).selectOption('Lighting Layout');
  await dialog.getByLabel(/Site Location/).fill('Dubai Hills, Al Barari');
  await dialog.getByLabel(/Design Stage/).selectOption('DetailedDesign');
  await dialog.getByLabel(/Lighting Scope/).fill('Interior, landscape and facade lighting design.');
  await dialog.getByLabel(/Lux Requirements/).fill('500 lux at working plane.');
  await dialog.getByLabel(/Drawing Reference/).fill('L-101 Rev B');
  await dialog.getByLabel(/Priority/).selectOption('High');
  await dialog.getByLabel(/Complexity/).selectOption('Large');
  await dialog.getByLabel(/Estimated Hours/).fill('40');
  await dialog.getByLabel(/Progress %/).fill('30');
  await dialog.getByLabel(/Required Delivery Date/).fill(TEST_FUTURE_REQUIRED_DELIVERY_DATE);

  await dialog.getByRole('button', { name: 'Save Changes' }).click();
  await expect(page.getByText('Project details saved.')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Dubai Hills Villa - Updated' })).toBeVisible();

  await page.reload();
  await expect(page.getByRole('heading', { name: 'Dubai Hills Villa - Updated' })).toBeVisible();
  await expect(page.getByText('CRM-99110')).toBeVisible();
  await expect(page.getByText('Al Barari Client · Dubai Hills, Al Barari')).toBeVisible();
  await expect(
    page.getByLabel('Project context').getByText(created.projectCode, { exact: true }),
  ).toBeVisible();
});
