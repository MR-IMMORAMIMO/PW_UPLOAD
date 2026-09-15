import { describe, expect, it } from 'vitest';
import type { Project, ProjectWorkspace } from '@scli/domain';
import {
  buildScopeItems,
  fullEditPayload,
  parseCommercialValue,
  projectFormValues,
  validateProjectCore,
} from './projectFormModel';

describe('shared Project form model', () => {
  it('allows an unknown site and open delivery date in the Personal project editor', () => {
    expect(
      validateProjectCore({
        projectName: 'Project',
        clientName: 'Client',
        projectType: 'Lighting',
        lightingScope: 'Scope',
        siteLocation: '',
        requiredDeliveryDate: '',
        estimatedHours: '0',
      }),
    ).toEqual({});
  });
  it('shares required/date/hours and commercial-pair validation with Create and Edit', () => {
    expect(
      validateProjectCore(
        {
          projectName: '',
          clientName: '',
          projectType: '',
          siteLocation: '',
          lightingScope: '',
          requiredDeliveryDate: '2026-08-22',
          estimatedHours: '10001',
        },
        '2026-08-23',
      ),
    ).toMatchObject({
      projectName: expect.any(String),
      clientName: expect.any(String),
      requiredDeliveryDate: 'Choose today or a future date.',
      estimatedHours: 'Enter 0–10,000 hours.',
    });
    expect(parseCommercialValue('120.50', 'aed')).toEqual({
      ok: true,
      value: { commercialValueMinor: 12050, commercialCurrency: 'AED' },
    });
    expect(parseCommercialValue('120', '').ok).toBe(false);
  });

  it('normalizes built-in and custom scope through one authority', () => {
    expect(buildScopeItems(['TechnicalBoq'], ['  Façade study  '])).toEqual([
      { code: 'TechnicalBoq', label: 'Technical BOQ', custom: false },
      { code: null, label: 'Façade study', custom: true },
    ]);
  });

  it('creates a minimal metadata delta inside the complete atomic command', () => {
    const project = {
      id: '00000000-0000-4000-8000-000000000001',
      projectName: 'Name',
      clientName: 'Client',
      crmReference: null,
      commercialValueMinor: null,
      commercialCurrency: null,
      projectType: 'Commercial',
      designStage: 'Concept',
      requiredDeliveryDate: '2026-09-01',
      siteLocation: 'Dubai',
      lightingScope: 'Interior',
      luxRequirements: '',
      drawingReference: '',
      description: '',
      salesOwnerId: '00000000-0000-4000-8000-000000000002',
      priority: 'Normal',
      complexity: 'Medium',
      estimatedHours: 24,
      version: 7,
    } as Project;
    const workspace = {
      services: ['LuminaireSchedule'],
      lightingPackage: { inputMode: 'Later' },
    } as ProjectWorkspace;
    const before = projectFormValues(project, workspace);
    const payload = fullEditPayload(before, { ...before, clientName: ' Updated ' }, project);
    expect(payload).toEqual({
      clientName: 'Updated',
      expectedVersion: 7,
      luminaireInputMode: 'Later',
      scopeItems: [{ code: 'LuminaireSchedule', label: 'Luminaire Schedule', custom: false }],
    });
  });
});
