import { describe, expect, it } from 'vitest';
import { canonicalDataValueKeys } from '@scli/domain';
import {
  changeStatusSchema,
  canonicalLuminaireSnapshotSchema,
  canonicalProjectSnapshotSchema,
  createProjectSchema,
  folderProfileCatalogSchema,
  folderProfileRefSchema,
  importFolderProfileSchema,
  projectFolderSnapshotSchema,
  projectScopeItemInputSchema,
  setDefaultFolderProfileSchema,
  updateProjectSchema,
  updateProjectScopeSchema,
  updateProjectWorkspaceSetupInputSchema,
  projectActionItemSchema,
} from './index';

const validCreate = {
  projectName: 'Office lighting upgrade',
  clientName: 'Acme',
  projectType: 'Lighting Layout',
  description: '',
  siteLocation: 'Dubai, UAE',
  designStage: 'Concept',
  lightingScope: 'Interior lighting layout and luminaire coordination.',
  luxRequirements: '500 lux at working plane.',
  drawingReference: 'A-101',
  priority: 'High',
  complexity: 'Medium',
  estimatedHours: 12,
  requiredDeliveryDate: '2026-08-10',
  projectFolderUrl: 'https://contoso.sharepoint.com/project',
  idempotencyKey: '99999999-9999-4999-8999-999999999999',
};

describe('API contracts', () => {
  it('normalizes canonical Action owner role and multiline notes without changing internal lines', () => {
    const parsed = projectActionItemSchema.parse({ title: 'Review layout' });
    expect(parsed.ownerRole).toBe('');
    expect(parsed.notes).toBe('');
    expect(
      projectActionItemSchema.parse({
        title: 'Review layout',
        ownerRole: '  Lighting Designer  ',
        notes: '  First line\nSecond line  ',
      }),
    ).toMatchObject({ ownerRole: 'Lighting Designer', notes: 'First line\nSecond line' });
    expect(
      projectActionItemSchema.safeParse({ title: 'Review layout', ownerRole: 'x'.repeat(181) })
        .success,
    ).toBe(false);
    expect(
      projectActionItemSchema.safeParse({ title: 'Review layout', notes: 'x'.repeat(8_001) })
        .success,
    ).toBe(false);
  });
  it('accepts a valid project and rejects non-HTTPS references', () => {
    expect(createProjectSchema.parse(validCreate).projectName).toBe('Office lighting upgrade');
    expect(createProjectSchema.parse(validCreate).luminaireInputMode).toBe('Later');
    expect(
      createProjectSchema.safeParse({ ...validCreate, projectFolderUrl: 'http://example.com' })
        .success,
    ).toBe(false);
    expect(
      createProjectSchema.safeParse({ ...validCreate, luminaireInputMode: 'Spreadsheet' }).success,
    ).toBe(false);
  });

  it('rejects over-posted and empty update payloads', () => {
    expect(updateProjectSchema.safeParse({}).success).toBe(false);
    expect(updateProjectSchema.safeParse({ projectCode: 'forged' }).success).toBe(false);
    expect(updateProjectSchema.safeParse({ progressPercent: 101 }).success).toBe(false);
  });

  it('accepts every safe editable metadata field in one update', () => {
    const parsed = updateProjectSchema.parse({
      projectName: 'Dubai Hills Villa',
      clientName: 'Private Client',
      crmReference: 'CRM-48572',
      projectType: 'Villa Lighting Design',
      description: 'Complete villa lighting design and documentation.',
      siteLocation: 'Dubai Hills',
      designStage: 'DetailedDesign',
      lightingScope: 'Interior and landscape lighting design.',
      luxRequirements: '500 lux at working plane.',
      drawingReference: 'L-101 Rev B',
      priority: 'High',
      complexity: 'Large',
      estimatedHours: 40,
      actualHours: 12,
      progressPercent: 30,
      requiredDeliveryDate: '2026-09-15',
      expectedVersion: 3,
    });
    expect(parsed).toMatchObject({
      projectName: 'Dubai Hills Villa',
      crmReference: 'CRM-48572',
      designStage: 'DetailedDesign',
      priority: 'High',
      complexity: 'Large',
      estimatedHours: 40,
      actualHours: 12,
      progressPercent: 30,
      requiredDeliveryDate: '2026-09-15',
      expectedVersion: 3,
    });
  });

  it('normalizes blank optional text and clears CRM with null', () => {
    const parsed = updateProjectSchema.parse({
      crmReference: '   ',
      description: '   ',
      luxRequirements: '',
      drawingReference: '  ',
      expectedVersion: 1,
    });
    expect(parsed.crmReference).toBeNull();
    expect(parsed.description).toBe('');
    expect(parsed.luxRequirements).toBe('');
    expect(parsed.drawingReference).toBe('');
  });

  it('accepts omitted, null, and populated commercial value pairs', () => {
    const omitted = createProjectSchema.parse(validCreate);
    expect(omitted).not.toHaveProperty('commercialValueMinor');
    expect(omitted).not.toHaveProperty('commercialCurrency');

    expect(
      createProjectSchema.parse({
        ...validCreate,
        commercialValueMinor: null,
        commercialCurrency: null,
      }),
    ).toMatchObject({ commercialValueMinor: null, commercialCurrency: null });
    expect(
      createProjectSchema.parse({
        ...validCreate,
        commercialValueMinor: Number.MAX_SAFE_INTEGER,
        commercialCurrency: 'AED',
      }),
    ).toMatchObject({
      commercialValueMinor: Number.MAX_SAFE_INTEGER,
      commercialCurrency: 'AED',
    });
    expect(
      updateProjectSchema.parse({ commercialValueMinor: 0, commercialCurrency: 'USD' }),
    ).toEqual({ commercialValueMinor: 0, commercialCurrency: 'USD' });
    expect(
      updateProjectSchema.parse({ commercialValueMinor: null, commercialCurrency: null }),
    ).toEqual({ commercialValueMinor: null, commercialCurrency: null });
  });

  it('rejects malformed commercial values, currencies, and non-atomic pairs', () => {
    for (const commercialValueMinor of [-1, 1.5, Number.MAX_SAFE_INTEGER + 1, '125000']) {
      expect(
        createProjectSchema.safeParse({
          ...validCreate,
          commercialValueMinor,
          commercialCurrency: 'AED',
        }).success,
      ).toBe(false);
    }
    for (const commercialCurrency of ['aed', 'AE', 'AEDX', 'A1D', ' AED', 784]) {
      expect(
        updateProjectSchema.safeParse({ commercialValueMinor: 125_000, commercialCurrency })
          .success,
      ).toBe(false);
    }
    for (const pair of [
      { commercialValueMinor: 125_000 },
      { commercialCurrency: 'AED' },
      { commercialValueMinor: null },
      { commercialCurrency: null },
      { commercialValueMinor: 125_000, commercialCurrency: null },
      { commercialValueMinor: null, commercialCurrency: 'AED' },
    ]) {
      expect(createProjectSchema.safeParse({ ...validCreate, ...pair }).success).toBe(false);
      expect(updateProjectSchema.safeParse(pair).success).toBe(false);
    }
  });

  it('rejects invalid metadata values before persistence', () => {
    expect(updateProjectSchema.safeParse({ projectName: '   ' }).success).toBe(false);
    expect(updateProjectSchema.safeParse({ clientName: '' }).success).toBe(false);
    expect(updateProjectSchema.safeParse({ projectType: 'x'.repeat(81) }).success).toBe(false);
    expect(updateProjectSchema.safeParse({ siteLocation: '' }).success).toBe(false);
    expect(updateProjectSchema.safeParse({ designStage: 'NotAStage' }).success).toBe(false);
    expect(updateProjectSchema.safeParse({ priority: 'Critical' }).success).toBe(false);
    expect(updateProjectSchema.safeParse({ complexity: 'Huge' }).success).toBe(false);
    expect(updateProjectSchema.safeParse({ estimatedHours: -1 }).success).toBe(false);
    expect(updateProjectSchema.safeParse({ estimatedHours: 10_001 }).success).toBe(false);
    expect(updateProjectSchema.safeParse({ actualHours: -1 }).success).toBe(false);
    expect(updateProjectSchema.safeParse({ progressPercent: 100.5 }).success).toBe(false);
    expect(updateProjectSchema.safeParse({ requiredDeliveryDate: 'not-a-date' }).success).toBe(
      false,
    );
    expect(updateProjectSchema.safeParse({ lightingScope: '' }).success).toBe(false);
  });

  it('rejects system identity and lifecycle fields as update payloads', () => {
    for (const field of [
      'id',
      'projectCode',
      'projectFolderPath',
      'status',
      'assignedDesignerId',
      'collaboratorDesignerIds',
      'completedAt',
      'cancelledAt',
      'version',
      'revisionNumber',
      'createdAt',
      'updatedAt',
    ]) {
      expect(updateProjectSchema.safeParse({ [field]: 'forged' }).success).toBe(false);
    }
  });

  it('accepts an optional expected current status on the change-status contract', () => {
    expect(changeStatusSchema.parse({ status: 'ClientReview' })).toMatchObject({
      status: 'ClientReview',
    });
    expect(
      changeStatusSchema.parse({ status: 'ClientReview', expectedCurrentStatus: 'InProgress' }),
    ).toMatchObject({ status: 'ClientReview', expectedCurrentStatus: 'InProgress' });
    expect(changeStatusSchema.safeParse({ status: 'NotAStatus' }).success).toBe(false);
    expect(
      changeStatusSchema.safeParse({ status: 'ClientReview', expectedCurrentStatus: 42 }).success,
    ).toBe(false);
  });

  it('accepts an optional transitionId UUID on the change-status contract', () => {
    const parsed = changeStatusSchema.parse({
      status: 'RevisionRequired',
      reason: 'Client requested lighting revisions.',
      transitionId: '99999999-9999-4999-8999-999999999999',
    });
    expect(parsed.transitionId).toBe('99999999-9999-4999-8999-999999999999');
  });

  it('change-status without transitionId remains valid for P2.5 clients', () => {
    const parsed = changeStatusSchema.parse({ status: 'InProgress' });
    expect(parsed.transitionId).toBeUndefined();
  });

  it('rejects a malformed transitionId on the change-status contract', () => {
    expect(
      changeStatusSchema.safeParse({ status: 'InProgress', transitionId: 'not-a-uuid' }).success,
    ).toBe(false);
  });

  it('preserves expectedCurrentStatus and cancellation reason parsing', () => {
    const parsed = changeStatusSchema.parse({
      status: 'Cancelled',
      reason: 'Client cancelled the scope.',
      expectedCurrentStatus: 'InProgress',
    });
    expect(parsed).toMatchObject({
      status: 'Cancelled',
      reason: 'Client cancelled the scope.',
      expectedCurrentStatus: 'InProgress',
    });
  });

  it('does not introduce a feedbackSummary request field', () => {
    const parsed = changeStatusSchema.parse({
      status: 'RevisionRequired',
      reason: 'Client feedback.',
    });
    expect(parsed).not.toHaveProperty('feedbackSummary');
  });

  it('does not introduce a transitionOperationId field', () => {
    const parsed = changeStatusSchema.parse({ status: 'InProgress' });
    expect(parsed).not.toHaveProperty('transitionOperationId');
  });
});

describe('flexible scope contracts', () => {
  it('accepts a reduced built-in scope and custom scope items at creation', () => {
    const parsed = createProjectSchema.parse({
      ...validCreate,
      services: ['LightingDesign'],
      scopeItems: [
        { code: 'LightingDesign', label: 'Lighting Design', custom: false },
        { label: 'Mockup Review', custom: true },
      ],
    });
    expect(parsed.services).toEqual(['LightingDesign']);
    expect(parsed.scopeItems).toEqual([
      { code: 'LightingDesign', label: 'Lighting Design', custom: false },
      { label: 'Mockup Review', custom: true },
    ]);
  });

  it('allows an empty built-in services array at creation', () => {
    const parsed = createProjectSchema.parse({ ...validCreate, services: [] });
    expect(parsed.services).toEqual([]);
  });

  it('accepts a dedicated scope update with optimistic version semantics', () => {
    const parsed = updateProjectScopeSchema.parse({
      scopeItems: [
        { code: 'TechnicalBoq', label: 'Technical BOQ', custom: false },
        { label: 'Authority Submission', custom: true },
      ],
      expectedVersion: 3,
    });
    expect(parsed.expectedVersion).toBe(3);
    expect(parsed.scopeItems).toHaveLength(2);
  });

  it('rejects scope updates without scope items', () => {
    expect(updateProjectScopeSchema.safeParse({ expectedVersion: 1 }).success).toBe(false);
  });

  it('accepts workspace setup without services so folder saves do not rewrite scope', () => {
    const parsed = updateProjectWorkspaceSetupInputSchema.parse({
      folderProfile: 'Full Lighting Design',
      folderStructure: [{ name: '01_INPUT', children: [] }],
      outputFolders: {
        scheduleExcel: '01_SCHEDULES',
        schedulePdf: '01_SCHEDULES',
        boqExcel: '02_BOQ',
        boqPdf: '02_BOQ',
        datasheets: '04_DATASHEETS',
      },
    });
    expect(parsed.services).toBeUndefined();
  });

  it('validates custom scope item labels', () => {
    expect(projectScopeItemInputSchema.safeParse({ label: '   ', custom: true }).success).toBe(
      false,
    );
    expect(projectScopeItemInputSchema.safeParse({ code: 'LightingDesign' }).success).toBe(true);
  });
});

describe('P2.4B3B1A unified catalog default contracts', () => {
  const profile = {
    schemaVersion: '1.0',
    profileId: '11111111-1111-4111-8111-111111111111',
    name: 'Lighting + Authority',
    description: 'Canonical profile.',
    folders: [
      {
        profileFolderId: 'folder-1',
        parentProfileFolderId: null,
        name: '01_WORKING',
        displayOrder: 0,
        semanticRole: null,
      },
    ],
    outputDefaults: [{ outputTypeId: 'scheduleExcel', destinationProfileFolderId: 'folder-1' }],
    structuralFingerprint: 'fp-1',
    createdAt: '2026-08-07T00:00:00.000Z',
    updatedAt: '2026-08-07T00:00:00.000Z',
  };

  it('adapts an old defaultProfileId catalog to a user defaultProfileRef without rewriting input', () => {
    const raw = {
      schemaVersion: '1.0',
      profiles: [profile],
      defaultProfileId: '11111111-1111-4111-8111-111111111111',
    };
    const parsed = folderProfileCatalogSchema.parse(raw);
    expect(parsed.defaultProfileRef).toEqual({
      kind: 'user',
      profileId: '11111111-1111-4111-8111-111111111111',
    });
    expect(JSON.stringify(parsed)).not.toContain('defaultProfileId');
    expect(JSON.stringify(parsed)).toContain('defaultProfileRef');
    expect(raw).toHaveProperty('defaultProfileId');
    expect(raw).not.toHaveProperty('defaultProfileRef');
  });

  it('maps an old null defaultProfileId to the blank canonical ref', () => {
    const parsed = folderProfileCatalogSchema.parse({
      schemaVersion: '1.0',
      profiles: [],
      defaultProfileId: null,
    });
    expect(parsed.defaultProfileRef).toEqual({ kind: 'blank' });
  });

  it('accepts a canonical factory defaultProfileRef', () => {
    const parsed = folderProfileCatalogSchema.parse({
      schemaVersion: '1.0',
      profiles: [],
      defaultProfileRef: { kind: 'factory', factoryProfileKey: 'full-lighting-design' },
    });
    expect(parsed.defaultProfileRef).toEqual({
      kind: 'factory',
      factoryProfileKey: 'full-lighting-design',
    });
  });

  it('rejects a user default reference whose profile is missing', () => {
    expect(() =>
      folderProfileCatalogSchema.parse({
        schemaVersion: '1.0',
        profiles: [],
        defaultProfileRef: {
          kind: 'user',
          profileId: '22222222-2222-4222-8222-222222222222',
        },
      }),
    ).toThrow();
  });

  it('rejects duplicate profile names in the catalog', () => {
    expect(() =>
      folderProfileCatalogSchema.parse({
        schemaVersion: '1.0',
        profiles: [profile, { ...profile, profileId: '22222222-2222-4222-8222-222222222222' }],
      }),
    ).toThrow();
  });

  it('accepts unified and legacy default request shapes', () => {
    expect(setDefaultFolderProfileSchema.parse({ profileId: profile.profileId })).toEqual({
      profileId: profile.profileId,
    });
    expect(
      setDefaultFolderProfileSchema.parse({
        kind: 'factory',
        factoryProfileKey: 'full-lighting-design',
      }),
    ).toEqual({ kind: 'factory', factoryProfileKey: 'full-lighting-design' });
    expect(setDefaultFolderProfileSchema.parse({ kind: 'blank' })).toEqual({ kind: 'blank' });
    expect(
      setDefaultFolderProfileSchema.parse({ kind: 'user', profileId: profile.profileId }),
    ).toEqual({ kind: 'user', profileId: profile.profileId });
  });

  it('parses the legacy import request', () => {
    expect(importFolderProfileSchema.parse({ name: 'Old Facade Profile' })).toEqual({
      name: 'Old Facade Profile',
    });
  });

  it('parses every canonical ref kind', () => {
    expect(folderProfileRefSchema.parse({ kind: 'blank' })).toEqual({ kind: 'blank' });
    expect(
      folderProfileRefSchema.parse({ kind: 'factory', factoryProfileKey: 'essential' }),
    ).toEqual({
      kind: 'factory',
      factoryProfileKey: 'essential',
    });
    expect(
      folderProfileRefSchema.parse({
        kind: 'user',
        profileId: '11111111-1111-4111-8111-111111111111',
      }),
    ).toEqual({ kind: 'user', profileId: '11111111-1111-4111-8111-111111111111' });
  });
});
describe('P2.4B3B2A canonical create contract', () => {
  const folderDraft = {
    folders: [
      { draftFolderId: 'D1', parentDraftFolderId: null, name: 'RECEIVED', displayOrder: 0 },
      {
        draftFolderId: 'D4',
        parentDraftFolderId: null,
        name: 'TECHNICAL',
        displayOrder: 1,
        sourceProfileFolderId: 'PF4',
      },
      {
        draftFolderId: 'D6',
        parentDraftFolderId: 'D4',
        name: 'BOQ',
        displayOrder: 0,
        sourceProfileFolderId: 'PF6',
      },
    ],
    outputMappings: [{ outputTypeId: 'TechnicalBoq', destinationDraftFolderId: 'D6' }],
    sourceProfile: {
      profileId: null,
      profileName: 'Full Lighting Design',
      profileRevision: null,
      structuralFingerprint: 'fp-1',
      factoryProfileKey: 'full-lighting-design',
    },
  };

  it('accepts a canonical folderDraft create request', () => {
    const parsed = createProjectSchema.parse({ ...validCreate, folderDraft });
    expect(parsed.folderDraft?.folders).toHaveLength(3);
    expect(parsed.folderDraft?.sourceProfile?.factoryProfileKey).toBe('full-lighting-design');
  });

  it('keeps the legacy create request accepted without folderDraft', () => {
    const parsed = createProjectSchema.parse({
      ...validCreate,
      folderStructure: [{ name: '01_INPUT', children: [] }],
      outputFolders: {
        scheduleExcel: '01_INPUT',
        schedulePdf: '01_INPUT',
        boqExcel: '01_INPUT',
        boqPdf: '01_INPUT',
        datasheets: '01_INPUT',
      },
    });
    expect(parsed.folderDraft).toBeUndefined();
    expect(parsed.folderStructure).toHaveLength(1);
  });

  it('rejects mixed canonical and legacy folder structure authority', () => {
    expect(
      createProjectSchema.safeParse({
        ...validCreate,
        folderDraft,
        folderStructure: [{ name: '01_INPUT', children: [] }],
      }).success,
    ).toBe(false);
    expect(
      createProjectSchema.safeParse({
        ...validCreate,
        folderDraft,
        outputFolders: {
          scheduleExcel: '01_INPUT',
          schedulePdf: '01_INPUT',
          boqExcel: '01_INPUT',
          boqPdf: '01_INPUT',
          datasheets: '01_INPUT',
        },
      }).success,
    ).toBe(false);
    expect(
      createProjectSchema.safeParse({
        ...validCreate,
        folderDraft,
        connectFolderPath: 'C:\\Projects\\Existing',
      }).success,
    ).toBe(false);
  });

  it('accepts a blank canonical draft and an empty persisted snapshot', () => {
    const parsed = createProjectSchema.parse({
      ...validCreate,
      folderDraft: { folders: [], outputMappings: [], sourceProfile: null },
    });
    expect(parsed.folderDraft?.folders).toEqual([]);
    expect(
      projectFolderSnapshotSchema.safeParse({
        schemaVersion: '1.0',
        sourceProfile: null,
        folders: [],
      }).success,
    ).toBe(true);
  });

  it('keeps connect and set-up-later requests valid without a folderDraft', () => {
    expect(
      createProjectSchema.safeParse({ ...validCreate, connectFolderPath: 'C:\\Projects\\Existing' })
        .success,
    ).toBe(true);
    expect(createProjectSchema.safeParse({ ...validCreate, createFolders: false }).success).toBe(
      true,
    );
  });
});

// ===========================================================================
// P2-FND-A2-03 — canonical field inventory drift guard
// ===========================================================================
// The presentation-only invariant forbids a template from OWNING any canonical
// technical/project value. The authoritative domain denylist
// (`canonicalDataValueKeys`) must cover the COMPLETE current canonical data
// surface, not a hand-picked subset. This regression ensures a future field
// added to the canonical Luminaire snapshot schema cannot silently become
// template-ownable.
describe('P2-FND-A2-03 — canonical field inventory covers the snapshot surface', () => {
  it('every canonical Luminaire snapshot field is present in canonicalDataValueKeys', () => {
    const snapshotKeys = Object.keys(
      canonicalLuminaireSnapshotSchema.shape as Record<string, unknown>,
    );
    expect(snapshotKeys.length).toBeGreaterThan(0);
    for (const key of snapshotKeys) {
      expect(canonicalDataValueKeys).toContain(key);
    }
  });

  it('canonicalDataValueKeys covers the canonical Project snapshot surface', () => {
    const snapshotKeys = Object.keys(
      canonicalProjectSnapshotSchema.shape as Record<string, unknown>,
    );
    for (const key of snapshotKeys) {
      expect(canonicalDataValueKeys).toContain(key);
    }
  });
});
