import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  BellRing,
  CheckCircle2,
  CirclePlus,
  CloudCog,
  Database,
  Save,
  KeyRound,
  ShieldCheck,
  ToggleLeft,
  ToggleRight,
  UserCog,
  UserPlus,
} from 'lucide-react';
import type { AppSettings, AppUser, ProjectType, Role } from '@scli/domain';
import { api } from '../api';
import { useAppContext } from '../app-context';
import { useToast } from '../components/toast';
import { Avatar, ErrorState, LoadingState, PageHeader, SectionHeading } from '../components/ui';

type SettingsTab = 'users' | 'types' | 'integrations';

export function SettingsScreen() {
  const { integrationStatus } = useAppContext();
  const [tab, setTab] = useState<SettingsTab>('users');
  const [draft, setDraft] = useState<AppSettings | null>(null);
  const [newType, setNewType] = useState('');
  const [showAddUser, setShowAddUser] = useState(false);
  const [newUser, setNewUser] = useState({
    displayName: '',
    email: '',
    jobTitle: 'Lighting Designer',
    department: 'Lighting Solutions',
    role: 'Designer' as Role,
    weeklyCapacityHours: 40,
    availabilityStatus: 'Available' as AppUser['availabilityStatus'],
    initialPassword: '',
  });
  const queryClient = useQueryClient();
  const { showToast } = useToast();
  const usersQuery = useQuery({ queryKey: ['admin-users'], queryFn: api.users });
  const settingsQuery = useQuery({ queryKey: ['admin-settings'], queryFn: api.settings });
  useEffect(() => {
    if (settingsQuery.data) setDraft(structuredClone(settingsQuery.data));
  }, [settingsQuery.data]);
  const userMutation = useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: Partial<AppUser> }) =>
      api.updateUser(id, patch),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['admin-users'] }),
        queryClient.invalidateQueries({ queryKey: ['workloads'] }),
      ]);
      showToast('User configuration updated.');
    },
    onError: (error) => showToast((error as Error).message, 'error'),
  });
  const createUserMutation = useMutation({
    mutationFn: api.createUser,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['admin-users'] });
      setShowAddUser(false);
      setNewUser({
        displayName: '',
        email: '',
        jobTitle: 'Lighting Designer',
        department: 'Lighting Solutions',
        role: 'Designer',
        weeklyCapacityHours: 40,
        availabilityStatus: 'Available',
        initialPassword: '',
      });
      showToast('Team member created. Share the initial password securely.');
    },
    onError: (error) => showToast((error as Error).message, 'error'),
  });
  const passwordMutation = useMutation({
    mutationFn: ({ id, password }: { id: string; password: string }) =>
      api.resetPassword(id, { password }),
    onSuccess: () => showToast('Password reset successfully.'),
    onError: (error) => showToast((error as Error).message, 'error'),
  });
  const settingsMutation = useMutation({
    mutationFn: api.updateSettings,
    onSuccess: async (settings) => {
      setDraft(settings);
      await queryClient.invalidateQueries({ queryKey: ['project-types'] });
      showToast('Application settings saved.');
    },
    onError: (error) => showToast((error as Error).message, 'error'),
  });

  if (usersQuery.isLoading || settingsQuery.isLoading)
    return <LoadingState label="Loading administration settings…" />;
  if (usersQuery.error || settingsQuery.error || !draft)
    return (
      <ErrorState
        message={
          ((usersQuery.error ?? settingsQuery.error) as Error | null)?.message ??
          'Settings unavailable.'
        }
      />
    );

  const updateType = (id: string, patch: Partial<ProjectType>) =>
    setDraft({
      ...draft,
      projectTypes: draft.projectTypes.map((type) =>
        type.id === id ? { ...type, ...patch, updatedAt: new Date().toISOString() } : type,
      ),
    });

  return (
    <>
      <PageHeader
        eyebrow="Administration"
        title="Settings"
        description="Manage application users, studio capacity, project types and production feature flags."
        actions={
          <button
            className="button primary"
            type="button"
            disabled={settingsMutation.isPending}
            onClick={() =>
              settingsMutation.mutate({
                companyTimezone: draft.companyTimezone,
                teamsNotificationsEnabled: draft.teamsNotificationsEnabled,
                projectTypes: draft.projectTypes,
              })
            }
          >
            <Save size={17} /> {settingsMutation.isPending ? 'Saving…' : 'Save settings'}
          </button>
        }
      />
      <div className="settings-tabs" role="tablist">
        <button
          role="tab"
          type="button"
          aria-selected={tab === 'users'}
          className={tab === 'users' ? 'active' : ''}
          onClick={() => setTab('users')}
        >
          <UserCog size={17} /> Users & roles
        </button>
        <button
          role="tab"
          type="button"
          aria-selected={tab === 'types'}
          className={tab === 'types' ? 'active' : ''}
          onClick={() => setTab('types')}
        >
          <Database size={17} /> Project types
        </button>
        <button
          role="tab"
          type="button"
          aria-selected={tab === 'integrations'}
          className={tab === 'integrations' ? 'active' : ''}
          onClick={() => setTab('integrations')}
        >
          <CloudCog size={17} /> Integrations
        </button>
      </div>

      {tab === 'users' ? (
        <section className="settings-panel">
          <SectionHeading
            title="Application users"
            detail="Create and maintain Sales, Lighting Designer, Manager, and Admin accounts."
          />
          {integrationStatus.mode === 'standalone' ? (
            <div className="user-create-panel">
              <button
                className="button secondary"
                type="button"
                onClick={() => setShowAddUser((value) => !value)}
                aria-expanded={showAddUser}
              >
                <UserPlus size={17} /> {showAddUser ? 'Close new user form' : 'Add team member'}
              </button>
              {showAddUser ? (
                <form
                  className="user-create-form"
                  onSubmit={(event) => {
                    event.preventDefault();
                    createUserMutation.mutate(newUser);
                  }}
                >
                  <label className="field">
                    Full name
                    <input
                      required
                      value={newUser.displayName}
                      onChange={(event) =>
                        setNewUser({ ...newUser, displayName: event.target.value })
                      }
                    />
                  </label>
                  <label className="field">
                    Work email
                    <input
                      required
                      type="email"
                      value={newUser.email}
                      onChange={(event) => setNewUser({ ...newUser, email: event.target.value })}
                    />
                  </label>
                  <label className="field">
                    Job title
                    <input
                      required
                      value={newUser.jobTitle}
                      onChange={(event) => setNewUser({ ...newUser, jobTitle: event.target.value })}
                    />
                  </label>
                  <label className="field">
                    Department
                    <input
                      required
                      value={newUser.department}
                      onChange={(event) =>
                        setNewUser({ ...newUser, department: event.target.value })
                      }
                    />
                  </label>
                  <label className="field">
                    Application role
                    <select
                      value={newUser.role}
                      onChange={(event) =>
                        setNewUser({ ...newUser, role: event.target.value as Role })
                      }
                    >
                      <option value="Sales">Sales</option>
                      <option value="Designer">Lighting Designer</option>
                      <option value="LineManager">Line Manager</option>
                      <option value="Admin">Admin</option>
                    </select>
                  </label>
                  <label className="field">
                    Initial password
                    <input
                      required
                      type="password"
                      minLength={12}
                      autoComplete="new-password"
                      value={newUser.initialPassword}
                      onChange={(event) =>
                        setNewUser({ ...newUser, initialPassword: event.target.value })
                      }
                    />
                    <small>At least 12 characters. Share it outside the application.</small>
                  </label>
                  {newUser.role === 'Designer' ? (
                    <label className="field">
                      Weekly capacity
                      <input
                        type="number"
                        min="0"
                        max="168"
                        value={newUser.weeklyCapacityHours}
                        onChange={(event) =>
                          setNewUser({
                            ...newUser,
                            weeklyCapacityHours: Number(event.target.value),
                          })
                        }
                      />
                    </label>
                  ) : null}
                  <button
                    className="button primary"
                    type="submit"
                    disabled={createUserMutation.isPending}
                  >
                    <UserPlus size={17} />
                    {createUserMutation.isPending ? 'Creating…' : 'Create account'}
                  </button>
                </form>
              ) : null}
            </div>
          ) : null}
          <div className="table-shell">
            <table className="data-table admin-users-table">
              <thead>
                <tr>
                  <th>User</th>
                  <th>Role</th>
                  <th>Capacity</th>
                  <th>Availability</th>
                  <th>Active</th>
                  <th>
                    <span className="sr-only">Save</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {usersQuery.data?.map((user) => (
                  <UserSettingsRow
                    key={user.id}
                    user={user}
                    onSave={(patch) => userMutation.mutate({ id: user.id, patch })}
                    {...(integrationStatus.mode === 'standalone'
                      ? {
                          onResetPassword: (password: string) =>
                            passwordMutation.mutate({ id: user.id, password }),
                        }
                      : {})}
                  />
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      {tab === 'types' ? (
        <section className="settings-panel">
          <SectionHeading
            title="Project types"
            detail="Only active types appear in the New Project form."
          />
          <div className="project-type-list">
            {draft.projectTypes.map((type) => (
              <div className="project-type-row" key={type.id}>
                <input
                  value={type.name}
                  onChange={(event) => updateType(type.id, { name: event.target.value })}
                  aria-label={`Project type ${type.name}`}
                />
                <button
                  className={type.isActive ? 'toggle-button active' : 'toggle-button'}
                  type="button"
                  onClick={() => updateType(type.id, { isActive: !type.isActive })}
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
              const name = newType.trim();
              if (!name) return;
              const now = new Date().toISOString();
              setDraft({
                ...draft,
                projectTypes: [
                  ...draft.projectTypes,
                  { id: crypto.randomUUID(), name, isActive: true, createdAt: now, updatedAt: now },
                ],
              });
              setNewType('');
            }}
          >
            <input
              value={newType}
              onChange={(event) => setNewType(event.target.value)}
              placeholder="New project type"
              maxLength={80}
            />
            <button className="button secondary" type="submit">
              <CirclePlus size={17} /> Add type
            </button>
          </form>
        </section>
      ) : null}

      {tab === 'integrations' ? (
        <div className="settings-integration-grid">
          <section className="settings-panel">
            <SectionHeading
              title="Company configuration"
              detail="Defaults used for date display and notification behavior."
            />
            <div className="form-grid">
              <label className="field">
                Company timezone
                <input
                  value={draft.companyTimezone}
                  onChange={(event) => setDraft({ ...draft, companyTimezone: event.target.value })}
                />
              </label>
              <label className="feature-toggle">
                <span>
                  <BellRing size={19} />
                  <span>
                    <strong>Optional Teams proactive notifications</strong>
                    <small>
                      {integrationStatus.mode === 'm365'
                        ? 'Requires the optional bot adapter and tenant installation.'
                        : 'Available only after a future Microsoft 365 upgrade.'}
                    </small>
                  </span>
                </span>
                <button
                  type="button"
                  role="switch"
                  aria-checked={draft.teamsNotificationsEnabled}
                  disabled={integrationStatus.mode !== 'm365'}
                  onClick={() =>
                    setDraft({
                      ...draft,
                      teamsNotificationsEnabled: !draft.teamsNotificationsEnabled,
                    })
                  }
                >
                  {draft.teamsNotificationsEnabled ? (
                    <ToggleRight size={34} />
                  ) : (
                    <ToggleLeft size={34} />
                  )}
                </button>
              </label>
            </div>
          </section>
          <section className="settings-panel integration-status-panel">
            <SectionHeading
              title="Integration status"
              detail="Standalone mode works without Microsoft 365 and keeps a documented upgrade path."
            />
            <div
              className={`configuration-banner ${integrationStatus.configured ? 'configured' : 'not-configured'}`}
            >
              <ShieldCheck size={24} />
              <div>
                <strong>
                  {integrationStatus.mode === 'mock'
                    ? 'Local mock mode'
                    : integrationStatus.mode === 'standalone'
                      ? 'Standalone workspace ready'
                      : integrationStatus.configured
                        ? 'Microsoft 365 configured'
                        : 'Configuration required'}
                </strong>
                <p>
                  {integrationStatus.mode === 'mock'
                    ? 'No tenant connection is active. All data is seeded locally.'
                    : integrationStatus.mode === 'standalone'
                      ? 'Local accounts and SQLite persistence are active. No tenant or IT approval is required.'
                      : integrationStatus.configured
                        ? 'The required production values are present.'
                        : 'Ask IT to provide the missing production values.'}
                </p>
              </div>
            </div>
            <ul className="integration-check-list">
              {integrationStatus.mode === 'standalone' ? (
                <>
                  <li>
                    <CheckCircle2 /> Local user accounts <span>Ready</span>
                  </li>
                  <li>
                    <CheckCircle2 /> SQLite project database <span>Ready</span>
                  </li>
                  <li>
                    <CheckCircle2 /> Microsoft 365 adapter <span>Optional future upgrade</span>
                  </li>
                </>
              ) : (
                <>
                  <li>
                    <CheckCircle2 /> Teams SSO{' '}
                    <span>
                      {integrationStatus.teamsSsoConfigured ? 'Configured' : 'Not configured'}
                    </span>
                  </li>
                  <li>
                    <CheckCircle2 /> SharePoint data provider{' '}
                    <span>
                      {integrationStatus.sharePointConfigured ? 'Configured' : 'Not configured'}
                    </span>
                  </li>
                  <li>
                    <CheckCircle2 /> Proactive notifications{' '}
                    <span>
                      {integrationStatus.proactiveNotificationsConfigured
                        ? 'Ready / disabled'
                        : 'Not configured'}
                    </span>
                  </li>
                </>
              )}
            </ul>
            {integrationStatus.missing.length ? (
              <details>
                <summary>Missing configuration values</summary>
                <code>{integrationStatus.missing.join(', ')}</code>
              </details>
            ) : null}
          </section>
        </div>
      ) : null}
    </>
  );
}

function UserSettingsRow({
  user,
  onSave,
  onResetPassword,
}: {
  user: AppUser;
  onSave: (patch: Partial<AppUser>) => void;
  onResetPassword?: (password: string) => void;
}) {
  const [displayName, setDisplayName] = useState(user.displayName);
  const [email, setEmail] = useState(user.email);
  const [jobTitle, setJobTitle] = useState(user.jobTitle);
  const [department, setDepartment] = useState(user.department);
  const [role, setRole] = useState(user.role);
  const [capacity, setCapacity] = useState(user.weeklyCapacityHours);
  const [availability, setAvailability] = useState(user.availabilityStatus);
  const [active, setActive] = useState(user.isActive);
  const [password, setPassword] = useState('');
  return (
    <tr>
      <td>
        <div className="table-user user-identity-editor">
          <Avatar user={user} />
          <span>
            <input
              value={displayName}
              onChange={(event) => setDisplayName(event.target.value)}
              aria-label={`Full name for ${user.displayName}`}
            />
            <input
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              aria-label={`Email for ${user.displayName}`}
            />
            <span className="identity-secondary-fields">
              <input
                value={jobTitle}
                onChange={(event) => setJobTitle(event.target.value)}
                aria-label={`Job title for ${user.displayName}`}
              />
              <input
                value={department}
                onChange={(event) => setDepartment(event.target.value)}
                aria-label={`Department for ${user.displayName}`}
              />
            </span>
          </span>
        </div>
      </td>
      <td>
        <select value={role} onChange={(event) => setRole(event.target.value as Role)}>
          <option value="Sales">Sales</option>
          <option value="Designer">Lighting Designer</option>
          <option value="LineManager">Line Manager</option>
          <option value="Admin">Admin</option>
        </select>
      </td>
      <td>
        <input
          type="number"
          min="0"
          max="168"
          value={capacity}
          disabled={role !== 'Designer'}
          onChange={(event) => setCapacity(Number(event.target.value))}
          aria-label={`Weekly capacity for ${user.displayName}`}
        />
      </td>
      <td>
        <select
          value={availability}
          disabled={role !== 'Designer'}
          onChange={(event) => setAvailability(event.target.value as AppUser['availabilityStatus'])}
        >
          <option>Available</option>
          <option>Limited</option>
          <option>FullyLoaded</option>
          <option>Unavailable</option>
        </select>
      </td>
      <td>
        <button
          className={active ? 'toggle-button active' : 'toggle-button'}
          type="button"
          onClick={() => setActive((value) => !value)}
          aria-pressed={active}
        >
          {active ? <ToggleRight size={24} /> : <ToggleLeft size={24} />}
          <span className="sr-only">{active ? 'Active' : 'Inactive'}</span>
        </button>
      </td>
      <td>
        <div className="user-row-actions">
          <button
            className="icon-button accent"
            type="button"
            onClick={() =>
              onSave({
                displayName,
                email,
                jobTitle,
                department,
                role,
                weeklyCapacityHours: capacity,
                availabilityStatus: availability,
                isActive: active,
              })
            }
            aria-label={`Save ${user.displayName}`}
          >
            <Save size={16} />
          </button>
          {onResetPassword ? (
            <span className="password-reset-inline">
              <input
                type="password"
                minLength={12}
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                placeholder="New password"
                aria-label={`New password for ${user.displayName}`}
              />
              <button
                className="icon-button"
                type="button"
                disabled={password.length < 12}
                onClick={() => {
                  onResetPassword(password);
                  setPassword('');
                }}
                aria-label={`Reset password for ${user.displayName}`}
              >
                <KeyRound size={15} />
              </button>
            </span>
          ) : null}
        </div>
      </td>
    </tr>
  );
}
