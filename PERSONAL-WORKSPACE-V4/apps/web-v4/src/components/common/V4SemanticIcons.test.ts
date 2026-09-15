import { describe, expect, it } from 'vitest';
import { v4SemanticIcons } from './V4SemanticIcons';

describe('v4SemanticIcons', () => {
  it('provides every required semantic V4 icon as a component', () => {
    expect(Object.keys(v4SemanticIcons)).toEqual(
      expect.arrayContaining([
        'projectScope',
        'deliverables',
        'requirements',
        'note',
        'exclusion',
        'summary',
        'lightingLayout',
        'lightingDesign',
        'dialuxCalculation',
        'dialuxReport',
        'luminaireSelection',
        'luminaireSchedule',
        'technicalBOQ',
        'datasheet',
        'datasheetsPackage',
        'pdf',
        'presentation',
        'threeDVisualization',
        'customDeliverable',
        'issuePackage',
        'package',
        'revision',
        'meeting',
        'action',
        'comment',
        'contact',
        'technicalCheck',
        'client',
        'sales',
        'priority',
        'tags',
      ]),
    );
    expect(Object.values(v4SemanticIcons).every((Icon) => typeof Icon === 'object')).toBe(true);
  });

  it('keeps representative technical concepts distinct', () => {
    expect(v4SemanticIcons.lightingLayout).not.toBe(v4SemanticIcons.dialuxCalculation);
    expect(v4SemanticIcons.lightingDesign).not.toBe(v4SemanticIcons.luminaireSelection);
    expect(v4SemanticIcons.dialuxCalculation).not.toBe(v4SemanticIcons.dialuxReport);
    expect(v4SemanticIcons.luminaireSelection).not.toBe(v4SemanticIcons.luminaireSchedule);
    expect(v4SemanticIcons.technicalBOQ).not.toBe(v4SemanticIcons.datasheet);
    expect(v4SemanticIcons.datasheetsPackage).not.toBe(v4SemanticIcons.issuePackage);
  });
});
