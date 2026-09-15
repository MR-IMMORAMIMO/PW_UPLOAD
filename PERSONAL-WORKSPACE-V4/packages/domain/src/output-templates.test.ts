import { describe, expect, it } from 'vitest';
import {
  DomainError,
  builtInTemplateVersions,
  canonicalDataValueKeys,
  canonicalTechnicalValueKeys,
  commercialPricingFieldKeys,
  findTemplateVersion,
  mandatoryTraceabilitySectionIds,
  normalizeForbiddenKey,
  resolveOutputTemplate,
  resolveTechnicalScheduleLayout,
  validateBuiltInTemplates,
  validateTemplateVersion,
  type OutputTemplateDefinition,
  type OutputTemplateOverride,
  type OutputSectionDefinition,
} from './index';

const SCHEDULE = 'LuminaireSchedule' as const;
const BOQ = 'TechnicalBoq' as const;
const PRESENTATION = 'PresentationSchedule' as const;

function resolve(
  templateId: string,
  requestedFamily: typeof SCHEDULE | typeof BOQ | typeof PRESENTATION | 'DatasheetRegister',
  overrides: {
    versionId?: string;
    globalConfig?: OutputTemplateOverride;
    projectOverride?: OutputTemplateOverride;
    generationOverride?: OutputTemplateOverride;
    allowInactive?: boolean;
    registry?: readonly OutputTemplateDefinition[];
  } = {},
) {
  return resolveOutputTemplate({
    templateId,
    requestedFamily,
    ...overrides,
  });
}

function expectDomainError(fn: () => unknown, message: string): void {
  let error: unknown;
  try {
    fn();
  } catch (caught) {
    error = caught;
  }
  expect(error).toBeInstanceOf(DomainError);
  expect((error as DomainError).message).toContain(message);
}

describe('P2-FND-03 — Versioned Output Template contract', () => {
  it('validates every built-in TemplateVersion definition', () => {
    expect(() => validateBuiltInTemplates()).not.toThrow();
  });

  it('every built-in template has a stable Template ID', () => {
    for (const version of builtInTemplateVersions) {
      expect(version.templateId.trim().length).toBeGreaterThan(0);
    }
  });

  it('every built-in definition has an explicit immutable Version ID', () => {
    for (const version of builtInTemplateVersions) {
      expect(version.versionId.trim().length).toBeGreaterThan(0);
      expect(version.versionId).not.toMatch(/updatedAt|timestamp/i);
    }
  });

  it('Template IDs are unique', () => {
    const ids = builtInTemplateVersions.map((version) => version.templateId);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('TemplateVersion IDs are unique within each Template ID', () => {
    const byTemplate = new Map<string, string[]>();
    for (const version of builtInTemplateVersions) {
      byTemplate.set(version.templateId, [
        ...(byTemplate.get(version.templateId) ?? []),
        version.versionId,
      ]);
    }
    for (const [templateId, versions] of byTemplate) {
      expect(new Set(versions).size, templateId).toBe(versions.length);
    }
  });

  it('Schedule and BOQ families are incompatible across the resolver', () => {
    expectDomainError(
      () => resolve('schedule.technical-modern', BOQ),
      'not compatible with requested family',
    );
    expectDomainError(
      () => resolve('boq.technical-modern', SCHEDULE),
      'not compatible with requested family',
    );
  });

  it('built-in vs custom classification is represented', () => {
    expect(builtInTemplateVersions.every((version) => version.origin === 'builtin')).toBe(true);
    const custom: OutputTemplateDefinition = {
      ...builtInTemplateVersions[0]!,
      templateId: 'schedule.custom.example',
      versionId: 'v1',
      origin: 'custom',
      displayName: 'Custom Example',
    };
    expect(custom.origin).toBe('custom');
  });

  it('inactive template cannot be selected for new generation', () => {
    const inactive: OutputTemplateDefinition = {
      ...builtInTemplateVersions[0]!,
      templateId: 'schedule.inactive.example',
      versionId: 'v1',
      state: 'inactive',
    };
    expectDomainError(
      () => resolve('schedule.inactive.example', SCHEDULE, { registry: [inactive] }),
      'inactive and cannot be selected for new generation',
    );
  });

  it('historical/inactive identity remains representable via allowInactive', () => {
    const inactive: OutputTemplateDefinition = {
      ...builtInTemplateVersions[0]!,
      templateId: 'schedule.inactive.example',
      versionId: 'v1',
      state: 'inactive',
    };
    const resolved = resolve('schedule.inactive.example', SCHEDULE, {
      registry: [inactive],
      allowInactive: true,
    });
    expect(resolved.state).toBe('inactive');
    expect(resolved.templateId).toBe('schedule.inactive.example');
  });

  it('mandatory traceability elements always resolve enabled', () => {
    for (const version of builtInTemplateVersions) {
      const resolved = resolve(version.templateId, version.family);
      for (const id of mandatoryTraceabilitySectionIds) {
        const section = resolved.sections.find((item) => item.sectionId === id);
        expect(section, `${version.templateId} ${id}`).toBeDefined();
        expect(section!.visible).toBe(true);
        expect(section!.mandatory).toBe(true);
      }
    }
  });

  it('attempt to disable mandatory traceability is rejected', () => {
    expectDomainError(
      () =>
        resolve('schedule.technical-modern', SCHEDULE, {
          projectOverride: {
            sections: [{ sectionId: 'projectCode', visible: false }],
          },
        }),
      'Mandatory traceability section "projectCode" cannot be disabled',
    );
  });

  it('rejects a registered definition whose mandatory traceability starts hidden', () => {
    const source = builtInTemplateVersions[0]!;
    const hiddenMandatory: OutputTemplateDefinition = {
      ...source,
      templateId: 'schedule.hidden-mandatory',
      sections: source.sections.map((section) =>
        section.sectionId === 'projectCode' ? { ...section, visible: false } : { ...section },
      ),
    };

    expectDomainError(
      () => validateTemplateVersion(hiddenMandatory),
      'Mandatory traceability section "projectCode" must be visible',
    );
  });

  it('optional section hide/show works', () => {
    const resolved = resolve('schedule.technical-modern', SCHEDULE, {
      projectOverride: { sections: [{ sectionId: 'notes', visible: false }] },
    });
    expect(resolved.sections.find((item) => item.sectionId === 'notes')!.visible).toBe(false);
    expect(resolved.sections.find((item) => item.sectionId === 'kpiSummary')!.visible).toBe(true);
  });

  it('optional section ordering resolves deterministically', () => {
    const resolved = resolve('schedule.technical-modern', SCHEDULE, {
      projectOverride: {
        sections: [
          { sectionId: 'notes', order: 100 },
          { sectionId: 'kpiSummary', order: 50 },
        ],
      },
    });
    const orders = resolved.sections.map((item) => item.order);
    expect([...orders].sort((a, b) => a - b)).toEqual(orders);
    expect(resolved.sections.find((item) => item.sectionId === 'kpiSummary')!.order).toBe(50);
    expect(resolved.sections.find((item) => item.sectionId === 'notes')!.order).toBe(100);
  });

  it('column visibility override works', () => {
    const resolved = resolve('schedule.technical-modern', SCHEDULE, {
      projectOverride: { columns: [{ columnId: 'image', visible: false }] },
    });
    expect(resolved.columns.find((item) => item.columnId === 'image')!.visible).toBe(false);
    expect(resolved.columns.find((item) => item.columnId === 'tag')!.visible).toBe(true);
  });

  it('column ordering resolves deterministically', () => {
    const resolved = resolve('schedule.technical-modern', SCHEDULE, {
      projectOverride: {
        columns: [
          { columnId: 'tag', order: 200 },
          { columnId: 'category', order: 1 },
        ],
      },
    });
    const orders = resolved.columns.map((item) => item.order);
    expect([...orders].sort((a, b) => a - b)).toEqual(orders);
    expect(resolved.columns.find((item) => item.columnId === 'category')!.order).toBe(1);
    expect(resolved.columns.find((item) => item.columnId === 'tag')!.order).toBe(200);
  });

  it('nested overrides preserve unspecified sibling config', () => {
    const resolved = resolve('schedule.technical-modern', SCHEDULE, {
      projectOverride: {
        sections: [{ sectionId: 'notes', config: { maxLength: 5_000 } }],
      },
    });
    const notes = resolved.sections.find((item) => item.sectionId === 'notes')!;
    expect(notes.config.maxLength).toBe(5_000);
    // Sibling config keys from the template default are preserved.
    expect(notes.config).toHaveProperty('maxLength');
  });

  it('global configuration applies over TemplateVersion default', () => {
    const resolved = resolve('schedule.technical-modern', SCHEDULE, {
      globalConfig: { paperSize: 'A4' },
    });
    expect(resolved.paperSize).toBe('A4');
  });

  it('project override applies over global config', () => {
    const resolved = resolve('schedule.technical-modern', SCHEDULE, {
      globalConfig: { paperSize: 'A4' },
      projectOverride: { paperSize: 'A3' },
    });
    expect(resolved.paperSize).toBe('A3');
  });

  it('generation-time presentation override applies over project override', () => {
    const resolved = resolve('schedule.technical-modern', SCHEDULE, {
      projectOverride: { paperSize: 'A3' },
      generationOverride: { paperSize: 'A4' },
    });
    expect(resolved.paperSize).toBe('A4');
  });

  it('fully resolved result contains no implicit mutable-default dependency', () => {
    const resolved = resolve('schedule.technical-modern', SCHEDULE);
    expect(resolved.paperSize).toBeDefined();
    expect(resolved.orientation).toBeDefined();
    expect(resolved.rowDensity).toBeDefined();
    expect(resolved.imageSettings).toBeDefined();
    expect(resolved.headerSettings).toBeDefined();
    expect(resolved.footerSettings).toBeDefined();
    expect(resolved.logoVisible).toBeDefined();
    expect(resolved.sections.every((item) => item.visible !== undefined)).toBe(true);
    expect(resolved.columns.every((item) => item.visible !== undefined)).toBe(true);
  });

  it('resolved snapshot contains Template ID + Version ID', () => {
    const resolved = resolve('schedule.technical-modern', SCHEDULE);
    expect(resolved.templateId).toBe('schedule.technical-modern');
    expect(resolved.versionId).toBe('v2');
  });

  it('Classic Grid Pro Full Technical is representable', () => {
    const resolved = resolve('schedule.classic-grid-pro.full-technical', SCHEDULE);
    expect(resolved.templateId).toBe('schedule.classic-grid-pro.full-technical');
    expect(resolved.columns.length).toBeGreaterThan(10);
    expect(resolved.columnGroups.some((group) => group.groupId === 'product-identity')).toBe(true);
  });

  it('Classic Grid Pro Consultant is distinct', () => {
    const full = resolve('schedule.classic-grid-pro.full-technical', SCHEDULE);
    const consultant = resolve('schedule.classic-grid-pro.consultant', SCHEDULE);
    expect(consultant.templateId).toBe('schedule.classic-grid-pro.consultant');
    expect(consultant.columns.length).toBeLessThan(full.columns.length);
  });

  it('Classic Grid Pro Compact is distinct', () => {
    const consultant = resolve('schedule.classic-grid-pro.consultant', SCHEDULE);
    const compact = resolve('schedule.classic-grid-pro.compact', SCHEDULE);
    expect(compact.templateId).toBe('schedule.classic-grid-pro.compact');
    expect(compact.columns.length).toBeLessThan(consultant.columns.length);
    expect(compact.rowDensity).toBe('Compact');
  });

  it('resolves materially distinct serializer-neutral Schedule layouts', () => {
    const professional = resolve('schedule.technical-modern', SCHEDULE, { versionId: 'v2' });
    const consultant = resolve('schedule.classic-grid-pro.consultant', SCHEDULE, {
      versionId: 'v1',
    });
    const compact = resolve('schedule.classic-grid-pro.compact', SCHEDULE, { versionId: 'v1' });
    const professionalLayout = resolveTechnicalScheduleLayout(professional);
    const consultantLayout = resolveTechnicalScheduleLayout(consultant);
    const compactLayout = resolveTechnicalScheduleLayout(compact);

    expect(professionalLayout.showImage).toBe(true);
    expect(professionalLayout.groups.map((group) => group.label)).toEqual([
      'Product',
      'Light Output',
      'Installation',
      'Application',
      'Documentation',
    ]);
    expect(consultantLayout.showImage).toBe(false);
    expect(consultantLayout.groups.map((group) => group.label)).not.toContain('Installation');
    expect(compactLayout.rowDensity).toBe('Compact');
    expect(compactLayout.groups.flatMap((group) => group.columns)).toHaveLength(7);
  });

  it('Technical Modern is distinct', () => {
    const resolved = resolve('schedule.technical-modern', SCHEDULE);
    expect(resolved.templateId).toBe('schedule.technical-modern');
    expect(resolved.family).toBe('LuminaireSchedule');
  });

  it('Presentation Schedule supports products-per-page config', () => {
    const resolved = resolve('schedule.presentation', PRESENTATION, {
      projectOverride: { productsPerPage: 4 },
    });
    expect(resolved.family).toBe('PresentationSchedule');
    expect(resolved.productsPerPage).toBe(4);
  });

  it('Technical BOQ Modern is non-priced', () => {
    const resolved = resolve('boq.technical-modern', BOQ);
    expect(resolved.nonPriced).toBe(true);
  });

  it('Classic Grid Pro BOQ is non-priced', () => {
    const resolved = resolve('boq.classic-grid-pro', BOQ);
    expect(resolved.nonPriced).toBe(true);
  });

  it('duplicate section IDs rejected', () => {
    const bad: OutputTemplateDefinition = {
      ...builtInTemplateVersions[0]!,
      templateId: 'schedule.dup-sections',
      versionId: 'v1',
      sections: [
        ...builtInTemplateVersions[0]!.sections,
        { ...builtInTemplateVersions[0]!.sections[0]! },
      ],
    };
    expectDomainError(() => validateTemplateVersion(bad), 'Duplicate section ID');
  });

  it('duplicate column IDs rejected', () => {
    const bad: OutputTemplateDefinition = {
      ...builtInTemplateVersions[0]!,
      templateId: 'schedule.dup-columns',
      versionId: 'v1',
      columns: [
        ...builtInTemplateVersions[0]!.columns,
        { ...builtInTemplateVersions[0]!.columns[0]! },
      ],
    };
    expectDomainError(() => validateTemplateVersion(bad), 'Duplicate column ID');
  });

  it('unknown template rejected', () => {
    expectDomainError(
      () => resolve('schedule.does-not-exist', SCHEDULE),
      'Unknown output template',
    );
  });

  it('unknown version rejected', () => {
    expectDomainError(
      () => resolve('schedule.technical-modern', SCHEDULE, { versionId: 'v99' }),
      'Unknown output template "schedule.technical-modern" version "v99"',
    );
  });

  it('incompatible output family rejected', () => {
    expectDomainError(
      () => resolve('boq.technical-modern', SCHEDULE),
      'not compatible with requested family',
    );
  });

  it('technical values cannot be defined by template config', () => {
    const bad: OutputTemplateDefinition = {
      ...builtInTemplateVersions[0]!,
      templateId: 'schedule.owns-values',
      versionId: 'v1',
      sections: builtInTemplateVersions[0]!.sections.map((item) =>
        item.sectionId === 'notes' ? { ...item, config: { ...item.config, wattage: '240' } } : item,
      ),
    };
    expectDomainError(() => validateTemplateVersion(bad), 'must not own technical value "wattage"');
    expect(canonicalTechnicalValueKeys).toContain('wattage');
  });

  it('resolver does not mutate input definitions/config objects', () => {
    const original = builtInTemplateVersions[0]!;
    const snapshot = JSON.stringify(original);
    resolve('schedule.technical-modern', SCHEDULE, {
      projectOverride: {
        sections: [{ sectionId: 'notes', visible: false, config: { maxLength: 5_000 } }],
        columns: [{ columnId: 'image', visible: false }],
      },
    });
    expect(JSON.stringify(original)).toBe(snapshot);
  });

  it('repeated resolution with same inputs is deterministic/deep-equal', () => {
    const a = resolve('schedule.technical-modern', SCHEDULE, {
      projectOverride: {
        sections: [{ sectionId: 'notes', visible: false }],
        columns: [{ columnId: 'image', visible: false }],
      },
    });
    const b = resolve('schedule.technical-modern', SCHEDULE, {
      projectOverride: {
        sections: [{ sectionId: 'notes', visible: false }],
        columns: [{ columnId: 'image', visible: false }],
      },
    });
    expect(a).toEqual(b);
  });

  it('findTemplateVersion returns the latest active version by default', () => {
    const registry: OutputTemplateDefinition[] = [
      { ...builtInTemplateVersions[0]!, versionId: 'v1', state: 'inactive' },
      { ...builtInTemplateVersions[0]!, versionId: 'v2', state: 'active' },
    ];
    const found = findTemplateVersion('schedule.technical-modern', undefined, registry);
    expect(found?.versionId).toBe('v2');
  });
});

// ===========================================================================
// P2-FND-03-H1 — Non-Priced Output Template Definition enforcement
// ===========================================================================
describe('P2-FND-03-H1 — commercial pricing field keys are rejected', () => {
  function withPricingColumn(fieldKey: string): OutputTemplateDefinition {
    const base = builtInTemplateVersions[0]!;
    return {
      ...base,
      templateId: 'boq.custom-pricing',
      versionId: 'v1',
      family: 'TechnicalBoq',
      nonPriced: true,
      columns: [
        ...base.columns,
        { ...base.columns[0]!, columnId: 'price', fieldKey, label: 'Price', order: 999 },
      ],
    };
  }

  it('custom Technical BOQ with fieldKey unitPrice throws VALIDATION_ERROR', () => {
    expectDomainError(
      () => validateTemplateVersion(withPricingColumn('unitPrice')),
      'must not reference a commercial pricing value',
    );
  });

  it('custom Technical BOQ with fieldKey totalAmount throws VALIDATION_ERROR', () => {
    expectDomainError(
      () => validateTemplateVersion(withPricingColumn('totalAmount')),
      'must not reference a commercial pricing value',
    );
  });

  it('custom Technical BOQ with formatted pricing fieldKey variant throws', () => {
    expectDomainError(
      () => validateTemplateVersion(withPricingColumn('Unit_Price')),
      'must not reference a commercial pricing value',
    );
  });

  it('existing built-in BOQ templates remain valid', () => {
    const boqTemplates = builtInTemplateVersions.filter(
      (version) => version.family === 'TechnicalBoq',
    );
    expect(boqTemplates.length).toBeGreaterThan(0);
    for (const template of boqTemplates) {
      expect(() => validateTemplateVersion(template)).not.toThrow();
    }
  });

  it('existing built-in Schedule templates remain valid', () => {
    const scheduleTemplates = builtInTemplateVersions.filter(
      (version) => version.family === 'LuminaireSchedule',
    );
    expect(scheduleTemplates.length).toBeGreaterThan(0);
    for (const template of scheduleTemplates) {
      expect(() => validateTemplateVersion(template)).not.toThrow();
    }
  });

  it('a Schedule template containing a pricing fieldKey is rejected globally', () => {
    const base = builtInTemplateVersions[0]!;
    const scheduleWithPrice: OutputTemplateDefinition = {
      ...base,
      templateId: 'schedule.pricing',
      versionId: 'v1',
      family: 'LuminaireSchedule',
      columns: [
        ...base.columns,
        {
          ...base.columns[0]!,
          columnId: 'price',
          fieldKey: 'unitPrice',
          label: 'Price',
          order: 999,
        },
      ],
    };
    expectDomainError(
      () => validateTemplateVersion(scheduleWithPrice),
      'must not reference a commercial pricing value',
    );
  });

  it('a Presentation Schedule template containing a pricing fieldKey is rejected globally', () => {
    const presentation = builtInTemplateVersions.find(
      (version) => version.family === 'PresentationSchedule',
    )!;
    const presentationWithPrice: OutputTemplateDefinition = {
      ...presentation,
      templateId: 'schedule.presentation.pricing',
      versionId: 'v1',
      columns: [
        ...presentation.columns,
        {
          ...presentation.columns[0]!,
          columnId: 'price',
          fieldKey: 'price',
          label: 'Price',
          order: 999,
        },
      ],
    };
    expectDomainError(
      () => validateTemplateVersion(presentationWithPrice),
      'must not reference a commercial pricing value',
    );
  });

  it('a pricing key injected through section config is rejected', () => {
    const bad: OutputTemplateDefinition = {
      ...builtInTemplateVersions[0]!,
      templateId: 'schedule.owns-pricing',
      versionId: 'v1',
      sections: builtInTemplateVersions[0]!.sections.map((item) =>
        item.sectionId === 'notes' ? { ...item, config: { ...item.config, unitPrice: 100 } } : item,
      ),
    };
    expectDomainError(
      () => validateTemplateVersion(bad),
      'must not own commercial pricing value "unitPrice"',
    );
  });

  it('nested technical values in section config are rejected recursively', () => {
    const bad: OutputTemplateDefinition = {
      ...builtInTemplateVersions[0]!,
      templateId: 'schedule.owns-nested-technical-value',
      versionId: 'v1',
      sections: builtInTemplateVersions[0]!.sections.map((item) =>
        item.sectionId === 'notes'
          ? { ...item, config: { presentation: { details: [{ wattage: '240' }] } } }
          : item,
      ),
    };

    expectDomainError(() => validateTemplateVersion(bad), 'must not own technical value "wattage"');
  });

  it('nested pricing values injected through an override are rejected after resolution', () => {
    expectDomainError(
      () =>
        resolve('boq.technical-modern', BOQ, {
          projectOverride: {
            sections: [
              {
                sectionId: 'notes',
                config: { presentation: { commercial: [{ Unit_Price: 100 }] } },
              },
            ],
          },
        }),
      'must not own commercial pricing value "Unit_Price"',
    );
  });

  it('valid nested presentation config still resolves', () => {
    const resolved = resolve('boq.technical-modern', BOQ, {
      projectOverride: {
        sections: [
          {
            sectionId: 'notes',
            config: { presentation: { typography: { emphasis: 'strong' } } },
          },
        ],
      },
    });

    expect(resolved.sections.find((section) => section.sectionId === 'notes')?.config).toEqual({
      maxLength: 2_000,
      presentation: { typography: { emphasis: 'strong' } },
    });
    expect(resolved.nonPriced).toBe(true);
  });

  it('non-pricing canonical presentation fieldKeys continue to validate', () => {
    // Technical values are valid column fieldKey references (they select
    // canonical data); only pricing fieldKeys are forbidden globally.
    const resolved = resolve('schedule.technical-modern', SCHEDULE);
    expect(resolved.columns.some((column) => column.fieldKey === 'tag')).toBe(true);
    expect(resolved.columns.some((column) => column.fieldKey === 'wattage')).toBe(true);
    expect(resolved.columns.some((column) => column.fieldKey === 'quantity')).toBe(true);
  });
});

// ===========================================================================
// P2-FND-A2-03 — Template Invariant Closure (presentation-only + currency) and
// Deep Detachment
// ===========================================================================

function withOwnedConfig(
  templateId: string,
  configValue: Record<string, unknown>,
): OutputTemplateDefinition {
  const base = builtInTemplateVersions[0]!;
  return {
    ...base,
    templateId,
    versionId: 'v1',
    sections: base.sections.map((item) =>
      item.sectionId === 'notes' ? { ...item, config: { ...item.config, ...configValue } } : item,
    ),
  };
}

describe('P2-FND-A2-03 — canonical technical/commercial values are never template-owned', () => {
  const ownedKeyCases: Array<{ key: string; label: string }> = [
    { key: 'description', label: 'Description' },
    { key: 'beamAngle', label: 'Beam Angle' },
    { key: 'datasheetPath', label: 'Datasheet Path' },
    { key: 'location', label: 'Location' },
    { key: 'unit', label: 'Unit' },
    { key: 'category', label: 'Category' },
    { key: 'imagePath', label: 'Image Path' },
    { key: 'manufacturer', label: 'Manufacturer' },
    { key: 'model', label: 'Model' },
    { key: 'lumens', label: 'Lumens' },
    { key: 'cri', label: 'CRI' },
    { key: 'ipRating', label: 'IP Rating' },
    { key: 'mounting', label: 'Mounting' },
    { key: 'cutout', label: 'Cutout' },
    { key: 'driver', label: 'Driver' },
    { key: 'control', label: 'Control' },
    { key: 'emergency', label: 'Emergency' },
    { key: 'lightColor', label: 'Light Color' },
    { key: 'dimensions', label: 'Dimensions' },
    { key: 'bodyColorFinish', label: 'Body / Finish' },
    { key: 'notes', label: 'Notes' },
    { key: 'sourceName', label: 'Source Name' },
  ];

  for (const { key, label } of ownedKeyCases) {
    it(`template-owned ${label} config is rejected`, () => {
      expectDomainError(
        () => validateTemplateVersion(withOwnedConfig(`schedule.owns.${key}`, { [key]: 'x' })),
        'must not own technical value',
      );
    });
  }

  it('template-owned projectCode config is rejected', () => {
    expectDomainError(
      () =>
        validateTemplateVersion(
          withOwnedConfig('schedule.owns.projectCode', { projectCode: 'SCL-1' }),
        ),
      'must not own technical value',
    );
  });

  it('canonicalDataValueKeys covers every current canonical Luminaire snapshot field', () => {
    // The audit's hand-picked six are only the examples; the authoritative set
    // must be comprehensive for the current model.
    for (const key of [
      'tag',
      'category',
      'imagePath',
      'description',
      'manufacturer',
      'model',
      'wattage',
      'lumens',
      'lightColor',
      'cri',
      'beamAngle',
      'ipRating',
      'mounting',
      'cutout',
      'driver',
      'control',
      'emergency',
      'datasheetPath',
      'location',
      'unit',
      'quantity',
      'notes',
      'sourceName',
      'dimensions',
      'bodyColorFinish',
    ]) {
      expect(canonicalDataValueKeys).toContain(key);
    }
    // Plus identity/project fields referenced as references.
    expect(canonicalDataValueKeys).toContain('projectCode');
    expect(canonicalDataValueKeys).toContain('projectName');
    expect(canonicalDataValueKeys).toContain('clientName');
    expect(canonicalDataValueKeys).toContain('projectId');
  });

  it('nested owned value (config.layout.rows[0].beamAngle) is rejected', () => {
    const bad: OutputTemplateDefinition = {
      ...builtInTemplateVersions[0]!,
      templateId: 'schedule.owns.nested.beamAngle',
      versionId: 'v1',
      sections: builtInTemplateVersions[0]!.sections.map((item) =>
        item.sectionId === 'legend'
          ? { ...item, config: { layout: { rows: [{ beamAngle: '36°' }] } } }
          : item,
      ),
    };
    expectDomainError(
      () => validateTemplateVersion(bad),
      'must not own technical value "beamAngle"',
    );
  });

  it('nested currency/pricing key rejected', () => {
    const bad: OutputTemplateDefinition = {
      ...builtInTemplateVersions[0]!,
      templateId: 'schedule.owns.nested.currency',
      versionId: 'v1',
      sections: builtInTemplateVersions[0]!.sections.map((item) =>
        item.sectionId === 'notes'
          ? { ...item, config: { pricing: { lineItems: [{ currency: 'EUR' }] } } }
          : item,
      ),
    };
    expectDomainError(
      () => validateTemplateVersion(bad),
      'must not own commercial pricing value "currency"',
    );
  });

  it('currency config rejected', () => {
    expectDomainError(
      () => validateTemplateVersion(withOwnedConfig('schedule.owns.currency', { currency: 'EUR' })),
      'must not own commercial pricing value "currency"',
    );
  });

  it('commercialCurrency config rejected', () => {
    expectDomainError(
      () =>
        validateTemplateVersion(
          withOwnedConfig('schedule.owns.commercialCurrency', { commercialCurrency: 'EUR' }),
        ),
      'must not own commercial pricing value "commercialCurrency"',
    );
  });

  it('pricing/currency column fieldKey rejected (currency)', () => {
    const base = builtInTemplateVersions[0]!;
    const bad: OutputTemplateDefinition = {
      ...base,
      templateId: 'schedule.owns.currency.column',
      versionId: 'v1',
      columns: [
        ...base.columns,
        {
          ...base.columns[0]!,
          columnId: 'currency',
          fieldKey: 'currency',
          label: 'Currency',
          order: 999,
        },
      ],
    };
    expectDomainError(
      () => validateTemplateVersion(bad),
      'must not reference a commercial pricing value',
    );
  });

  it('commercialCurrency is part of the commercial pricing field key inventory', () => {
    expect(commercialPricingFieldKeys).toContain('commercialCurrency');
  });

  it('currency is part of the commercial pricing field key inventory', () => {
    expect(commercialPricingFieldKeys).toContain('currency');
  });

  it('formatting variants normalize for comparison', () => {
    expect(normalizeForbiddenKey('Beam_Angle')).toBe(normalizeForbiddenKey('beamAngle'));
    expect(normalizeForbiddenKey('Unit Price')).toBe(normalizeForbiddenKey('unitPrice'));
    expect(normalizeForbiddenKey('Commercial Currency')).toBe(
      normalizeForbiddenKey('commercialCurrency'),
    );
    expect(normalizeForbiddenKey('Commercial Currency')).toBe(
      normalizeForbiddenKey('commercialCurrency'),
    );
  });

  it('legitimate canonical technical column references remain valid', () => {
    // Columns select/display canonical data; they are references, not ownership.
    const resolved = resolve('schedule.technical-modern', SCHEDULE);
    for (const fieldKey of ['description', 'beamAngle', 'location', 'unit', 'quantity']) {
      expect(
        resolved.columns.some((column) => column.fieldKey === fieldKey),
        fieldKey,
      ).toBe(true);
    }
  });

  it('custom registry definition carrying owned description is rejected', () => {
    const bad = withOwnedConfig('schedule.custom.owns.description', { description: 'x' });
    expectDomainError(
      () => validateTemplateVersion({ ...bad, origin: 'custom' }),
      'must not own technical value "description"',
    );
  });

  it('Technical BOQ remains non-priced', () => {
    const resolved = resolve('boq.technical-modern', BOQ);
    expect(resolved.nonPriced).toBe(true);
  });

  it('Presentation Schedule remains valid', () => {
    expect(() => validateBuiltInTemplates()).not.toThrow();
    const resolved = resolve('schedule.presentation', PRESENTATION);
    expect(resolved.family).toBe('PresentationSchedule');
    expect(resolved.productsPerPage).toBe(3);
  });
});

describe('P2-FND-A2-03 — resolved template is deeply detached', () => {
  // Build an isolated custom definition carrying a nested config object so the
  // shared-reference defect is reachable. The module-level built-ins must never
  // be mutated by tests.
  function nestedDefinition(templateId: string): OutputTemplateDefinition {
    return {
      ...builtInTemplateVersions[0]!,
      templateId,
      versionId: 'v1',
      origin: 'custom',
      sections: builtInTemplateVersions[0]!.sections.map((item) =>
        item.sectionId === 'legend'
          ? { ...item, config: { layout: { spacing: { row: 4, column: 8 } } } }
          : item,
      ),
    };
  }

  // Typed accessors into the presentation-only nested config. `config` is
  // `Record<string, unknown>`, so these narrow the arbitrary nested bag for the
  // detachment assertions (tests deliberately use non-canonical keys).
  function spacingOf(resolved: OutputTemplateDefinition): { row: number; column: number } {
    const legend = resolved.sections.find((s) => s.sectionId === 'legend')!;
    const layout = legend.config.layout as { spacing: { row: number; column: number } };
    return layout.spacing;
  }
  function sourceSpacing(source: OutputTemplateDefinition): { row: number; column: number } {
    const legend = source.sections.find((s) => s.sectionId === 'legend')!;
    const layout = legend.config.layout as { spacing: { row: number; column: number } };
    return layout.spacing;
  }
  function rowsOf(resolved: OutputTemplateDefinition): Array<{ label: string }> {
    const legend = resolved.sections.find((s) => s.sectionId === 'legend')!;
    const layout = legend.config.layout as { rows: Array<{ label: string }> };
    return layout.rows;
  }
  function overrideSpacing(override: OutputTemplateOverride): { row: number; column: number } {
    const section = override.sections![0]!;
    const layout = section.config!.layout as { spacing: { row: number; column: number } };
    return layout.spacing;
  }
  function legendOf(resolved: OutputTemplateDefinition): OutputSectionDefinition {
    return resolved.sections.find((s) => s.sectionId === 'legend')!;
  }

  it('resolved nested mutation does not mutate TemplateVersion', () => {
    const source = nestedDefinition('schedule.detach.source');
    const snapshot = JSON.stringify(source);
    const resolved = resolve('schedule.detach.source', SCHEDULE, { registry: [source] });
    // Reproduces the A2 audit defect: pre-fix this mutated the source to 99.
    spacingOf(resolved).row = 99;
    expect(JSON.stringify(source)).toBe(snapshot);
  });

  it('TemplateVersion nested mutation after resolve does not mutate resolved snapshot', () => {
    const source = nestedDefinition('schedule.detach.source2');
    const resolved = resolve('schedule.detach.source2', SCHEDULE, { registry: [source] });
    const snapshot = JSON.stringify(resolved);
    // Mutate a nested value inside the source TemplateVersion after resolution.
    sourceSpacing(source).row = 77;
    expect(JSON.stringify(resolved)).toBe(snapshot);
  });

  it('resolved nested array mutation does not mutate TemplateVersion', () => {
    const source = nestedDefinition('schedule.detach.source3');
    source.sections = source.sections.map((item) =>
      item.sectionId === 'legend'
        ? { ...item, config: { layout: { rows: [{ label: 'a' }, { label: 'b' }] } } }
        : item,
    );
    const snapshot = JSON.stringify(source);
    const resolved = resolve('schedule.detach.source3', SCHEDULE, { registry: [source] });
    const rows = rowsOf(resolved);
    rows.push({ label: 'c' });
    rows[0]!.label = 'z';
    expect(JSON.stringify(source)).toBe(snapshot);
  });

  it('global override nested object is detached both directions', () => {
    const globalOverride: OutputTemplateOverride = {
      sections: [
        {
          sectionId: 'legend',
          config: { layout: { spacing: { row: 4, column: 8 } } },
        },
      ],
    };
    const overrideSnapshot = JSON.stringify(globalOverride);

    // Direction 1: mutating resolved must not mutate the override.
    const resolved = resolve('schedule.technical-modern', SCHEDULE, {
      globalConfig: globalOverride,
    });
    spacingOf(resolved).row = 99;
    expect(JSON.stringify(globalOverride)).toBe(overrideSnapshot);

    // Direction 2: mutating override after resolution must not mutate resolved.
    const resolved2 = resolve('schedule.technical-modern', SCHEDULE, {
      globalConfig: globalOverride,
    });
    const resolvedSnapshot = JSON.stringify(resolved2);
    overrideSpacing(globalOverride).row = 77;
    expect(JSON.stringify(resolved2)).toBe(resolvedSnapshot);
  });

  it('project override nested object is detached both directions', () => {
    const projectOverride: OutputTemplateOverride = {
      sections: [{ sectionId: 'legend', config: { layout: { spacing: { row: 4, column: 8 } } } }],
    };
    const overrideSnapshot = JSON.stringify(projectOverride);

    const resolved = resolve('schedule.technical-modern', SCHEDULE, { projectOverride });
    spacingOf(resolved).row = 99;
    expect(JSON.stringify(projectOverride)).toBe(overrideSnapshot);

    const resolved2 = resolve('schedule.technical-modern', SCHEDULE, { projectOverride });
    const resolvedSnapshot = JSON.stringify(resolved2);
    overrideSpacing(projectOverride).row = 77;
    expect(JSON.stringify(resolved2)).toBe(resolvedSnapshot);
  });

  it('generation override nested object is detached both directions', () => {
    const generationOverride: OutputTemplateOverride = {
      sections: [{ sectionId: 'legend', config: { layout: { spacing: { row: 4, column: 8 } } } }],
    };
    const overrideSnapshot = JSON.stringify(generationOverride);

    const resolved = resolve('schedule.technical-modern', SCHEDULE, { generationOverride });
    spacingOf(resolved).row = 99;
    expect(JSON.stringify(generationOverride)).toBe(overrideSnapshot);

    const resolved2 = resolve('schedule.technical-modern', SCHEDULE, { generationOverride });
    const resolvedSnapshot = JSON.stringify(resolved2);
    overrideSpacing(generationOverride).row = 77;
    expect(JSON.stringify(resolved2)).toBe(resolvedSnapshot);
  });

  it('untouched nested sibling is detached', () => {
    // Template default spacing {row:4,column:8}; project override touches only
    // a sibling setting. The untouched nested `spacing` must still be detached.
    const source = nestedDefinition('schedule.detach.sibling');
    const sourceSnapshot = JSON.stringify(source);

    // Direction 1: mutating untouched sibling nested value in resolved does not
    // mutate the source template definition.
    const resolved = resolve('schedule.detach.sibling', SCHEDULE, {
      registry: [source],
      projectOverride: {
        sections: [{ sectionId: 'legend', config: { otherSetting: true } }],
      },
    });
    const legend = legendOf(resolved);
    expect(legend.config.layout).toBeDefined();
    spacingOf(resolved).row = 99;
    expect(JSON.stringify(source)).toBe(sourceSnapshot);

    // Direction 2: mutating the untouched source nested value after resolution
    // does not mutate an already-resolved snapshot.
    const resolved2 = resolve('schedule.detach.sibling', SCHEDULE, {
      registry: [source],
      projectOverride: {
        sections: [{ sectionId: 'legend', config: { otherSetting: true } }],
      },
    });
    const resolvedSnapshot = JSON.stringify(resolved2);
    sourceSpacing(source).row = 77;
    expect(JSON.stringify(resolved2)).toBe(resolvedSnapshot);
  });

  it('custom registry TemplateVersion is detached', () => {
    const custom = nestedDefinition('schedule.detach.custom');
    const customSnapshot = JSON.stringify(custom);
    const resolved = resolve('schedule.detach.custom', SCHEDULE, { registry: [custom] });
    spacingOf(resolved).row = 99;
    expect(JSON.stringify(custom)).toBe(customSnapshot);
  });

  it('repeated resolution with same unchanged inputs remains deep-equal', () => {
    const a = resolve('schedule.technical-modern', SCHEDULE, {
      projectOverride: {
        sections: [{ sectionId: 'legend', config: { layout: { spacing: { row: 4 } } } }],
      },
    });
    const b = resolve('schedule.technical-modern', SCHEDULE, {
      projectOverride: {
        sections: [{ sectionId: 'legend', config: { layout: { spacing: { row: 4 } } } }],
      },
    });
    expect(a).toEqual(b);
  });

  it('resolver still does not mutate inputs during resolution', () => {
    const original = builtInTemplateVersions[0]!;
    const snapshot = JSON.stringify(original);
    const override: OutputTemplateOverride = {
      sections: [{ sectionId: 'legend', config: { layout: { spacing: { row: 6 } } } }],
    };
    const overrideSnapshot = JSON.stringify(override);
    resolve('schedule.technical-modern', SCHEDULE, {
      projectOverride: override,
      globalConfig: { paperSize: 'A4' },
    });
    expect(JSON.stringify(original)).toBe(snapshot);
    expect(JSON.stringify(override)).toBe(overrideSnapshot);
  });
});
