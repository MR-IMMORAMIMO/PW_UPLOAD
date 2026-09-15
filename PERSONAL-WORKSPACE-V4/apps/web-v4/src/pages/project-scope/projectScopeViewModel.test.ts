import { describe, expect, it } from 'vitest';
import { buildScopeSummary, requirementSupportingText } from './projectScopeViewModel';

describe('project scope view model', () => {
  it('derives only canonical scope, deliverable, and requirement counts', () => {
    expect(
      buildScopeSummary({
        scopeItems: [
          { id: 'LightingDesign', code: 'LightingDesign', label: 'Lighting Design', custom: false },
          { id: 'custom:mockup', code: null, label: 'Mock-up review', custom: true },
        ],
        deliverables: [
          { id: 'd1', required: true },
          { id: 'd2', required: false },
        ] as never,
        requirements: [
          { id: 'r1', status: 'Requested' },
          { id: 'r2', status: 'Received' },
        ] as never,
      }),
    ).toEqual({
      serviceCount: 2,
      deliverableCount: 2,
      requiredDeliverableCount: 1,
      openRequirementCount: 1,
    });
  });

  it('does not fabricate requirement descriptions', () => {
    expect(requirementSupportingText({ details: '', requestedFrom: '' } as never)).toBeNull();
    expect(requirementSupportingText({ details: '', requestedFrom: 'Client' } as never)).toBe(
      'Requested from Client',
    );
  });
});
