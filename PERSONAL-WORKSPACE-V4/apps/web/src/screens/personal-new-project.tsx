import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeft,
  ArrowRight,
  Check,
  CheckCircle2,
  FileInput,
  FolderTree,
  LoaderCircle,
  RotateCcw,
  Save,
  Sparkles,
  X,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import {
  factoryProfileSource,
  folderProfileStructuralFingerprint,
  luminaireInputModeOptions,
  normalizeScopeLabel,
  projectServiceCodes,
  projectServiceLabels,
  type FolderProfilePreset,
  type FolderProfileRef,
  type FolderProfileSource,
  type LuminaireInputMode,
  type ProjectFolderDraft,
  type ProjectScopeItem,
  type ProjectServiceCode,
} from '@scli/domain';
import { api } from '../api';
import { formatCommercialValue, parseCommercialValueInput } from '../commercial-value';
import { CommercialValueFields } from '../components/commercial-value-fields';
import { useToast } from '../components/toast';
import { PageHeader } from '../components/ui';
import {
  ProjectFolderDraftEditor,
  blankDraft,
  draftFromCanonicalProfile,
  draftFromPreset,
  draftMeaningfullyCustomized,
  draftOutputsValid,
  draftToProfileCreateInput,
  flatToDraftTree,
  type DraftTreeNode,
} from '../components/folder-structure-editor';
import { desktop } from '../desktop';
import { addCalendarDays, workspaceDateKey } from '../local-date';

function defaultDeliveryDate(): string {
  return addCalendarDays(workspaceDateKey(), 14);
}

function refToValue(ref: FolderProfileRef): string {
  if (ref.kind === 'blank') return 'blank';
  if (ref.kind === 'factory') return `factory:${ref.factoryProfileKey}`;
  return `user:${ref.profileId}`;
}

function valueToRef(value: string): FolderProfileRef {
  if (value === 'blank') return { kind: 'blank' };
  if (value.startsWith('factory:')) {
    return { kind: 'factory', factoryProfileKey: value.slice('factory:'.length) };
  }
  return { kind: 'user', profileId: value.slice('user:'.length) };
}

function renderDraftTree(nodes: DraftTreeNode[], depth = 0) {
  return (
    <ul className="profile-preview-tree" role="tree">
      {nodes.map((node) => (
        <li
          key={node.draftFolderId}
          role="treeitem"
          aria-selected="false"
          style={{ paddingLeft: `${depth * 16 + 4}px` }}
        >
          <FolderTree size={14} aria-hidden="true" />
          <span>{node.name}</span>
          {node.children.length ? renderDraftTree(node.children, depth + 1) : null}
        </li>
      ))}
    </ul>
  );
}

export function PersonalNewProjectScreen() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { showToast } = useToast();
  const settingsQuery = useQuery({
    queryKey: ['personal-settings'],
    queryFn: api.personalSettings,
  });
  const profilesQuery = useQuery({ queryKey: ['folder-profiles'], queryFn: api.folderProfiles });
  const catalogQuery = useQuery({
    queryKey: ['folder-profile-catalog'],
    queryFn: api.folderProfileCatalog,
  });
  const typesQuery = useQuery({ queryKey: ['project-types'], queryFn: api.projectTypes });
  const salesQuery = useQuery({ queryKey: ['sales-users'], queryFn: api.salesUsers });
  const [step, setStep] = useState(1);
  const [form, setForm] = useState({
    projectName: '',
    clientName: '',
    crmReference: '',
    commercialValueAmount: '',
    commercialCurrency: '',
    projectType: '',
    siteLocation: '',
    description: '',
    lightingScope: '',
    luxRequirements: '',
    drawingReference: '',
    designStage: 'Concept',
    priority: 'Normal',
    complexity: 'Medium',
    estimatedHours: 24,
    requiredDeliveryDate: defaultDeliveryDate(),
    projectRoot: '',
    folderMode: 'Create' as 'Create' | 'Connect' | 'Later',
    existingFolderPath: '',
    luminaireInputMode: 'Later' as LuminaireInputMode,
    salesOwnerId: '',
  });
  const inputModeTouchedRef = useRef(false);
  // P2.9A — initialize untouched projectType from the first active configured
  // catalogue type, and luminaireInputMode from the saved Personal setting.
  // A background refetch must never overwrite a value the user has already
  // changed, so we only apply when the field is still the untouched default.
  const [projectTypeInitialized, setProjectTypeInitialized] = useState(false);
  const [inputModeInitialized, setInputModeInitialized] = useState(false);

  useEffect(() => {
    if (projectTypeInitialized) return;
    const active = typesQuery.data?.filter((type) => type.isActive);
    if (!active?.length) return;
    setForm((current) =>
      current.projectType ? current : { ...current, projectType: active[0]!.name },
    );
    setProjectTypeInitialized(true);
  }, [typesQuery.data, projectTypeInitialized]);

  useEffect(() => {
    if (inputModeInitialized) return;
    const saved = settingsQuery.data?.defaultInputMode;
    if (!saved) return;
    if (!inputModeTouchedRef.current) {
      setForm((current) => ({ ...current, luminaireInputMode: saved }));
    }
    setInputModeInitialized(true);
  }, [settingsQuery.data, inputModeInitialized]);
  const [services, setServices] = useState<ProjectServiceCode[]>([
    'LightingLayout',
    'LuminaireSchedule',
    'TechnicalBoq',
    'Datasheets',
  ]);
  const [customScopeItems, setCustomScopeItems] = useState<ProjectScopeItem[]>([]);
  const [customScopeInput, setCustomScopeInput] = useState('');

  // P2.4B3B2B - canonical project folder draft state.
  const [profileRef, setProfileRef] = useState<FolderProfileRef | null>(null);
  const [draft, setDraft] = useState<ProjectFolderDraft>(blankDraft());
  const [sourcePreset, setSourcePreset] = useState<FolderProfilePreset | null>(null);
  const [customizing, setCustomizing] = useState(false);
  const [pendingProfileRef, setPendingProfileRef] = useState<FolderProfileRef | null>(null);
  const [resetConfirmOpen, setResetConfirmOpen] = useState(false);
  const [saveAsProfileOpen, setSaveAsProfileOpen] = useState(false);
  const [saveAsProfileName, setSaveAsProfileName] = useState('');

  const idempotencyKeyRef = useRef<string | null>(null);
  if (idempotencyKeyRef.current == null) {
    idempotencyKeyRef.current = crypto.randomUUID();
  }

  const projectRoot = form.projectRoot || settingsQuery.data?.projectRoot || '';

  const factoryProfiles = useMemo(
    () => profilesQuery.data?.filter((profile) => profile.source === 'factory') ?? [],
    [profilesQuery.data],
  );
  const userProfiles = useMemo(
    () => profilesQuery.data?.filter((profile) => profile.source === 'user') ?? [],
    [profilesQuery.data],
  );

  const resolvePreset = useCallback(
    (ref: FolderProfileRef): FolderProfilePreset | null => {
      if (ref.kind === 'blank') return null;
      if (ref.kind === 'factory') {
        return (
          factoryProfiles.find((profile) => profile.factoryProfileKey === ref.factoryProfileKey) ??
          null
        );
      }
      return userProfiles.find((profile) => profile.profileId === ref.profileId) ?? null;
    },
    [factoryProfiles, userProfiles],
  );

  const buildSourceProfile = useCallback(
    (ref: FolderProfileRef, preset: FolderProfilePreset | null): FolderProfileSource | null => {
      if (!preset) return null;
      const fingerprint = folderProfileStructuralFingerprint(preset.folders, preset.outputFolders);
      if (ref.kind === 'factory') {
        return factoryProfileSource(ref.factoryProfileKey, preset.name, fingerprint);
      }
      return {
        profileId: preset.profileId ?? null,
        profileName: preset.name,
        profileRevision: null,
        structuralFingerprint: fingerprint,
      };
    },
    [],
  );

  const buildDraftForRef = useCallback(
    (ref: FolderProfileRef) => {
      const preset = resolvePreset(ref);
      const sourceProfile = buildSourceProfile(ref, preset);
      if (!preset) {
        setDraft(blankDraft());
        setSourcePreset(null);
      } else if (ref.kind === 'user' && preset.profileId && catalogQuery.data?.profiles) {
        const canonical = catalogQuery.data.profiles.find(
          (profile) => profile.profileId === preset.profileId,
        );
        if (canonical) {
          setDraft(draftFromCanonicalProfile(canonical, sourceProfile, () => crypto.randomUUID()));
        } else {
          setDraft(draftFromPreset(preset, sourceProfile, () => crypto.randomUUID()));
        }
        setSourcePreset(preset);
      } else {
        setDraft(draftFromPreset(preset, sourceProfile, () => crypto.randomUUID()));
        setSourcePreset(preset);
      }
      setCustomizing(false);
    },
    [resolvePreset, buildSourceProfile, catalogQuery.data],
  );

  // Initialize the profile selector from the canonical default once data is ready.
  useEffect(() => {
    if (profileRef !== null) return;
    if (!catalogQuery.data || !profilesQuery.data) return;
    const ref = catalogQuery.data.effectiveDefaultRef;
    setProfileRef(ref);
    buildDraftForRef(ref);
  }, [catalogQuery.data, profilesQuery.data, profileRef, buildDraftForRef]);

  const customized = useMemo(
    () => draftMeaningfullyCustomized(draft, sourcePreset),
    [draft, sourcePreset],
  );
  const outputsValid = useMemo(() => draftOutputsValid(draft), [draft]);
  const draftTree = useMemo(() => flatToDraftTree(draft.folders), [draft.folders]);
  const commercialValue = useMemo(
    () => parseCommercialValueInput(form.commercialValueAmount, form.commercialCurrency),
    [form.commercialCurrency, form.commercialValueAmount],
  );
  const commercialValueDisplay =
    commercialValue.ok && commercialValue.value.commercialValueMinor !== undefined
      ? formatCommercialValue(
          commercialValue.value.commercialValueMinor,
          commercialValue.value.commercialCurrency,
        )
      : 'Not set';

  const canContinue = useMemo(() => {
    if (step === 1)
      return Boolean(
        form.projectName.trim() &&
        form.clientName.trim() &&
        form.projectType.trim() &&
        form.siteLocation.trim() &&
        form.lightingScope.trim() &&
        form.requiredDeliveryDate &&
        commercialValue.ok &&
        (!(salesQuery.data?.length ?? 0) || form.salesOwnerId),
      );
    if (step === 2) return true;
    if (step === 3) {
      if (form.folderMode === 'Later') return true;
      if (form.folderMode === 'Connect') return Boolean(form.existingFolderPath.trim());
      return Boolean(projectRoot.trim()) && outputsValid;
    }
    return true;
  }, [commercialValue.ok, form, outputsValid, projectRoot, salesQuery.data?.length, step]);

  const saveAsProfileMutation = useMutation({
    mutationFn: (name: string) =>
      api.createFolderProfile(
        draftToProfileCreateInput(draft, name, 'Custom project folder structure.'),
      ),
    onSuccess: async (profile) => {
      await queryClient.invalidateQueries({ queryKey: ['folder-profiles'] });
      await queryClient.invalidateQueries({ queryKey: ['folder-profile-catalog'] });
      setSaveAsProfileOpen(false);
      setSaveAsProfileName('');
      showToast(`${profile.name} saved as a new folder profile.`);
    },
    onError: (error) =>
      showToast(
        error instanceof Error ? error.message : 'Folder profile could not be saved.',
        'error',
      ),
  });

  const mutation = useMutation({
    mutationFn: api.createProject,
    onSuccess: async (result) => {
      await queryClient.invalidateQueries({ queryKey: ['projects'] });
      if (result.folderError)
        showToast(`Project created. Folder needs attention: ${result.folderError}`, 'error');
      else showToast(`${result.project.projectCode} is ready.`);
      const openedFolderPath = result.folderCreation?.folderPath ?? result.workspace?.folderPath;
      if (openedFolderPath && settingsQuery.data?.autoOpenProjectFolder && desktop.available()) {
        void desktop.openPath(openedFolderPath);
      }
      navigate(`/projects/${result.project.id}`);
    },
    onError: (error) =>
      showToast(error instanceof Error ? error.message : 'Project creation failed.', 'error'),
  });

  const update = (key: keyof typeof form, value: string | number | boolean) =>
    setForm((current) => ({ ...current, [key]: value }));
  const toggleService = (service: ProjectServiceCode) => {
    setServices((current) =>
      current.includes(service)
        ? current.filter((item) => item !== service)
        : [...current, service],
    );
  };
  const addCustomScopeItem = () => {
    const label = customScopeInput.trim();
    if (!label) return;
    if (
      customScopeItems.some(
        (item) => normalizeScopeLabel(item.label) === normalizeScopeLabel(label),
      )
    ) {
      showToast('That scope item is already in this project.', 'error');
      return;
    }
    setCustomScopeItems((current) => [
      ...current,
      {
        id: `custom:${
          label
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/^-+|-+$/g, '') || 'item'
        }`,
        code: null,
        label,
        custom: true,
      },
    ]);
    setCustomScopeInput('');
  };
  const removeCustomScopeItem = (id: string) => {
    setCustomScopeItems((current) => current.filter((item) => item.id !== id));
  };
  const scopeItems: ProjectScopeItem[] = [
    ...services.map((service) => ({
      id: service,
      code: service,
      label: projectServiceLabels[service],
      custom: false,
    })),
    ...customScopeItems,
  ];

  const handleProfileChange = (value: string) => {
    const nextRef = valueToRef(value);
    if (draftMeaningfullyCustomized(draft, sourcePreset)) {
      setPendingProfileRef(nextRef);
      return;
    }
    setProfileRef(nextRef);
    buildDraftForRef(nextRef);
  };

  const confirmProfileChange = () => {
    if (!pendingProfileRef) return;
    setProfileRef(pendingProfileRef);
    buildDraftForRef(pendingProfileRef);
    setPendingProfileRef(null);
  };

  const handleReset = () => {
    if (profileRef === null) return;
    buildDraftForRef(profileRef);
    setResetConfirmOpen(false);
  };

  const submit = () => {
    if (!commercialValue.ok) {
      showToast(commercialValue.error, 'error');
      return;
    }
    const {
      commercialValueAmount: _commercialValueAmount,
      commercialCurrency: _currency,
      ...rest
    } = form;
    void _commercialValueAmount;
    void _currency;
    const base = {
      ...rest,
      ...commercialValue.value,
      crmReference: form.crmReference.trim() || undefined,
      projectRoot: projectRoot || undefined,
      createFolders: form.folderMode === 'Create' && Boolean(projectRoot),
      connectFolderPath:
        form.folderMode === 'Connect' ? form.existingFolderPath || undefined : undefined,
      services,
      scopeItems,
      salesOwnerId: form.salesOwnerId || undefined,
      assignedDesignerId: null,
      collaboratorDesignerIds: [],
      projectFolderUrl: null,
      idempotencyKey: idempotencyKeyRef.current,
    };
    if (form.folderMode === 'Create') {
      // Canonical ProjectFolderDraft is the single folder-structure authority.
      mutation.mutate({
        ...base,
        folderProfile: sourcePreset?.name ?? 'Blank',
        folderDraft: draft,
      });
      return;
    }
    // Connect / Later keep their existing compatible semantics (no canonical draft).
    const defaultPreset = profileRef ? resolvePreset(profileRef) : null;
    mutation.mutate({
      ...base,
      folderProfile: defaultPreset?.name ?? 'Full Lighting Design',
    });
  };

  const steps = [
    ['Project', 'Core information'],
    ['Scope', 'Your deliverables'],
    ['Folders', 'Project structure'],
    ['Input', 'Luminaire source'],
    ['Review', 'Create workspace'],
  ];

  const sourceClass = sourcePreset
    ? sourcePreset.source === 'factory'
      ? 'Factory'
      : 'User'
    : 'Blank';

  return (
    <>
      <PageHeader
        eyebrow="Personal project setup"
        title="Create a lighting project"
        description="Define only what this project needs. BOQ and datasheets remain part of every delivery package."
      />
      <div className="personal-wizard">
        <aside className="wizard-rail">
          {steps.map(([title, detail], index) => {
            const number = index + 1;
            return (
              <button
                key={title}
                type="button"
                className={`${step === number ? 'active' : ''}${step > number ? ' complete' : ''}`}
                onClick={() => number < step && setStep(number)}
              >
                <span>{step > number ? <Check size={16} /> : number}</span>
                <div>
                  <strong>{title}</strong>
                  <small>{detail}</small>
                </div>
              </button>
            );
          })}
        </aside>

        <section className="wizard-panel">
          <div className="wizard-panel-head">
            <span>Step {step} of 5</span>
            <h2>{steps[step - 1]?.[0]}</h2>
            <p>{steps[step - 1]?.[1]}</p>
          </div>

          {step === 1 ? (
            <div className="form-grid wizard-fields">
              <label className="field field-wide">
                Project Name<span className="required">Required</span>
                <input
                  value={form.projectName}
                  onChange={(event) => update('projectName', event.target.value)}
                  placeholder="e.g. Private Villa — Dubai Hills"
                />
              </label>
              <label className="field">
                Client Name<span className="required">Required</span>
                <input
                  value={form.clientName}
                  onChange={(event) => update('clientName', event.target.value)}
                  placeholder="Client or consultant"
                />
              </label>
              <label className="field">
                CRM Reference <small>Optional</small>
                <input
                  value={form.crmReference}
                  onChange={(event) => update('crmReference', event.target.value)}
                  placeholder="e.g. CRM-48572"
                />
                <small>Optional reference used to link the project to a CRM record.</small>
              </label>
              <CommercialValueFields
                amount={form.commercialValueAmount}
                currency={form.commercialCurrency}
                error={commercialValue.ok ? undefined : commercialValue.error}
                onAmountChange={(value) => update('commercialValueAmount', value)}
                onCurrencyChange={(value) => update('commercialCurrency', value)}
                onClear={() =>
                  setForm((current) => ({
                    ...current,
                    commercialValueAmount: '',
                    commercialCurrency: '',
                  }))
                }
              />
              <label className="field">
                Salesperson
                {(salesQuery.data?.length ?? 0) > 0 ? (
                  <span className="required">Required</span>
                ) : null}
                <span className="select-wrap">
                  <select
                    value={form.salesOwnerId}
                    onChange={(event) => update('salesOwnerId', event.target.value)}
                  >
                    <option value="">
                      {salesQuery.data?.length ? 'Select salesperson' : 'Direct / not assigned'}
                    </option>
                    {salesQuery.data?.map((salesperson) => (
                      <option key={salesperson.id} value={salesperson.id}>
                        {salesperson.displayName}
                      </option>
                    ))}
                  </select>
                </span>
                <small>Manage names from the Sales Directory.</small>
              </label>
              <label className="field">
                Project Type<span className="required">Required</span>
                <span className="select-wrap">
                  <select
                    value={form.projectType}
                    onChange={(event) => update('projectType', event.target.value)}
                  >
                    {typesQuery.data
                      ?.filter((type) => type.isActive)
                      .map((type) => (
                        <option key={type.id}>{type.name}</option>
                      ))}
                  </select>
                </span>
                {!typesQuery.data?.some((type) => type.isActive) ? (
                  <small className="form-error" role="alert">
                    No active project types are configured. Add one in Settings before creating a
                    project.
                  </small>
                ) : null}
              </label>
              <label className="field field-wide">
                Site Location<span className="required">Required</span>
                <input
                  value={form.siteLocation}
                  onChange={(event) => update('siteLocation', event.target.value)}
                  placeholder="City, development or plot"
                />
              </label>
              <label className="field">
                Design Stage
                <span className="select-wrap">
                  <select
                    value={form.designStage}
                    onChange={(event) => update('designStage', event.target.value)}
                  >
                    <option>Concept</option>
                    <option value="SchematicDesign">Schematic Design</option>
                    <option value="DetailedDesign">Detailed Design</option>
                    <option>Tender</option>
                    <option>Construction</option>
                    <option value="AsBuilt">As Built</option>
                  </select>
                </span>
              </label>
              <label className="field">
                Required Delivery Date
                <input
                  type="date"
                  value={form.requiredDeliveryDate}
                  min={workspaceDateKey()}
                  onChange={(event) => update('requiredDeliveryDate', event.target.value)}
                />
              </label>
              <label className="field">
                Priority
                <span className="select-wrap">
                  <select
                    value={form.priority}
                    onChange={(event) => update('priority', event.target.value)}
                  >
                    <option>Normal</option>
                    <option>High</option>
                    <option>Urgent</option>
                  </select>
                </span>
              </label>
              <label className="field">
                Estimated Hours
                <input
                  type="number"
                  min="0"
                  value={form.estimatedHours}
                  onChange={(event) => update('estimatedHours', Number(event.target.value))}
                />
              </label>
              <label className="field field-wide">
                Lighting Scope<span className="required">Required</span>
                <textarea
                  rows={3}
                  value={form.lightingScope}
                  onChange={(event) => update('lightingScope', event.target.value)}
                  placeholder="Describe the spaces, expectations and lighting design scope"
                />
              </label>
              <label className="field">
                Lux Requirements
                <textarea
                  rows={2}
                  value={form.luxRequirements}
                  onChange={(event) => update('luxRequirements', event.target.value)}
                  placeholder="Optional targets or standards"
                />
              </label>
              <label className="field">
                Drawing Reference
                <textarea
                  rows={2}
                  value={form.drawingReference}
                  onChange={(event) => update('drawingReference', event.target.value)}
                  placeholder="Optional drawing numbers or revision"
                />
              </label>
            </div>
          ) : null}

          {step === 2 ? (
            <div className="service-picker">
              <div className="wizard-note">
                <Sparkles />
                <div>
                  <strong>Flexible scope, project by project</strong>
                  <span>
                    Choose the services that apply to this project, or add project-specific scope
                    items. Nothing is forced.
                  </span>
                </div>
              </div>
              <div className="service-grid">
                {projectServiceCodes.map((service) => {
                  const selected = services.includes(service);
                  return (
                    <button
                      type="button"
                      key={service}
                      className={selected ? 'selected' : ''}
                      onClick={() => toggleService(service)}
                    >
                      <span className="service-check">{selected ? <Check size={16} /> : null}</span>
                      <strong>{projectServiceLabels[service]}</strong>
                      <small>{selected ? 'Included in this project' : 'Not required'}</small>
                    </button>
                  );
                })}
              </div>
              <div className="custom-scope-editor">
                <label className="field">
                  Project-specific scope item
                  <span className="field-path-control">
                    <input
                      value={customScopeInput}
                      onChange={(event) => setCustomScopeInput(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter') {
                          event.preventDefault();
                          addCustomScopeItem();
                        }
                      }}
                      placeholder="e.g. Authority Submission"
                    />
                    <button className="button secondary" type="button" onClick={addCustomScopeItem}>
                      Add item
                    </button>
                  </span>
                </label>
                {customScopeItems.length ? (
                  <ul className="custom-scope-list">
                    {customScopeItems.map((item) => (
                      <li key={item.id}>
                        <span>{item.label}</span>
                        <button
                          type="button"
                          aria-label={`Remove ${item.label}`}
                          onClick={() => removeCustomScopeItem(item.id)}
                        >
                          <X size={14} />
                        </button>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </div>
            </div>
          ) : null}

          {step === 3 ? (
            <div className="folder-setup">
              <div className="folder-mode-picker" role="group" aria-label="Project folder mode">
                {(
                  [
                    ['Create', 'Create new', 'Build the customized folder tree now.'],
                    [
                      'Connect',
                      'Connect existing',
                      'Use an existing project folder without moving it.',
                    ],
                    ['Later', 'Decide later', 'Create the project record first.'],
                  ] as const
                ).map(([value, title, detail]) => (
                  <button
                    type="button"
                    className={form.folderMode === value ? 'selected' : ''}
                    key={value}
                    onClick={() => update('folderMode', value)}
                  >
                    <span className="service-check">
                      {form.folderMode === value ? <Check size={16} /> : null}
                    </span>
                    <strong>{title}</strong>
                    <small>{detail}</small>
                  </button>
                ))}
              </div>

              {form.folderMode === 'Create' ? (
                <>
                  <label className="field">
                    Projects Root Folder
                    <span className="field-path-control">
                      <input
                        value={projectRoot}
                        onChange={(event) => update('projectRoot', event.target.value)}
                        placeholder="e.g. D:\SCT PROJECTS"
                      />
                      <button
                        className="button secondary"
                        type="button"
                        onClick={async () => {
                          const selected = await desktop.selectFolder();
                          if (selected) update('projectRoot', selected);
                        }}
                      >
                        Browse
                      </button>
                    </span>
                    <small>
                      Choose the main folder that will contain the new numbered project.
                    </small>
                  </label>

                  <label className="field">
                    Folder Profile
                    <span className="select-wrap">
                      <select
                        value={profileRef ? refToValue(profileRef) : ''}
                        onChange={(event) => handleProfileChange(event.target.value)}
                      >
                        <option value="blank">Blank</option>
                        {factoryProfiles.map((profile) => (
                          <option
                            key={profile.factoryProfileKey ?? profile.name}
                            value={`factory:${profile.factoryProfileKey}`}
                          >
                            {profile.name}
                          </option>
                        ))}
                        {userProfiles.map((profile) => (
                          <option key={profile.profileId} value={`user:${profile.profileId}`}>
                            {profile.name}
                          </option>
                        ))}
                      </select>
                    </span>
                    <small>
                      Start from a template or a saved profile. Legacy profiles are imported from
                      Settings first.
                    </small>
                  </label>

                  <div className="draft-preview">
                    <div className="draft-preview-header">
                      <div>
                        <strong>{sourcePreset?.name ?? 'Blank'}</strong>
                        <span className="profile-source-class">{sourceClass}</span>
                      </div>
                      <span className={`draft-customized-badge ${customized ? 'customized' : ''}`}>
                        {customized ? 'Customized for this project' : 'Not customized'}
                      </span>
                    </div>
                    <div className="draft-preview-stats">
                      <span>{draft.folders.length} folders</span>
                      <span>{draft.outputMappings.length} output mappings</span>
                      <span className={outputsValid ? 'ok' : 'attention'}>
                        {outputsValid ? 'Outputs valid' : 'Outputs need attention'}
                      </span>
                    </div>
                    {draftTree.length ? (
                      renderDraftTree(draftTree)
                    ) : (
                      <p className="draft-preview-empty">
                        No folders yet — customize to add folders.
                      </p>
                    )}
                    <div className="draft-preview-actions">
                      <button
                        className="button secondary"
                        type="button"
                        onClick={() => setCustomizing((current) => !current)}
                      >
                        {customizing ? 'Close customization' : 'Customize for this project'}
                      </button>
                      {customized && sourcePreset ? (
                        <button
                          className="button ghost"
                          type="button"
                          onClick={() => setResetConfirmOpen(true)}
                        >
                          <RotateCcw size={15} /> Reset to Profile
                        </button>
                      ) : null}
                      {customized ? (
                        <button
                          className="button ghost"
                          type="button"
                          onClick={() => setSaveAsProfileOpen(true)}
                        >
                          <Save size={15} /> Save as New Profile
                        </button>
                      ) : null}
                    </div>
                  </div>

                  {customizing ? (
                    <ProjectFolderDraftEditor draft={draft} onChange={setDraft} />
                  ) : null}
                </>
              ) : null}

              {form.folderMode === 'Connect' ? (
                <label className="field">
                  Existing Project Folder
                  <span className="field-path-control">
                    <input
                      value={form.existingFolderPath}
                      onChange={(event) => update('existingFolderPath', event.target.value)}
                      placeholder="Select the exact existing project folder"
                    />
                    <button
                      className="button secondary"
                      type="button"
                      onClick={async () => {
                        const selected = await desktop.selectFolder();
                        if (selected) update('existingFolderPath', selected);
                      }}
                    >
                      Browse
                    </button>
                  </span>
                  <small>
                    The folder is linked in place. Existing files are never deleted or moved.
                  </small>
                </label>
              ) : null}
            </div>
          ) : null}

          {step === 4 ? (
            <section aria-labelledby="luminaire-input-heading">
              <div className="wizard-field-heading">
                <h3 id="luminaire-input-heading">Luminaire Input</h3>
                <p>
                  The initial selection comes from Settings and can be changed for this project.
                </p>
              </div>
              <div className="input-mode-grid">
                {luminaireInputModeOptions.map((mode) => (
                  <button
                    type="button"
                    key={mode.value}
                    className={form.luminaireInputMode === mode.value ? 'selected' : ''}
                    onClick={() => {
                      inputModeTouchedRef.current = true;
                      update('luminaireInputMode', mode.value);
                    }}
                  >
                    <FileInput />
                    <span>
                      <strong>{mode.label}</strong>
                      <small>{mode.detail}</small>
                    </span>
                    {form.luminaireInputMode === mode.value ? <CheckCircle2 /> : null}
                  </button>
                ))}
              </div>
            </section>
          ) : null}

          {step === 5 ? (
            <div className="project-review">
              <div className="review-hero">
                <span>Ready to create</span>
                <h2>{form.projectName}</h2>
                <p>
                  {form.clientName} · {form.siteLocation}
                </p>
              </div>
              <dl>
                <div>
                  <dt>Delivery</dt>
                  <dd>{form.requiredDeliveryDate}</dd>
                </div>
                <div>
                  <dt>Salesperson</dt>
                  <dd>
                    {salesQuery.data?.find((item) => item.id === form.salesOwnerId)?.displayName ??
                      'Direct / not assigned'}
                  </dd>
                </div>
                <div>
                  <dt>CRM Reference</dt>
                  <dd>{form.crmReference.trim() || 'Not Set'}</dd>
                </div>
                <div>
                  <dt>Commercial Value</dt>
                  <dd>{commercialValueDisplay}</dd>
                </div>
                <div>
                  <dt>Scope</dt>
                  <dd>
                    {scopeItems.length} scope item{scopeItems.length === 1 ? '' : 's'}
                  </dd>
                </div>
                <div>
                  <dt>Luminaire input</dt>
                  <dd>
                    {
                      luminaireInputModeOptions.find(
                        (mode) => mode.value === form.luminaireInputMode,
                      )?.label
                    }
                  </dd>
                </div>
              </dl>
              <div className="review-folder-summary">
                <div>
                  <dt>Folder setup</dt>
                  <dd>
                    {form.folderMode === 'Create'
                      ? 'Create new'
                      : form.folderMode === 'Connect'
                        ? 'Connect existing'
                        : 'Set up later'}
                  </dd>
                </div>
                {form.folderMode === 'Create' ? (
                  <>
                    <div>
                      <dt>Profile / source</dt>
                      <dd>{sourcePreset?.name ?? 'Blank'}</dd>
                    </div>
                    <div>
                      <dt>Customized</dt>
                      <dd>{customized ? 'Yes' : 'No'}</dd>
                    </div>
                    <div>
                      <dt>Folders</dt>
                      <dd>{draft.folders.length}</dd>
                    </div>
                    <div>
                      <dt>Output mappings</dt>
                      <dd>
                        {draft.outputMappings.length} · {outputsValid ? 'valid' : 'needs attention'}
                      </dd>
                    </div>
                  </>
                ) : null}
              </div>
              <div className="review-services">
                {scopeItems.map((item) => (
                  <span key={item.id}>
                    <Check size={13} /> {item.label}
                  </span>
                ))}
              </div>
            </div>
          ) : null}

          <footer className="wizard-actions">
            <button
              className="button ghost"
              type="button"
              disabled={step === 1 || mutation.isPending}
              onClick={() => setStep((current) => current - 1)}
            >
              <ArrowLeft size={16} /> Back
            </button>
            {step < 5 ? (
              <button
                className="button primary"
                type="button"
                disabled={!canContinue}
                onClick={() => setStep((current) => current + 1)}
              >
                Continue <ArrowRight size={16} />
              </button>
            ) : (
              <button
                className="button primary"
                type="button"
                disabled={mutation.isPending}
                onClick={submit}
              >
                {mutation.isPending ? <LoaderCircle className="spin" /> : <Sparkles />} Create
                Project Workspace
              </button>
            )}
          </footer>
        </section>
      </div>

      {pendingProfileRef ? (
        <div className="confirm-dialog-backdrop">
          <div
            className="confirm-dialog"
            role="dialog"
            aria-modal="true"
            aria-label="Change profile"
          >
            <h3>Change folder profile?</h3>
            <p>
              You customized this project's folder structure. Changing the profile will replace
              those changes.
            </p>
            <div className="confirm-dialog-actions">
              <button
                className="button ghost"
                type="button"
                onClick={() => setPendingProfileRef(null)}
              >
                Keep Current
              </button>
              <button className="button primary" type="button" onClick={confirmProfileChange}>
                Change Profile
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {resetConfirmOpen ? (
        <div className="confirm-dialog-backdrop">
          <div
            className="confirm-dialog"
            role="dialog"
            aria-modal="true"
            aria-label="Reset to profile"
          >
            <h3>Reset to profile?</h3>
            <p>
              This rebuilds the project folder structure from the selected profile. Your
              customizations for this project will be lost. The source profile is not changed.
            </p>
            <div className="confirm-dialog-actions">
              <button
                className="button ghost"
                type="button"
                onClick={() => setResetConfirmOpen(false)}
              >
                Cancel
              </button>
              <button className="button primary" type="button" onClick={handleReset}>
                Reset to Profile
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {saveAsProfileOpen ? (
        <div className="confirm-dialog-backdrop">
          <div
            className="confirm-dialog"
            role="dialog"
            aria-modal="true"
            aria-label="Save as new profile"
          >
            <h3>Save as new profile</h3>
            <p>
              Save this project's folder structure as a reusable profile. The current project draft
              is unchanged.
            </p>
            <label className="field">
              Profile name
              <input
                value={saveAsProfileName}
                onChange={(event) => setSaveAsProfileName(event.target.value)}
                placeholder="e.g. Full Lighting + Mockup"
              />
            </label>
            <div className="confirm-dialog-actions">
              <button
                className="button ghost"
                type="button"
                onClick={() => setSaveAsProfileOpen(false)}
              >
                Cancel
              </button>
              <button
                className="button primary"
                type="button"
                disabled={!saveAsProfileName.trim() || saveAsProfileMutation.isPending}
                onClick={() => saveAsProfileMutation.mutate(saveAsProfileName.trim())}
              >
                {saveAsProfileMutation.isPending ? <LoaderCircle className="spin" /> : null} Save
                Profile
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
