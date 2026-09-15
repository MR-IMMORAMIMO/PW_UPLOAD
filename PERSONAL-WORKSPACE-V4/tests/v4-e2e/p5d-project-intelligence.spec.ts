import { expect, test, type APIRequestContext } from '@playwright/test';
import { randomUUID } from 'node:crypto';

async function data<T>(response: Awaited<ReturnType<APIRequestContext['get']>>): Promise<T> {
  if (!response.ok()) throw new Error(`${response.status()}: ${await response.text()}`);
  return ((await response.json()) as { data: T }).data;
}

async function createProject(request: APIRequestContext, name: string): Promise<string> {
  const project = await data<{ project: { id: string } }>(
    await request.post('/api/projects', {
      data: {
        projectName: name,
        clientName: 'Disposable P5D Client',
        projectType: 'Lighting Design',
        description: 'Disposable Project Intelligence.',
        siteLocation: 'Synthetic Site',
        designStage: 'DetailedDesign',
        lightingScope: 'Project Intelligence only.',
        priority: 'Normal',
        complexity: 'Medium',
        estimatedHours: 1,
        requiredDeliveryDate: '2028-12-15',
        idempotencyKey: randomUUID(),
      },
    }),
  );
  return project.project.id;
}

test('P5D retains readiness services while retiring standalone Project Intelligence', async ({
  page,
  request,
}) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 1536, height: 1024 });
  const projectId = await createProject(request, 'P5D Project Intelligence');
  const fixture = await data<{ revisionId: string; sourceId: string }>(
    await request.post('/api/test/p5d-intelligence/seed', {
      data: { projectId },
    }),
  );

  await page.goto('/v4/dashboard');
  await page.evaluate(() => window.localStorage.setItem('scli.v4.theme', 'dark'));
  await page.goto(`/v4/projects/${projectId}/intelligence`);

  await expect(page.getByRole('heading', { name: 'Ready-to-Issue' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Project Intelligence', exact: true })).toHaveCount(
    0,
  );
  await expect(page).toHaveURL(new RegExp(`/v4/projects/${projectId}/files$`));
  await expect(page.getByRole('heading', { name: 'Project Files' })).toBeVisible();

  // The readiness API returns a deterministic level for the seeded Revision.
  const readiness = await data<{ level: string; revisionId: string }>(
    await request.get(`/api/projects/${projectId}/readiness?revisionId=${fixture.revisionId}`),
  );
  expect(readiness.revisionId).toBe(fixture.revisionId);
  expect(['READY', 'READY_WITH_WARNINGS', 'NOT_READY']).toContain(readiness.level);
});

test('P5D action CAS patch rejects a stale row_version through the HTTP boundary', async ({
  request,
}) => {
  const projectId = await createProject(request, 'P5D Action CAS');
  const created = await data<{ id: string; rowVersion: number }>(
    await request.post(`/api/projects/${projectId}/actions`, {
      data: {
        title: 'Blocking layout fix',
        details: '',
        owner: 'Mohamed',
        ownerRole: '',
        dueDate: null,
        status: 'Open',
        priority: 'High',
        sourceType: 'Manual',
        sourceId: null,
        revisionId: null,
        categoryId: null,
        notes: '',
        blocksIssue: true,
      },
    }),
  );
  expect(created.rowVersion).toBe(1);

  const patched = await data<{ status: string; rowVersion: number }>(
    await request.patch(`/api/projects/${projectId}/actions/${created.id}/merge`, {
      data: { rowVersion: 1, status: 'InProgress' },
    }),
  );
  expect(patched.status).toBe('InProgress');
  expect(patched.rowVersion).toBe(2);

  const stale = await request.patch(`/api/projects/${projectId}/actions/${created.id}/merge`, {
    data: { rowVersion: 1, status: 'Completed' },
  });
  expect(stale.status()).toBe(409);
});
