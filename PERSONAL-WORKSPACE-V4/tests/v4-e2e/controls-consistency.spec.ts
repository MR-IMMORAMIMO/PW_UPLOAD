import { test, expect } from '@playwright/test';

test('Studio uses application decisions and themed native dropdowns', async ({ page, request }) => {
  const nativeDialogs: string[] = [];
  page.on('dialog', (dialog) => {
    nativeDialogs.push(dialog.type());
    void dialog.dismiss();
  });
  const projects = (await (await request.get('/api/projects')).json()).data;
  const projectId = projects.items?.[0]?.id ?? projects[0]?.id;
  expect(projectId).toBeTruthy();
  await page.goto(`/v4/projects/${projectId}/output-studio`);
  const studio = page.frameLocator('iframe[title="Luminaire Studio 1.4.1"]');
  await studio.getByRole('heading', { name: 'Output studio', exact: true }).waitFor();
  const catalogBefore = (await (await request.get('/api/luminaire-studio/templates')).json()).data;
  await studio.getByRole('button', { name: 'Save current', exact: true }).click();
  const prompt = page.getByRole('dialog', { name: 'Enter value', exact: true });
  await expect(prompt.getByRole('textbox', { name: 'Template name', exact: true })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(prompt).toHaveCount(0);
  expect((await (await request.get('/api/luminaire-studio/templates')).json()).data).toEqual(
    catalogBefore,
  );
  const select = studio.getByRole('combobox', { name: 'Saved output template', exact: true });
  await select.click();
  expect(await select.evaluate((node) => getComputedStyle(node).appearance)).toBe('base-select');
  await page.keyboard.press('Escape');
  expect(nativeDialogs).toEqual([]);
});
