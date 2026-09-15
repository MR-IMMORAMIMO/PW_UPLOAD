import { randomUUID } from 'node:crypto';
import {
  DomainError,
  blankFolderProfileRef,
  buildFolderProfile,
  duplicateFolderProfile,
  instantiateFolderProfile,
  normalizeProfileName,
  presetToFolderProfileDraft,
  validateFolderProfileRef,
  type FolderProfile,
  type FolderProfileCatalog,
  type FolderProfileRef,
  type ProfileInstantiationResult,
} from '@scli/domain';
import type { CreateFolderProfileInput, UpdateFolderProfileInput } from '@scli/contracts';
import type { PersonalWorkspaceStore } from './personal-workspace-store';
import { builtInFolderProfiles } from './personal-workspace-store';

export type LegacyDefaultMatch = 'canonical' | 'factory' | 'user' | 'legacy' | 'unknown';

/** Read-model used by the future Settings UI and legacy compatibility consumers. */
export interface FolderProfileDefaultCompatibility {
  canonicalRef: FolderProfileRef;
  effectiveRef: FolderProfileRef;
  legacyName: string;
  legacyMatch: LegacyDefaultMatch;
  requiresImport: boolean;
}

/**
 * P2.4B3B1A - Unified Folder Profile default authority and legacy import.
 *
 * Owns the canonical Folder Profile catalog invariants: stable profile
 * identity, stable profile-folder-node identity, case-insensitive name
 * uniqueness, the unified default reference (blank | factory | user), and pure
 * profile-to-project instantiation. The canonical defaultProfileRef is the
 * source of truth; the legacy name-based personal setting is only a
 * compatibility mirror. Profile CRUD and import never touch the filesystem and
 * never mutate existing project snapshots.
 */
export class FolderProfileService {
  public constructor(private readonly store: PersonalWorkspaceStore) {}

  public listProfiles(): FolderProfile[] {
    return [...this.readCatalog().profiles].sort((left, right) =>
      left.name.localeCompare(right.name, undefined, { sensitivity: 'base' }),
    );
  }

  public getCatalog(): FolderProfileCatalog {
    return this.readCatalog();
  }

  public getDefaultProfileRef(): FolderProfileRef {
    return this.readCatalog().defaultProfileRef;
  }

  public getProfile(profileId: string): FolderProfile {
    const profile = this.readCatalog().profiles.find(
      (candidate) => candidate.profileId === profileId,
    );
    if (!profile) {
      throw new DomainError('NOT_FOUND', 'Folder profile not found.', 404);
    }
    return profile;
  }

  public createProfile(input: CreateFolderProfileInput): FolderProfile {
    const catalog = this.readCatalog();
    this.assertUniqueName(catalog, input.name);
    const profile = buildFolderProfile(
      {
        name: input.name,
        description: input.description ?? null,
        folders: input.folders,
        outputDefaults: input.outputDefaults,
      },
      new Map(),
      randomUUID,
      new Date().toISOString(),
      randomUUID(),
    );
    catalog.profiles.push(profile);
    this.writeCatalog(catalog);
    return profile;
  }

  public updateProfile(profileId: string, input: UpdateFolderProfileInput): FolderProfile {
    const catalog = this.readCatalog();
    const index = catalog.profiles.findIndex((candidate) => candidate.profileId === profileId);
    if (index < 0) {
      throw new DomainError('NOT_FOUND', 'Folder profile not found.', 404);
    }
    const current = catalog.profiles[index]!;
    this.assertUniqueName(catalog, input.name, profileId);
    const existing = new Map(current.folders.map((node) => [node.profileFolderId, node]));
    const next = buildFolderProfile(
      {
        name: input.name,
        description: input.description ?? null,
        folders: input.folders,
        outputDefaults: input.outputDefaults,
      },
      existing,
      randomUUID,
      new Date().toISOString(),
      profileId,
    );
    next.createdAt = current.createdAt;
    catalog.profiles[index] = next;
    this.writeCatalog(catalog);
    return next;
  }

  public duplicateProfile(profileId: string): FolderProfile {
    const catalog = this.readCatalog();
    const source = catalog.profiles.find((candidate) => candidate.profileId === profileId);
    if (!source) {
      throw new DomainError('NOT_FOUND', 'Folder profile not found.', 404);
    }
    const duplicate = duplicateFolderProfile(
      source,
      this.uniqueDuplicateName(catalog, source.name),
      randomUUID,
      new Date().toISOString(),
    );
    catalog.profiles.push(duplicate);
    this.writeCatalog(catalog);
    return duplicate;
  }

  public deleteProfile(profileId: string): void {
    const catalog = this.readCatalog();
    const index = catalog.profiles.findIndex((candidate) => candidate.profileId === profileId);
    if (index < 0) {
      throw new DomainError('NOT_FOUND', 'Folder profile not found.', 404);
    }
    catalog.profiles.splice(index, 1);
    if (
      catalog.defaultProfileRef.kind === 'user' &&
      catalog.defaultProfileRef.profileId === profileId
    ) {
      catalog.defaultProfileRef = blankFolderProfileRef();
    }
    this.writeCatalog(catalog);
  }

  /** Sets the canonical unified default reference (blank | factory | user). */
  public setDefaultProfileRef(ref: FolderProfileRef): FolderProfileCatalog {
    const catalog = this.readCatalog();
    this.assertValidDefaultRef(catalog, ref);
    catalog.defaultProfileRef = ref;
    this.writeCatalog(catalog, ref.kind === 'blank');
    this.mirrorCanonicalDefault(catalog, ref);
    return catalog;
  }

  public setDefaultFactoryProfile(factoryProfileKey: string): FolderProfileCatalog {
    return this.setDefaultProfileRef({ kind: 'factory', factoryProfileKey });
  }

  public setDefaultBlank(): FolderProfileCatalog {
    return this.setDefaultProfileRef(blankFolderProfileRef());
  }

  /** Legacy compatibility entry point: canonical user default by UUID. */
  public setDefaultProfile(profileId: string): FolderProfileCatalog {
    return this.setDefaultProfileRef({ kind: 'user', profileId });
  }

  /** Legacy compatibility entry point: clears the canonical default to blank. */
  public clearDefaultProfile(): FolderProfileCatalog {
    return this.setDefaultBlank();
  }

  /** Legacy user-profile default view (null for blank/factory). */
  public getDefaultProfile(): FolderProfile | null {
    const catalog = this.readCatalog();
    const defaultRef = catalog.defaultProfileRef;
    if (defaultRef.kind !== 'user') {
      return null;
    }
    return (
      catalog.profiles.find((candidate) => candidate.profileId === defaultRef.profileId) ?? null
    );
  }

  /**
   * Resolves the default for legacy consumers. The canonical default wins when
   * present (including explicit blank). When an existing installation has no
   * canonical default, the legacy name-based setting is accepted as
   * compatibility evidence for factory/user refs; a historical-only name is
   * reported as requiring explicit import and never becomes canonical.
   */
  public resolveDefaultCompatibility(): FolderProfileDefaultCompatibility {
    const catalog = this.readCatalog();
    const legacyName = this.store.getSettings().defaultFolderProfile;
    const canonicalRef = catalog.defaultProfileRef;
    if (canonicalRef.kind !== 'blank' || this.store.hasCanonicalDefault()) {
      return {
        canonicalRef,
        effectiveRef: canonicalRef,
        legacyName,
        legacyMatch: 'canonical',
        requiresImport: false,
      };
    }
    const factory = builtInFolderProfiles.find(
      (profile) => profile.name.toLowerCase() === legacyName.toLowerCase(),
    );
    if (factory?.factoryProfileKey) {
      return {
        canonicalRef,
        effectiveRef: { kind: 'factory', factoryProfileKey: factory.factoryProfileKey },
        legacyName,
        legacyMatch: 'factory',
        requiresImport: false,
      };
    }
    const user = catalog.profiles.find(
      (profile) => normalizeProfileName(profile.name) === normalizeProfileName(legacyName),
    );
    if (user) {
      return {
        canonicalRef,
        effectiveRef: { kind: 'user', profileId: user.profileId },
        legacyName,
        legacyMatch: 'user',
        requiresImport: false,
      };
    }
    if (this.store.readHistoricalFolderProfile(legacyName)) {
      return {
        canonicalRef,
        effectiveRef: blankFolderProfileRef(),
        legacyName,
        legacyMatch: 'legacy',
        requiresImport: true,
      };
    }
    return {
      canonicalRef,
      effectiveRef: blankFolderProfileRef(),
      legacyName,
      legacyMatch: 'unknown',
      requiresImport: false,
    };
  }

  /**
   * Imports one historical custom_folder_profiles row into the canonical
   * catalog. The historical row stays read-only; imported profiles receive
   * fresh canonical identities and no factory output defaults are invented.
   */
  public importLegacyProfile(name: string): FolderProfile {
    const catalog = this.readCatalog();
    const normalized = normalizeProfileName(name);
    if (catalog.profiles.some((profile) => normalizeProfileName(profile.name) === normalized)) {
      throw new DomainError(
        'CONFLICT',
        'A folder profile with this name already exists in the catalog.',
        409,
      );
    }
    const historical = this.store.readHistoricalFolderProfile(name);
    if (!historical) {
      throw new DomainError('NOT_FOUND', 'Historical legacy profile not found.', 404);
    }
    const draft = presetToFolderProfileDraft(
      {
        name: historical.name,
        description: historical.description,
        folders: historical.folders,
        outputFolders: historical.outputFolders,
      },
      null,
    );
    const profile = buildFolderProfile(
      draft,
      new Map(),
      randomUUID,
      new Date().toISOString(),
      randomUUID(),
    );
    catalog.profiles.push(profile);
    this.writeCatalog(catalog);
    return profile;
  }

  public instantiateProfile(profileId: string): ProfileInstantiationResult {
    return instantiateFolderProfile(this.getProfile(profileId), randomUUID);
  }

  private readCatalog(): FolderProfileCatalog {
    return this.store.readFolderProfileCatalog();
  }

  private writeCatalog(catalog: FolderProfileCatalog, persistBlankDefault = false): void {
    this.store.writeFolderProfileCatalog(catalog, persistBlankDefault);
  }

  private assertValidDefaultRef(catalog: FolderProfileCatalog, ref: FolderProfileRef): void {
    if (
      ref.kind === 'user' &&
      !catalog.profiles.some((profile) => profile.profileId === ref.profileId)
    ) {
      throw new DomainError('NOT_FOUND', 'Folder profile not found.', 404);
    }
    validateFolderProfileRef(ref, {
      profileIds: new Set(catalog.profiles.map((profile) => profile.profileId)),
      factoryKeys: new Set(
        builtInFolderProfiles
          .map((profile) => profile.factoryProfileKey)
          .filter((key): key is string => typeof key === 'string' && key.length > 0),
      ),
    });
  }

  private mirrorCanonicalDefault(catalog: FolderProfileCatalog, ref: FolderProfileRef): void {
    if (ref.kind === 'user') {
      const profile = catalog.profiles.find((candidate) => candidate.profileId === ref.profileId);
      if (profile) this.store.mirrorDefaultFolderProfile(profile.name);
    } else if (ref.kind === 'factory') {
      const factory = builtInFolderProfiles.find(
        (profile) => profile.factoryProfileKey === ref.factoryProfileKey,
      );
      if (factory) this.store.mirrorDefaultFolderProfile(factory.name);
    }
  }

  private assertUniqueName(
    catalog: FolderProfileCatalog,
    name: string,
    excludeProfileId?: string,
  ): void {
    const normalized = normalizeProfileName(name);
    const conflict = catalog.profiles.some(
      (profile) =>
        profile.profileId !== excludeProfileId && normalizeProfileName(profile.name) === normalized,
    );
    if (conflict) {
      throw new DomainError('CONFLICT', 'A folder profile with this name already exists.', 409);
    }
  }

  private uniqueDuplicateName(catalog: FolderProfileCatalog, sourceName: string): string {
    const base = `${sourceName} Copy`;
    let candidate = base;
    let suffix = 2;
    while (
      catalog.profiles.some(
        (profile) => normalizeProfileName(profile.name) === normalizeProfileName(candidate),
      )
    ) {
      candidate = `${base} ${suffix}`;
      suffix += 1;
    }
    return candidate;
  }
}
