import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  BriefcaseBusiness,
  LoaderCircle,
  Plus,
  Search,
  UserRoundCheck,
  UsersRound,
} from 'lucide-react';
import { Link } from 'react-router-dom';
import { isActiveProject } from '@scli/domain';
import { api } from '../api';
import { useToast } from '../components/toast';
import { salesTone } from '../sales-color';
import { personalStatusLabel } from '../personal-status';
import { EmptyState, ErrorState, LoadingState, PageHeader, StatusBadge } from '../components/ui';

export function PersonalSalesScreen() {
  const queryClient = useQueryClient();
  const { showToast } = useToast();
  const [search, setSearch] = useState('');
  const [form, setForm] = useState({ name: '', email: '' });
  const usersQuery = useQuery({ queryKey: ['users', 'sales-directory'], queryFn: api.users });
  const projectsQuery = useQuery({
    queryKey: ['projects', 'sales-directory'],
    queryFn: () => api.projects(),
  });
  const createMutation = useMutation({
    mutationFn: () =>
      api.createSalesContact({
        displayName: form.name,
        ...(form.email.trim() ? { email: form.email.trim() } : {}),
      }),
    onSuccess: async () => {
      setForm({ name: '', email: '' });
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['users'] }),
        queryClient.invalidateQueries({ queryKey: ['sales-users'] }),
      ]);
      showToast('Salesperson added to the local directory.');
    },
    onError: (error) => showToast((error as Error).message, 'error'),
  });
  const activeMutation = useMutation({
    mutationFn: ({ id, isActive }: { id: string; isActive: boolean }) =>
      api.updateUser(id, { isActive }),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['users'] }),
        queryClient.invalidateQueries({ queryKey: ['sales-users'] }),
      ]);
      showToast('Sales Directory updated. Existing project history was kept.');
    },
    onError: (error) => showToast((error as Error).message, 'error'),
  });

  const salespeople = useMemo(() => {
    const normalized = search.trim().toLowerCase();
    return (usersQuery.data ?? [])
      .filter((user) => user.role === 'Sales')
      .filter(
        (user) =>
          !normalized || `${user.displayName} ${user.email}`.toLowerCase().includes(normalized),
      )
      .sort(
        (a, b) =>
          Number(b.isActive) - Number(a.isActive) || a.displayName.localeCompare(b.displayName),
      );
  }, [search, usersQuery.data]);

  if (usersQuery.isLoading || projectsQuery.isLoading)
    return <LoadingState label="Opening Sales Directory…" />;
  if (usersQuery.error || projectsQuery.error)
    return <ErrorState message={(usersQuery.error ?? (projectsQuery.error as Error)).message} />;
  const projects = projectsQuery.data ?? [];

  return (
    <>
      <PageHeader
        eyebrow="Local directory"
        title="Sales Directory"
        description="Keep the salesperson behind every project visible, searchable and easy to group. No prices, commissions or commercial values are stored."
      />
      <div className="sales-directory-layout">
        <section className="content-card sales-directory-main">
          <div className="sales-directory-toolbar">
            <label className="filter-search">
              <Search />
              <input
                aria-label="Search salesperson"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search salesperson…"
              />
            </label>
            <Link className="button secondary" to="/projects?sortBy=salesOwner&sortDirection=asc">
              <BriefcaseBusiness /> Group Projects by Sales
            </Link>
          </div>
          <div className="sales-directory-grid">
            {salespeople.map((salesperson) => {
              const owned = projects.filter((project) => project.salesOwnerId === salesperson.id);
              const waiting = owned.filter((project) => project.status === 'WaitingForSales');
              const active = owned.filter(isActiveProject);
              return (
                <article
                  className={`sales-person-card ${salesTone(salesperson.id)}${salesperson.isActive ? '' : ' inactive'}`}
                  key={salesperson.id}
                >
                  <div className={`sales-person-avatar ${salesTone(salesperson.id)}`}>
                    {salesperson.displayName
                      .split(' ')
                      .slice(0, 2)
                      .map((part) => part[0])
                      .join('')
                      .toUpperCase()}
                  </div>
                  <div className="sales-person-heading">
                    <div>
                      <h3>{salesperson.displayName}</h3>
                      <p>
                        {salesperson.email.endsWith('@scli.local')
                          ? 'Local contact'
                          : salesperson.email}
                      </p>
                    </div>
                    <span className={salesperson.isActive ? 'active' : 'inactive'}>
                      {salesperson.isActive ? 'Active' : 'Inactive'}
                    </span>
                  </div>
                  <div className="sales-person-metrics">
                    <span>
                      <strong>{owned.length}</strong>
                      <small>Projects</small>
                    </span>
                    <span>
                      <strong>{active.length}</strong>
                      <small>Active</small>
                    </span>
                    <span>
                      <strong>{waiting.length}</strong>
                      <small>Waiting</small>
                    </span>
                  </div>
                  {waiting.length ? (
                    <div className="sales-waiting-list">
                      {waiting.slice(0, 3).map((project) => (
                        <Link to={`/projects/${project.id}`} key={project.id}>
                          <span>{project.projectCode}</span>
                          <strong title={project.projectName}>{project.projectName}</strong>
                          <StatusBadge
                            status={project.status}
                            label={personalStatusLabel(project.status)}
                          />
                        </Link>
                      ))}
                    </div>
                  ) : null}
                  <div className="sales-person-actions">
                    <Link
                      className="button secondary"
                      to={`/projects?salesOwnerId=${salesperson.id}`}
                    >
                      View projects
                    </Link>
                    <button
                      type="button"
                      className="button ghost"
                      disabled={activeMutation.isPending}
                      onClick={() =>
                        activeMutation.mutate({
                          id: salesperson.id,
                          isActive: !salesperson.isActive,
                        })
                      }
                    >
                      {salesperson.isActive ? 'Deactivate' : 'Reactivate'}
                    </button>
                  </div>
                </article>
              );
            })}
          </div>
          {!salespeople.length ? (
            <EmptyState
              title={search ? 'No matching salesperson' : 'Sales Directory is empty'}
              description={
                search ? 'Try another name.' : 'Add the first salesperson from the panel.'
              }
            />
          ) : null}
        </section>

        <aside className="content-card operations-editor">
          <div className="operations-editor-title">
            <UserRoundCheck />
            <div>
              <strong>Add salesperson</strong>
              <small>Personal local directory</small>
            </div>
          </div>
          <form
            className="compact-form"
            onSubmit={(event) => {
              event.preventDefault();
              createMutation.mutate();
            }}
          >
            <label>
              Name
              <input
                required
                value={form.name}
                onChange={(event) => setForm({ ...form, name: event.target.value })}
                placeholder="Salesperson name"
              />
            </label>
            <label>
              Email <small>Optional — no email is sent.</small>
              <input
                type="email"
                value={form.email}
                onChange={(event) => setForm({ ...form, email: event.target.value })}
                placeholder="name@company.com"
              />
            </label>
            <div className="sales-local-note">
              <UsersRound /> This entry is used only for project ownership, filters and reports.
            </div>
            <button
              className="button primary"
              disabled={!form.name.trim() || createMutation.isPending}
            >
              {createMutation.isPending ? <LoaderCircle className="spin" /> : <Plus />} Add to
              Directory
            </button>
          </form>
        </aside>
      </div>
    </>
  );
}
