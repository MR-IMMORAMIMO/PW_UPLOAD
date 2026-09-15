import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type { ProjectContact, ProjectScopeItem, ProjectWorkspace } from '@scli/domain';
import { ContactDrawer, type ContactDraft } from './ContactDrawer';
import { useParams } from 'react-router-dom';
import { api, apiRequest } from '../../api/environment';
import { ProjectDirectoryEditor } from '../../components/final-ui/ProjectDirectoryEditor';
import { V4TextEditor } from '../../components/common/V4TextEditor';
import { V4Button } from '../../components/common/V4Button';
import { V4ProjectEditAction } from '../../components/project/V4ProjectEditAction';
import { Plus as SctPlus, SctEdit } from '../../components/common/SctIcons';
import { projectDirectorySchema, type ProjectDirectoryEntry } from '@scli/contracts';
import { V4AppShell } from '../../components/shell/V4AppShell';
import { ProjectHeader } from '../../components/final-ui/ProjectHeader';
import { shellProject } from '../../components/final-ui/ShellData';
import {
  readStoredSidebarMode,
  writeStoredSidebarMode,
} from '../../components/sidebar/sidebarMode';
import FinalContactsView from './FinalContactsView';

export function ProjectContactsPage() {
  const { projectId = '' } = useParams<{ projectId: string }>();
  return <ContactsWorkspace key={projectId} projectId={projectId} />;
}
function ContactsWorkspace({ projectId }: { projectId: string }) {
  const [mode, setMode] = useState(() => readStoredSidebarMode(window.localStorage));
  const [query, setQuery] = useState('');
  const [role, setRole] = useState('');
  const [selectedId, setSelectedId] = useState('');
  const [notice, setNotice] = useState('');
  const [editingNotes, setEditingNotes] = useState(false);
  const [addingClient, setAddingClient] = useState(false);
  const [initialGroup, setInitialGroup] = useState('');
  const [editing, setEditing] = useState<ProjectContact | null | undefined>(undefined);
  const client = useQueryClient();
  const directory = useQuery({
    queryKey: ['v4', 'project-directory'],
    enabled: addingClient,
    queryFn: async () =>
      projectDirectorySchema.parse(await apiRequest('/api/personal/project-directory')),
  });
  const refreshContactConsumers = () =>
    client.invalidateQueries({
      predicate: (query) => query.queryKey[0] === 'v4' && query.queryKey.includes(projectId),
    });
  const save = useMutation({
    mutationFn: (draft: ContactDraft) =>
      editing
        ? api.updateContact(projectId, editing.id, draft)
        : api.createContact(projectId, draft),
    onSuccess: async (contact) => {
      await refreshContactConsumers();
      setEditing(undefined);
      setSelectedId(contact.id);
      setNotice('Contact saved.');
    },
  });
  const project = useQuery({
    queryKey: ['v4', 'contacts', 'project', projectId],
    queryFn: () => api.project(projectId),
    enabled: Boolean(projectId),
  });
  const workspace = useQuery({
    queryKey: ['v4', 'contacts', 'workspace', projectId],
    queryFn: () => api.projectWorkspace(projectId),
    enabled: Boolean(projectId),
  });
  const loading = project.isLoading || workspace.isLoading;
  const failed = project.isError || workspace.isError;
  // Fail closed across route changes and malformed/mismatched workspace responses.
  const scopeMatches = project.data?.id === projectId && workspace.data?.projectId === projectId;
  const contacts =
    !loading && !failed && scopeMatches
      ? (workspace.data?.contacts ?? []).filter((c) => c.projectId === projectId)
      : [];
  const selected = contacts.some((c) => c.id === selectedId) ? selectedId : '';
  const saveProjectMetadata = async (patch: {
    responsibilityNotes?: string;
    clientName?: string;
  }) => {
    if (!project.data) throw new Error('Project is unavailable.');
    const current = await apiRequest<ProjectWorkspace & { scopeItems: ProjectScopeItem[] }>(
      `/api/projects/${projectId}/workspace`,
    );
    if (!Array.isArray(current.scopeItems))
      throw new Error('Project scope could not be loaded. Please retry.');
    await api.updateProjectConfiguration(projectId, {
      ...patch,
      expectedVersion: project.data.version,
      scopeItems: current.scopeItems.map(({ code, label, custom }) => ({ code, label, custom })),
      luminaireInputMode: project.data.luminaireInputMode ?? 'Later',
    });
    await refreshContactConsumers();
  };
  const state = loading ? (
    <span role="status">Loading contacts…</span>
  ) : failed || (!loading && !scopeMatches) ? (
    <span role="alert">
      Contacts could not be loaded.{' '}
      <button onClick={() => void Promise.all([project.refetch(), workspace.refetch()])}>
        Retry
      </button>
    </span>
  ) : null;
  return (
    <V4AppShell
      context="project"
      sidebarMode={mode}
      onToggleSidebarMode={() =>
        setMode((current) => {
          const next = current === 'extended' ? 'minimal' : 'extended';
          writeStoredSidebarMode(window.localStorage, next);
          return next;
        })
      }
      activeSectionId="contacts"
      finalContacts
    >
      <div
        className="final-ui final-ui-contact-main"
        data-integration="V4-FINAL-UI-INTEGRATION-01"
        data-project-id={projectId}
      >
        <ProjectHeader project={shellProject(scopeMatches && !failed ? project.data : null)} />
        <FinalContactsView
          relationship={
            scopeMatches && project.data ? (
              <section aria-label="Key Relationship">
                <h3>Billing / Client Group</h3>
                <p>{project.data.clientName || 'No client recorded.'}</p>
                <V4ProjectEditAction
                  project={project.data}
                  projectQueryKey={['v4', 'contacts', 'project', projectId]}
                  renderTrigger={(open, pending) => (
                    <V4Button disabled={pending} onClick={(event) => open(event.currentTarget)}>
                      <SctEdit /> Edit project client
                    </V4Button>
                  )}
                />
                <V4Button aria-label="Add client" onClick={() => setAddingClient(true)}>
                  <SctPlus />
                </V4Button>
                <div
                  style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}
                >
                  <h3>Responsibility Notes</h3>
                  <V4Button
                    aria-label="Edit responsibility notes"
                    onClick={() => setEditingNotes(true)}
                  >
                    <SctEdit />
                  </V4Button>
                </div>
                <p style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
                  {project.data.responsibilityNotes || 'No responsibility notes recorded.'}
                </p>
              </section>
            ) : null
          }
          onArchive={(contact, archived) => {
            if (
              !archived &&
              contact.isPrimary &&
              contacts.some(
                (other) =>
                  other.id !== contact.id &&
                  !other.archived &&
                  other.isPrimary &&
                  (other.group || other.role || 'Unspecified').trim().toLowerCase() ===
                    (contact.group || contact.role || 'Unspecified').trim().toLowerCase(),
              )
            ) {
              save.reset();
              setEditing({ ...contact, archived: false });
              return;
            }
            void api
              .updateContact(projectId, contact.id, {
                name: contact.name,
                email: contact.email,
                company: contact.company,
                role: contact.role,
                phone: contact.phone ?? '',
                group: contact.group ?? '',
                notes: contact.notes ?? '',
                isPrimary: contact.isPrimary ?? false,
                archived,
              })
              .then(async () => {
                await refreshContactConsumers();
                setSelectedId('');
                setNotice(
                  archived ? 'Contact archived. Existing links are retained.' : 'Contact restored.',
                );
              })
              .catch((error: unknown) =>
                setNotice(error instanceof Error ? error.message : 'Could not update contact.'),
              );
          }}
          contacts={contacts}
          query={query}
          role={role}
          onQuery={setQuery}
          onRole={setRole}
          selectedId={selected}
          onSelect={setSelectedId}
          state={state}
          notify={setNotice}
          onAdd={(group) => {
            setInitialGroup(group ?? '');
            save.reset();
            setEditing(null);
          }}
          onEdit={(contact) => {
            save.reset();
            setEditing(contact);
          }}
        />
        <ContactDrawer
          initialGroup={initialGroup}
          contacts={contacts}
          open={editing !== undefined}
          contact={editing ?? null}
          pending={save.isPending}
          error={save.error instanceof Error ? save.error.message : null}
          onClose={() => {
            if (!save.isPending) setEditing(undefined);
          }}
          onSave={async (draft) => {
            try {
              await save.mutateAsync(draft);
              return true;
            } catch {
              return false;
            }
          }}
        />
        {editingNotes && project.data && (
          <V4TextEditor
            title="Responsibility Notes"
            value={project.data.responsibilityNotes ?? ''}
            onClose={() => setEditingNotes(false)}
            onSave={async (value) => {
              await saveProjectMetadata({
                responsibilityNotes: value,
              });
            }}
          />
        )}
        {addingClient && (
          <ProjectDirectoryEditor
            kind="Client"
            onClose={() => setAddingClient(false)}
            onSave={async (name, email) => {
              const existing = directory.data?.find(
                (entry) =>
                  entry.kind === 'Client' && entry.name.toLowerCase() === name.toLowerCase(),
              );
              const entry =
                existing ??
                (await apiRequest<ProjectDirectoryEntry>('/api/personal/project-directory', {
                  method: 'POST',
                  body: { kind: 'Client', name, email },
                }));
              if (!project.data) throw new Error('Project is unavailable.');
              await saveProjectMetadata({
                clientName: entry.name,
              });
              await client.invalidateQueries({ queryKey: ['v4', 'project-directory'] });
              await refreshContactConsumers();
            }}
          />
        )}
        <span className="final-ui-status" role="status">
          {notice}
        </span>
      </div>
    </V4AppShell>
  );
}
