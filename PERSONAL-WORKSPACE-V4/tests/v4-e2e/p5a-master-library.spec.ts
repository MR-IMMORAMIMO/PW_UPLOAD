import { expect, test, type Page, type TestInfo } from '@playwright/test';
import { writeFileSync } from 'node:fs';

async function captureSettled(page: Page, testInfo: TestInfo, name: string) {
  await page.waitForTimeout(260);
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth))
    .toBe(true);
  await page.screenshot({
    path: testInfo.outputPath(`${name}.png`),
    fullPage: true,
    animations: 'allow',
  });
}

test('Phase 5A owner workflow renders and adds one exact published version to a Project', async ({
  page,
  request,
}, testInfo) => {
  test.setTimeout(90_000);
  const runtimeFailures: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') runtimeFailures.push(`console: ${message.text()}`);
  });
  page.on('pageerror', (error) => runtimeFailures.push(`pageerror: ${error.message}`));
  page.on('dialog', async (dialog) => {
    runtimeFailures.push(`native-dialog: ${dialog.type()} ${dialog.message()}`);
    await dialog.dismiss();
  });
  page.on('response', (response) => {
    if (response.url().includes('/api/') && response.status() >= 400) {
      runtimeFailures.push(
        `${response.status()}: ${response.request().method()} ${response.url()}`,
      );
    }
  });

  const manufacturerResponse = await request.post('/api/luminaire-library/manufacturers', {
    data: { name: 'ERCO', idempotencyKey: crypto.randomUUID() },
  });
  expect(manufacturerResponse.ok()).toBe(true);
  const manufacturer = (await manufacturerResponse.json()).data as {
    manufacturerId: string;
  };
  const productResponse = await request.post('/api/luminaire-library/products', {
    data: {
      manufacturerId: manufacturer.manufacturerId,
      name: 'Lightscan',
      productType: 'Spotlight',
      description: 'Compact architectural track spotlight.',
      idempotencyKey: crypto.randomUUID(),
    },
  });
  expect(productResponse.ok()).toBe(true);
  const product = (await productResponse.json()).data as { productId: string; rowVersion: number };
  const variantResponse = await request.post(
    `/api/luminaire-library/products/${product.productId}/variants`,
    {
      data: {
        variantLabel: '12W · 3000K · 24° · White · DALI',
        orderingCode: 'LS-12-930-24-W-DALI',
        wattage: '12W',
        lumens: '1050 lm',
        lightColor: '3000K',
        cri: 'CRI 90',
        beamAngle: '24°',
        ipRating: 'IP20',
        mounting: 'Track',
        cutout: '',
        driver: 'Integral',
        control: 'DALI',
        emergency: 'No',
        dimensions: '100 × 200 mm',
        bodyColorFinish: 'White',
        idempotencyKey: crypto.randomUUID(),
      },
    },
  );
  expect(variantResponse.ok()).toBe(true);
  const variant = (await variantResponse.json()).data as {
    variantId: string;
    rowVersion: number;
  };
  const publishResponse = await request.post(
    `/api/luminaire-library/variants/${variant.variantId}/publish`,
    {
      data: {
        expectedProductRowVersion: product.rowVersion,
        expectedVariantRowVersion: variant.rowVersion,
        idempotencyKey: crypto.randomUUID(),
      },
    },
  );
  expect(publishResponse.ok()).toBe(true);

  const ikuProductResponse = await request.post('/api/luminaire-library/products', {
    data: {
      manufacturerId: manufacturer.manufacturerId,
      name: 'Iku',
      productType: 'Recessed Downlight',
      description: 'Architectural recessed downlight family.',
      idempotencyKey: crypto.randomUUID(),
    },
  });
  expect(ikuProductResponse.ok()).toBe(true);
  const ikuProduct = (await ikuProductResponse.json()).data as {
    productId: string;
    rowVersion: number;
  };
  const fixtureSpecs = [
    {
      code: 'A2000427',
      watts: '10.6W',
      lumens: '1222 lm',
      cct: '3000K',
      cri: 'CRI92',
      beam: 'Wide Flood',
      control: 'DALI',
      ip: 'IP20',
      photometry: 'IES',
    },
    {
      code: 'A2000428',
      watts: '12W',
      lumens: '1400 lm',
      cct: '3000K',
      cri: 'CRI92',
      beam: '24°',
      control: 'DALI',
      ip: 'IP20',
      photometry: 'IES',
    },
    {
      code: 'A2000429',
      watts: '14W',
      lumens: '1550 lm',
      cct: '4000K',
      cri: 'CRI90',
      beam: '36°',
      control: 'DALI',
      ip: 'IP44',
      photometry: 'LDT',
    },
  ] as const;
  const ikuVariants: Array<{ variantId: string; rowVersion: number }> = [];
  for (const [index, spec] of fixtureSpecs.entries()) {
    const created = await request.post(
      `/api/luminaire-library/products/${ikuProduct.productId}/variants`,
      {
        data: {
          variantLabel: `Iku ${spec.watts} ${spec.cct} ${spec.beam}`,
          orderingCode: spec.code,
          wattage: spec.watts,
          lumens: spec.lumens,
          lightColor: spec.cct,
          cri: spec.cri,
          beamAngle: spec.beam,
          ipRating: spec.ip,
          mounting: 'Recessed',
          cutout: 'Ø150 mm',
          driver: 'Remote',
          control: spec.control,
          emergency: 'No',
          dimensions: 'Ø165 × 120 mm',
          bodyColorFinish: 'White',
          idempotencyKey: crypto.randomUUID(),
        },
      },
    );
    expect(created.ok()).toBe(true);
    const createdVariant = (await created.json()).data as {
      variantId: string;
      rowVersion: number;
    };
    ikuVariants.push(createdVariant);
    const photometryPath = testInfo.outputPath(`iku-${index}.${spec.photometry.toLowerCase()}`);
    writeFileSync(photometryPath, `fixture ${spec.photometry} ${spec.code}`);
    const assetResponse = await request.post('/api/luminaire-library/assets', {
      data: {
        productId: ikuProduct.productId,
        variantId: createdVariant.variantId,
        assetType: spec.photometry,
        label: `${spec.photometry} current`,
        idempotencyKey: crypto.randomUUID(),
      },
    });
    expect(assetResponse.ok()).toBe(true);
    const asset = (await assetResponse.json()).data as { assetId: string };
    const versionResponse = await request.post(
      `/api/luminaire-library/assets/${asset.assetId}/versions`,
      {
        data: {
          sourceFilePath: photometryPath,
          expectedLatestSequence: 0,
          idempotencyKey: crypto.randomUUID(),
        },
      },
    );
    expect(versionResponse.ok()).toBe(true);
    if (index < 2) {
      const imagePath = testInfo.outputPath(`iku-${index}.png`);
      writeFileSync(
        imagePath,
        Buffer.from(
          'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
          'base64',
        ),
      );
      const imageAssetResponse = await request.post('/api/luminaire-library/assets', {
        data: {
          productId: ikuProduct.productId,
          variantId: createdVariant.variantId,
          assetType: 'ProductImage',
          label: 'Product image current',
          idempotencyKey: crypto.randomUUID(),
        },
      });
      expect(imageAssetResponse.ok()).toBe(true);
      const imageAsset = (await imageAssetResponse.json()).data as { assetId: string };
      expect(
        (
          await request.post(`/api/luminaire-library/assets/${imageAsset.assetId}/versions`, {
            data: {
              sourceFilePath: imagePath,
              expectedLatestSequence: 0,
              idempotencyKey: crypto.randomUUID(),
            },
          })
        ).ok(),
      ).toBe(true);
    }
  }
  const datasheetPath = testInfo.outputPath('iku-family.pdf');
  writeFileSync(datasheetPath, 'fixture Iku family datasheet');
  const datasheetAssetResponse = await request.post('/api/luminaire-library/assets', {
    data: {
      productId: ikuProduct.productId,
      variantId: null,
      assetType: 'Datasheet',
      label: 'Datasheet current',
      idempotencyKey: crypto.randomUUID(),
    },
  });
  expect(datasheetAssetResponse.ok()).toBe(true);
  const datasheetAsset = (await datasheetAssetResponse.json()).data as { assetId: string };
  expect(
    (
      await request.post(`/api/luminaire-library/assets/${datasheetAsset.assetId}/versions`, {
        data: {
          sourceFilePath: datasheetPath,
          expectedLatestSequence: 0,
          idempotencyKey: crypto.randomUUID(),
        },
      })
    ).ok(),
  ).toBe(true);
  for (const createdVariant of ikuVariants) {
    const published = await request.post(
      `/api/luminaire-library/variants/${createdVariant.variantId}/publish`,
      {
        data: {
          expectedProductRowVersion: ikuProduct.rowVersion,
          expectedVariantRowVersion: createdVariant.rowVersion,
          idempotencyKey: crypto.randomUUID(),
        },
      },
    );
    expect(published.ok()).toBe(true);
  }
  const otherManufacturerResponse = await request.post('/api/luminaire-library/manufacturers', {
    data: { name: 'iGuzzini', idempotencyKey: crypto.randomUUID() },
  });
  expect(otherManufacturerResponse.ok()).toBe(true);
  const otherManufacturer = (await otherManufacturerResponse.json()).data as {
    manufacturerId: string;
  };
  const otherProductResponse = await request.post('/api/luminaire-library/products', {
    data: {
      manufacturerId: otherManufacturer.manufacturerId,
      name: 'Laser Blade',
      productType: 'Recessed Downlight',
      description: 'Secondary manufacturer filter fixture.',
      idempotencyKey: crypto.randomUUID(),
    },
  });
  expect(otherProductResponse.ok()).toBe(true);
  const otherProduct = (await otherProductResponse.json()).data as {
    productId: string;
    rowVersion: number;
  };
  const otherVariantResponse = await request.post(
    `/api/luminaire-library/products/${otherProduct.productId}/variants`,
    {
      data: {
        variantLabel: 'Laser Blade 18W 3000K Flood',
        orderingCode: 'IG-LB-18-930',
        wattage: '18W',
        lumens: '1700 lm',
        lightColor: '3000K',
        cri: 'CRI90',
        beamAngle: 'Flood',
        ipRating: 'IP20',
        mounting: 'Recessed',
        cutout: '',
        driver: 'Remote',
        control: 'DALI',
        emergency: 'No',
        dimensions: '',
        bodyColorFinish: 'White',
        idempotencyKey: crypto.randomUUID(),
      },
    },
  );
  expect(otherVariantResponse.ok()).toBe(true);
  const otherVariant = (await otherVariantResponse.json()).data as {
    variantId: string;
    rowVersion: number;
  };
  expect(
    (
      await request.post(`/api/luminaire-library/variants/${otherVariant.variantId}/publish`, {
        data: {
          expectedProductRowVersion: otherProduct.rowVersion,
          expectedVariantRowVersion: otherVariant.rowVersion,
          idempotencyKey: crypto.randomUUID(),
        },
      })
    ).ok(),
  ).toBe(true);
  const duplicateResponse = await request.post(
    `/api/luminaire-library/products/${ikuProduct.productId}/variants`,
    {
      data: {
        variantLabel: 'Duplicate Iku',
        orderingCode: ' a2000427 ',
        wattage: '10.6W',
        lumens: '1222 lm',
        lightColor: '3000K',
        cri: 'CRI92',
        beamAngle: '24°',
        ipRating: 'IP44',
        mounting: 'Recessed',
        cutout: '',
        driver: 'Remote',
        control: 'DALI',
        emergency: 'No',
        dimensions: '',
        bodyColorFinish: 'White',
        idempotencyKey: crypto.randomUUID(),
      },
    },
  );
  expect(duplicateResponse.status()).toBe(409);
  expect((await duplicateResponse.json()).error.details).toMatchObject({
    conflictKind: 'DUPLICATE_ORDERING_CODE',
    variantId: ikuVariants[0]!.variantId,
  });

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(
    `/v4/luminaire-library?productId=${ikuProduct.productId}&variantId=${ikuVariants[1]!.variantId}`,
  );
  await expect(page.getByRole('heading', { name: 'Luminaire Library', exact: true })).toBeVisible();
  const libraryTable = page.getByRole('table', { name: 'Luminaire Library Products' });
  const inspector = page.getByRole('complementary', { name: 'Selected product inspector' });
  await expect(inspector).toContainText('A2000428');
  await page.getByLabel('Category', { exact: true }).selectOption('Recessed Downlight');
  // Three published variants and the empty draft product both belong to this category.
  await expect(libraryTable.locator('tbody tr')).toHaveCount(4);
  await page.getByLabel('Manufacturer', { exact: true }).selectOption('ERCO');
  await page.getByLabel('CCT', { exact: true }).selectOption('3000K');
  await page.getByLabel('Control', { exact: true }).selectOption('DALI');
  await expect(libraryTable.getByRole('row', { name: /A2000427/ })).toBeVisible();
  await captureSettled(page, testInfo, '01-final-library-filtered');
  await page.getByRole('button', { name: 'Clear', exact: true }).click();
  await page
    .getByRole('textbox', { name: 'Search Library', exact: true })
    .fill('no-such-owner-uat-product');
  await expect(page.getByRole('status')).toContainText('No luminaires match');
  await page.getByRole('textbox', { name: 'Search Library', exact: true }).fill('');
  await libraryTable.locator(`[data-library-id="${ikuVariants[1]!.variantId}"]`).click();
  await expect(inspector).toContainText('A2000428');
  const addProductAction = page.getByRole('button', { name: 'New Draft', exact: true });
  await addProductAction.click();
  const productDialog = page.getByRole('dialog', { name: 'Add Library Product' });
  await productDialog.getByLabel('Common Technical Description').fill('Unsaved owner draft');
  await productDialog.getByRole('button', { name: 'Close', exact: true }).click();
  const discard = page.getByRole('alertdialog', { name: 'Discard Library draft changes' });
  await expect(discard).toBeVisible();
  await discard.getByRole('button', { name: 'Discard Changes' }).click();
  await expect(productDialog).toBeHidden();
  await inspector.getByRole('button', { name: 'Open Draft', exact: true }).click();
  const draft = page.getByRole('dialog', { name: 'Edit Variant Draft' });
  await draft.getByLabel('Beam / Optic').fill('25°');
  await draft.getByRole('button', { name: 'Save Draft' }).click();
  await expect(draft).toBeHidden();
  await page.reload();
  await expect(inspector).toContainText('A2000428');
  await inspector.getByRole('button', { name: 'Open Draft', exact: true }).click();
  await expect(
    page.getByRole('dialog', { name: 'Edit Variant Draft' }).getByLabel('Beam / Optic'),
  ).toHaveValue('25°');
  await page.keyboard.press('Escape');
  await inspector.getByRole('button', { name: 'Publish Version', exact: true }).click();
  const publishConfirmation = page.getByRole('dialog', { name: 'Publish Variant Version' });
  await expect(publishConfirmation).toBeVisible();
  await publishConfirmation.getByRole('button', { name: 'Cancel', exact: true }).click();
  const immutableVersions = await request.get(
    `/api/luminaire-library/variants/${ikuVariants[1]!.variantId}/versions`,
  );
  expect((await immutableVersions.json()).data).toHaveLength(1);
  for (const theme of ['light', 'dark']) {
    for (const width of [1080, 1440, 1920]) {
      await page.setViewportSize({ width, height: width === 1920 ? 1080 : 900 });
      await page.evaluate((theme) => {
        localStorage.setItem('scli.v4.theme', theme);
        document.documentElement.dataset.theme = theme;
      }, theme);
      await expect
        .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1))
        .toBe(true);
      const rect = await inspector.boundingBox();
      expect(rect).not.toBeNull();
      expect(rect!.height).toBeGreaterThan(500);
      await captureSettled(page, testInfo, `final-library-${theme}-${width}`);
    }
  }

  const projectsResponse = await request.get('/api/projects');
  expect(projectsResponse.ok()).toBe(true);
  const projects = (await projectsResponse.json()).data as Array<{ id: string }>;
  expect(projects.length).toBeGreaterThan(0);
  const customResponse = await request.post(`/api/projects/${projects[0]!.id}/luminaires`, {
    data: {
      tag: 'C-P5A-DRAFT',
      category: 'Decorative',
      imagePath: '',
      description: 'Reusable custom pendant baseline.',
      manufacturer: 'Project-only Maker',
      model: 'Bespoke Pendant',
      productType: '',
      variantLabel: '',
      orderingCode: 'BP-P5A-12-930-DALI',
      wattage: '12W',
      lumens: '1050 lm',
      lightColor: '3000K',
      cri: 'CRI90',
      beamAngle: '24°',
      ipRating: 'IP20',
      mounting: 'Suspended',
      cutout: '',
      driver: 'Integral',
      control: 'DALI',
      emergency: 'No',
      datasheetPath: '',
      location: 'Owner UAT lobby',
      unit: 'No.',
      quantity: 3,
      notes: 'Project-only note must remain excluded.',
      sourceName: 'Manual',
      dimensions: 'Ø240 × 420 mm',
      bodyColorFinish: 'White',
    },
  });
  expect(customResponse.ok()).toBe(true);
  const custom = (await customResponse.json()).data as { id: string };
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`/v4/projects/${projects[0]!.id}/luminaires`);
  await page.getByRole('button', { name: 'Add Luminaire' }).click();
  await page.getByRole('menuitem', { name: 'From Master Library' }).click();
  let libraryDialog = page.getByRole('dialog', {
    name: 'Add Luminaire · From Master Library',
  });
  await expect(libraryDialog).toBeVisible();
  await libraryDialog.getByRole('button', { name: 'Cancel' }).click();
  await expect(libraryDialog).toBeHidden();
  await page.getByRole('button', { name: 'Add Luminaire' }).click();
  await page.getByRole('menuitem', { name: 'From Master Library' }).click();
  libraryDialog = page.getByRole('dialog', { name: 'Add Luminaire · From Master Library' });
  await expect(libraryDialog).toBeVisible();
  await libraryDialog.getByRole('button', { name: /ERCO Lightscan/ }).click();
  await libraryDialog.getByLabel('Tag').fill('L-P5A-01');
  await libraryDialog
    .getByRole('textbox', { name: 'Project Category', exact: true })
    .fill('Spotlight');
  await libraryDialog.getByLabel('Location').fill('Owner UAT lobby');
  await libraryDialog.getByLabel('Quantity').fill('4');
  await libraryDialog
    .getByLabel('Project Description Override')
    .fill('Owner-approved Project description override.');
  await captureSettled(page, testInfo, '06-add-from-library-dark-1440');
  await libraryDialog.getByRole('button', { name: 'Add to Project' }).click();
  await expect(libraryDialog).toBeHidden();
  await expect(page.getByText('L-P5A-01', { exact: true }).first()).toBeVisible();
  const linkedRow = page
    .getByRole('row')
    .filter({ has: page.getByRole('checkbox', { name: 'Select L-P5A-01', exact: true }) });
  await expect(linkedRow).toContainText('12');
  await expect(linkedRow).toContainText('3000 K');
  await captureSettled(page, testInfo, 'linked-project-final-luminaires');

  const linkedWorkspaceResponse = await request.get(`/api/projects/${projects[0]!.id}/workspace`);
  expect(linkedWorkspaceResponse.ok()).toBe(true);
  const linkedLuminaire = (
    (await linkedWorkspaceResponse.json()).data.luminaires as Array<{
      id: string;
      tag: string;
      lumens: string;
    }>
  ).find((item) => item.tag === 'L-P5A-01');
  expect(linkedLuminaire).toBeDefined();
  expect(linkedLuminaire!.lumens).toBe('1050 lm');
  const updateVariantResponse = await request.patch(
    `/api/luminaire-library/variants/${variant.variantId}/draft`,
    {
      data: {
        variantLabel: '12W · 3000K · 24° · White · DALI',
        orderingCode: 'LS-12-930-24-W-DALI',
        wattage: '12W',
        lumens: '1120 lm',
        lightColor: '3000K',
        cri: 'CRI 90',
        beamAngle: '24°',
        ipRating: 'IP20',
        mounting: 'Track',
        cutout: '',
        driver: 'Integral',
        control: 'DALI',
        emergency: 'No',
        dimensions: '100 × 200 mm',
        bodyColorFinish: 'White',
        expectedRowVersion: variant.rowVersion,
      },
    },
  );
  expect(updateVariantResponse.ok()).toBe(true);
  const updatedVariant = (await updateVariantResponse.json()).data as { rowVersion: number };
  const secondPublishResponse = await request.post(
    `/api/luminaire-library/variants/${variant.variantId}/publish`,
    {
      data: {
        expectedProductRowVersion: product.rowVersion,
        expectedVariantRowVersion: updatedVariant.rowVersion,
        idempotencyKey: crypto.randomUUID(),
      },
    },
  );
  expect(secondPublishResponse.ok()).toBe(true);
  await page.goto(
    `/v4/projects/${projects[0]!.id}/luminaires?luminaireId=${encodeURIComponent(linkedLuminaire!.id)}`,
  );
  // Library comparison/promotion have no final inspector destination. Exercise
  // their retained backend authority without inventing controls in the locked UI.
  const sourceStatus = await request.get(
    `/api/projects/${projects[0]!.id}/luminaires/${linkedLuminaire!.id}/library-status`,
  );
  expect(sourceStatus.ok()).toBe(true);
  const currentWorkspace = await request.get(`/api/projects/${projects[0]!.id}/workspace`);
  expect(
    (await currentWorkspace.json()).data.luminaires.find(
      (item: { id: string }) => item.id === linkedLuminaire!.id,
    ).lumens,
  ).toBe('1050 lm');
  const candidateResponse = await request.get(
    `/api/projects/${projects[0]!.id}/luminaires/${custom.id}/library-draft-candidate`,
  );
  expect(candidateResponse.ok()).toBe(true);
  const candidate = (await candidateResponse.json()).data;
  const promoted = await request.post(
    `/api/projects/${projects[0]!.id}/luminaires/${custom.id}/create-library-draft`,
    {
      data: {
        manufacturer: { mode: 'CREATE_NEW', name: candidate.source.manufacturerName },
        product: {
          mode: 'CREATE_NEW',
          name: candidate.source.productName,
          productType: candidate.source.productType,
          description: candidate.source.description,
          duplicateDecision: 'NO_MATCHES',
        },
        variant: candidate.source.variant,
        idempotencyKey: crypto.randomUUID(),
      },
    },
  );
  expect(promoted.ok(), await promoted.text()).toBe(true);
  await page.goto('/v4/luminaire-library');
  await expect(
    page
      .getByRole('table', { name: 'Luminaire Library Products' })
      .getByRole('row', { name: /Bespoke Pendant/ }),
  ).toContainText('Draft');
  await captureSettled(page, testInfo, 'promoted-draft-final-library');

  const afterCandidate = await request.get(
    `/api/projects/${projects[0]!.id}/luminaires/${custom.id}/library-draft-candidate`,
  );
  expect(afterCandidate.ok()).toBe(true);
  expect((await afterCandidate.json()).data.eligibility).toMatchObject({
    eligible: true,
    reasonCode: 'ELIGIBLE',
  });
  const workspaceAfter = await request.get(`/api/projects/${projects[0]!.id}/workspace`);
  const sourceAfter = (
    (await workspaceAfter.json()).data.luminaires as Array<Record<string, unknown>>
  ).find((item) => item.id === custom.id);
  expect(sourceAfter).toMatchObject({
    tag: 'C-P5A-DRAFT',
    category: 'Decorative',
    location: 'Owner UAT lobby',
    unit: 'No.',
    quantity: 3,
    notes: 'Project-only note must remain excluded.',
  });

  expect(runtimeFailures).toEqual([]);
});
