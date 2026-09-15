import { describe, expect, it } from 'vitest';
import {
  diffChangeLabel,
  diffChangeVariant,
  findingSeverityVariant,
  impactCategoryLabel,
  readinessLevelLabel,
  readinessLevelVariant,
  sortedDiffLuminaires,
  sourceFreshnessLabel,
  sourceFreshnessVariant,
  sourceTypeLabel,
} from './projectIntelligenceViewModel';

describe('projectIntelligenceViewModel', () => {
  it('maps readiness levels to labels and pill variants', () => {
    expect(readinessLevelLabel('READY')).toBe('Ready to Issue');
    expect(readinessLevelLabel('READY_WITH_WARNINGS')).toBe('Ready with Warnings');
    expect(readinessLevelLabel('NOT_READY')).toBe('Not Ready');
    expect(readinessLevelVariant('READY')).toBe('success');
    expect(readinessLevelVariant('READY_WITH_WARNINGS')).toBe('warning');
    expect(readinessLevelVariant('NOT_READY')).toBe('danger');
  });

  it('maps finding severities to pill variants', () => {
    expect(findingSeverityVariant('BLOCKER')).toBe('danger');
    expect(findingSeverityVariant('WARNING')).toBe('warning');
    expect(findingSeverityVariant('INFO')).toBe('neutral');
  });

  it('maps source freshness states to labels and pill variants', () => {
    expect(sourceFreshnessLabel('FRESH')).toBe('Fresh');
    expect(sourceFreshnessLabel('STALE')).toBe('Stale');
    expect(sourceFreshnessLabel('MISSING')).toBe('Missing');
    expect(sourceFreshnessLabel('NOT_BASELINED')).toBe('Not Baselined');
    expect(sourceFreshnessLabel('UNAVAILABLE')).toBe('Unavailable');
    expect(sourceFreshnessVariant('FRESH')).toBe('success');
    expect(sourceFreshnessVariant('STALE')).toBe('danger');
    expect(sourceFreshnessVariant('MISSING')).toBe('danger');
    expect(sourceFreshnessVariant('NOT_BASELINED')).toBe('warning');
    expect(sourceFreshnessVariant('UNAVAILABLE')).toBe('neutral');
  });

  it('maps impact categories and source types to labels', () => {
    expect(impactCategoryLabel('QUANTITY_BOQ_IMPACT')).toBe('Quantity / BOQ');
    expect(impactCategoryLabel('TECHNICAL_SCHEDULE_IMPACT')).toBe('Technical Schedule');
    expect(impactCategoryLabel('PRODUCT_ORDERING_CODE_IMPACT')).toBe('Ordering Code');
    expect(impactCategoryLabel('DATASHEET_VERIFICATION_IMPACT')).toBe('Datasheet / Verification');
    expect(impactCategoryLabel('OUTPUT_COMPOSITION_IMPACT')).toBe('Output Composition');
    expect(sourceTypeLabel('AUTOCAD')).toBe('AutoCAD');
    expect(sourceTypeLabel('DIALUX')).toBe('DIALux');
    expect(sourceTypeLabel('EXCEL')).toBe('Excel');
    expect(sourceTypeLabel('OTHER')).toBe('Other');
  });

  it('sorts diff luminaires deterministically (changed first, then tag)', () => {
    const items = [
      {
        luminaireId: 'b',
        tag: 'L02',
        changeType: 'UNCHANGED' as const,
        changedFields: [],
        impactCategories: [],
      },
      {
        luminaireId: 'a',
        tag: 'L01',
        changeType: 'CHANGED' as const,
        changedFields: [],
        impactCategories: [],
      },
      {
        luminaireId: 'c',
        tag: 'L03',
        changeType: 'ADDED' as const,
        changedFields: [],
        impactCategories: [],
      },
    ];
    const sorted = sortedDiffLuminaires(items);
    expect(sorted.map((item) => item.tag)).toEqual(['L01', 'L03', 'L02']);
  });

  it('maps diff change types to labels and variants', () => {
    expect(diffChangeLabel.ADDED).toBe('Added');
    expect(diffChangeLabel.REMOVED).toBe('Removed');
    expect(diffChangeLabel.CHANGED).toBe('Changed');
    expect(diffChangeLabel.UNCHANGED).toBe('Unchanged');
    expect(diffChangeVariant('ADDED')).toBe('success');
    expect(diffChangeVariant('REMOVED')).toBe('danger');
    expect(diffChangeVariant('CHANGED')).toBe('warning');
    expect(diffChangeVariant('UNCHANGED')).toBe('neutral');
  });
});
