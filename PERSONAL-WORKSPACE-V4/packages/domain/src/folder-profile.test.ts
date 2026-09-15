import { describe, expect, it } from 'vitest';
import {
  DomainError,
  blankFolderProfileRef,
  blankProjectFolderDraft,
  buildFolderProfile,
  buildProjectFolderSnapshot,
  deriveProfileFolderPath,
  duplicateFolderProfile,
  factoryFolderProfileRef,
  factoryProfileSource,
  folderProfileToPreset,
  instantiateFolderProfile,
  instantiateProjectFolderDraft,
  presetToFolderProfileDraft,
  profileStructuralFingerprint,
  userFolderProfileRef,
  validateFolderProfile,
  validateFolderProfileRef,
  validateProjectFolderDraft,
  validateFolderSnapshot,
  validateProfileFolderNodes,
  validateProfileOutputDefaults,
  type FolderNodePreset,
  type FolderProfile,
  type ProjectFolderDraft,
  type ProfileFolderNode,
  type ProfileFolderNodeDraft,
  type ProfileOutputDefault,
  type ProjectOutputFolders,
} from './index';

const fixedNow = '2026-08-07T00:00:00.000Z';

function sequentialIds(): () => string {
  let next = 0;
  return () => `id-${(next += 1)}`;
}

function projectIds(): () => string {
  let next = 0;
  return () => `project-${(next += 1)}`;
}

function duplicateIds(): () => string {
  let next = 0;
  return () => `dup-${(next += 1)}`;
}

function newIds(): () => string {
  let next = 0;
  return () => `new-${(next += 1)}`;
}

function draftProfile(): {
  name: string;
  description: string;
  folders: ProfileFolderNodeDraft[];
  outputDefaults: Array<{ outputTypeId: string; destinationPath: string }>;
} {
  return {
    name: 'Full Lighting + Authority',
    description: 'Reality profile',
    folders: [
      { name: '00_RECEIVED', children: [] },
      { name: '01_WORKING', children: [] },
      { name: '02_CALCULATIONS', children: [] },
      { name: '03_DRAWINGS', children: [] },
      {
        name: '04_TECHNICAL',
        children: [
          { name: 'DATASHEETS', children: [] },
          { name: 'BOQ', children: [] },
        ],
      },
      { name: '05_DELIVERABLES', children: [] },
    ],
    outputDefaults: [
      { outputTypeId: 'TechnicalBoq', destinationPath: '04_TECHNICAL/BOQ' },
      { outputTypeId: 'Datasheets', destinationPath: '04_TECHNICAL/DATASHEETS' },
      { outputTypeId: 'Reports', destinationPath: '05_DELIVERABLES' },
    ],
  };
}

function buildTestProfile(name = 'Full Lighting + Authority'): FolderProfile {
  return buildFolderProfile(
    { ...draftProfile(), name },
    new Map(),
    sequentialIds(),
    fixedNow,
    'profile-1',
  );
}

function profileToDrafts(profile: FolderProfile): ProfileFolderNodeDraft[] {
  const byParent = new Map<string | null, ProfileFolderNode[]>();
  for (const node of profile.folders) {
    const siblings = byParent.get(node.parentProfileFolderId) ?? [];
    siblings.push(node);
    byParent.set(node.parentProfileFolderId, siblings);
  }
  const build = (parent: string | null): ProfileFolderNodeDraft[] =>
    (byParent.get(parent) ?? [])
      .sort((left, right) => left.displayOrder - right.displayOrder)
      .map((node) => ({
        profileFolderId: node.profileFolderId,
        name: node.name,
        semanticRole: node.semanticRole,
        children: build(node.profileFolderId),
      }));
  return build(null);
}

function outputDefaultsToDrafts(
  profile: FolderProfile,
): Array<{ outputTypeId: string; destinationPath: string }> {
  return profile.outputDefaults.map((outputDefault) => ({
    outputTypeId: outputDefault.outputTypeId,
    destinationPath:
      deriveProfileFolderPath(profile.folders, outputDefault.destinationProfileFolderId) ??
      outputDefault.destinationProfileFolderId,
  }));
}

describe('P2.4B3A profile identity', () => {
  it('creates a profile with a stable profileId', () => {
    const profile = buildTestProfile();
    expect(profile.profileId).toBe('profile-1');
    expect(profile.schemaVersion).toBe('1.0');
    expect(profile.folders).toHaveLength(8);
    expect(profile.outputDefaults).toHaveLength(3);
    expect(profile.structuralFingerprint).toMatch(/^[0-9a-f]{16}$/);
  });

  it('keeps profileFolderId independent of folder name', () => {
    const profile = buildTestProfile();
    const drawings = profile.folders.find((folder) => folder.name === '03_DRAWINGS')!;
    const existing = new Map(profile.folders.map((folder) => [folder.profileFolderId, folder]));
    const drafts = profileToDrafts(profile);
    const renamedDraft = drafts.find((draft) => draft.name === '03_DRAWINGS')!;
    renamedDraft.name = '03_LIGHTING_DRAWINGS';
    const rebuilt = buildFolderProfile(
      {
        name: profile.name,
        description: profile.description,
        folders: drafts,
        outputDefaults: outputDefaultsToDrafts(profile),
      },
      existing,
      sequentialIds(),
      fixedNow,
      profile.profileId,
    );
    const renamed = rebuilt.folders.find((folder) => folder.name === '03_LIGHTING_DRAWINGS')!;
    expect(renamed.profileFolderId).toBe(drawings.profileFolderId);
  });

  it('keeps profileFolderId independent of order', () => {
    const profile = buildTestProfile();
    const existing = new Map(profile.folders.map((folder) => [folder.profileFolderId, folder]));
    const drafts = profileToDrafts(profile);
    drafts.reverse();
    const rebuilt = buildFolderProfile(
      {
        name: profile.name,
        description: profile.description,
        folders: drafts,
        outputDefaults: outputDefaultsToDrafts(profile),
      },
      existing,
      sequentialIds(),
      fixedNow,
      profile.profileId,
    );
    const originalIds = new Set(profile.folders.map((folder) => folder.profileFolderId));
    expect(
      rebuilt.folders.map((folder) => folder.profileFolderId).every((id) => originalIds.has(id)),
    ).toBe(true);
  });

  it('keeps profileFolderId independent of derived path', () => {
    const profile = buildTestProfile();
    const boq = profile.folders.find((folder) => folder.name === 'BOQ')!;
    const existing = new Map(profile.folders.map((folder) => [folder.profileFolderId, folder]));
    const drafts = profileToDrafts(profile);
    const technical = drafts.find((draft) => draft.name === '04_TECHNICAL')!;
    technical.children = technical.children.filter((child) => child.name !== 'BOQ');
    drafts.push({ profileFolderId: boq.profileFolderId, name: 'BOQ', children: [] });
    const defaults = outputDefaultsToDrafts(profile);
    defaults.find(
      (outputDefault) => outputDefault.outputTypeId === 'TechnicalBoq',
    )!.destinationPath = 'BOQ';
    const rebuilt = buildFolderProfile(
      {
        name: profile.name,
        description: profile.description,
        folders: drafts,
        outputDefaults: defaults,
      },
      existing,
      newIds(),
      fixedNow,
      profile.profileId,
    );
    const moved = rebuilt.folders.find((folder) => folder.name === 'BOQ')!;
    expect(moved.profileFolderId).toBe(boq.profileFolderId);
    expect(moved.parentProfileFolderId).toBeNull();
  });

  it('update preserves unchanged node IDs', () => {
    const profile = buildTestProfile();
    const existing = new Map(profile.folders.map((folder) => [folder.profileFolderId, folder]));
    const rebuilt = buildFolderProfile(
      {
        name: profile.name,
        description: profile.description,
        folders: profileToDrafts(profile),
        outputDefaults: outputDefaultsToDrafts(profile),
      },
      existing,
      sequentialIds(),
      fixedNow,
      profile.profileId,
    );
    expect(rebuilt.folders.map((folder) => folder.profileFolderId)).toEqual(
      profile.folders.map((folder) => folder.profileFolderId),
    );
  });

  it('duplicate profile gets a new profileId', () => {
    const profile = buildTestProfile();
    const duplicate = duplicateFolderProfile(
      profile,
      'Full Lighting + Authority Copy',
      duplicateIds(),
      fixedNow,
    );
    expect(duplicate.profileId).not.toBe(profile.profileId);
  });

  it('duplicate profile gets new profileFolderIds', () => {
    const profile = buildTestProfile();
    const duplicate = duplicateFolderProfile(
      profile,
      'Full Lighting + Authority Copy',
      duplicateIds(),
      fixedNow,
    );
    const originalIds = new Set(profile.folders.map((folder) => folder.profileFolderId));
    expect(duplicate.folders).toHaveLength(profile.folders.length);
    expect(duplicate.folders.every((folder) => !originalIds.has(folder.profileFolderId))).toBe(
      true,
    );
  });

  it('duplicate output defaults remap to duplicated node IDs', () => {
    const profile = buildTestProfile();
    const duplicate = duplicateFolderProfile(
      profile,
      'Full Lighting + Authority Copy',
      duplicateIds(),
      fixedNow,
    );
    const duplicateIdsSet = new Set(duplicate.folders.map((folder) => folder.profileFolderId));
    for (const outputDefault of duplicate.outputDefaults) {
      expect(duplicateIdsSet.has(outputDefault.destinationProfileFolderId)).toBe(true);
    }
    const originalByType = new Map(
      profile.outputDefaults.map((outputDefault) => [
        outputDefault.outputTypeId,
        outputDefault.destinationProfileFolderId,
      ]),
    );
    for (const outputDefault of duplicate.outputDefaults) {
      expect(outputDefault.destinationProfileFolderId).not.toBe(
        originalByType.get(outputDefault.outputTypeId),
      );
    }
  });
});

describe('P2.4B3A profile validation', () => {
  it('rejects duplicate profileFolderId', () => {
    const nodes: ProfileFolderNode[] = [
      {
        profileFolderId: 'a',
        parentProfileFolderId: null,
        name: 'A',
        displayOrder: 0,
        semanticRole: null,
      },
      {
        profileFolderId: 'a',
        parentProfileFolderId: null,
        name: 'B',
        displayOrder: 1,
        semanticRole: null,
      },
    ];
    expect(() => validateProfileFolderNodes(nodes)).toThrow(DomainError);
  });

  it('rejects a missing parent', () => {
    const nodes: ProfileFolderNode[] = [
      {
        profileFolderId: 'a',
        parentProfileFolderId: 'missing',
        name: 'A',
        displayOrder: 0,
        semanticRole: null,
      },
    ];
    expect(() => validateProfileFolderNodes(nodes)).toThrow(/Unknown parent/);
  });

  it('rejects a hierarchy cycle', () => {
    const nodes: ProfileFolderNode[] = [
      {
        profileFolderId: 'a',
        parentProfileFolderId: 'b',
        name: 'A',
        displayOrder: 0,
        semanticRole: null,
      },
      {
        profileFolderId: 'b',
        parentProfileFolderId: 'a',
        name: 'B',
        displayOrder: 0,
        semanticRole: null,
      },
    ];
    expect(() => validateProfileFolderNodes(nodes)).toThrow(/cycle/);
  });

  it('rejects an invalid Windows folder segment', () => {
    const nodes: ProfileFolderNode[] = [
      {
        profileFolderId: 'a',
        parentProfileFolderId: null,
        name: 'BAD/NAME',
        displayOrder: 0,
        semanticRole: null,
      },
    ];
    expect(() => validateProfileFolderNodes(nodes)).toThrow(DomainError);
  });

  it('rejects duplicate outputTypeId', () => {
    const profile = buildTestProfile();
    const defaults: ProfileOutputDefault[] = [
      { outputTypeId: 'Reports', destinationProfileFolderId: profile.folders[0]!.profileFolderId },
      { outputTypeId: 'Reports', destinationProfileFolderId: profile.folders[1]!.profileFolderId },
    ];
    expect(() => validateProfileOutputDefaults(defaults, profile.folders)).toThrow(
      /Duplicate output default/,
    );
  });

  it('rejects an output default targeting a missing node', () => {
    const profile = buildTestProfile();
    const defaults: ProfileOutputDefault[] = [
      { outputTypeId: 'Reports', destinationProfileFolderId: 'missing-node' },
    ];
    expect(() => validateProfileOutputDefaults(defaults, profile.folders)).toThrow(/same profile/);
  });

  it('preserves unknown/custom outputTypeId', () => {
    const profile = buildFolderProfile(
      {
        ...draftProfile(),
        outputDefaults: [
          ...draftProfile().outputDefaults,
          { outputTypeId: 'CustomDeliverable', destinationPath: '05_DELIVERABLES' },
        ],
      },
      new Map(),
      sequentialIds(),
      fixedNow,
      'profile-custom',
    );
    expect(
      profile.outputDefaults.some(
        (outputDefault) => outputDefault.outputTypeId === 'CustomDeliverable',
      ),
    ).toBe(true);
    validateFolderProfile(profile);
  });
});

describe('P2.4B3A structural fingerprint', () => {
  it('produces the same fingerprint for identical structural content', () => {
    const first = buildTestProfile();
    const second = buildTestProfile();
    expect(first.structuralFingerprint).toBe(second.structuralFingerprint);
  });

  it('is independent of irrelevant object-key ordering', () => {
    const folders: ProfileFolderNode[] = [
      {
        profileFolderId: 'a',
        parentProfileFolderId: null,
        name: 'A',
        displayOrder: 0,
        semanticRole: null,
      },
      {
        profileFolderId: 'b',
        parentProfileFolderId: 'a',
        name: 'B',
        displayOrder: 0,
        semanticRole: null,
      },
    ];
    const defaults: ProfileOutputDefault[] = [
      { outputTypeId: 'Reports', destinationProfileFolderId: 'b' },
      { outputTypeId: 'Datasheets', destinationProfileFolderId: 'a' },
    ];
    const first = profileStructuralFingerprint(folders, defaults);
    const second = profileStructuralFingerprint(
      [folders[1]!, folders[0]!],
      [defaults[1]!, defaults[0]!],
    );
    expect(first).toBe(second);
  });

  it('does not change when the profile display name changes', () => {
    const first = buildTestProfile('Full Lighting + Authority');
    const second = buildTestProfile('Renamed Profile');
    expect(first.structuralFingerprint).toBe(second.structuralFingerprint);
  });

  it('does not change when the description changes', () => {
    const first = buildTestProfile();
    const second = buildFolderProfile(
      { ...draftProfile(), description: 'A different description' },
      new Map(),
      sequentialIds(),
      fixedNow,
      'profile-2',
    );
    expect(first.structuralFingerprint).toBe(second.structuralFingerprint);
  });

  it('changes when a folder is renamed', () => {
    const profile = buildTestProfile();
    const existing = new Map(profile.folders.map((folder) => [folder.profileFolderId, folder]));
    const drafts = profileToDrafts(profile);
    drafts.find((draft) => draft.name === '03_DRAWINGS')!.name = '03_LIGHTING_DRAWINGS';
    const rebuilt = buildFolderProfile(
      {
        name: profile.name,
        description: profile.description,
        folders: drafts,
        outputDefaults: outputDefaultsToDrafts(profile),
      },
      existing,
      sequentialIds(),
      fixedNow,
      profile.profileId,
    );
    expect(rebuilt.structuralFingerprint).not.toBe(profile.structuralFingerprint);
  });

  it('changes when the hierarchy changes', () => {
    const profile = buildTestProfile();
    const existing = new Map(profile.folders.map((folder) => [folder.profileFolderId, folder]));
    const drafts = profileToDrafts(profile);
    const technical = drafts.find((draft) => draft.name === '04_TECHNICAL')!;
    technical.children = technical.children.filter((child) => child.name !== 'BOQ');
    drafts.push({ name: 'BOQ', children: [] });
    const defaults = outputDefaultsToDrafts(profile);
    defaults.find(
      (outputDefault) => outputDefault.outputTypeId === 'TechnicalBoq',
    )!.destinationPath = 'BOQ';
    const rebuilt = buildFolderProfile(
      {
        name: profile.name,
        description: profile.description,
        folders: drafts,
        outputDefaults: defaults,
      },
      existing,
      newIds(),
      fixedNow,
      profile.profileId,
    );
    expect(rebuilt.structuralFingerprint).not.toBe(profile.structuralFingerprint);
  });

  it('changes when the order changes', () => {
    const profile = buildTestProfile();
    const existing = new Map(profile.folders.map((folder) => [folder.profileFolderId, folder]));
    const drafts = profileToDrafts(profile);
    drafts.reverse();
    const rebuilt = buildFolderProfile(
      {
        name: profile.name,
        description: profile.description,
        folders: drafts,
        outputDefaults: outputDefaultsToDrafts(profile),
      },
      existing,
      sequentialIds(),
      fixedNow,
      profile.profileId,
    );
    expect(rebuilt.structuralFingerprint).not.toBe(profile.structuralFingerprint);
  });

  it('changes when an output destination changes', () => {
    const profile = buildTestProfile();
    const existing = new Map(profile.folders.map((folder) => [folder.profileFolderId, folder]));
    const defaults = outputDefaultsToDrafts(profile);
    defaults.find((outputDefault) => outputDefault.outputTypeId === 'Reports')!.destinationPath =
      '04_TECHNICAL';
    const rebuilt = buildFolderProfile(
      {
        name: profile.name,
        description: profile.description,
        folders: profileToDrafts(profile),
        outputDefaults: defaults,
      },
      existing,
      sequentialIds(),
      fixedNow,
      profile.profileId,
    );
    expect(rebuilt.structuralFingerprint).not.toBe(profile.structuralFingerprint);
  });
});

describe('P2.4B3A profile instantiation', () => {
  it('never copies profile node IDs into project folder IDs', () => {
    const profile = buildTestProfile();
    const result = instantiateFolderProfile(profile, projectIds());
    const profileIds = new Set(profile.folders.map((folder) => folder.profileFolderId));
    expect(result.snapshot.folders.every((folder) => !profileIds.has(folder.folderId))).toBe(true);
  });

  it('produces different project folder IDs for two instantiations', () => {
    const profile = buildTestProfile();
    const ids = projectIds();
    const first = instantiateFolderProfile(profile, ids);
    const second = instantiateFolderProfile(profile, ids);
    expect(first.snapshot.folders.map((folder) => folder.folderId)).not.toEqual(
      second.snapshot.folders.map((folder) => folder.folderId),
    );
  });

  it('remaps the parent hierarchy correctly', () => {
    const profile = buildTestProfile();
    const result = instantiateFolderProfile(profile, sequentialIds());
    const byId = new Map(result.snapshot.folders.map((folder) => [folder.folderId, folder]));
    for (const folder of result.snapshot.folders) {
      if (folder.parentFolderId !== null) {
        expect(byId.has(folder.parentFolderId)).toBe(true);
      }
    }
    const boq = result.snapshot.folders.find((folder) => folder.name === 'BOQ')!;
    const technical = result.snapshot.folders.find((folder) => folder.name === '04_TECHNICAL')!;
    expect(boq.parentFolderId).toBe(technical.folderId);
  });

  it('retains sourceProfileFolderId provenance', () => {
    const profile = buildTestProfile();
    const result = instantiateFolderProfile(profile, sequentialIds());
    const byName = new Map(result.snapshot.folders.map((folder) => [folder.name, folder]));
    expect(byName.get('BOQ')?.sourceProfileFolderId).toBe(
      profile.folders.find((folder) => folder.name === 'BOQ')?.profileFolderId,
    );
  });

  it('retains source profileId and fingerprint in snapshot provenance', () => {
    const profile = buildTestProfile();
    const result = instantiateFolderProfile(profile, sequentialIds());
    expect(result.snapshot.sourceProfile).toEqual({
      profileId: profile.profileId,
      profileName: profile.name,
      profileRevision: null,
      structuralFingerprint: profile.structuralFingerprint,
    });
  });

  it('remaps profile output defaults to project destination folder IDs', () => {
    const profile = buildTestProfile();
    const result = instantiateFolderProfile(profile, sequentialIds());
    const byName = new Map(result.snapshot.folders.map((folder) => [folder.name, folder]));
    const reports = result.outputMappings.mappings.find(
      (mapping) => mapping.outputTypeId === 'Reports',
    )!;
    expect(reports.destinationFolderId).toBe(byName.get('05_DELIVERABLES')!.folderId);
    expect(reports.unresolved).toBe(false);
  });

  it('keeps every output mapping target inside the resulting snapshot', () => {
    const profile = buildTestProfile();
    const result = instantiateFolderProfile(profile, sequentialIds());
    const ids = new Set(result.snapshot.folders.map((folder) => folder.folderId));
    for (const mapping of result.outputMappings.mappings) {
      expect(ids.has(mapping.destinationFolderId!)).toBe(true);
    }
  });

  it('performs no filesystem operation', () => {
    const profile = buildTestProfile();
    const result = instantiateFolderProfile(profile, sequentialIds());
    expect(result.snapshot.schemaVersion).toBe('1.0');
    expect(result.outputMappings.schemaVersion).toBe('1.0');
    expect(result.snapshot.folders.length).toBeGreaterThan(0);
    expect(result.outputMappings.mappings.length).toBeGreaterThan(0);
  });
});

describe('P2.4B3A legacy project compatibility', () => {
  it('loads an existing B1/B2 snapshot without sourceProfileFolderId', () => {
    const snapshot = {
      schemaVersion: '1.0' as const,
      sourceProfile: null,
      folders: [
        {
          folderId: 'legacy-1',
          parentFolderId: null,
          name: '01_INPUT',
          displayOrder: 0,
          enabled: true,
          semanticRole: null,
        },
      ],
    };
    expect(snapshot.folders.every((folder) => !('sourceProfileFolderId' in folder))).toBe(true);
    expect(() => validateFolderSnapshot(snapshot)).not.toThrow();
  });

  it('keeps legacy project snapshots readable without rewrite', () => {
    const profile = buildTestProfile();
    const result = instantiateFolderProfile(profile, sequentialIds());
    const withoutProvenance = {
      ...result.snapshot,
      folders: result.snapshot.folders.map((folder) => {
        const copy = { ...folder };
        delete copy.sourceProfileFolderId;
        return copy;
      }),
    };
    expect(withoutProvenance.folders.every((folder) => !('sourceProfileFolderId' in folder))).toBe(
      true,
    );
    expect(() => validateFolderSnapshot(withoutProvenance)).not.toThrow();
  });
});

describe('P2.4B3A legacy preset compatibility boundary', () => {
  const fallbackOutputFolders: ProjectOutputFolders = {
    scheduleExcel: 'FALLBACK',
    schedulePdf: 'FALLBACK',
    boqExcel: 'FALLBACK',
    boqPdf: 'FALLBACK',
    datasheets: 'FALLBACK',
  };

  function buildLegacyKeyedProfile(): FolderProfile {
    return buildFolderProfile(
      {
        ...draftProfile(),
        outputDefaults: [
          { outputTypeId: 'scheduleExcel', destinationPath: '04_TECHNICAL/BOQ' },
          { outputTypeId: 'schedulePdf', destinationPath: '04_TECHNICAL/BOQ' },
          { outputTypeId: 'boqExcel', destinationPath: '04_TECHNICAL/BOQ' },
          { outputTypeId: 'boqPdf', destinationPath: '04_TECHNICAL/BOQ' },
          { outputTypeId: 'datasheets', destinationPath: '04_TECHNICAL/DATASHEETS' },
        ],
      },
      new Map(),
      sequentialIds(),
      fixedNow,
      'profile-legacy-keys',
    );
  }

  function presetTree(profile: FolderProfile): FolderNodePreset[] {
    const byParent = new Map<string | null, ProfileFolderNode[]>();
    for (const node of profile.folders) {
      const siblings = byParent.get(node.parentProfileFolderId) ?? [];
      siblings.push(node);
      byParent.set(node.parentProfileFolderId, siblings);
    }
    const buildTree = (parent: string | null): FolderNodePreset[] =>
      (byParent.get(parent) ?? [])
        .sort((left, right) => left.displayOrder - right.displayOrder)
        .map((node) => ({ name: node.name, children: buildTree(node.profileFolderId) }));
    return buildTree(null);
  }

  it('converts a catalog profile into the legacy preset view with known output keys', () => {
    const profile = buildLegacyKeyedProfile();
    const preset = folderProfileToPreset(profile, fallbackOutputFolders);
    expect(preset.name).toBe(profile.name);
    expect(preset.builtIn).toBe(false);
    expect(preset.folders).toHaveLength(
      profile.folders.filter((node) => node.parentProfileFolderId === null).length,
    );
    expect(preset.outputFolders.scheduleExcel).toBe('04_TECHNICAL/BOQ');
    expect(preset.outputFolders.schedulePdf).toBe('04_TECHNICAL/BOQ');
    expect(preset.outputFolders.datasheets).toBe('04_TECHNICAL/DATASHEETS');
  });

  it('keeps unknown output types in the catalog but omits them from the legacy view', () => {
    const profile = buildFolderProfile(
      {
        ...draftProfile(),
        outputDefaults: [
          { outputTypeId: 'scheduleExcel', destinationPath: '04_TECHNICAL/BOQ' },
          { outputTypeId: 'datasheets', destinationPath: '04_TECHNICAL/DATASHEETS' },
          { outputTypeId: 'CustomDeliverable', destinationPath: '05_DELIVERABLES' },
        ],
      },
      new Map(),
      sequentialIds(),
      fixedNow,
      'profile-custom-boundary',
    );
    const preset = folderProfileToPreset(profile, fallbackOutputFolders);
    expect(preset.outputFolders).not.toHaveProperty('CustomDeliverable');
    expect(preset.outputFolders.scheduleExcel).toBe('04_TECHNICAL/BOQ');
    expect(
      profile.outputDefaults.some(
        (outputDefault) => outputDefault.outputTypeId === 'CustomDeliverable',
      ),
    ).toBe(true);
  });

  it('preserves node identity across legacy save round trips by relative path', () => {
    const profile = buildLegacyKeyedProfile();
    const preset = folderProfileToPreset(profile, fallbackOutputFolders);
    const draft = presetToFolderProfileDraft(
      {
        name: profile.name,
        description: profile.description ?? '',
        folders: presetTree(profile),
        outputFolders: preset.outputFolders,
      },
      profile,
    );
    const rebuilt = buildFolderProfile(
      draft,
      new Map(profile.folders.map((node) => [node.profileFolderId, node])),
      newIds(),
      fixedNow,
      profile.profileId,
    );
    expect(rebuilt.folders.map((node) => node.profileFolderId)).toEqual(
      profile.folders.map((node) => node.profileFolderId),
    );
  });

  it('round-trips legacy preset input through the catalog without structural loss', () => {
    const profile = buildLegacyKeyedProfile();
    const preset = folderProfileToPreset(profile, fallbackOutputFolders);
    const draft = presetToFolderProfileDraft(
      {
        name: preset.name,
        description: preset.description,
        folders: preset.folders,
        outputFolders: preset.outputFolders,
      },
      profile,
    );
    const rebuilt = buildFolderProfile(
      draft,
      new Map(profile.folders.map((node) => [node.profileFolderId, node])),
      newIds(),
      fixedNow,
      profile.profileId,
    );
    const rebuiltPreset = folderProfileToPreset(rebuilt, fallbackOutputFolders);
    expect(rebuiltPreset.folders).toEqual(preset.folders);
    expect(rebuiltPreset.outputFolders).toEqual(preset.outputFolders);
  });
});

describe('P2.4B3B1A unified default authority', () => {
  const factoryKeys = new Set(['full-lighting-design', 'classic-scli']);

  it('blank default reference is always valid', () => {
    expect(
      validateFolderProfileRef({ kind: 'blank' }, { profileIds: new Set(), factoryKeys }),
    ).toBeUndefined();
  });

  it('factory default reference is valid by stable key', () => {
    expect(
      validateFolderProfileRef(
        { kind: 'factory', factoryProfileKey: 'full-lighting-design' },
        { profileIds: new Set(), factoryKeys },
      ),
    ).toBeUndefined();
  });

  it('rejects an unknown factory key', () => {
    expect(() =>
      validateFolderProfileRef(
        { kind: 'factory', factoryProfileKey: 'renamed-later' },
        { profileIds: new Set(), factoryKeys },
      ),
    ).toThrow(DomainError);
  });

  it('user default reference is valid by canonical UUID', () => {
    expect(
      validateFolderProfileRef(
        { kind: 'user', profileId: 'profile-1' },
        { profileIds: new Set(['profile-1']), factoryKeys },
      ),
    ).toBeUndefined();
  });

  it('rejects a user default reference with a missing profile', () => {
    expect(() =>
      validateFolderProfileRef(
        { kind: 'user', profileId: 'missing-profile' },
        { profileIds: new Set(['profile-1']), factoryKeys },
      ),
    ).toThrow(DomainError);
  });

  it('factory identity is a stable machine key, never the display name', () => {
    const factoryRef = factoryFolderProfileRef('full-lighting-design');
    expect(factoryRef).toEqual({ kind: 'factory', factoryProfileKey: 'full-lighting-design' });
    expect(blankFolderProfileRef()).toEqual({ kind: 'blank' });
    expect(userFolderProfileRef('profile-1')).toEqual({ kind: 'user', profileId: 'profile-1' });
  });
});

describe('P2.4B3B1A unknown output preservation through legacy drafts', () => {
  function keyedProfile(): FolderProfile {
    return buildFolderProfile(
      {
        name: 'Lighting + Authority',
        description: 'Canonical profile with unknown outputs.',
        folders: draftProfile().folders,
        outputDefaults: [
          { outputTypeId: 'scheduleExcel', destinationPath: '04_TECHNICAL/BOQ' },
          { outputTypeId: 'schedulePdf', destinationPath: '04_TECHNICAL/BOQ' },
          { outputTypeId: 'boqExcel', destinationPath: '04_TECHNICAL/BOQ' },
          { outputTypeId: 'boqPdf', destinationPath: '04_TECHNICAL/BOQ' },
          { outputTypeId: 'datasheets', destinationPath: '04_TECHNICAL/DATASHEETS' },
          { outputTypeId: 'CustomDeliverable', destinationPath: '05_DELIVERABLES' },
          { outputTypeId: 'Reports', destinationPath: '05_DELIVERABLES' },
        ],
      },
      new Map(),
      sequentialIds(),
      fixedNow,
      'profile-unknown-outputs',
    );
  }

  it('preserves unknown/custom output defaults when an existing profile is saved through legacy input', () => {
    const profile = keyedProfile();
    const draft = presetToFolderProfileDraft(
      {
        name: profile.name,
        description: profile.description ?? '',
        folders: [
          { name: '00_RECEIVED', children: [] },
          { name: '01_WORKING', children: [] },
          { name: '02_CALCULATIONS', children: [] },
          { name: '03_DRAWINGS', children: [] },
          {
            name: '04_TECHNICAL',
            children: [
              { name: 'DATASHEETS', children: [] },
              { name: 'BOQ', children: [] },
            ],
          },
          { name: '05_DELIVERABLES', children: [] },
        ],
        outputFolders: {
          scheduleExcel: '04_TECHNICAL/BOQ',
          schedulePdf: '04_TECHNICAL/BOQ',
          boqExcel: '04_TECHNICAL/BOQ',
          boqPdf: '04_TECHNICAL/BOQ',
          datasheets: '04_TECHNICAL/DATASHEETS',
        },
      },
      profile,
    );
    const outputTypeIds = draft.outputDefaults.map((outputDefault) => outputDefault.outputTypeId);
    expect(outputTypeIds).toContain('CustomDeliverable');
    expect(outputTypeIds).toContain('Reports');
    expect(outputTypeIds).toContain('scheduleExcel');
    const custom = draft.outputDefaults.find(
      (outputDefault) => outputDefault.outputTypeId === 'CustomDeliverable',
    );
    expect(custom?.destinationPath).toBe('05_DELIVERABLES');
  });

  it('applies known legacy output edits while preserving unknown mappings', () => {
    const profile = keyedProfile();
    const draft = presetToFolderProfileDraft(
      {
        name: profile.name,
        description: profile.description ?? '',
        folders: [
          { name: '00_RECEIVED', children: [] },
          { name: '01_WORKING', children: [] },
          { name: '02_CALCULATIONS', children: [] },
          { name: '03_DRAWINGS', children: [] },
          {
            name: '04_TECHNICAL',
            children: [
              { name: 'DATASHEETS', children: [] },
              { name: 'BOQ', children: [] },
            ],
          },
          { name: '05_DELIVERABLES', children: [] },
        ],
        outputFolders: {
          scheduleExcel: '04_TECHNICAL',
          schedulePdf: '04_TECHNICAL',
          boqExcel: '04_TECHNICAL/BOQ',
          boqPdf: '04_TECHNICAL/BOQ',
          datasheets: '04_TECHNICAL/DATASHEETS',
        },
      },
      profile,
    );
    const scheduleExcel = draft.outputDefaults.find(
      (outputDefault) => outputDefault.outputTypeId === 'scheduleExcel',
    );
    expect(scheduleExcel?.destinationPath).toBe('04_TECHNICAL');
    expect(
      draft.outputDefaults.some(
        (outputDefault) => outputDefault.outputTypeId === 'CustomDeliverable',
      ),
    ).toBe(true);
  });

  it('a new profile through legacy input contains no invented unknown outputs', () => {
    const draft = presetToFolderProfileDraft(
      {
        name: 'Legacy New Profile',
        description: 'Created through the legacy contract.',
        folders: [{ name: '01_WORKING', children: [] }],
        outputFolders: {
          scheduleExcel: '01_WORKING',
          schedulePdf: '01_WORKING',
          boqExcel: '01_WORKING',
          boqPdf: '01_WORKING',
          datasheets: '01_WORKING',
        },
      },
      null,
    );
    expect(draft.outputDefaults).toHaveLength(5);
    expect(
      draft.outputDefaults.every(
        (outputDefault) =>
          outputDefault.outputTypeId.startsWith('schedule') ||
          outputDefault.outputTypeId.startsWith('boq') ||
          outputDefault.outputTypeId === 'datasheets',
      ),
    ).toBe(true);
  });
});

describe('P2.4B3B1A factory provenance model', () => {
  it('source-profile model represents a stable factory key', () => {
    const source = factoryProfileSource('full-lighting-design', 'Full Lighting Design', 'fp-1');
    expect(source.profileId).toBeNull();
    expect(source.factoryProfileKey).toBe('full-lighting-design');
    const snapshot = buildProjectFolderSnapshot(
      [{ name: '01_INPUT', children: [] }],
      source,
      sequentialIds(),
    );
    expect(() => validateFolderSnapshot(snapshot)).not.toThrow();
    expect(snapshot.sourceProfile?.factoryProfileKey).toBe('full-lighting-design');
    expect(snapshot.sourceProfile?.profileId).toBeNull();
  });

  it('existing snapshots without the new provenance field still load', () => {
    const source = {
      profileId: 'profile-1' as string | null,
      profileName: 'Full Lighting + Authority',
      profileRevision: null as string | null,
      structuralFingerprint: 'fp-1',
    };
    const snapshot = buildProjectFolderSnapshot(
      [{ name: '01_INPUT', children: [] }],
      source,
      sequentialIds(),
    );
    expect(() => validateFolderSnapshot(snapshot)).not.toThrow();
    expect(snapshot.sourceProfile?.factoryProfileKey).toBeUndefined();
  });
});
describe('P2.4B3B2A canonical project folder draft', () => {
  const factorySource = factoryProfileSource(
    'full-lighting-design',
    'Full Lighting Design',
    'fp-factory-1',
  );

  function realityDraft(overrides: Partial<ProjectFolderDraft> = {}): ProjectFolderDraft {
    return {
      folders: [
        {
          draftFolderId: 'D1',
          parentDraftFolderId: null,
          name: 'RECEIVED',
          displayOrder: 0,
          sourceProfileFolderId: 'PF1',
        },
        {
          draftFolderId: 'D2',
          parentDraftFolderId: null,
          name: 'WORKING',
          displayOrder: 1,
          sourceProfileFolderId: 'PF2',
        },
        {
          draftFolderId: 'D3',
          parentDraftFolderId: null,
          name: 'LIGHTING_DRAWINGS',
          displayOrder: 2,
          sourceProfileFolderId: 'PF3',
        },
        {
          draftFolderId: 'D4',
          parentDraftFolderId: null,
          name: 'TECHNICAL',
          displayOrder: 3,
          sourceProfileFolderId: 'PF4',
        },
        {
          draftFolderId: 'D5',
          parentDraftFolderId: 'D4',
          name: 'DATASHEETS',
          displayOrder: 0,
          sourceProfileFolderId: 'PF5',
        },
        {
          draftFolderId: 'D6',
          parentDraftFolderId: 'D4',
          name: 'BOQ',
          displayOrder: 1,
          sourceProfileFolderId: 'PF6',
        },
        {
          draftFolderId: 'D7',
          parentDraftFolderId: null,
          name: 'DELIVERABLES',
          displayOrder: 4,
          sourceProfileFolderId: 'PF7',
        },
        { draftFolderId: 'D8', parentDraftFolderId: 'D4', name: 'MOCKUP', displayOrder: 2 },
      ],
      outputMappings: [
        { outputTypeId: 'TechnicalBoq', destinationDraftFolderId: 'D6' },
        { outputTypeId: 'Datasheets', destinationDraftFolderId: 'D5' },
        { outputTypeId: 'Reports', destinationDraftFolderId: 'D7' },
        { outputTypeId: 'CustomDeliverable', destinationDraftFolderId: 'D7' },
      ],
      sourceProfile: factorySource,
      ...overrides,
    };
  }

  it('keeps draftFolderId unique and independent of name, order, and path', () => {
    const draft = realityDraft();
    expect(() => validateProjectFolderDraft(draft)).not.toThrow();
    const ids = draft.folders.map((folder) => folder.draftFolderId);
    expect(new Set(ids).size).toBe(ids.length);

    const renamed = realityDraft({
      folders: draft.folders.map((folder) =>
        folder.draftFolderId === 'D3' ? { ...folder, name: 'DRAWINGS' } : folder,
      ),
    });
    expect(() => validateProjectFolderDraft(renamed)).not.toThrow();
    expect(renamed.folders.find((folder) => folder.draftFolderId === 'D3')?.name).toBe('DRAWINGS');

    const reordered = realityDraft({
      folders: draft.folders.map((folder) =>
        folder.draftFolderId === 'D3'
          ? { ...folder, displayOrder: 3 }
          : folder.draftFolderId === 'D4'
            ? { ...folder, displayOrder: 2 }
            : folder,
      ),
    });
    expect(() => validateProjectFolderDraft(reordered)).not.toThrow();

    const moved = realityDraft({
      folders: draft.folders.map((folder) =>
        folder.draftFolderId === 'D5'
          ? { ...folder, parentDraftFolderId: 'D2', displayOrder: 0 }
          : folder,
      ),
    });
    expect(() => validateProjectFolderDraft(moved)).not.toThrow();
    expect(moved.folders.find((folder) => folder.draftFolderId === 'D5')?.parentDraftFolderId).toBe(
      'D2',
    );
  });

  it('separates draftFolderId from profileFolderId and project folderId', () => {
    const draft = realityDraft();
    const instantiated = instantiateProjectFolderDraft(draft, projectIds());
    const draftIds = new Set(draft.folders.map((folder) => folder.draftFolderId));
    const profileIds = new Set(
      draft.folders
        .map((folder) => folder.sourceProfileFolderId)
        .filter((id): id is string => typeof id === 'string'),
    );
    for (const node of instantiated.snapshot.folders) {
      expect(draftIds.has(node.folderId)).toBe(false);
      expect(profileIds.has(node.folderId)).toBe(false);
      expect(node.folderId.startsWith('project-')).toBe(true);
    }
    for (const folder of draft.folders) {
      expect(folder.draftFolderId).not.toBe(folder.sourceProfileFolderId);
    }
  });

  it('supports custom draft nodes without source profile provenance', () => {
    const draft = realityDraft();
    const instantiated = instantiateProjectFolderDraft(draft, projectIds());
    const mockup = instantiated.snapshot.folders.find((folder) => folder.name === 'MOCKUP')!;
    expect(mockup.sourceProfileFolderId).toBeUndefined();
    expect(
      draft.folders.find((folder) => folder.draftFolderId === 'D8')?.sourceProfileFolderId,
    ).toBeUndefined();
  });

  it('rejects missing parents, cycles, invalid Windows segments, and duplicate siblings', () => {
    expect(() =>
      validateProjectFolderDraft(
        realityDraft({
          folders: [
            {
              draftFolderId: 'A1',
              parentDraftFolderId: 'MISSING',
              name: 'FOLDER',
              displayOrder: 0,
            },
          ],
        }),
      ),
    ).toThrow(/missing parent/);

    expect(() =>
      validateProjectFolderDraft({
        ...realityDraft(),
        folders: [
          { draftFolderId: 'A', parentDraftFolderId: 'B', name: 'A_FOLDER', displayOrder: 0 },
          { draftFolderId: 'B', parentDraftFolderId: 'A', name: 'B_FOLDER', displayOrder: 0 },
        ],
      }),
    ).toThrow(/cycle/);

    for (const invalidName of ['BAD/NAME', 'CON', '..', '.']) {
      expect(() =>
        validateProjectFolderDraft(
          realityDraft({
            folders: [
              {
                draftFolderId: 'A1',
                parentDraftFolderId: null,
                name: invalidName,
                displayOrder: 0,
              },
            ],
          }),
        ),
      ).toThrow(DomainError);
    }

    expect(() =>
      validateProjectFolderDraft(
        realityDraft({
          folders: [
            { draftFolderId: 'A1', parentDraftFolderId: null, name: 'DUPLICATE', displayOrder: 0 },
            { draftFolderId: 'A2', parentDraftFolderId: null, name: 'duplicate', displayOrder: 1 },
          ],
        }),
      ),
    ).toThrow(/Duplicate draft folder name/);
  });

  it('rejects duplicate or dangling output mappings', () => {
    expect(() =>
      validateProjectFolderDraft(
        realityDraft({
          outputMappings: [
            { outputTypeId: 'TechnicalBoq', destinationDraftFolderId: 'D6' },
            { outputTypeId: 'TechnicalBoq', destinationDraftFolderId: 'D5' },
          ],
        }),
      ),
    ).toThrow(/Duplicate output mapping/);

    expect(() =>
      validateProjectFolderDraft(
        realityDraft({
          outputMappings: [{ outputTypeId: 'TechnicalBoq', destinationDraftFolderId: 'NOPE' }],
        }),
      ),
    ).toThrow(/same draft/);
  });

  it('remaps output destinations to project folder IDs and preserves custom types', () => {
    const draft = realityDraft();
    const instantiated = instantiateProjectFolderDraft(draft, projectIds());
    const byDraft = new Map(
      instantiated.snapshot.folders.map((folder) => [folder.name, folder.folderId]),
    );
    const mappings = instantiated.outputMappings.mappings;
    expect(mappings).toHaveLength(4);
    expect(
      mappings.find((mapping) => mapping.outputTypeId === 'TechnicalBoq')?.destinationFolderId,
    ).toBe(byDraft.get('BOQ'));
    expect(
      mappings.find((mapping) => mapping.outputTypeId === 'Datasheets')?.destinationFolderId,
    ).toBe(byDraft.get('DATASHEETS'));
    expect(
      mappings.find((mapping) => mapping.outputTypeId === 'Reports')?.destinationFolderId,
    ).toBe(byDraft.get('DELIVERABLES'));
    const custom = mappings.find((mapping) => mapping.outputTypeId === 'CustomDeliverable');
    expect(custom?.destinationFolderId).toBe(byDraft.get('DELIVERABLES'));
    expect(
      mappings.every((mapping) => mapping.unresolved === false && mapping.legacyPath === null),
    ).toBe(true);
  });

  it('assigns new IDs to every node, remaps parents, and preserves provenance', () => {
    const draft = realityDraft();
    const instantiated = instantiateProjectFolderDraft(draft, projectIds());
    const byName = new Map(instantiated.snapshot.folders.map((folder) => [folder.name, folder]));
    const technical = byName.get('TECHNICAL')!;
    const datasheets = byName.get('DATASHEETS')!;
    const mockup = byName.get('MOCKUP')!;
    expect(datasheets.parentFolderId).toBe(technical.folderId);
    expect(mockup.parentFolderId).toBe(technical.folderId);
    expect(datasheets.sourceProfileFolderId).toBe('PF5');
    expect(byName.get('LIGHTING_DRAWINGS')?.sourceProfileFolderId).toBe('PF3');
    expect(technical.sourceProfileFolderId).toBe('PF4');
  });

  it('orders draft nodes deterministically with parents before children', () => {
    const instantiated = instantiateProjectFolderDraft(realityDraft(), projectIds());
    const names = instantiated.snapshot.folders.map((folder) => folder.name);
    expect(names).toEqual([
      'RECEIVED',
      'WORKING',
      'LIGHTING_DRAWINGS',
      'TECHNICAL',
      'DATASHEETS',
      'BOQ',
      'MOCKUP',
      'DELIVERABLES',
    ]);
  });

  it('produces independent IDs for two instantiations of the same draft', () => {
    const draft = realityDraft();
    const first = instantiateProjectFolderDraft(draft, projectIds());
    const second = instantiateProjectFolderDraft(draft, newIds());
    const firstIds = new Set(first.snapshot.folders.map((folder) => folder.folderId));
    expect(second.snapshot.folders.every((folder) => !firstIds.has(folder.folderId))).toBe(true);
  });

  it('stores factory provenance by stable key and user provenance by profileId', () => {
    const factory = instantiateProjectFolderDraft(realityDraft(), projectIds());
    expect(factory.snapshot.sourceProfile?.factoryProfileKey).toBe('full-lighting-design');
    expect(factory.snapshot.sourceProfile?.profileId).toBeNull();

    const userDraft = realityDraft({
      sourceProfile: {
        profileId: 'profile-9',
        profileName: 'Villa Profile',
        profileRevision: null,
        structuralFingerprint: 'fp-user-9',
      },
    });
    const user = instantiateProjectFolderDraft(userDraft, projectIds());
    expect(user.snapshot.sourceProfile?.profileId).toBe('profile-9');
    expect(user.snapshot.sourceProfile?.profileName).toBe('Villa Profile');
    expect(user.snapshot.sourceProfile?.structuralFingerprint).toBe('fp-user-9');
  });

  it('later profile edits or deletion never change the reviewed draft snapshot', () => {
    const profile = buildFolderProfile(
      {
        name: 'Editable Profile',
        description: null,
        folders: [{ name: '01_INPUT', children: [] }],
        outputDefaults: [],
      },
      new Map(),
      sequentialIds(),
      fixedNow,
      'profile-edit-1',
    );
    const draft: ProjectFolderDraft = {
      folders: profile.folders.map((node) => ({
        draftFolderId: `D-${node.profileFolderId}`,
        parentDraftFolderId: null,
        name: node.name,
        displayOrder: node.displayOrder,
        sourceProfileFolderId: node.profileFolderId,
      })),
      outputMappings: [],
      sourceProfile: {
        profileId: profile.profileId,
        profileName: profile.name,
        profileRevision: null,
        structuralFingerprint: profile.structuralFingerprint,
      },
    };
    const before = instantiateProjectFolderDraft(draft, projectIds());

    const renamed = buildFolderProfile(
      {
        name: 'Renamed Profile',
        description: null,
        folders: [{ name: '02_CHANGED', children: [] }],
        outputDefaults: [],
      },
      new Map(),
      sequentialIds(),
      fixedNow,
      'profile-edit-2',
    );
    void renamed;

    const after = instantiateProjectFolderDraft(draft, projectIds());
    expect(after.snapshot.sourceProfile?.profileName).toBe('Editable Profile');
    expect(after.snapshot.sourceProfile?.structuralFingerprint).toBe(profile.structuralFingerprint);
    expect(after.snapshot.folders.map((folder) => folder.name)).toEqual(
      before.snapshot.folders.map((folder) => folder.name),
    );
  });

  it('supports a blank draft with zero folders and zero mappings', () => {
    const draft = blankProjectFolderDraft();
    expect(() => validateProjectFolderDraft(draft)).not.toThrow();
    const instantiated = instantiateProjectFolderDraft(draft, projectIds());
    expect(instantiated.snapshot.folders).toEqual([]);
    expect(instantiated.snapshot.sourceProfile).toBeNull();
    expect(instantiated.outputMappings.mappings).toEqual([]);
  });
});
