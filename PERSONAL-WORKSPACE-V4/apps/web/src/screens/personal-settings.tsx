import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Building2,
  Copy,
  DatabaseBackup,
  Download,
  Eye,
  FolderCog,
  Image,
  Layers,
  LoaderCircle,
  Moon,
  Pencil,
  Plus,
  Save,
  ShieldCheck,
  Sun,
  ToggleLeft,
  ToggleRight,
  Trash2,
  X,
} from 'lucide-react';
import {
  luminaireInputModeOptions,
  type FolderProfile,
  type FolderProfilePreset,
  type FolderProfileRef,
  type LuminaireInputMode,
  type ProjectType,
} from '@scli/domain';
import { AnimatePresence, motion } from 'motion/react';
import { api } from '../api';
import { useAppContext } from '../app-context';
import { useToast } from '../components/toast';
import { ErrorState, LoadingState, PageHeader } from '../components/ui';
import {
  FolderProfilePreview,
  FolderProfileTemplateEditor,
  canonicalProfileToTemplateDraft,
  type FolderProfileTemplateDraft,
  type ProfileTemplateNode,
  type ProfileTemplateOutputDraft,
} from '../components/folder-structure-editor';
import { desktop } from '../desktop';

type DrawerKind = 'preview' | 'editor';
type EditorMode = 'create' | 'edit';

interface ActivePreview {
  profile: FolderProfilePreset;
  sourceClass: 'Factory' | 'User' | 'Legacy';
  canonicalProfile?: FolderProfile;
}

interface ActiveEditor {
  mode: EditorMode;
  profileId: string | null;
  sourcePreset?: FolderProfilePreset;
  sourceProfile?: FolderProfile;
  presetName?: string;
}

export function PersonalSettingsScreen() {
  const { themePreference, setThemePreference } = useAppContext();
  const { showToast } = useToast();
  const queryClient = useQueryClient();
  const settingsQuery = useQuery({
    queryKey: ['personal-settings'],
    queryFn: api.personalSettings,
  });
  const profilesQuery = useQuery({ queryKey: ['folder-profiles'], queryFn: api.folderProfiles });
  const catalogQuery = useQuery({
    queryKey: ['folder-profile-catalog'],
    queryFn: api.folderProfileCatalog,
  });
  const backupsQuery = useQuery({ queryKey: ['backups'], queryFn: api.backups });
  const typesQuery = useQuery({
    queryKey: ['personal-project-types'],
    queryFn: api.personalProjectTypes,
  });

  const [form, setForm] = useState({
    projectRoot: '',
    defaultFolderProfile: '',
    defaultInputMode: 'Later' as LuminaireInputMode,
    autoOpenProjectFolder: true,
    designerName: 'Mohamed',
    companyName: 'SCIENTECHNIC',
    companyLogoPath: '',
    accentColor: '#008C95',
    timeZone: 'Asia/Dubai',
    backupRetention: 20,
  });

  useEffect(() => {
    if (!settingsQuery.data) return;
    setForm({
      projectRoot: settingsQuery.data.projectRoot,
      defaultFolderProfile: settingsQuery.data.defaultFolderProfile,
      defaultInputMode: settingsQuery.data.defaultInputMode,
      autoOpenProjectFolder: settingsQuery.data.autoOpenProjectFolder,
      designerName: settingsQuery.data.designerName,
      companyName: settingsQuery.data.companyName,
      companyLogoPath: settingsQuery.data.companyLogoPath,
      accentColor: settingsQuery.data.accentColor,
      timeZone: settingsQuery.data.timeZone,
      backupRetention: settingsQuery.data.backupRetention,
    });
  }, [settingsQuery.data]);

  const [activeDrawer, setActiveDrawer] = useState<DrawerKind | null>(null);
  const [activePreview, setActivePreview] = useState<ActivePreview | null>(null);
  const [activeEditor, setActiveEditor] = useState<ActiveEditor | null>(null);
  const [duplicateTarget, setDuplicateTarget] = useState<FolderProfilePreset | null>(null);
  const [importTarget, setImportTarget] = useState<FolderProfilePreset | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<FolderProfile | null>(null);
  const [typesDraft, setTypesDraft] = useState<ProjectType[]>([]);
  const [newTypeName, setNewTypeName] = useState('');
  const [typeError, setTypeError] = useState<string | null>(null);

  useEffect(() => {
    if (typesQuery.data) setTypesDraft(typesQuery.data);
  }, [typesQuery.data]);

  const saveMutation = useMutation({
    mutationFn: () => {
      const { defaultFolderProfile, ...rest } = form;
      void defaultFolderProfile;
      return api.updatePersonalSettings(rest);
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['personal-settings'] });
      showToast('Personal workspace settings saved.');
    },
    onError: (error) =>
      showToast(error instanceof Error ? error.message : 'Settings could not be saved.', 'error'),
  });
  const backupMutation = useMutation({
    mutationFn: api.createBackup,
    onSuccess: async (result) => {
      void navigator.clipboard.writeText(result.backupPath);
      await queryClient.invalidateQueries({ queryKey: ['backups'] });
      showToast('Backup created and its path copied.');
    },
    onError: (error) =>
      showToast(error instanceof Error ? error.message : 'Backup failed.', 'error'),
  });
  const restoreMutation = useMutation({
    mutationFn: api.restoreBackup,
    onSuccess: async () => {
      showToast('Backup validated. Restarting SCT Workspace to restore it.');
      if (desktop.available()) await desktop.restart();
    },
    onError: (error) => showToast((error as Error).message, 'error'),
  });

  const setDefaultMutation = useMutation({
    mutationFn: api.setFolderProfileDefault,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['folder-profile-catalog'] });
      await queryClient.invalidateQueries({ queryKey: ['personal-settings'] });
      showToast('Default folder profile updated.');
    },
    onError: (error) =>
      showToast(error instanceof Error ? error.message : 'Default could not be updated.', 'error'),
  });
  const createMutation = useMutation({
    mutationFn: api.createFolderProfile,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['folder-profiles'] });
      await queryClient.invalidateQueries({ queryKey: ['folder-profile-catalog'] });
      setActiveEditor(null);
      setActiveDrawer(null);
      showToast('Folder profile created.');
    },
    onError: (error) =>
      showToast(error instanceof Error ? error.message : 'Profile could not be created.', 'error'),
  });
  const updateMutation = useMutation({
    mutationFn: (vars: {
      profileId: string;
      body: Parameters<typeof api.updateFolderProfile>[1];
    }) => api.updateFolderProfile(vars.profileId, vars.body),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['folder-profiles'] });
      await queryClient.invalidateQueries({ queryKey: ['folder-profile-catalog'] });
      setActiveEditor(null);
      setActiveDrawer(null);
      showToast('Folder profile saved.');
    },
    onError: (error) =>
      showToast(error instanceof Error ? error.message : 'Profile could not be saved.', 'error'),
  });
  const deleteMutation = useMutation({
    mutationFn: api.deleteFolderProfile,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['folder-profiles'] });
      await queryClient.invalidateQueries({ queryKey: ['folder-profile-catalog'] });
      setDeleteTarget(null);
      showToast('Folder profile deleted.');
    },
    onError: (error) =>
      showToast(error instanceof Error ? error.message : 'Profile could not be deleted.', 'error'),
  });
  const importMutation = useMutation({
    mutationFn: api.importLegacyFolderProfile,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['folder-profiles'] });
      await queryClient.invalidateQueries({ queryKey: ['folder-profile-catalog'] });
      setImportTarget(null);
      showToast('Legacy profile imported.');
    },
    onError: (error) =>
      showToast(error instanceof Error ? error.message : 'Import failed.', 'error'),
  });

  const typesMutation = useMutation({
    mutationFn: api.updatePersonalProjectTypes,
    onSuccess: async (saved) => {
      setTypesDraft(saved);
      await queryClient.invalidateQueries({ queryKey: ['personal-project-types'] });
      await queryClient.invalidateQueries({ queryKey: ['project-types'] });
      showToast('Project types saved.');
    },
    onError: (error) =>
      showToast(
        error instanceof Error ? error.message : 'Project types could not be saved.',
        'error',
      ),
  });

  const updateType = (id: string, patch: Partial<ProjectType>) =>
    setTypesDraft((current) =>
      current.map((type) =>
        type.id === id ? { ...type, ...patch, updatedAt: new Date().toISOString() } : type,
      ),
    );

  // P2.9A-H1 — central catalogue invariant: at least one active type and no
  // case-insensitive duplicate names (across active AND inactive entries).
  const validateTypesDraft = (draft: ProjectType[]): string | null => {
    const activeCount = draft.filter((type) => type.isActive).length;
    if (activeCount === 0) return 'At least one project type must remain active.';
    const seen = new Set<string>();
    for (const type of draft) {
      const normalized = type.name.trim().toLowerCase();
      if (seen.has(normalized)) return 'Project type names must be unique.';
      seen.add(normalized);
    }
    return null;
  };

  const addType = () => {
    const name = newTypeName.trim();
    if (!name) {
      setTypeError('Project type name is required.');
      return;
    }
    const normalized = name.toLowerCase();
    if (typesDraft.some((type) => type.name.toLowerCase() === normalized)) {
      setTypeError('That project type already exists.');
      return;
    }
    const now = new Date().toISOString();
    setTypesDraft((current) => [
      ...current,
      { id: crypto.randomUUID(), name, isActive: true, createdAt: now, updatedAt: now },
    ]);
    setNewTypeName('');
    setTypeError(null);
  };

  const deactivateType = (id: string) => {
    const activeCount = typesDraft.filter((type) => type.isActive).length;
    const target = typesDraft.find((type) => type.id === id);
    if (target?.isActive && activeCount <= 1) {
      setTypeError('At least one project type must remain active.');
      return;
    }
    setTypeError(null);
    updateType(id, { isActive: !target?.isActive });
  };

  const saveTypes = () => {
    const error = validateTypesDraft(typesDraft);
    if (error) {
      setTypeError(error);
      return;
    }
    setTypeError(null);
    typesMutation.mutate(typesDraft);
  };

  const factories = useMemo(
    () => profilesQuery.data?.filter((p) => p.source === 'factory') ?? [],
    [profilesQuery.data],
  );
  const userPresets = useMemo(
    () => profilesQuery.data?.filter((p) => p.source === 'user') ?? [],
    [profilesQuery.data],
  );
  const legacyPresets = useMemo(
    () => profilesQuery.data?.filter((p) => p.source === 'legacy') ?? [],
    [profilesQuery.data],
  );

  const canonicalDefault = catalogQuery.data?.defaultProfileRef;

  const profilePresetById = useMemo(() => {
    const map = new Map<string, FolderProfilePreset>();
    for (const preset of userPresets) if (preset.profileId) map.set(preset.profileId, preset);
    return map;
  }, [userPresets]);

  const selectRefValue = (ref: FolderProfileRef): string => {
    if (ref.kind === 'blank') return 'blank';
    if (ref.kind === 'factory') return `factory:${ref.factoryProfileKey}`;
    return `user:${ref.profileId}`;
  };

  const handleDefaultChange = (value: string) => {
    if (value === 'blank') {
      setDefaultMutation.mutate({ kind: 'blank' });
      return;
    }
    if (value.startsWith('factory:')) {
      setDefaultMutation.mutate({
        kind: 'factory',
        factoryProfileKey: value.slice('factory:'.length),
      });
      return;
    }
    const profileId = value.startsWith('user:') ? value.slice('user:'.length) : value;
    setDefaultMutation.mutate({ kind: 'user', profileId });
  };

  const openPreview = (preset: FolderProfilePreset, sourceClass: ActivePreview['sourceClass']) => {
    const canonicalProfile = preset.profileId
      ? catalogQuery.data?.profiles.find((candidate) => candidate.profileId === preset.profileId)
      : undefined;
    setActivePreview({
      profile: preset,
      sourceClass,
      ...(canonicalProfile ? { canonicalProfile } : {}),
    });
    setActiveDrawer('preview');
  };

  const openEditor = (
    mode: EditorMode,
    profileId: string | null,
    sourcePreset?: FolderProfilePreset,
    presetName?: string,
    sourceProfile?: FolderProfile,
  ) => {
    setActiveEditor({
      mode,
      profileId,
      ...(sourcePreset !== undefined ? { sourcePreset } : {}),
      ...(presetName !== undefined ? { presetName } : {}),
      ...(sourceProfile !== undefined ? { sourceProfile } : {}),
    });
    setActiveDrawer('editor');
  };

  const openCreateFrom = (sourcePreset: FolderProfilePreset) => {
    setDuplicateTarget(sourcePreset);
  };

  const handleDuplicateConfirm = (name: string, source: FolderProfilePreset) => {
    setDuplicateTarget(null);
    const canonicalProfile = source.profileId
      ? catalogQuery.data?.profiles.find((candidate) => candidate.profileId === source.profileId)
      : undefined;
    openEditor('create', null, source, name, canonicalProfile ?? undefined);
  };

  if (
    settingsQuery.isLoading ||
    profilesQuery.isLoading ||
    catalogQuery.isLoading ||
    typesQuery.isLoading
  )
    return <LoadingState label="Opening personal settings…" />;
  if (settingsQuery.error || profilesQuery.error || catalogQuery.error || typesQuery.error)
    return (
      <ErrorState
        message={
          (
            settingsQuery.error ??
            profilesQuery.error ??
            catalogQuery.error ??
            (typesQuery.error as Error)
          ).message
        }
      />
    );

  const selectedProfile = profilePresetById.get(
    canonicalDefault?.kind === 'user' ? canonicalDefault.profileId : '',
  );

  return (
    <>
      <PageHeader
        eyebrow="Personal workspace"
        title="Settings"
        description="Configure the local workspace, project folders and appearance. Every project can still override its own folder structure."
      />
      <div className="settings-personal-grid">
        <section className="content-card">
          <div className="settings-card-title">
            <Building2 />
            <div>
              <h2>Identity & branding</h2>
              <p>Used by your personal workspace and future output templates.</p>
            </div>
          </div>
          <div className="settings-fields">
            <label className="field">
              Designer Name
              <input
                value={form.designerName}
                onChange={(event) => setForm({ ...form, designerName: event.target.value })}
              />
            </label>
            <label className="field">
              Company Name
              <input
                value={form.companyName}
                onChange={(event) => setForm({ ...form, companyName: event.target.value })}
              />
            </label>
            <label className="field field-wide">
              Company Logo
              <span className="field-path-control">
                <input
                  value={form.companyLogoPath}
                  onChange={(event) => setForm({ ...form, companyLogoPath: event.target.value })}
                  placeholder="PNG or JPG logo path"
                />
                <button
                  className="button secondary"
                  type="button"
                  onClick={async () => {
                    const selected = await desktop.selectFile([
                      { name: 'Logo images', extensions: ['png', 'jpg', 'jpeg', 'webp'] },
                    ]);
                    if (selected) setForm({ ...form, companyLogoPath: selected });
                  }}
                >
                  <Image /> Browse
                </button>
              </span>
            </label>
            <label className="field">
              Brand Color
              <span className="brand-color-control">
                <input
                  type="color"
                  value={form.accentColor}
                  onChange={(event) => setForm({ ...form, accentColor: event.target.value })}
                />
                <input
                  value={form.accentColor}
                  onChange={(event) => setForm({ ...form, accentColor: event.target.value })}
                />
              </span>
            </label>
            <label className="field">
              Time Zone
              <select
                value={form.timeZone}
                onChange={(event) => setForm({ ...form, timeZone: event.target.value })}
              >
                <option value="Asia/Dubai">Asia/Dubai</option>
                <option value="Asia/Riyadh">Asia/Riyadh</option>
                <option value="Africa/Cairo">Africa/Cairo</option>
                <option value="Europe/London">Europe/London</option>
              </select>
            </label>
            <label className="field">
              Backup Retention
              <input
                type="number"
                min="3"
                max="100"
                value={form.backupRetention}
                onChange={(event) =>
                  setForm({ ...form, backupRetention: Number(event.target.value) })
                }
              />
              <small>Number of recent automatic backups to retain.</small>
            </label>
          </div>
        </section>

        <section className="content-card">
          <div className="settings-card-title">
            <FolderCog />
            <div>
              <h2>Project folders</h2>
              <p>Default root for new project workspaces.</p>
            </div>
          </div>
          <div className="settings-fields">
            <label className="field field-wide">
              Projects Root Folder
              <span className="field-path-control">
                <input
                  value={form.projectRoot}
                  onChange={(event) => setForm({ ...form, projectRoot: event.target.value })}
                  placeholder="e.g. D:\\SCT PROJECTS"
                />
                <button
                  className="button secondary"
                  type="button"
                  onClick={async () => {
                    const selected = await desktop.selectFolder();
                    if (selected) setForm({ ...form, projectRoot: selected });
                  }}
                >
                  Browse
                </button>
              </span>
              <small>
                {desktop.available()
                  ? 'Choose the folder that contains SCT and legacy SCLI projects.'
                  : 'Enter the full path. Browse is available in the desktop app.'}
              </small>
            </label>
            <label className="field">
              Default Luminaire Input
              <span className="select-wrap">
                <select
                  value={form.defaultInputMode}
                  onChange={(event) =>
                    setForm({ ...form, defaultInputMode: event.target.value as LuminaireInputMode })
                  }
                >
                  {luminaireInputModeOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </span>
            </label>
            <label
              className="toggle-row field-wide"
              aria-label="Open project folder after creation"
            >
              <input
                type="checkbox"
                checked={form.autoOpenProjectFolder}
                onChange={(event) =>
                  setForm({ ...form, autoOpenProjectFolder: event.target.checked })
                }
              />
              <span>
                <strong>Open project folder after creation</strong>
                <small>Applied by the portable desktop version.</small>
              </span>
            </label>
          </div>
          {selectedProfile ? (
            <div className="folder-preview">
              <FolderCog />
              <div>
                <strong>{selectedProfile.name}</strong>
                <p>{selectedProfile.description}</p>
                <div>
                  {selectedProfile.folders.map((folder) => (
                    <span key={folder.name}>{folder.name}</span>
                  ))}
                </div>
              </div>
            </div>
          ) : null}
        </section>

        <section className="content-card">
          <div className="settings-card-title">
            <Layers />
            <div>
              <h2>Project Types</h2>
              <p>
                Active types appear in the New Project form. Deactivating a type only affects future
                selection — existing projects keep their stored type.
              </p>
            </div>
          </div>
          <div className="project-type-list">
            {typesDraft.map((type) => (
              <div className="project-type-row" key={type.id}>
                <input
                  value={type.name}
                  onChange={(event) => updateType(type.id, { name: event.target.value })}
                  aria-label={`Project type ${type.name}`}
                />
                <button
                  className={type.isActive ? 'toggle-button active' : 'toggle-button'}
                  type="button"
                  onClick={() => deactivateType(type.id)}
                  aria-pressed={type.isActive}
                >
                  {type.isActive ? <ToggleRight size={24} /> : <ToggleLeft size={24} />}
                  {type.isActive ? 'Active' : 'Inactive'}
                </button>
              </div>
            ))}
          </div>
          <form
            className="add-type-form"
            onSubmit={(event) => {
              event.preventDefault();
              addType();
            }}
          >
            <input
              value={newTypeName}
              onChange={(event) => setNewTypeName(event.target.value)}
              placeholder="New project type"
              maxLength={80}
              aria-label="New project type name"
            />
            <button className="button secondary" type="submit">
              <Plus /> Add type
            </button>
          </form>
          {typeError ? (
            <p className="form-error" role="alert">
              {typeError}
            </p>
          ) : null}
          <div className="settings-save-row">
            <button
              className="button primary"
              type="button"
              disabled={typesMutation.isPending}
              onClick={saveTypes}
            >
              {typesMutation.isPending ? <LoaderCircle className="spin" /> : <Save />} Save Project
              Types
            </button>
          </div>
        </section>

        <section className="content-card settings-profiles-card">
          <div className="settings-card-title">
            <Layers />
            <div>
              <h2>Folder Profiles</h2>
              <p>Templates used when creating new projects.</p>
            </div>
          </div>

          <div className="profile-default-section">
            <div className="profile-default-heading">
              <strong>Default</strong>
              <small>Applied to new projects that do not override it.</small>
            </div>
            <span className="select-wrap">
              <select
                aria-label="Default folder profile"
                value={canonicalDefault ? selectRefValue(canonicalDefault) : ''}
                disabled={setDefaultMutation.isPending}
                onChange={(event) => handleDefaultChange(event.target.value)}
              >
                <option value="blank">Blank</option>
                {factories.map((factory) => (
                  <option
                    key={factory.factoryProfileKey ?? factory.name}
                    value={factory.factoryProfileKey ? `factory:${factory.factoryProfileKey}` : ''}
                  >
                    {factory.name}
                  </option>
                ))}
                {userPresets.map((preset) => (
                  <option
                    key={preset.profileId}
                    value={preset.profileId ? `user:${preset.profileId}` : ''}
                  >
                    {preset.name}
                  </option>
                ))}
              </select>
            </span>
          </div>

          <div className="profile-list-section">
            <div className="profile-list-heading">
              <strong>Factory profiles</strong>
              <small>Read-only built-in templates.</small>
            </div>
            {factories.length ? (
              factories.map((factory) => (
                <ProfileRow
                  key={factory.factoryProfileKey ?? factory.name}
                  name={factory.name}
                  description={factory.description}
                  actions={
                    <>
                      <button
                        className="button ghost"
                        type="button"
                        onClick={() => openPreview(factory, 'Factory')}
                      >
                        <Eye /> Preview
                      </button>
                      <button
                        className="button ghost"
                        type="button"
                        onClick={() => openCreateFrom(factory)}
                      >
                        <Copy /> Duplicate
                      </button>
                      <button
                        className="button ghost"
                        type="button"
                        disabled={setDefaultMutation.isPending}
                        onClick={() =>
                          factory.factoryProfileKey &&
                          setDefaultMutation.mutate({
                            kind: 'factory',
                            factoryProfileKey: factory.factoryProfileKey,
                          })
                        }
                      >
                        Set as Default
                      </button>
                    </>
                  }
                />
              ))
            ) : (
              <p className="profile-empty-note">No factory profiles.</p>
            )}
          </div>

          <div className="profile-list-section">
            <div className="profile-list-heading">
              <strong>My profiles</strong>
              <small>Editable canonical templates.</small>
              <button
                className="button secondary profile-new-button"
                type="button"
                onClick={() => openEditor('create', null)}
              >
                <Plus /> New Profile
              </button>
            </div>
            {userPresets.length ? (
              userPresets.map((preset) => (
                <ProfileRow
                  key={preset.profileId}
                  name={preset.name}
                  description={preset.description}
                  actions={
                    <>
                      <button
                        className="button ghost"
                        type="button"
                        onClick={() => openPreview(preset, 'User')}
                      >
                        <Eye /> Preview
                      </button>
                      <button
                        className="button ghost"
                        type="button"
                        onClick={() => preset.profileId && openEditor('edit', preset.profileId)}
                      >
                        <Pencil /> Edit
                      </button>
                      <button
                        className="button ghost"
                        type="button"
                        onClick={() => preset.profileId && openCreateFrom(preset)}
                      >
                        <Copy /> Duplicate
                      </button>
                      <button
                        className="button ghost"
                        type="button"
                        disabled={setDefaultMutation.isPending}
                        onClick={() =>
                          preset.profileId &&
                          setDefaultMutation.mutate({ kind: 'user', profileId: preset.profileId })
                        }
                      >
                        Set as Default
                      </button>
                      <button
                        className="button ghost-danger"
                        type="button"
                        onClick={() => {
                          const canonical = catalogQuery.data?.profiles.find(
                            (p) => p.profileId === preset.profileId,
                          );
                          if (canonical) setDeleteTarget(canonical);
                        }}
                      >
                        <Trash2 /> Delete
                      </button>
                    </>
                  }
                />
              ))
            ) : (
              <p className="profile-empty-note">No user profiles yet. Create one above.</p>
            )}
          </div>

          <div className="profile-list-section">
            <div className="profile-list-heading">
              <strong>Legacy profiles</strong>
              <small>Historical templates not yet imported.</small>
            </div>
            {legacyPresets.length ? (
              legacyPresets.map((legacy) => (
                <ProfileRow
                  key={legacy.name}
                  name={legacy.name}
                  description={legacy.description}
                  actions={
                    <>
                      <button
                        className="button ghost"
                        type="button"
                        onClick={() => openPreview(legacy, 'Legacy')}
                      >
                        <Eye /> Preview
                      </button>
                      <button
                        className="button ghost"
                        type="button"
                        onClick={() => setImportTarget(legacy)}
                      >
                        <Download /> Import
                      </button>
                    </>
                  }
                />
              ))
            ) : (
              <p className="profile-empty-note">No legacy profiles available.</p>
            )}
          </div>
        </section>

        <section className="content-card">
          <div className="settings-card-title">
            <ShieldCheck />
            <div>
              <h2>Workspace preferences</h2>
              <p>Light is the default. Switch modes here or from the top bar with one click.</p>
            </div>
          </div>
          <div className="appearance-choice" role="group" aria-label="Workspace appearance">
            <button
              type="button"
              className={`button ${themePreference === 'light' ? 'primary' : 'secondary'}`}
              onClick={() => setThemePreference('light')}
            >
              <Sun /> Light
            </button>
            <button
              type="button"
              className={`button ${themePreference === 'dark' ? 'primary' : 'secondary'}`}
              onClick={() => setThemePreference('dark')}
            >
              <Moon /> Dark
            </button>
          </div>
          <div className="backup-card">
            <DatabaseBackup />
            <div>
              <strong>Local database backup</strong>
              <span>
                Creates a complete SQLite snapshot of projects, deliverables, luminaires and
                revisions.
              </span>
            </div>
            <button
              className="button secondary"
              type="button"
              disabled={backupMutation.isPending}
              onClick={() => backupMutation.mutate()}
            >
              {backupMutation.isPending ? <LoaderCircle className="spin" /> : <DatabaseBackup />}{' '}
              Create Backup
            </button>
          </div>
          {backupsQuery.data?.length ? (
            <div className="backup-history-list">
              {backupsQuery.data.slice(0, 5).map((backup) => (
                <div className="backup-history-item" key={backup.filePath}>
                  <DatabaseBackup />
                  <span>
                    <strong>{backup.reason}</strong>
                    <small>
                      {new Date(backup.createdAt).toLocaleString('en-AE')} ·{' '}
                      {(backup.sizeBytes / 1_048_576).toFixed(1)} MB
                    </small>
                  </span>
                  <div className="row-actions">
                    <button
                      className="button ghost"
                      type="button"
                      onClick={() => void desktop.openPath(backup.filePath)}
                    >
                      Open
                    </button>
                    <button
                      className="button ghost-danger"
                      type="button"
                      disabled={restoreMutation.isPending}
                      onClick={() => {
                        if (
                          window.confirm(
                            'Restore this complete workspace backup? The current database will be backed up first and the app will restart.',
                          )
                        ) {
                          restoreMutation.mutate(backup.filePath);
                        }
                      }}
                    >
                      Restore
                    </button>
                  </div>
                </div>
              ))}
            </div>
          ) : null}
        </section>

        <footer className="settings-save-bar">
          <span>Defaults never lock a project — every option stays editable.</span>
          <button
            className="button primary"
            type="button"
            disabled={saveMutation.isPending}
            onClick={() => saveMutation.mutate()}
          >
            {saveMutation.isPending ? <LoaderCircle className="spin" /> : <Save />} Save Settings
          </button>
        </footer>
      </div>

      {activeDrawer === 'preview' && activePreview ? (
        <ProfilePreviewDrawer
          preview={activePreview}
          onClose={() => {
            setActiveDrawer(null);
            setActivePreview(null);
          }}
        />
      ) : null}

      {activeDrawer === 'editor' && activeEditor ? (
        <ProfileEditorDrawer
          editor={activeEditor}
          existingProfile={
            activeEditor.mode === 'edit'
              ? (catalogQuery.data?.profiles.find((p) => p.profileId === activeEditor.profileId) ??
                null)
              : null
          }
          creating={createMutation.isPending}
          saving={updateMutation.isPending}
          onSave={(draft) => {
            if (activeEditor.mode === 'create') {
              createMutation.mutate(profileDraftToCreate(draft));
            } else if (activeEditor.profileId) {
              updateMutation.mutate({
                profileId: activeEditor.profileId,
                body: profileDraftToUpdate(draft),
              });
            }
          }}
          onClose={() => {
            setActiveDrawer(null);
            setActiveEditor(null);
          }}
        />
      ) : null}

      {duplicateTarget ? (
        <DuplicateDialog
          source={duplicateTarget}
          onCancel={() => setDuplicateTarget(null)}
          onConfirm={handleDuplicateConfirm}
        />
      ) : null}

      {importTarget ? (
        <ConfirmDialog
          title={`Import "${importTarget.name}"?`}
          message="This will create an editable canonical profile. The historical profile will remain preserved."
          confirmLabel="Import"
          busy={importMutation.isPending}
          onConfirm={() => importMutation.mutate(importTarget.name)}
          onCancel={() => setImportTarget(null)}
        />
      ) : null}

      {deleteTarget ? (
        <ConfirmDialog
          title={`Delete "${deleteTarget.name}"?`}
          message="This removes the template profile. Existing projects and physical folders are not affected."
          confirmLabel="Delete Profile"
          danger
          busy={deleteMutation.isPending}
          onConfirm={() => deleteMutation.mutate(deleteTarget.profileId)}
          onCancel={() => setDeleteTarget(null)}
        />
      ) : null}
    </>
  );
}

function ProfileRow({
  name,
  description,
  actions,
}: {
  name: string;
  description: string;
  actions: React.ReactNode;
}) {
  return (
    <div className="profile-row">
      <div className="profile-row-info">
        <strong>{name}</strong>
        {description ? <p>{description}</p> : null}
      </div>
      <div className="row-actions profile-row-actions">{actions}</div>
    </div>
  );
}

function ProfilePreviewDrawer({
  preview,
  onClose,
}: {
  preview: ActivePreview;
  onClose: () => void;
}) {
  return (
    <AnimatePresence>
      <motion.button
        className="drawer-backdrop"
        type="button"
        aria-label="Close profile preview"
        onClick={onClose}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
      />
      <motion.aside
        className="assignment-drawer profile-drawer"
        role="dialog"
        aria-modal="true"
        aria-label="Profile preview"
        initial={{ x: '100%' }}
        animate={{ x: 0 }}
        exit={{ x: '100%' }}
        transition={{ duration: 0.24 }}
      >
        <header className="drawer-header">
          <div>
            <h2>Profile preview</h2>
            <p>Read-only view — no project files are changed.</p>
          </div>
          <button className="icon-button" type="button" aria-label="Close" onClick={onClose}>
            <X size={18} />
          </button>
        </header>
        <div className="drawer-body">
          <FolderProfilePreview
            profile={preview.profile}
            sourceClass={preview.sourceClass}
            outputDefaults={
              preview.canonicalProfile
                ? canonicalProfileToTemplateDraft(preview.canonicalProfile).outputDefaults
                : previewToOutputDrafts(preview.profile)
            }
          />
        </div>
        <footer className="drawer-footer">
          <button className="button ghost" type="button" onClick={onClose}>
            Close
          </button>
        </footer>
      </motion.aside>
    </AnimatePresence>
  );
}

function ProfileEditorDrawer({
  editor,
  existingProfile,
  creating,
  saving,
  onSave,
  onClose,
}: {
  editor: ActiveEditor;
  existingProfile: FolderProfile | null;
  creating: boolean;
  saving: boolean;
  onSave: (draft: FolderProfileTemplateDraft) => void;
  onClose: () => void;
}) {
  const initialDraft = useMemo<FolderProfileTemplateDraft>(() => {
    if (editor.mode === 'edit' && existingProfile) {
      return canonicalProfileToTemplateDraft(existingProfile);
    }
    if (editor.mode === 'create' && editor.sourceProfile) {
      return {
        ...canonicalProfileToTemplateDraft(editor.sourceProfile),
        name: editor.presetName ?? editor.sourceProfile.name,
      };
    }
    if (editor.sourcePreset) {
      return {
        ...presetToDraft(editor.sourcePreset),
        name: editor.presetName ?? editor.sourcePreset.name,
      };
    }
    return {
      name: '',
      description: '',
      folders: [{ name: '01_INPUT', children: [] }],
      outputDefaults: [],
    };
  }, [editor.mode, editor.sourcePreset, editor.sourceProfile, existingProfile, editor.presetName]);

  const [draft, setDraft] = useState<FolderProfileTemplateDraft>(initialDraft);
  const [dirty, setDirty] = useState(false);
  const [nameError, setNameError] = useState<string | null>(null);

  useEffect(() => {
    setDraft(initialDraft);
    setDirty(false);
    setNameError(null);
  }, [initialDraft]);

  const handleChange = (next: FolderProfileTemplateDraft) => {
    setDraft(next);
    setDirty(true);
    setNameError(null);
  };

  const handleClose = () => {
    if (dirty && !window.confirm('Discard unsaved profile changes?')) return;
    onClose();
  };

  const handleSave = () => {
    if (!draft.name.trim()) {
      setNameError('Profile name is required.');
      return;
    }
    onSave(draft);
  };

  const busy = creating || saving;

  return (
    <AnimatePresence>
      <motion.button
        className="drawer-backdrop"
        type="button"
        aria-label="Close profile editor"
        onClick={handleClose}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
      />
      <motion.aside
        className="assignment-drawer profile-drawer profile-editor-drawer"
        role="dialog"
        aria-modal="true"
        aria-label={editor.mode === 'create' ? 'New folder profile' : 'Edit folder profile'}
        initial={{ x: '100%' }}
        animate={{ x: 0 }}
        exit={{ x: '100%' }}
        transition={{ duration: 0.24 }}
      >
        <header className="drawer-header">
          <div>
            <h2>{editor.mode === 'create' ? 'New Profile' : 'Edit Profile'}</h2>
            <p>Template JSON only — no filesystem changes.</p>
          </div>
          <button className="icon-button" type="button" aria-label="Close" onClick={handleClose}>
            <X size={18} />
          </button>
        </header>
        <div className="drawer-body profile-editor-body">
          <label className="field">
            Profile Name
            <input
              aria-label="Profile name"
              value={draft.name}
              onChange={(event) => handleChange({ ...draft, name: event.target.value })}
              placeholder="e.g. Full Lighting Custom"
            />
            {nameError ? <small className="field-error">{nameError}</small> : null}
          </label>
          <label className="field">
            Description (optional)
            <input
              aria-label="Profile description"
              value={draft.description}
              onChange={(event) => handleChange({ ...draft, description: event.target.value })}
              placeholder="Short description"
            />
          </label>
          <FolderProfileTemplateEditor draft={draft} disabled={busy} onChange={handleChange} />
        </div>
        <footer className="drawer-footer">
          <button className="button ghost" type="button" onClick={handleClose}>
            Cancel
          </button>
          <button className="button primary" type="button" disabled={busy} onClick={handleSave}>
            {busy ? <LoaderCircle className="spin" /> : <Save />} Save
          </button>
        </footer>
      </motion.aside>
    </AnimatePresence>
  );
}

function DuplicateDialog({
  source,
  onCancel,
  onConfirm,
}: {
  source: FolderProfilePreset;
  onCancel: () => void;
  onConfirm: (name: string, source: FolderProfilePreset) => void;
}) {
  const [name, setName] = useState(`${source.name} Custom`);
  const [error, setError] = useState<string | null>(null);

  const handleConfirm = () => {
    if (!name.trim()) {
      setError('A name is required for the duplicate.');
      return;
    }
    onConfirm(name.trim(), source);
  };

  return (
    <ConfirmDialog
      title={`Duplicate "${source.name}"?`}
      message="This creates a new editable canonical profile with its own folder identities and output mappings."
      confirmLabel="Duplicate"
      onConfirm={handleConfirm}
      onCancel={onCancel}
      body={
        <label className="field">
          New Profile Name
          <input
            aria-label="Duplicate profile name"
            value={name}
            onChange={(event) => {
              setName(event.target.value);
              setError(null);
            }}
          />
          {error ? <small className="field-error">{error}</small> : null}
        </label>
      }
    />
  );
}

function ConfirmDialog({
  title,
  message,
  confirmLabel,
  danger,
  busy,
  onConfirm,
  onCancel,
  body,
}: {
  title: string;
  message: string;
  confirmLabel: string;
  danger?: boolean;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  body?: React.ReactNode;
}) {
  return (
    <AnimatePresence>
      <motion.button
        className="drawer-backdrop"
        type="button"
        aria-label="Close dialog"
        onClick={onCancel}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
      />
      <motion.div
        className="confirm-dialog"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        initial={{ opacity: 0, scale: 0.96 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.96 }}
        transition={{ duration: 0.18 }}
      >
        <h3>{title}</h3>
        <p>{message}</p>
        {body}
        <div className="confirm-dialog-actions">
          <button className="button ghost" type="button" onClick={onCancel}>
            Cancel
          </button>
          <button
            className={`button ${danger ? 'danger' : 'primary'}`}
            type="button"
            disabled={busy}
            onClick={onConfirm}
          >
            {busy ? <LoaderCircle className="spin" /> : null} {confirmLabel}
          </button>
        </div>
      </motion.div>
    </AnimatePresence>
  );
}

function previewToOutputDrafts(profile: FolderProfilePreset): ProfileTemplateOutputDraft[] {
  return Object.entries(profile.outputFolders).map(([outputTypeId, destinationPath]) => ({
    outputTypeId,
    destinationPath,
  }));
}

function presetToDraft(preset: FolderProfilePreset): FolderProfileTemplateDraft {
  return {
    name: preset.name,
    description: preset.description,
    folders: preset.folders as ProfileTemplateNode[],
    outputDefaults: previewToOutputDrafts(preset),
  };
}

function stripProfileFolderIds(nodes: ProfileTemplateNode[]): ProfileTemplateNode[] {
  return nodes.map((node) => ({
    name: node.name,
    children: stripProfileFolderIds(node.children),
  }));
}

function profileDraftToCreate(draft: FolderProfileTemplateDraft): {
  name: string;
  description: string;
  folders: ProfileTemplateNode[];
  outputDefaults: ProfileTemplateOutputDraft[];
} {
  return {
    name: draft.name.trim(),
    description: draft.description.trim(),
    folders: stripProfileFolderIds(draft.folders),
    outputDefaults: draft.outputDefaults,
  };
}

function profileDraftToUpdate(draft: FolderProfileTemplateDraft): {
  name: string;
  description: string;
  folders: ProfileTemplateNode[];
  outputDefaults: ProfileTemplateOutputDraft[];
} {
  return {
    name: draft.name.trim(),
    description: draft.description.trim(),
    folders: draft.folders,
    outputDefaults: draft.outputDefaults,
  };
}
