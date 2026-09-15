import { v4Decisions } from '../../components/interaction/V4Decisions';
import { FinalSettingsView } from '../../components/final-ui/FinalSettingsView';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  ArchiveRestore,
  Building2,
  Check,
  ChevronRight,
  Clock3,
  CloudDownload,
  DatabaseBackup,
  Folder,
  FolderCog,
  FolderOpen,
  Image,
  Monitor,
  Moon,
  Palette,
  Plus,
  Save,
  Settings,
  Sun,
  Tags,
  UsersRound,
} from '../../components/common/SctIcons';
import {
  luminaireInputModeOptions,
  type BackupRecord,
  type ActionCategory,
  type PersonalWorkspaceSettings,
} from '@scli/domain';
import { api, apiRequest } from '../../api/environment';
import { formatBusinessDateTime } from '../../date-time/businessDateTime';
import { resolveLuminaireImage, type LocalImageResult } from '../../desktop/localImage';
import { V4PageHeader } from '../../components/common/V4PageHeader';
import { V4Drawer } from '../../components/common/V4Drawer';
import { V4FilterSelect } from '../../components/common/V4FilterSelect';
import { V4FloatingWorkspace } from '../../components/common/V4FloatingWorkspace';
import { V4Pagination } from '../../components/common/V4Pagination';
import { V4ConfirmDialog } from '../../components/common/V4ConfirmDialog';
import { V4Button } from '../../components/common/V4Button';
import { useV4DirtySurface } from '../../components/interaction/V4DirtyGuard';
import { actionCategoryIconFor } from '../../components/common/actionCategoryIconCatalog';
import { V4AppShell } from '../../components/shell/V4AppShell';
import {
  readStoredSidebarMode,
  writeStoredSidebarMode,
  type SidebarMode,
} from '../../components/sidebar/sidebarMode';
import { useV4Theme } from '../../theme/ThemeProvider';
import { applyV4Accent, V4_ACCENT_PRESETS } from '../../theme/V4AccentProvider';
import { ROUTE_DASHBOARD, ROUTE_PROJECTS, ROUTE_SETTINGS } from '../../router/routes';
import {
  ActionCategoriesDrawer,
  FolderProfilesDrawer,
  ProjectTypesDrawer,
  SalesDirectoryDrawer,
} from './SettingsDrawers';
import { IntegrationSettingsSection } from './IntegrationSettingsSection';
import {
  createFolderProfileInput,
  folderRefValue,
  formatBytes,
  initials,
  parseFolderRef,
  updateFolderProfileInput,
  type FolderProfileDraft,
} from './settingsModel';

type Drawer = 'project-types' | 'folder-profiles' | 'action-categories' | 'sales' | null;
type SettingsSection = 'general' | 'data' | 'integrations';
const ACCENTS = V4_ACCENT_PRESETS;
const TIME_ZONES = ['Asia/Dubai', 'Asia/Riyadh', 'Africa/Cairo', 'Europe/London'] as const;
const BACKUPS_PER_PAGE = 8;

function settingsForm(settings: PersonalWorkspaceSettings) {
  return {
    projectRoot: settings.projectRoot,
    defaultInputMode: settings.defaultInputMode,
    autoOpenProjectFolder: settings.autoOpenProjectFolder,
    designerName: settings.designerName,
    companyName: settings.companyName,
    companyLogoPath: settings.companyLogoPath,
    accentColor: settings.accentColor,
    timeZone: settings.timeZone,
    backupRetention: settings.backupRetention,
  };
}

export type SettingsForm = ReturnType<typeof settingsForm>;

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

function SettingCard({
  icon: Icon,
  tone,
  title,
  description,
  children,
  className = '',
  hidden = false,
}: {
  icon: typeof Settings;
  tone: string;
  title: string;
  description: string;
  children: React.ReactNode;
  className?: string;
  hidden?: boolean;
}) {
  return (
    <section className={`v4-settings-card ${className}`} hidden={hidden}>
      <header className="v4-settings-card__header">
        <span className={`v4-settings-card__icon is-${tone}`}>
          <Icon aria-hidden="true" />
        </span>
        <div>
          <h2>{title}</h2>
          <p>{description}</p>
        </div>
      </header>
      {children}
    </section>
  );
}

function LogoPreview({ path }: { path: string }) {
  const [result, setResult] = useState<LocalImageResult | null>(null);
  useEffect(() => {
    let live = true;
    if (!path.trim()) {
      setResult(null);
      return;
    }
    void resolveLuminaireImage(path).then((next) => {
      if (live) setResult(next);
    });
    return () => {
      live = false;
    };
  }, [path]);
  if (!path.trim()) return null;
  return result?.ok ? (
    <img className="v4-settings__logo-preview" src={result.src} alt="Company logo preview" />
  ) : (
    <span className="v4-settings__logo-unavailable">Preview unavailable</span>
  );
}

function dateTime(value: string, timeZone: string): string {
  void timeZone;
  return formatBusinessDateTime(value, {
    dateStyle: 'medium',
    timeStyle: 'short',
    hour12: true,
  });
}

export function SettingsWorkspace({ finalView = false }: { finalView?: boolean }) {
  const navigate = useNavigate();
  const [routeQuery] = useSearchParams();
  const queryClient = useQueryClient();
  const theme = useV4Theme();
  const [sidebarMode, setSidebarMode] = useState<SidebarMode>(() =>
    readStoredSidebarMode(window.localStorage),
  );
  const [drawer, setDrawer] = useState<Drawer>(null);
  const [form, setForm] = useState<SettingsForm | null>(null);
  const [baseline, setBaseline] = useState<SettingsForm | null>(null);
  const [notice, setNotice] = useState<{ kind: 'success' | 'error' | 'info'; text: string } | null>(
    null,
  );
  const [restoreTarget, setRestoreTarget] = useState<BackupRecord | null>(null);
  const [categoryDeleteTarget, setCategoryDeleteTarget] = useState<ActionCategory | null>(null);
  const [categoryReplacement, setCategoryReplacement] = useState('');
  const [restartRequired, setRestartRequired] = useState(false);
  const [backupPage, setBackupPage] = useState(0);
  const [settingsSection, setSettingsSection] = useState<SettingsSection>(() =>
    routeQuery.get('section') === 'integrations' ? 'integrations' : 'general',
  );

  const settings = useQuery({ queryKey: ['v4', 'settings'], queryFn: api.personalSettings });
  const projectTypes = useQuery({
    queryKey: ['v4', 'settings', 'project-types'],
    queryFn: api.personalProjectTypes,
  });
  const presets = useQuery({
    queryKey: ['v4', 'settings', 'folder-presets'],
    queryFn: api.folderProfiles,
  });
  const profiles = useQuery({
    queryKey: ['v4', 'settings', 'folder-profile-catalog'],
    queryFn: api.folderProfileCatalog,
  });
  const categories = useQuery({
    queryKey: ['v4', 'action-categories'],
    queryFn: api.listActionCategories,
  });
  const users = useQuery({ queryKey: ['v4', 'settings', 'users'], queryFn: api.users });
  const backups = useQuery({ queryKey: ['v4', 'settings', 'backups'], queryFn: api.backups });
  const backupRows = backups.data ?? [];
  const backupPageCount = Math.max(1, Math.ceil(backupRows.length / BACKUPS_PER_PAGE));
  const visibleBackups = backupRows.slice(
    backupPage * BACKUPS_PER_PAGE,
    backupPage * BACKUPS_PER_PAGE + BACKUPS_PER_PAGE,
  );

  useEffect(() => {
    setBackupPage((current) => Math.min(current, backupPageCount - 1));
  }, [backupPageCount]);

  const persistedAccentRef = useRef<string | null>(null);
  const previousSettings = useRef<SettingsForm | null>(null);

  useEffect(() => {
    if (!settings.data) return;
    const next = settingsForm(settings.data);
    const previous = previousSettings.current;
    setForm((current) => {
      if (!current || !previous) return next;
      const merged = { ...next };
      for (const key of Object.keys(next) as Array<keyof SettingsForm>) {
        if (current[key] !== previous[key]) Object.assign(merged, { [key]: current[key] });
      }
      return merged;
    });
    setBaseline(next);
    previousSettings.current = next;
    persistedAccentRef.current = next.accentColor;
  }, [settings.data]);

  // Live accent preview: selecting a preset applies it immediately.
  // On unmount (or when form.accentColor changes away from preview) the
  // cleanup restores the LAST PERSISTED accent so the provider surface
  // reflects durable truth without requiring a re-fetch.
  useEffect(() => {
    applyV4Accent(form?.accentColor);
    return () => applyV4Accent(persistedAccentRef.current ?? undefined);
  }, [form?.accentColor]);

  const sales = useMemo(
    () => (users.data ?? []).filter((user) => user.role === 'Sales'),
    [users.data],
  );
  const dirty =
    form !== null && baseline !== null && JSON.stringify(form) !== JSON.stringify(baseline);
  const loading = [settings, projectTypes, presets, profiles, categories, users, backups].some(
    (query) => query.isLoading,
  );
  const failed = [settings, projectTypes, presets, profiles, categories, users, backups].find(
    (query) => query.isError,
  );
  const refresh = (keys: string[][]) =>
    Promise.all(keys.map((queryKey) => queryClient.invalidateQueries({ queryKey })));
  const announceError = (error: unknown, fallback: string) =>
    setNotice({ kind: 'error', text: errorMessage(error, fallback) });

  const save = useMutation({
    mutationFn: () => api.updatePersonalSettings(form),
    onSuccess: (saved) => {
      const next = settingsForm(saved);
      setForm(next);
      setBaseline(next);
      persistedAccentRef.current = next.accentColor;
      queryClient.setQueryData(['v4', 'settings'], saved);
      setNotice({ kind: 'success', text: 'Workspace settings saved.' });
    },
    onError: (error) => announceError(error, 'Settings could not be saved.'),
  });
  const [leave, setLeave] = useState<{ proceed: () => void; cancel: () => void } | null>(null);
  useV4DirtySurface(dirty, (_reason, proceed, cancel) => {
    if (save.isPending) return cancel();
    setLeave({ proceed, cancel });
  });
  const backup = useMutation({
    mutationFn: api.createBackup,
    onSuccess: async () => {
      setBackupPage(0);
      await backups.refetch();
      setNotice({ kind: 'success', text: 'Backup created.' });
    },
    onError: (error) => announceError(error, 'Backup could not be created.'),
  });
  const restore = useMutation({
    mutationFn: (record: BackupRecord) => api.restoreBackup(record.filePath),
    onSuccess: (result) => {
      setRestoreTarget(null);
      setRestartRequired(result.restartRequired);
      setNotice({
        kind: 'info',
        text: result.restartRequired
          ? 'Restore is ready. Restart the desktop app to apply it.'
          : 'Restore is ready.',
      });
    },
    onError: (error) => announceError(error, 'Backup could not be restored.'),
  });
  const setDefault = useMutation({
    mutationFn: api.setFolderProfileDefault,
    onSuccess: async () => {
      await refresh([
        ['v4', 'settings', 'folder-profile-catalog'],
        ['v4', 'settings'],
      ]);
      setNotice({ kind: 'success', text: 'Default folder profile updated.' });
    },
    onError: (error) => announceError(error, 'Default folder profile could not be updated.'),
  });
  const saveTypes = useMutation({
    mutationFn: api.updatePersonalProjectTypes,
    onSuccess: async () => {
      await refresh([
        ['v4', 'settings', 'project-types'],
        ['v4', 'project-types'],
      ]);
      setDrawer(null);
      setNotice({ kind: 'success', text: 'Project types saved.' });
    },
    onError: (error) => announceError(error, 'Project types could not be saved.'),
  });

  const refreshProfiles = () =>
    refresh([
      ['v4', 'settings', 'folder-presets'],
      ['v4', 'settings', 'folder-profile-catalog'],
      ['v4', 'settings'],
    ]);
  const profileCreate = useMutation({
    mutationFn: (draft: FolderProfileDraft) =>
      api.createFolderProfile(createFolderProfileInput(draft)),
    onSuccess: async () => {
      await refreshProfiles();
      setDrawer(null);
      setNotice({ kind: 'success', text: 'Folder profile created.' });
    },
    onError: (error) => announceError(error, 'Folder profile could not be created.'),
  });
  const profileUpdate = useMutation({
    mutationFn: ({ profileId, draft }: { profileId: string; draft: FolderProfileDraft }) =>
      api.updateFolderProfile(profileId, updateFolderProfileInput(draft)),
    onSuccess: async () => {
      await refreshProfiles();
      setDrawer(null);
      setNotice({ kind: 'success', text: 'Folder profile saved.' });
    },
    onError: (error) => announceError(error, 'Folder profile could not be saved.'),
  });
  const profileDuplicate = useMutation({
    mutationFn: (profileId: string) =>
      apiRequest(`/api/folder-profiles/catalog/${profileId}/duplicate`, { method: 'POST' }),
    onSuccess: async () => {
      await refreshProfiles();
      setNotice({ kind: 'success', text: 'Folder profile duplicated.' });
    },
    onError: (error) => announceError(error, 'Folder profile could not be duplicated.'),
  });
  const profileImport = useMutation({
    mutationFn: api.importLegacyFolderProfile,
    onSuccess: async () => {
      await refreshProfiles();
      setNotice({
        kind: 'success',
        text: 'Legacy profile imported with a new canonical identity.',
      });
    },
    onError: (error) => announceError(error, 'Legacy profile could not be imported.'),
  });
  const profileDelete = useMutation({
    mutationFn: api.deleteFolderProfile,
    onSuccess: async () => {
      await refreshProfiles();
      setNotice({
        kind: 'success',
        text: 'Folder profile deleted. Existing projects were not changed.',
      });
    },
    onError: (error) => announceError(error, 'Folder profile could not be deleted.'),
  });

  const refreshCategories = () => refresh([['v4', 'action-categories']]);
  const categoryCreate = useMutation({
    mutationFn: api.createActionCategory,
    onSuccess: async () => {
      await refreshCategories();
      setDrawer(null);
      setNotice({ kind: 'success', text: 'Action category created.' });
    },
    onError: (error) => announceError(error, 'Action category could not be created.'),
  });
  const categoryUpdate = useMutation({
    mutationFn: ({ id, body }: { id: string; body: unknown }) => api.updateActionCategory(id, body),
    onSuccess: async () => {
      await refreshCategories();
      setDrawer(null);
      setNotice({ kind: 'success', text: 'Action category saved.' });
    },
    onError: (error) => announceError(error, 'Action category could not be saved.'),
  });
  const categoryDelete = useMutation({
    mutationFn: ({ id, replacementId }: { id: string; replacementId: string | null }) =>
      api.replaceAndDeleteActionCategory(id, replacementId),
    onSuccess: async () => {
      await refreshCategories();
      setCategoryDeleteTarget(null);
      setNotice({ kind: 'success', text: 'Action category deleted.' });
    },
    onError: (error) => announceError(error, 'This action category cannot be deleted.'),
  });

  const refreshUsers = () =>
    refresh([
      ['v4', 'settings', 'users'],
      ['v4', 'new', 'sales'],
      ['v4', 'projects', 'sales'],
    ]);
  const salesCreate = useMutation({
    mutationFn: api.createSalesContact,
    onSuccess: async () => {
      await refreshUsers();
      setDrawer(null);
      setNotice({ kind: 'success', text: 'Sales contact added.' });
    },
    onError: (error) => announceError(error, 'Sales contact could not be added.'),
  });
  const salesUpdate = useMutation({
    mutationFn: ({ id, body }: { id: string; body: unknown }) => api.updateUser(id, body),
    onSuccess: async () => {
      await refreshUsers();
      setDrawer(null);
      setNotice({ kind: 'success', text: 'Sales contact saved.' });
    },
    onError: (error) => announceError(error, 'Sales contact could not be saved.'),
  });

  const profileBusy = [
    profileCreate,
    profileUpdate,
    profileDuplicate,
    profileImport,
    profileDelete,
    setDefault,
  ].some((mutation) => mutation.isPending);
  const categoryBusy = [categoryCreate, categoryUpdate, categoryDelete].some(
    (mutation) => mutation.isPending,
  );
  const salesBusy = [salesCreate, salesUpdate].some((mutation) => mutation.isPending);
  const defaultValue = profiles.data ? folderRefValue(profiles.data.effectiveDefaultRef) : 'blank';

  const handleGlobalNav = async (id: string) => {
    if (
      dirty &&
      id !== 'settings' &&
      !(await v4Decisions.confirm('Discard unsaved workspace settings?'))
    )
      return;
    if (id === 'dashboard') navigate(ROUTE_DASHBOARD);
    if (id === 'projects') navigate(ROUTE_PROJECTS);
    if (id === 'settings') navigate(ROUTE_SETTINGS);
  };
  const update = <K extends keyof SettingsForm>(key: K, value: SettingsForm[K]) =>
    setForm((current) => (current ? { ...current, [key]: value } : current));

  return (
    <V4AppShell
      context="global"
      sidebarMode={sidebarMode}
      onToggleSidebarMode={() =>
        setSidebarMode((current) => {
          const next = current === 'extended' ? 'minimal' : 'extended';
          writeStoredSidebarMode(window.localStorage, next);
          return next;
        })
      }
      activeSectionId="settings"
      onSelectSection={handleGlobalNav}
      boundedPage
      pageHeader={
        finalView ? undefined : (
          <V4PageHeader
            title="Settings"
            description="Manage workspace configuration, catalogues, backup, and appearance."
            icon={Settings}
            actions={
              <div className="v4-settings__header-actions">
                {settingsSection === 'data' ? (
                  <button
                    type="button"
                    disabled={backup.isPending || loading}
                    onClick={() => backup.mutate()}
                  >
                    <CloudDownload aria-hidden="true" /> Create Backup
                  </button>
                ) : null}
                <button
                  className="v4-settings__primary"
                  type="button"
                  disabled={!dirty || save.isPending}
                  onClick={() => save.mutate()}
                >
                  <Save aria-hidden="true" /> Save Changes
                </button>
              </div>
            }
          />
        )
      }
    >
      <main
        className={finalView ? 'final-ui-reference v4-bounded-page' : 'v4-settings'}
        data-testid="v4-settings"
      >
        {!finalView ? (
          <nav className="v4-settings__sections" aria-label="Settings sections">
            <button
              type="button"
              aria-pressed={settingsSection === 'general'}
              onClick={() => setSettingsSection('general')}
            >
              General
            </button>
            <button
              type="button"
              aria-pressed={settingsSection === 'data'}
              onClick={() => setSettingsSection('data')}
            >
              Data &amp; Backup
            </button>
            <button
              type="button"
              aria-pressed={settingsSection === 'integrations'}
              onClick={() => setSettingsSection('integrations')}
            >
              Integrations &amp; Automation
            </button>
          </nav>
        ) : null}
        {notice ? (
          <div
            className={`v4-settings__notice is-${notice.kind}`}
            role={notice.kind === 'error' ? 'alert' : 'status'}
          >
            <span>{notice.text}</span>
            <button type="button" aria-label="Dismiss message" onClick={() => setNotice(null)}>
              ×
            </button>
          </div>
        ) : null}
        {restartRequired ? (
          <div className="v4-settings__restart" role="status">
            <ArchiveRestore aria-hidden="true" />
            <span>
              <strong>Restart required</strong> Close and reopen the SCT Workspace desktop app to
              complete the restore.
            </span>
          </div>
        ) : null}
        {loading ? (
          <section className="v4-settings__load">
            <span className="v4-settings__spinner" /> Loading settings…
          </section>
        ) : failed || !form ? (
          <section className="v4-settings__load" role="alert">
            Settings data is unavailable.
            <button
              type="button"
              onClick={() =>
                void Promise.all([
                  settings.refetch(),
                  projectTypes.refetch(),
                  presets.refetch(),
                  profiles.refetch(),
                  categories.refetch(),
                  users.refetch(),
                  backups.refetch(),
                ])
              }
            >
              Retry
            </button>
          </section>
        ) : finalView ? (
          <FinalSettingsView
            onIntegrations={() => setSettingsSection('integrations')}
            form={form}
            update={update}
            theme={theme.preference}
            onTheme={theme.setPreference}
            defaultValue={defaultValue}
            defaultPending={setDefault.isPending}
            defaultOptions={[
              { value: 'blank', label: 'Blank structure' },
              ...(presets.data ?? [])
                .filter((p) => p.source === 'factory' && p.factoryProfileKey)
                .map((p) => ({ value: `factory:${p.factoryProfileKey}`, label: p.name })),
              ...(profiles.data?.profiles ?? []).map((p) => ({
                value: `user:${p.profileId}`,
                label: p.name,
              })),
            ]}
            onDefault={(value) => setDefault.mutate(parseFolderRef(value))}
            projectTypes={(projectTypes.data ?? []).map((item) => ({
              id: item.id,
              name: item.name,
            }))}
            folderProfiles={[
              ...(presets.data ?? [])
                .filter((p) => p.source === 'factory' && p.factoryProfileKey)
                .map((p) => ({
                  id: `factory:${p.factoryProfileKey}`,
                  name: p.name,
                  ...(defaultValue === `factory:${p.factoryProfileKey}`
                    ? { badge: 'Default' }
                    : {}),
                })),
              ...(profiles.data?.profiles ?? []).map((p) => ({
                id: p.profileId,
                name: p.name,
                ...(defaultValue === `user:${p.profileId}` ? { badge: 'Default' } : {}),
              })),
            ]}
            categories={(categories.data ?? []).map((c) => ({ id: c.id, name: c.label }))}
            sales={sales.map((u) => ({
              id: u.id,
              name: u.displayName,
              badge: u.isActive ? 'Active' : 'Inactive',
            }))}
            onManage={setDrawer}
            backups={backupRows}
            onRestore={setRestoreTarget}
            onBackup={() => backup.mutate()}
            backupPending={backup.isPending}
            onSave={() => save.mutate()}
            dirty={dirty}
            saving={save.isPending}
            saveDisabled={!dirty || save.isPending}
            onError={(message) => setNotice({ kind: 'error', text: message })}
          />
        ) : (
          <div
            className="v4-settings__grid"
            data-section={settingsSection}
            role="region"
            aria-label={
              settingsSection === 'general'
                ? 'General settings'
                : settingsSection === 'data'
                  ? 'Data and backup settings'
                  : 'Integrations and automation settings'
            }
          >
            {settingsSection === 'integrations' ? <IntegrationSettingsSection /> : null}
            <SettingCard
              icon={FolderCog}
              tone="teal"
              title="Workspace"
              description="Configure workspace paths and default behaviours."
              className="v4-settings-card--workspace"
              hidden={settingsSection !== 'general'}
            >
              <div className="v4-settings__fields">
                <label>
                  <span>Project Root</span>
                  <span className="v4-settings__path">
                    <input
                      value={form.projectRoot}
                      onChange={(event) => update('projectRoot', event.target.value)}
                    />
                    <button
                      type="button"
                      disabled={!window.scliDesktop?.selectFolder}
                      title={window.scliDesktop?.selectFolder ? undefined : 'Desktop app required'}
                      onClick={async () => {
                        const selected = await window.scliDesktop?.selectFolder?.();
                        if (selected) update('projectRoot', selected);
                      }}
                    >
                      <FolderOpen aria-hidden="true" /> Browse
                    </button>
                  </span>
                </label>
                <label>
                  <span>Default Folder Profile</span>
                  <select
                    value={defaultValue}
                    disabled={setDefault.isPending}
                    onChange={(event) => setDefault.mutate(parseFolderRef(event.target.value))}
                  >
                    <option value="blank">Blank structure</option>
                    {(presets.data ?? [])
                      .filter((preset) => preset.source === 'factory' && preset.factoryProfileKey)
                      .map((preset) => (
                        <option
                          key={preset.factoryProfileKey}
                          value={`factory:${preset.factoryProfileKey}`}
                        >
                          {preset.name}
                        </option>
                      ))}
                    {(profiles.data?.profiles ?? []).map((profile) => (
                      <option key={profile.profileId} value={`user:${profile.profileId}`}>
                        {profile.name}
                      </option>
                    ))}
                  </select>
                  <small>
                    Uses the canonical catalogue default; the legacy name setting remains preserved
                    separately.
                  </small>
                </label>
                <label>
                  <span>Default Input Mode</span>
                  <select
                    value={form.defaultInputMode}
                    onChange={(event) =>
                      update(
                        'defaultInputMode',
                        event.target.value as SettingsForm['defaultInputMode'],
                      )
                    }
                  >
                    {luminaireInputModeOptions.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </label>
                <div className="v4-settings__toggle-row">
                  <span>
                    <label htmlFor="settings-auto-open-folder">
                      <strong>Auto-open Project Folder</strong>
                    </label>
                    <small id="settings-auto-open-folder-help">
                      Open the folder after creating or opening a project.
                    </small>
                  </span>
                  <input
                    id="settings-auto-open-folder"
                    type="checkbox"
                    role="switch"
                    aria-describedby="settings-auto-open-folder-help"
                    checked={form.autoOpenProjectFolder}
                    onChange={(event) => update('autoOpenProjectFolder', event.target.checked)}
                  />
                </div>
              </div>
            </SettingCard>

            <SettingCard
              icon={Building2}
              tone="purple"
              title="Identity & Branding"
              description="Manage identity, logo, and branding preferences."
              className="v4-settings-card--identity"
              hidden={settingsSection !== 'general'}
            >
              <div className="v4-settings__fields">
                <label>
                  <span>Designer Name</span>
                  <input
                    value={form.designerName}
                    onChange={(event) => update('designerName', event.target.value)}
                  />
                </label>
                <label>
                  <span>Company Name</span>
                  <input
                    value={form.companyName}
                    onChange={(event) => update('companyName', event.target.value)}
                  />
                </label>
                <label>
                  <span>Company Logo</span>
                  <span className="v4-settings__path">
                    <input
                      value={form.companyLogoPath}
                      onChange={(event) => update('companyLogoPath', event.target.value)}
                    />
                    <button
                      type="button"
                      disabled={!window.scliDesktop?.selectFile}
                      title={window.scliDesktop?.selectFile ? undefined : 'Desktop app required'}
                      onClick={async () => {
                        const selected = await window.scliDesktop?.selectFile?.([
                          { name: 'Logo images', extensions: ['png', 'jpg', 'jpeg', 'webp'] },
                        ]);
                        if (selected) update('companyLogoPath', selected);
                      }}
                    >
                      <Image aria-hidden="true" /> Browse
                    </button>
                  </span>
                  <LogoPreview path={form.companyLogoPath} />
                </label>
                <div className="v4-settings__field">
                  <span>Accent Color</span>
                  <div className="v4-settings__accents" role="group" aria-label="Accent Color">
                    {ACCENTS.map((color) => (
                      <button
                        type="button"
                        aria-label={color}
                        aria-pressed={form.accentColor.toLowerCase() === color.toLowerCase()}
                        style={{ '--settings-accent': color } as React.CSSProperties}
                        key={color}
                        onClick={() => update('accentColor', color)}
                      >
                        {form.accentColor.toLowerCase() === color.toLowerCase() ? (
                          <Check aria-hidden="true" />
                        ) : null}
                      </button>
                    ))}
                  </div>
                </div>
                <label>
                  <span>Time Zone</span>
                  <select
                    value={form.timeZone}
                    onChange={(event) => update('timeZone', event.target.value)}
                  >
                    {!TIME_ZONES.includes(form.timeZone as (typeof TIME_ZONES)[number]) ? (
                      <option value={form.timeZone}>{form.timeZone}</option>
                    ) : null}
                    {TIME_ZONES.map((zone) => (
                      <option value={zone} key={zone}>
                        (GMT{zone === 'Asia/Dubai' ? '+04:00' : ''}) {zone}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
            </SettingCard>

            <SettingCard
              icon={Tags}
              tone="violet"
              title="Catalogues"
              description="Manage core catalogues used across projects and the workspace."
              className="v4-settings-card--catalogues"
              hidden={settingsSection !== 'general'}
            >
              <div className="v4-settings__catalogue-grid">
                <CatalogueCard
                  icon={Folder}
                  title="Project Types"
                  rows={(projectTypes.data ?? [])
                    .filter((item) => item.isActive)
                    .slice(0, 2)
                    .map((item) => ({ id: item.id, label: item.name }))}
                  onOpen={() => setDrawer('project-types')}
                />
                <CatalogueCard
                  icon={FolderCog}
                  title="Folder Profiles"
                  rows={[
                    ...(presets.data ?? [])
                      .filter((item) => item.source === 'factory')
                      .map((item) => ({
                        id: item.factoryProfileKey ?? item.name,
                        label: item.name,
                      })),
                    ...(profiles.data?.profiles ?? []).map((item) => ({
                      id: item.profileId,
                      label: item.name,
                    })),
                  ].slice(0, 2)}
                  onOpen={() => setDrawer('folder-profiles')}
                />
                <CatalogueCard
                  icon={Palette}
                  title="Action Categories"
                  rows={(categories.data ?? []).slice(0, 2).map((item) => ({
                    id: item.id,
                    label: item.label,
                    icon: actionCategoryIconFor(item.iconKey),
                  }))}
                  onOpen={() => setDrawer('action-categories')}
                />
                <CatalogueCard
                  icon={UsersRound}
                  title="Sales Directory"
                  rows={sales.slice(0, 2).map((item) => ({
                    id: item.id,
                    label: item.displayName,
                    avatar: initials(item.displayName),
                    state: item.isActive ? 'Active' : 'Inactive',
                  }))}
                  onOpen={() => setDrawer('sales')}
                />
              </div>
            </SettingCard>

            <div className="v4-settings__right-stack">
              <SettingCard
                icon={DatabaseBackup}
                tone="teal"
                title="Data & Backup"
                description="Verified workspace backup: database, Master Library assets, and Project-owned Library snapshots."
                className="v4-settings-card--backup"
                hidden={settingsSection !== 'data'}
              >
                <div className="v4-settings__backup-controls">
                  <label>
                    <span>Backup Retention</span>
                    <input
                      type="number"
                      min={3}
                      max={100}
                      value={form.backupRetention}
                      onChange={(event) => update('backupRetention', Number(event.target.value))}
                    />
                  </label>
                  <button type="button" disabled={backup.isPending} onClick={() => backup.mutate()}>
                    <CloudDownload aria-hidden="true" /> Create Backup
                  </button>
                </div>
                <div className="v4-settings__backups">
                  <h3>Recent Backups</h3>
                  {backupRows.length ? (
                    <>
                      <div className="v4-settings__backup-table">
                        <table>
                          <thead>
                            <tr>
                              <th>Date & time</th>
                              <th>Size</th>
                              <th>Actions</th>
                            </tr>
                          </thead>
                          <tbody>
                            {visibleBackups.map((record) => (
                              <tr key={record.filePath}>
                                <td>
                                  <strong>{record.fileName}</strong>
                                  <small>{dateTime(record.createdAt, form.timeZone)}</small>
                                  {record.managedAssetsVerified ? (
                                    <small>
                                      {record.managedAssetCount ?? 0} managed asset files verified
                                    </small>
                                  ) : null}
                                </td>
                                <td>{formatBytes(record.sizeBytes)}</td>
                                <td>
                                  <button
                                    type="button"
                                    disabled={!window.scliDesktop?.openPath}
                                    title={
                                      window.scliDesktop?.openPath
                                        ? undefined
                                        : 'Desktop app required'
                                    }
                                    onClick={() =>
                                      void window.scliDesktop?.openPath?.(record.filePath)
                                    }
                                  >
                                    Open
                                  </button>
                                  <button type="button" onClick={() => setRestoreTarget(record)}>
                                    Restore
                                  </button>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                      <footer className="v4-settings__backup-footer">
                        <span>
                          Showing {backupPage * BACKUPS_PER_PAGE + 1}–
                          {Math.min((backupPage + 1) * BACKUPS_PER_PAGE, backupRows.length)} of{' '}
                          {backupRows.length} backups
                        </span>
                        <V4Pagination
                          pageCount={backupPageCount}
                          currentPage={backupPage}
                          onChange={setBackupPage}
                          ariaLabel="Recent Backups pages"
                        />
                      </footer>
                    </>
                  ) : (
                    <p className="v4-settings__empty">No backups are available yet.</p>
                  )}
                </div>
              </SettingCard>

              <SettingCard
                icon={Monitor}
                tone="pink"
                title="Appearance"
                description="Customize the look and feel of the application."
                className="v4-settings-card--appearance"
                hidden={settingsSection !== 'general'}
              >
                <div className="v4-settings__theme" role="radiogroup" aria-label="Theme">
                  <button
                    type="button"
                    role="radio"
                    aria-checked={theme.preference === 'light'}
                    className={theme.preference === 'light' ? 'is-selected' : ''}
                    onClick={() => theme.setPreference('light')}
                  >
                    <Sun aria-hidden="true" /> Light
                  </button>
                  <button
                    type="button"
                    role="radio"
                    aria-checked={theme.preference === 'dark'}
                    className={theme.preference === 'dark' ? 'is-selected' : ''}
                    onClick={() => theme.setPreference('dark')}
                  >
                    <Moon aria-hidden="true" /> Dark
                  </button>
                  <button
                    type="button"
                    role="radio"
                    aria-checked={theme.preference === 'system'}
                    className={theme.preference === 'system' ? 'is-selected' : ''}
                    onClick={() => theme.setPreference('system')}
                  >
                    <Monitor aria-hidden="true" /> System
                  </button>
                </div>
                <div className="v4-settings__theme-previews">
                  <button
                    type="button"
                    aria-label="Use light theme"
                    className={`is-light ${theme.preference === 'light' ? 'is-selected' : ''}`}
                    onClick={() => theme.setPreference('light')}
                  >
                    <span />
                    <span />
                    <span />
                    {theme.preference === 'light' ? <Check aria-hidden="true" /> : null}
                  </button>
                  <button
                    type="button"
                    aria-label="Use dark theme"
                    className={`is-dark ${theme.preference === 'dark' ? 'is-selected' : ''}`}
                    onClick={() => theme.setPreference('dark')}
                  >
                    <span />
                    <span />
                    <span />
                    {theme.preference === 'dark' ? <Check aria-hidden="true" /> : null}
                  </button>
                  <button
                    type="button"
                    aria-label="Use system theme"
                    className={`is-system ${theme.preference === 'system' ? 'is-selected' : ''}`}
                    onClick={() => theme.setPreference('system')}
                  >
                    <span />
                    <span />
                    <span />
                    {theme.preference === 'system' ? <Check aria-hidden="true" /> : null}
                  </button>
                </div>
                <p className="v4-settings__theme-note">
                  <Clock3 aria-hidden="true" /> System follows your operating system preference.
                </p>
              </SettingCard>
            </div>
          </div>
        )}
      </main>

      <V4ConfirmDialog
        open={Boolean(leave)}
        destructive
        title="Unsaved workspace settings"
        description="Save your changes before leaving?"
        cancelLabel="Keep editing"
        confirmLabel="Discard"
        pending={save.isPending}
        additionalAction={
          <V4Button
            disabled={save.isPending}
            onClick={() => {
              void save
                .mutateAsync()
                .then(() => {
                  const next = leave;
                  setLeave(null);
                  next?.proceed();
                })
                .catch(() => {
                  leave?.cancel();
                  setLeave(null);
                });
            }}
          >
            Save changes
          </V4Button>
        }
        onCancel={() => {
          leave?.cancel();
          setLeave(null);
        }}
        onConfirm={() => {
          const next = leave;
          setForm(baseline);
          setLeave(null);
          next?.proceed();
        }}
      />
      {projectTypes.data ? (
        <ProjectTypesDrawer
          serverError={notice?.kind === 'error' ? notice.text : undefined}
          open={drawer === 'project-types'}
          onClose={() => setDrawer(null)}
          types={projectTypes.data}
          busy={saveTypes.isPending}
          onSave={(value) => saveTypes.mutate(value)}
        />
      ) : null}
      {presets.data && profiles.data ? (
        <FolderProfilesDrawer
          serverError={notice?.kind === 'error' ? notice.text : undefined}
          open={drawer === 'folder-profiles'}
          onClose={() => setDrawer(null)}
          presets={presets.data}
          catalog={profiles.data}
          busy={profileBusy}
          onCreate={(draft) => profileCreate.mutate(draft)}
          onUpdate={(profileId, draft) => profileUpdate.mutate({ profileId, draft })}
          onDuplicate={(profileId) => profileDuplicate.mutate(profileId)}
          onImport={(name) => profileImport.mutate(name)}
          onDelete={(profileId) => profileDelete.mutate(profileId)}
          onSetDefault={(ref) => setDefault.mutate(ref)}
        />
      ) : null}
      <ActionCategoriesDrawer
        serverError={notice?.kind === 'error' ? notice.text : undefined}
        open={drawer === 'action-categories'}
        onClose={() => setDrawer(null)}
        categories={categories.data ?? []}
        busy={categoryBusy}
        onCreate={(body) => categoryCreate.mutate(body)}
        onUpdate={(id, body) => categoryUpdate.mutate({ id, body })}
        onDelete={(category) => {
          categoryDelete.reset();
          setCategoryReplacement('');
          setCategoryDeleteTarget(category);
        }}
      />
      <V4Drawer
        open={categoryDeleteTarget !== null}
        presentation="float"
        title="Replace and delete category"
        onClose={() => {
          if (!categoryDelete.isPending) setCategoryDeleteTarget(null);
        }}
        footer={
          <>
            <button
              type="button"
              disabled={categoryDelete.isPending}
              onClick={() => setCategoryDeleteTarget(null)}
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={categoryDelete.isPending || !categoryDeleteTarget}
              onClick={() => {
                if (categoryDeleteTarget)
                  categoryDelete.mutate({
                    id: categoryDeleteTarget.id,
                    replacementId: categoryReplacement || null,
                  });
              }}
            >
              {categoryDelete.isPending ? 'Deleting…' : 'Delete category'}
            </button>
          </>
        }
      >
        <p>
          Delete {categoryDeleteTarget?.label}? Actions across all projects will keep their details
          and move to the category selected below.
        </p>
        <V4FilterSelect
          label="Replacement category"
          value={categoryReplacement}
          onChange={setCategoryReplacement}
          options={[
            { value: '', label: 'Uncategorized' },
            ...(categories.data ?? [])
              .filter((item) => item.id !== categoryDeleteTarget?.id)
              .map((item) => ({ value: item.id, label: item.label })),
          ]}
        />
        {categoryDelete.isError ? (
          <p role="alert">
            The category could not be deleted. No reassignment was applied. Try again.
          </p>
        ) : null}
      </V4Drawer>
      <SalesDirectoryDrawer
        serverError={notice?.kind === 'error' ? notice.text : undefined}
        open={drawer === 'sales'}
        onClose={() => setDrawer(null)}
        users={sales}
        busy={salesBusy}
        onCreate={(body) => salesCreate.mutate(body)}
        onUpdate={(id, body) => salesUpdate.mutate({ id, body })}
      />
      <V4FloatingWorkspace
        footer={null}
        open={finalView && settingsSection === 'integrations'}
        title="Desktop integrations"
        panelClassName="v4-integrations-float"
        onRequestClose={() => setSettingsSection('general')}
      >
        <IntegrationSettingsSection />
      </V4FloatingWorkspace>
      <V4Drawer
        open={restoreTarget !== null}
        title="Restore backup"
        description="This replaces current workspace data with the selected backup."
        onClose={() => {
          if (!restore.isPending) setRestoreTarget(null);
        }}
        className="v4-settings-drawer"
        footer={
          <button
            className="v4-settings__danger"
            type="button"
            disabled={restore.isPending || !restoreTarget}
            onClick={() => {
              if (restoreTarget) restore.mutate(restoreTarget);
            }}
          >
            <ArchiveRestore aria-hidden="true" /> Restore workspace
          </button>
        }
      >
        {restoreTarget ? (
          <div className="v4-settings__restore-copy">
            <DatabaseBackup aria-hidden="true" />
            <p>
              <strong>{restoreTarget.fileName}</strong>
              <span>
                {dateTime(restoreTarget.createdAt, form?.timeZone ?? 'Asia/Dubai')} ·{' '}
                {formatBytes(restoreTarget.sizeBytes)}
              </span>
            </p>
            <p>
              Current workspace data, Master Library assets, and Project-owned Library snapshots
              will be restored together from this verified backup. The desktop app must be restarted
              afterward.
            </p>
          </div>
        ) : null}
      </V4Drawer>
    </V4AppShell>
  );
}

function CatalogueCard({
  icon: Icon,
  title,
  rows,
  onOpen,
}: {
  icon: typeof Folder;
  title: string;
  rows: Array<{ id: string; label: string; icon?: typeof Folder; avatar?: string; state?: string }>;
  onOpen: () => void;
}) {
  return (
    <article className="v4-settings__catalogue">
      <header>
        <span>
          <Icon aria-hidden="true" /> {title}
        </span>
        <button type="button" aria-label={`Add or manage ${title}`} onClick={onOpen}>
          <Plus aria-hidden="true" /> Add
        </button>
      </header>
      <div className="v4-settings__catalogue-rows">
        {rows.length ? (
          rows.map((row) => {
            const RowIcon = row.icon;
            return (
              <div key={row.id}>
                {row.avatar ? (
                  <span className="v4-settings__avatar">{row.avatar}</span>
                ) : RowIcon ? (
                  <RowIcon aria-hidden="true" />
                ) : (
                  <span className="v4-settings__grip">⠿</span>
                )}
                <span>{row.label}</span>
                {row.state ? <small>{row.state}</small> : null}
              </div>
            );
          })
        ) : (
          <p className="v4-settings__empty">No entries yet.</p>
        )}
      </div>
      <button className="v4-settings__manage" type="button" onClick={onOpen}>
        Manage {title} <ChevronRight aria-hidden="true" />
      </button>
    </article>
  );
}
