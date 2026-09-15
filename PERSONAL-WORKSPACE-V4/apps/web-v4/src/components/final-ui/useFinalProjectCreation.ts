import { projectWizardIssues } from './projectWizardReadiness';
import { useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import {
  createProjectSchema,
  projectWizardDraftSchema,
  projectDirectorySchema,
  type ProjectDirectoryEntry,
  type ProjectWizardDraft,
} from '@scli/contracts';
import type { FinalProjectSetup, ProjectServiceCode } from '@scli/domain';
import { api, apiRequest } from '../../api/environment';
import { draftFromPreset, folderPath } from '../../pages/new-project/newProjectModel';
import { parseCommercialValue, buildScopeItems } from '../project/projectFormModel';

export function useFinalProjectCreation() {
  const navigate = useNavigate();
  const client = useQueryClient();
  const idempotency = useRef(crypto.randomUUID());
  const creationCommitted = useRef(false);
  const [fields, setFields] = useState<Record<string, string>>({
    priority: 'Normal',
    currency: '',
    startDate: '',
    completionDate: '',
    designDuration: '0',
    constructionDuration: '0',
    designStage: 'Concept',
    coordination: 'standard',
    documentCategory: 'MEET',
    separator: '-',
    extension: '.pdf',
    sequenceDigits: '4',
  });
  const [notice, setNotice] = useState<string | null>(null);
  const savedDraft = useQuery({
    queryKey: ['v4', 'project-wizard-draft'],
    queryFn: async () => {
      const value = await apiRequest<unknown>('/api/personal/project-wizard-draft');
      return value === null ? null : projectWizardDraftSchema.parse(value);
    },
  });
  const saveDraft = useMutation({
    scope: { id: 'project-wizard-write' },
    mutationFn: ({ value }: { value: ProjectWizardDraft; automatic: boolean }) =>
      apiRequest<ProjectWizardDraft>('/api/personal/project-wizard-draft', {
        method: 'PUT',
        body: projectWizardDraftSchema.parse(value),
      }),
    onSuccess: (value, { automatic }) => {
      client.setQueryData(['v4', 'project-wizard-draft'], value);
      if (!automatic) setNotice('Draft saved. Resume it from New Project whenever you are ready.');
    },
    onError: (error) =>
      setNotice(error instanceof Error ? error.message : 'Draft could not be saved.'),
  });
  const directory = useQuery({
    queryKey: ['v4', 'project-directory'],
    queryFn: async () =>
      projectDirectorySchema.parse(await apiRequest('/api/personal/project-directory')),
  });
  const addDirectoryEntry = async (
    kind: 'Client' | 'Manager' | 'Sales',
    name: string,
    email: string,
  ) => {
    if (kind === 'Sales') {
      const result = await api.createSalesContact({
        displayName: name,
        ...(email ? { email } : {}),
      });
      update('salesOwnerId', result.id);
    } else {
      const result = await apiRequest<ProjectDirectoryEntry>('/api/personal/project-directory', {
        method: 'POST',
        body: { kind, name, email },
      });
      update(
        kind === 'Client' ? 'clientName' : 'managerId',
        kind === 'Client' ? result.name : result.id,
      );
    }
    await client.invalidateQueries({ queryKey: ['v4'] });
  };
  const settings = useQuery({
    queryKey: ['v4', 'new', 'settings'],
    queryFn: () => api.personalSettings(),
  });
  const types = useQuery({ queryKey: ['v4', 'new', 'types'], queryFn: () => api.projectTypes() });
  const sales = useQuery({ queryKey: ['v4', 'new', 'sales'], queryFn: () => api.salesUsers() });
  const me = useQuery({ queryKey: ['v4', 'new', 'me'], queryFn: () => api.me() });
  const users = useQuery({
    queryKey: ['v4', 'new', 'users'],
    queryFn: () => api.users(),
    enabled: me.data?.role === 'Admin' || me.data?.role === 'LineManager',
  });
  const projects = useQuery({ queryKey: ['v4', 'new', 'clients'], queryFn: () => api.projects() });
  const profiles = useQuery({
    queryKey: ['v4', 'new', 'profiles'],
    queryFn: () => api.folderProfiles(),
  });
  const selectedProfile =
    profiles.data?.find((profile) => profile.name === fields.folderProfile) ??
    profiles.data?.find((profile) => profile.name === settings.data?.defaultFolderProfile) ??
    profiles.data?.[0];
  const draft = useMemo(
    () =>
      selectedProfile
        ? draftFromPreset(selectedProfile)
        : { folders: [], outputMappings: [], sourceProfile: null },
    [selectedProfile],
  );
  const [excludedGroups, setExcludedGroups] = useState<string[]>([]);
  const roots = draft.folders.filter((folder) => !folder.parentDraftFolderId);
  const excludedIds = new Set<string>();
  for (const folder of draft.folders)
    if (excludedGroups.includes(folderPath(draft, folder.draftFolderId).split('/')[0]!))
      excludedIds.add(folder.draftFolderId);
  const folderDraft = {
    ...draft,
    folders: draft.folders.filter((folder) => !excludedIds.has(folder.draftFolderId)),
    outputMappings: draft.outputMappings.filter(
      (mapping) => !excludedIds.has(mapping.destinationDraftFolderId),
    ),
  };
  const update = (key: string, value: string) => {
    setFields((current) => ({ ...current, [key]: value }));
    setNotice(null);
  };
  const create = useMutation({
    scope: { id: 'project-wizard-write' },
    mutationFn: api.createProject,
    onSuccess: async (result) => {
      creationCommitted.current = true;
      // Draft cleanup must not turn a committed creation into a retryable failure.
      await apiRequest('/api/personal/project-wizard-draft', { method: 'DELETE' }).catch(
        () => undefined,
      );
      client.setQueryData(['v4', 'project-wizard-draft'], null);
      await client.invalidateQueries({ queryKey: ['v4'] });
      navigate(`/projects/${result.project.id}/summary`, {
        state: result.folderError ? { folderError: result.folderError } : undefined,
      });
    },
    onError: (error) =>
      setNotice(error instanceof Error ? error.message : 'Project could not be created.'),
  });
  function validateStep(step: number, scopeSummary: string) {
    const issues = projectWizardIssues(fields, scopeSummary);
    const message =
      (step === 1
        ? issues.information
        : step === 2
          ? issues.scope
          : step === 3
            ? issues.schedule
            : [])[0] ?? null;
    setNotice(message);
    return message === null;
  }
  async function submit(setup: FinalProjectSetup, description: string, scopeSummary: string) {
    if (create.isPending || ![1, 2, 3].every((step) => validateStep(step, scopeSummary))) return;
    const money = parseCommercialValue(fields.commercialValue ?? '', fields.currency ?? '');
    if (!money.ok) {
      setNotice(money.error);
      return;
    }
    let root = fields.projectRoot || settings.data?.projectRoot;
    if (!root) root = (await window.scliDesktop?.selectFolder?.()) ?? undefined;
    if (!root) {
      setNotice(
        'Choose a Project root folder to create the reviewed structure. You can save your inputs as a draft without creating a Project.',
      );
      return;
    }
    const serviceMapping: Record<string, ProjectServiceCode> = {
      'Lighting Plans': 'LightingLayout',
      Calculations: 'DialuxCalculation',
      Schedules: 'LuminaireSchedule',
      'Schedules / Luminaire Schedule': 'LuminaireSchedule',
    };
    const services = [
      ...new Set(
        setup.deliverables
          .map((label) => serviceMapping[label])
          .filter((value): value is ProjectServiceCode => Boolean(value)),
      ),
    ];
    const payload = createProjectSchema.safeParse({
      projectName: fields.projectName,
      clientName: fields.clientName,
      projectType: fields.projectType,
      crmReference: fields.crmReference || undefined,
      salesOwnerId: fields.salesOwnerId || undefined,
      siteLocation: fields.siteLocation ?? '',
      designStage: fields.designStage,
      priority: fields.priority,
      complexity: 'Medium',
      estimatedHours: 0,
      requiredDeliveryDate: fields.completionDate,
      description,
      lightingScope: scopeSummary,
      ...money.value,
      finalSetup: setup,
      idempotencyKey: idempotency.current,
      createFolders: true,
      projectRoot: root,
      folderProfile: selectedProfile?.name ?? 'Blank',
      folderDraft,
      services,
      scopeItems: buildScopeItems(
        services,
        setup.deliverables.filter((label) => !serviceMapping[label]),
      ),
      luminaireInputMode: settings.data?.defaultInputMode ?? 'Later',
    });
    if (!payload.success) {
      setNotice(
        payload.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join(' '),
      );
      return;
    }
    create.mutate(payload.data);
  }
  return {
    creationCommitted,
    fields,
    findExistingDirectoryEntry: (
      kind: 'Client' | 'Manager' | 'Sales',
      name: string,
      email: string,
    ) => {
      const normalized = (value: string) =>
        value.trim().toLocaleLowerCase('en').replace(/\s+/g, ' ');
      const candidates =
        kind === 'Sales'
          ? (sales.data ?? []).map((item) => ({
              id: item.id,
              name: item.displayName,
              email: item.email ?? '',
            }))
          : (directory.data ?? []).filter((item) => item.kind === kind && item.isActive);
      const match = candidates.find(
        (item) =>
          normalized(item.name) === normalized(name) ||
          (email.trim() && normalized(item.email) === normalized(email)),
      );
      if (match)
        return {
          name: match.name,
          select: () =>
            update(
              kind === 'Sales' ? 'salesOwnerId' : kind === 'Client' ? 'clientName' : 'managerId',
              kind === 'Client' ? match.name : match.id,
            ),
        };
      if (kind === 'Client') {
        const project = (projects.data ?? []).find(
          (item) => normalized(item.clientName) === normalized(name),
        );
        if (project)
          return {
            name: project.clientName,
            select: () => update('clientName', project.clientName),
          };
      }
      if (kind === 'Manager') {
        const manager = (users.data ?? (me.data ? [me.data] : [])).find(
          (item) =>
            item.isActive &&
            (normalized(item.displayName) === normalized(name) ||
              (email.trim() && normalized(item.email) === normalized(email))),
        );
        if (manager)
          return { name: manager.displayName, select: () => update('managerId', manager.id) };
      }
      return undefined;
    },
    addDirectoryEntry,
    restoreFields: setFields,
    restoreDraftFields: (savedFields: Record<string, string>, groups: string[]) => {
      // Resolve exclusions against the saved preset, not the preset from the previous render.
      const profile =
        profiles.data?.find((item) => item.name === savedFields.folderProfile) ?? selectedProfile;
      setFields(savedFields);
      setExcludedGroups(
        (profile?.folders ?? [])
          .filter((item) => !groups.includes(item.name))
          .map((item) => item.name),
      );
    },
    savedDraft: savedDraft.data,
    saveDraft: (value: ProjectWizardDraft, automatic = false) =>
      saveDraft.mutateAsync({ value, automatic }),
    draftLoading: savedDraft.isLoading,
    draftError: savedDraft.error,
    update,
    notice,
    setNotice,
    submit,
    validateStep,
    pending: create.isPending || saveDraft.isPending,
    loading: settings.isLoading || types.isLoading || profiles.isLoading,
    error: settings.error?.message || types.error?.message || profiles.error?.message,
    projectTypes: (types.data ?? []).filter((type) => type.isActive).map((type) => type.name),
    scopeTemplates: (projects.data ?? []).flatMap((project) =>
      project.finalSetup
        ? [
            {
              id: project.id,
              name: project.projectName,
              scope: project.lightingScope,
              setup: project.finalSetup,
            },
          ]
        : [],
    ),
    clients: [
      ...new Set([
        ...(projects.data ?? []).map((project) => project.clientName),
        ...(directory.data ?? [])
          .filter((entry) => entry.kind === 'Client' && entry.isActive)
          .map((entry) => entry.name),
      ]),
    ],
    sales: sales.data ?? [],
    managers: [
      ...(users.data ?? (me.data ? [me.data] : [])),
      ...(directory.data ?? [])
        .filter((entry) => entry.kind === 'Manager')
        .map((entry) => ({ id: entry.id, displayName: entry.name, isActive: entry.isActive })),
    ],
    profiles: profiles.data ?? [],
    selectedProfile,
    projectRoot: fields.projectRoot || settings.data?.projectRoot || '',
    browseProjectRoot: async () => {
      const selected = await window.scliDesktop?.selectFolder?.();
      if (selected) update('projectRoot', selected);
    },
    roots,
    folderDraft,
    folderNames: folderDraft.folders.map((folder) => folderPath(folderDraft, folder.draftFolderId)),
    enabledGroups: roots
      .filter((folder) => !excludedGroups.includes(folder.name))
      .map((folder) => folder.name),
    excludedGroups,
    setEnabledGroups: (names: string[]) =>
      setExcludedGroups(
        roots.filter((folder) => !names.includes(folder.name)).map((folder) => folder.name),
      ),
  };
}
