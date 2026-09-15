import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { ProjectWizardDraftStore } from './ProjectWizardDraftStore';
import type { ProjectWizardDraft } from '@scli/contracts';

describe('unsubmitted project wizard drafts', () => {
  it('resumes incomplete input and step per actor without allocating any Project record', () => {
    const db = new DatabaseSync(':memory:');
    db.exec(
      'CREATE TABLE app_state (state_key TEXT PRIMARY KEY, json_value TEXT NOT NULL, updated_at TEXT NOT NULL)',
    );
    const draft: ProjectWizardDraft = {
      schemaVersion: 1,
      step: 3,
      fields: { projectName: 'Unfinished' },
      description: '',
      scopeSummary: '',
      setup: {
        schemaVersion: 1,
        sourceLead: '',
        contractReference: '',
        managerId: null,
        probability: null,
        category: '',
        discipline: '',
        projectNature: '',
        packageType: '',
        deliverables: [],
        designServices: [],
        documentation: [],
        coordination: 'standard',
        standards: [],
        notes: '',
        schedule: {
          startDate: '',
          completionDate: '',
          designDurationDays: 0,
          constructionDurationDays: 0,
          milestones: [],
        },
        structure: {
          enabledGroups: [],
          documentCategory: '',
          sequenceDigits: 4,
          separator: '-',
          extension: '.pdf',
        },
      },
    };
    new ProjectWizardDraftStore(db).save('actor-a', draft);
    const reopened = new ProjectWizardDraftStore(db);
    expect(reopened.read('actor-a')).toEqual(draft);
    expect(reopened.read('actor-b')).toBeNull();
    expect(() => reopened.save('actor-a', { ...draft, step: 99 })).toThrow();
    expect(reopened.read('actor-a')).toEqual(draft);
    reopened.remove('actor-b');
    expect(reopened.read('actor-a')).toEqual(draft);
    reopened.remove('actor-a');
    expect(reopened.read('actor-a')).toBeNull();
    db.close();
  });
});
