import { v4Decisions } from '../../components/interaction/V4Decisions';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import {
  SctBack as ArrowLeft,
  SctNext as ArrowRight,
  SctSuccess as CheckCircle2,
  SctWarning as CircleAlert,
  SctRevisions as Layers3,
  SctRestore as RotateCcw,
  SctGenerate as Sparkles,
  SctCommercial as WalletCards,
} from '../../components/common/SctIcons';
import {
  Building2,
  CalendarDays,
  Check,
  ClipboardCheck,
  Clock3,
  FileInput,
  Folder,
  FolderInput,
  FolderPlus,
  FolderTree,
  Gauge,
  Lightbulb,
  Link2,
  LoaderCircle,
  MapPin,
  Plus,
  Save,
  UserRound,
  X,
} from '../../components/common/SctIcons';
import {
  luminaireInputModeOptions,
  projectServiceCodes,
  projectServiceLabels,
  type FolderProfilePreset,
  type LuminaireInputMode,
  type ProjectFolderDraft,
  type ProjectServiceCode,
} from '@scli/domain';
import { api } from '../../api/environment';
import { V4AppShell } from '../../components/shell/V4AppShell';
import { V4PageHeader } from '../../components/common/V4PageHeader';
import {
  readStoredSidebarMode,
  writeStoredSidebarMode,
  type SidebarMode,
} from '../../components/sidebar/sidebarMode';
import { ROUTE_PROJECTS, ROUTE_PROJECT_SUMMARY, projectRoute } from '../../router/routes';
import {
  defaultDeliveryDate,
  draftFromPreset,
  folderPath,
  parseCommercialValue,
  profileCreateBody,
  todayInDubai,
  type FolderMode,
} from './newProjectModel';
import { buildScopeItems, validateProjectCore } from '../../components/project/projectFormModel';

const STEPS = [
  'Project Info',
  'Scope & Services',
  'Folder Structure',
  'Luminaire Input',
  'Review & Create',
] as const;
type Errors = Record<string, string>;

const serviceIcons = [Lightbulb, Layers3, Gauge, ClipboardCheck, FileInput, Sparkles];

export function LegacyNewProjectPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [sidebarMode, setSidebarMode] = useState<SidebarMode>(() =>
    readStoredSidebarMode(window.localStorage),
  );
  const [step, setStep] = useState(1);
  const [furthest, setFurthest] = useState(1);
  const [errors, setErrors] = useState<Errors>({});
  const [notice, setNotice] = useState('');
  const [form, setForm] = useState({
    projectName: '',
    clientName: '',
    crmReference: '',
    projectType: '',
    salesOwnerId: '',
    siteLocation: '',
    lightingScope: '',
    requiredDeliveryDate: defaultDeliveryDate(),
    estimatedHours: '24',
    commercialValue: '',
    commercialCurrency: '',
    description: '',
    designStage: 'Concept',
    priority: 'Normal',
    complexity: 'Medium',
    luxRequirements: '',
    drawingReference: '',
    folderMode: 'Later' as FolderMode,
    projectRoot: '',
    connectFolderPath: '',
    luminaireInputMode: 'Later' as LuminaireInputMode,
  });
  const [services, setServices] = useState<ProjectServiceCode[]>([
    'LightingLayout',
    'LuminaireSchedule',
    'TechnicalBoq',
    'Datasheets',
  ]);
  const [customItems, setCustomItems] = useState<string[]>([]);
  const [customInput, setCustomInput] = useState('');
  const [selectedProfile, setSelectedProfile] = useState('');
  const [draft, setDraft] = useState<ProjectFolderDraft>({
    folders: [],
    outputMappings: [],
    sourceProfile: null,
  });
  const [profileBaseline, setProfileBaseline] = useState<ProjectFolderDraft | null>(null);
  const [newFolder, setNewFolder] = useState('');
  const [saveProfileName, setSaveProfileName] = useState('');
  const idempotencyKey = useRef(crypto.randomUUID());
  const inputTouched = useRef(false);

  const settings = useQuery({ queryKey: ['v4', 'new', 'settings'], queryFn: api.personalSettings });
  const types = useQuery({ queryKey: ['v4', 'new', 'types'], queryFn: api.projectTypes });
  const sales = useQuery({ queryKey: ['v4', 'new', 'sales'], queryFn: api.salesUsers });
  const profiles = useQuery({ queryKey: ['v4', 'new', 'profiles'], queryFn: api.folderProfiles });
  const catalog = useQuery({
    queryKey: ['v4', 'new', 'profile-catalog'],
    queryFn: api.folderProfileCatalog,
  });

  const activeTypes = (types.data ?? []).filter((item) => item.isActive);
  const chosenProfile = (profiles.data ?? []).find(
    (item) => profileValue(item) === selectedProfile,
  );
  const effectiveRoot = form.projectRoot || settings.data?.projectRoot || '';
  const dirty =
    Object.values(form).some(
      (value) =>
        value !== '' &&
        value !== '24' &&
        value !== 'Later' &&
        value !== 'Concept' &&
        value !== 'Normal' &&
        value !== 'Medium',
    ) || customItems.length > 0;

  useEffect(() => {
    if (!form.projectType && activeTypes[0])
      setForm((current) => ({ ...current, projectType: activeTypes[0]!.name }));
  }, [activeTypes, form.projectType]);
  useEffect(() => {
    if (!inputTouched.current && settings.data?.defaultInputMode)
      setForm((current) => ({ ...current, luminaireInputMode: settings.data!.defaultInputMode }));
  }, [settings.data]);
  useEffect(() => {
    if (selectedProfile || !profiles.data || !catalog.data) return;
    const ref = catalog.data.effectiveDefaultRef;
    const value =
      ref.kind === 'factory'
        ? `factory:${ref.factoryProfileKey}`
        : ref.kind === 'user'
          ? `user:${ref.profileId}`
          : 'blank';
    applyProfile(value);
    // apply once when both catalogues resolve
  }, [profiles.data, catalog.data]);

  const commercial = useMemo(
    () => parseCommercialValue(form.commercialValue, form.commercialCurrency),
    [form.commercialValue, form.commercialCurrency],
  );
  const customized = profileBaseline
    ? JSON.stringify(draft) !== JSON.stringify(profileBaseline)
    : draft.folders.length > 0;

  function update(key: string, value: string) {
    setForm((current) => ({ ...current, [key]: value }));
    setErrors((current) => ({ ...current, [key]: '' }));
  }
  function applyProfile(value: string) {
    setSelectedProfile(value);
    const profile = (profiles.data ?? []).find((item) => profileValue(item) === value);
    const next = profile
      ? draftFromPreset(profile)
      : { folders: [], outputMappings: [], sourceProfile: null };
    setDraft(next);
    setProfileBaseline(structuredClone(next));
  }
  function validateStep(target = step) {
    const next: Errors = {};
    if (target === 1) {
      Object.assign(next, validateProjectCore(form, todayInDubai()));
      if (!commercial.ok) next.commercialValue = commercial.error;
    }
    if (target === 3 && form.folderMode === 'Create' && !effectiveRoot.trim())
      next.projectRoot = 'Choose a project root.';
    if (target === 3 && form.folderMode === 'Connect' && !form.connectFolderPath.trim())
      next.connectFolderPath = 'Choose an existing project folder.';
    setErrors(next);
    return Object.keys(next).length === 0;
  }
  function continueStep() {
    if (!validateStep()) return;
    setStep((current) => current + 1);
    setFurthest((current) => Math.max(current, step + 1));
  }
  async function cancel() {
    if (!dirty || (await v4Decisions.confirm('Discard this new project setup?')))
      navigate(ROUTE_PROJECTS);
  }
  async function browse(key: 'projectRoot' | 'connectFolderPath') {
    const selected = await window.scliDesktop?.selectFolder?.();
    if (selected) update(key, selected);
  }

  const saveProfile = useMutation({
    mutationFn: () => api.createFolderProfile(profileCreateBody(draft, saveProfileName.trim())),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['v4', 'new', 'profiles'] });
      setSaveProfileName('');
      setNotice('Folder profile saved.');
    },
    onError: (error) =>
      setNotice(error instanceof Error ? error.message : 'Folder profile could not be saved.'),
  });
  const create = useMutation({
    mutationFn: api.createProject,
    onSuccess: async (result) => {
      await queryClient.invalidateQueries({ queryKey: ['v4'] });
      const path = result.folderCreation?.folderPath ?? result.workspace?.folderPath;
      if (result.folderError)
        setNotice(`Project created. Folder needs attention: ${result.folderError}`);
      if (path && settings.data?.autoOpenProjectFolder && window.scliDesktop?.openPath)
        void window.scliDesktop.openPath(path);
      navigate(projectRoute(ROUTE_PROJECT_SUMMARY, result.project.id), {
        state: result.folderError ? { folderError: result.folderError } : undefined,
      });
    },
    onError: (error) =>
      setNotice(error instanceof Error ? error.message : 'Project creation failed.'),
  });
  function submit() {
    if (create.isPending || ![1, 3].every(validateStep)) return;
    if (!commercial.ok) return;
    const scopeItems = buildScopeItems(services, customItems);
    const payload = {
      projectName: form.projectName.trim(),
      clientName: form.clientName.trim(),
      crmReference: form.crmReference.trim() || undefined,
      ...commercial.value,
      projectType: form.projectType,
      description: form.description.trim(),
      salesOwnerId: form.salesOwnerId || undefined,
      assignedDesignerId: null,
      collaboratorDesignerIds: [],
      siteLocation: form.siteLocation.trim(),
      designStage: form.designStage,
      lightingScope: form.lightingScope.trim(),
      luxRequirements: form.luxRequirements.trim(),
      drawingReference: form.drawingReference.trim(),
      priority: form.priority,
      complexity: form.complexity,
      estimatedHours: Number(form.estimatedHours),
      requiredDeliveryDate: form.requiredDeliveryDate,
      projectFolderUrl: null,
      projectRoot: form.folderMode === 'Create' ? effectiveRoot : undefined,
      connectFolderPath: form.folderMode === 'Connect' ? form.connectFolderPath.trim() : undefined,
      createFolders: form.folderMode === 'Create',
      folderProfile: chosenProfile?.name ?? 'Blank',
      folderDraft: form.folderMode === 'Create' ? draft : undefined,
      services,
      scopeItems,
      luminaireInputMode: form.luminaireInputMode,
      idempotencyKey: idempotencyKey.current,
    };
    create.mutate(payload);
  }

  const guidance = guidanceForStep(step);
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
      activeSectionId="projects"
      onSelectSection={(id) => id === 'projects' && navigate(ROUTE_PROJECTS)}
      pageHeader={
        <V4PageHeader
          title="New Project"
          description="Create a lighting design project and configure its workspace."
          icon={FolderPlus}
          actions={
            <button className="v4-new-project__cancel" type="button" onClick={cancel}>
              <X /> Cancel
            </button>
          }
        />
      }
    >
      <main className="v4-new-project" data-testid="v4-new-project">
        <nav className="v4-new-project__stepper" aria-label="New Project steps">
          {STEPS.map((label, index) => {
            const number = index + 1;
            return (
              <button
                key={label}
                type="button"
                aria-label={`${number}. ${label}`}
                aria-current={step === number ? 'step' : undefined}
                disabled={number > furthest}
                onClick={() => number <= furthest && setStep(number)}
              >
                <span>{number < step ? <Check /> : number}</span>
                <strong>{label}</strong>
              </button>
            );
          })}
        </nav>
        {notice ? (
          <div className="v4-new-project__notice" role="status">
            <CircleAlert />
            {notice}
            <button type="button" aria-label="Dismiss message" onClick={() => setNotice('')}>
              <X />
            </button>
          </div>
        ) : null}
        <div className="v4-new-project__layout">
          <section className="v4-new-project__panel">
            {step === 1 ? (
              <ProjectInfo
                form={form}
                update={update}
                errors={errors}
                activeTypes={activeTypes}
                sales={sales.data ?? []}
                loading={types.isLoading || sales.isLoading}
                failed={types.isError || sales.isError}
                retry={() => {
                  void types.refetch();
                  void sales.refetch();
                }}
              />
            ) : null}
            {step === 2 ? (
              <ScopeStep
                services={services}
                setServices={setServices}
                customItems={customItems}
                setCustomItems={setCustomItems}
                customInput={customInput}
                setCustomInput={setCustomInput}
              />
            ) : null}
            {step === 3 ? (
              <FolderStep
                form={form}
                update={update}
                error={errors}
                profiles={profiles.data ?? []}
                loading={profiles.isLoading || catalog.isLoading}
                failed={profiles.isError || catalog.isError}
                selectedProfile={selectedProfile}
                applyProfile={applyProfile}
                draft={draft}
                setDraft={setDraft}
                customized={customized}
                reset={() => profileBaseline && setDraft(structuredClone(profileBaseline))}
                newFolder={newFolder}
                setNewFolder={setNewFolder}
                browse={browse}
                effectiveRoot={effectiveRoot}
                saveProfileName={saveProfileName}
                setSaveProfileName={setSaveProfileName}
                saveProfile={() => saveProfile.mutate()}
              />
            ) : null}
            {step === 4 ? (
              <InputStep
                value={form.luminaireInputMode}
                onChange={(value) => {
                  inputTouched.current = true;
                  update('luminaireInputMode', value);
                }}
              />
            ) : null}
            {step === 5 ? (
              <ReviewStep
                form={form}
                services={services}
                customItems={customItems}
                sales={sales.data ?? []}
                profile={chosenProfile}
                draft={draft}
                edit={setStep}
              />
            ) : null}
            <footer className="v4-new-project__actions">
              <button
                type="button"
                className="secondary"
                onClick={() => (step === 1 ? cancel() : setStep(step - 1))}
              >
                <ArrowLeft />
                {step === 1 ? 'Cancel' : 'Back'}
              </button>
              {step < 5 ? (
                <button type="button" className="primary" onClick={continueStep}>
                  Continue: {STEPS[step]}
                  <ArrowRight />
                </button>
              ) : (
                <button
                  type="button"
                  className="primary"
                  disabled={create.isPending}
                  onClick={submit}
                >
                  {create.isPending ? <LoaderCircle className="spin" /> : <Sparkles />}Create
                  Project Workspace
                </button>
              )}
            </footer>
          </section>
          <aside className="v4-new-project__guidance">
            <section>
              <guidance.Icon />
              <div>
                <h2>{guidance.title}</h2>
                <p>{guidance.text}</p>
              </div>
            </section>
            <section className="success">
              <CheckCircle2 />
              <div>
                <h2>Best practice</h2>
                <p>{guidance.tip}</p>
              </div>
            </section>
            <section>
              <Lightbulb />
              <div>
                <h2>Good to know</h2>
                <p>Nothing is saved until you create the project workspace.</p>
              </div>
            </section>
          </aside>
        </div>
      </main>
    </V4AppShell>
  );
}

function Field({
  label,
  icon: Icon,
  error,
  children,
  wide = false,
}: {
  label: string;
  icon: typeof Folder;
  error?: string | undefined;
  children: React.ReactNode;
  wide?: boolean;
}) {
  return (
    <label className={`v4-new-project__field${wide ? ' wide' : ''}`}>
      <span>
        <Icon />
        {label}
      </span>
      {children}
      {error ? <small role="alert">{error}</small> : null}
    </label>
  );
}

function ProjectInfo({
  form,
  update,
  errors,
  activeTypes,
  sales,
  loading,
  failed,
  retry,
}: {
  form: Record<string, string>;
  update: (key: string, value: string) => void;
  errors: Errors;
  activeTypes: Array<{ id: string; name: string }>;
  sales: Array<{ id: string; displayName: string; isActive?: boolean }>;
  loading: boolean;
  failed: boolean;
  retry: () => void;
}) {
  if (failed)
    return (
      <div className="v4-new-project__catalog-error" role="alert">
        <CircleAlert />
        <h2>Required catalogues are unavailable</h2>
        <button type="button" onClick={retry}>
          Retry
        </button>
      </div>
    );
  return (
    <>
      <SectionTitle
        icon={FolderPlus}
        title="Project Information"
        text="Enter the real project details used to create the workspace."
      />
      {loading ? <p>Loading project catalogues…</p> : null}
      <div className="v4-new-project__form-grid">
        <Field label="Project Name *" icon={Folder} error={errors.projectName}>
          <input value={form.projectName} onChange={(e) => update('projectName', e.target.value)} />
        </Field>
        <Field label="Client Name *" icon={Building2} error={errors.clientName}>
          <input value={form.clientName} onChange={(e) => update('clientName', e.target.value)} />
        </Field>
        <Field label="CRM Reference" icon={Link2}>
          <input
            value={form.crmReference}
            onChange={(e) => update('crmReference', e.target.value)}
          />
        </Field>
        <Field label="Project Type *" icon={Layers3} error={errors.projectType}>
          <select value={form.projectType} onChange={(e) => update('projectType', e.target.value)}>
            <option value="">Select project type</option>
            {activeTypes.map((item) => (
              <option key={item.id}>{item.name}</option>
            ))}
          </select>
        </Field>
        <Field label="Sales Owner" icon={UserRound}>
          <select
            value={form.salesOwnerId}
            onChange={(e) => update('salesOwnerId', e.target.value)}
          >
            <option value="">Use server default</option>
            {sales
              .filter((u) => u.isActive !== false)
              .map((u) => (
                <option key={u.id} value={u.id}>
                  {u.displayName}
                </option>
              ))}
          </select>
        </Field>
        <Field label="Priority" icon={Gauge}>
          <select value={form.priority} onChange={(e) => update('priority', e.target.value)}>
            <option>Normal</option>
            <option>High</option>
            <option>Urgent</option>
          </select>
        </Field>
        <Field label="Design Stage" icon={Layers3}>
          <select value={form.designStage} onChange={(e) => update('designStage', e.target.value)}>
            <option>Concept</option>
            <option value="SchematicDesign">Schematic Design</option>
            <option value="DetailedDesign">Detailed Design</option>
            <option>Tender</option>
            <option>Construction</option>
            <option value="AsBuilt">As Built</option>
          </select>
        </Field>
        <Field label="Complexity" icon={Gauge}>
          <select value={form.complexity} onChange={(e) => update('complexity', e.target.value)}>
            <option>Small</option>
            <option>Medium</option>
            <option>Large</option>
          </select>
        </Field>
        <Field
          label="Required Delivery Date *"
          icon={CalendarDays}
          error={errors.requiredDeliveryDate}
        >
          <input
            type="date"
            min={todayInDubai()}
            value={form.requiredDeliveryDate}
            onChange={(e) => update('requiredDeliveryDate', e.target.value)}
          />
        </Field>
        <Field label="Estimated Hours *" icon={Clock3} error={errors.estimatedHours}>
          <input
            type="number"
            min="0"
            max="10000"
            value={form.estimatedHours}
            onChange={(e) => update('estimatedHours', e.target.value)}
          />
        </Field>
        <Field label="Commercial Value" icon={WalletCards} error={errors.commercialValue}>
          <input
            inputMode="decimal"
            value={form.commercialValue}
            placeholder="Optional amount"
            onChange={(e) => update('commercialValue', e.target.value)}
          />
        </Field>
        <Field label="Currency" icon={WalletCards}>
          <input
            maxLength={3}
            value={form.commercialCurrency}
            placeholder="e.g. AED"
            onChange={(e) => update('commercialCurrency', e.target.value.toUpperCase())}
          />
        </Field>
        <Field label="Site Location *" icon={MapPin} error={errors.siteLocation} wide>
          <input
            value={form.siteLocation}
            onChange={(e) => update('siteLocation', e.target.value)}
          />
        </Field>
        <Field label="Lighting Scope *" icon={Lightbulb} error={errors.lightingScope} wide>
          <textarea
            rows={3}
            value={form.lightingScope}
            onChange={(e) => update('lightingScope', e.target.value)}
          />
        </Field>
        <Field label="Lux Requirements" icon={Gauge}>
          <textarea
            rows={2}
            value={form.luxRequirements}
            onChange={(e) => update('luxRequirements', e.target.value)}
          />
        </Field>
        <Field label="Drawing Reference" icon={FileInput}>
          <textarea
            rows={2}
            value={form.drawingReference}
            onChange={(e) => update('drawingReference', e.target.value)}
          />
        </Field>
        <Field label="Description" icon={ClipboardCheck} wide>
          <textarea
            rows={2}
            value={form.description}
            onChange={(e) => update('description', e.target.value)}
          />
        </Field>
      </div>
    </>
  );
}

function ScopeStep({
  services,
  setServices,
  customItems,
  setCustomItems,
  customInput,
  setCustomInput,
}: {
  services: ProjectServiceCode[];
  setServices: React.Dispatch<React.SetStateAction<ProjectServiceCode[]>>;
  customItems: string[];
  setCustomItems: React.Dispatch<React.SetStateAction<string[]>>;
  customInput: string;
  setCustomInput: (value: string) => void;
}) {
  const add = () => {
    const value = customInput.trim();
    if (value && !customItems.some((item) => item.toLowerCase() === value.toLowerCase()))
      setCustomItems((items) => [...items, value]);
    setCustomInput('');
  };
  return (
    <>
      <SectionTitle
        icon={Layers3}
        title="Scope & Services"
        text="Choose canonical services and add supported project-specific scope."
      />
      <div className="v4-new-project__service-grid">
        {projectServiceCodes.map((service, index) => {
          const Icon = serviceIcons[index % serviceIcons.length]!;
          const selected = services.includes(service);
          return (
            <button
              type="button"
              key={service}
              className={selected ? 'selected' : ''}
              aria-pressed={selected}
              onClick={() =>
                setServices((items) =>
                  selected ? items.filter((item) => item !== service) : [...items, service],
                )
              }
            >
              <Icon />
              <span>
                <strong>{projectServiceLabels[service]}</strong>
                <small>{selected ? 'Included' : 'Not included'}</small>
              </span>
              {selected ? <CheckCircle2 /> : null}
            </button>
          );
        })}
      </div>
      <section className="v4-new-project__custom">
        <h3>Custom scope items</h3>
        <div>
          <input
            aria-label="Custom scope item"
            value={customInput}
            onChange={(e) => setCustomInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                add();
              }
            }}
          />
          <button type="button" onClick={add}>
            <Plus />
            Add item
          </button>
        </div>
        {customItems.map((item) => (
          <span key={item}>
            {item}
            <button
              type="button"
              aria-label={`Remove ${item}`}
              onClick={() => setCustomItems((items) => items.filter((value) => value !== item))}
            >
              <X />
            </button>
          </span>
        ))}
      </section>
    </>
  );
}

function FolderStep({
  form,
  update,
  error,
  profiles,
  loading,
  failed,
  selectedProfile,
  applyProfile,
  draft,
  setDraft,
  customized,
  reset,
  newFolder,
  setNewFolder,
  browse,
  effectiveRoot,
  saveProfileName,
  setSaveProfileName,
  saveProfile,
}: {
  form: Record<string, string>;
  update: (key: string, value: string) => void;
  error: Errors;
  profiles: FolderProfilePreset[];
  loading: boolean;
  failed: boolean;
  selectedProfile: string;
  applyProfile: (value: string) => void;
  draft: ProjectFolderDraft;
  setDraft: React.Dispatch<React.SetStateAction<ProjectFolderDraft>>;
  customized: boolean;
  reset: () => void;
  newFolder: string;
  setNewFolder: (value: string) => void;
  browse: (key: 'projectRoot' | 'connectFolderPath') => Promise<void>;
  effectiveRoot: string;
  saveProfileName: string;
  setSaveProfileName: (value: string) => void;
  saveProfile: () => void;
}) {
  const mode = form.folderMode as FolderMode;
  const addFolder = () => {
    const name = newFolder.trim();
    if (!name) return;
    setDraft((current) => ({
      ...current,
      folders: [
        ...current.folders,
        {
          draftFolderId: crypto.randomUUID(),
          parentDraftFolderId: null,
          name,
          displayOrder: current.folders.filter((f) => !f.parentDraftFolderId).length,
        },
      ],
    }));
    setNewFolder('');
  };
  return (
    <>
      <SectionTitle
        icon={FolderTree}
        title="Folder Structure"
        text="Create a folder structure, connect an existing folder, or safely decide later."
      />
      <div className="v4-new-project__folder-modes">
        {(
          [
            ['Create', FolderPlus, 'Create new folders'],
            ['Connect', FolderInput, 'Connect an existing folder'],
            ['Later', Clock3, 'Set up after creation'],
          ] as const
        ).map(([value, Icon, text]) => (
          <button
            key={value}
            type="button"
            className={mode === value ? 'selected' : ''}
            onClick={() => update('folderMode', value)}
          >
            <Icon />
            <strong>{value}</strong>
            <small>{text}</small>
            {mode === value ? <CheckCircle2 /> : null}
          </button>
        ))}
      </div>
      {mode === 'Later' ? (
        <div className="v4-new-project__later">
          <Clock3 />
          <h3>No folder side effects</h3>
          <p>The project record will be created without creating or connecting folders.</p>
        </div>
      ) : null}
      {mode === 'Connect' ? (
        <Field
          label="Existing Project Folder *"
          icon={FolderInput}
          error={error.connectFolderPath}
          wide
        >
          <span className="v4-new-project__path">
            <input
              value={form.connectFolderPath}
              onChange={(e) => update('connectFolderPath', e.target.value)}
            />
            <button
              type="button"
              disabled={!window.scliDesktop?.selectFolder}
              onClick={() => void browse('connectFolderPath')}
            >
              Browse
            </button>
          </span>
        </Field>
      ) : null}
      {mode === 'Create' ? (
        <div className="v4-new-project__folder-create">
          <div>
            <Field label="Project Root *" icon={Folder} error={error.projectRoot}>
              <span className="v4-new-project__path">
                <input
                  value={effectiveRoot}
                  onChange={(e) => update('projectRoot', e.target.value)}
                />
                <button
                  type="button"
                  disabled={!window.scliDesktop?.selectFolder}
                  onClick={() => void browse('projectRoot')}
                >
                  Browse
                </button>
              </span>
            </Field>
            <Field label="Folder Profile" icon={FolderTree}>
              {loading ? (
                <span>Loading profiles…</span>
              ) : failed ? (
                <span role="alert">Folder profiles unavailable.</span>
              ) : (
                <select value={selectedProfile} onChange={(e) => applyProfile(e.target.value)}>
                  <option value="blank">Blank</option>
                  {profiles.map((profile) => (
                    <option key={profileValue(profile)} value={profileValue(profile)}>
                      {profile.name}
                    </option>
                  ))}
                </select>
              )}
            </Field>
            <div className="v4-new-project__folder-tools">
              <button type="button" disabled={!customized} onClick={reset}>
                <RotateCcw />
                Reset to Profile
              </button>
              <input
                aria-label="New root folder"
                value={newFolder}
                onChange={(e) => setNewFolder(e.target.value)}
              />
              <button type="button" onClick={addFolder}>
                <Plus />
                Add folder
              </button>
              {customized ? (
                <>
                  <input
                    aria-label="New profile name"
                    value={saveProfileName}
                    onChange={(e) => setSaveProfileName(e.target.value)}
                  />
                  <button type="button" disabled={!saveProfileName.trim()} onClick={saveProfile}>
                    <Save />
                    Save as New Profile
                  </button>
                </>
              ) : null}
            </div>
          </div>
          <div className="v4-new-project__tree">
            <header>
              <FolderTree />
              <strong>Structure Preview</strong>
              <span>{draft.folders.length} folders</span>
            </header>
            {draft.folders.length ? (
              <ul>
                {draft.folders.map((folder) => (
                  <li
                    key={folder.draftFolderId}
                    style={{
                      paddingLeft: `${12 + folderPath(draft, folder.draftFolderId).split('/').length * 14}px`,
                    }}
                  >
                    <Folder />
                    {folder.name}
                    <button
                      type="button"
                      aria-label={`Remove ${folder.name}`}
                      onClick={() =>
                        setDraft((current) => ({
                          ...current,
                          folders: current.folders.filter(
                            (item) =>
                              item.draftFolderId !== folder.draftFolderId &&
                              item.parentDraftFolderId !== folder.draftFolderId,
                          ),
                          outputMappings: current.outputMappings.filter(
                            (item) => item.destinationDraftFolderId !== folder.draftFolderId,
                          ),
                        }))
                      }
                    >
                      <X />
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <p>No folders in this draft.</p>
            )}
          </div>
        </div>
      ) : null}
    </>
  );
}

function InputStep({
  value,
  onChange,
}: {
  value: LuminaireInputMode;
  onChange: (value: LuminaireInputMode) => void;
}) {
  return (
    <>
      <SectionTitle
        icon={FileInput}
        title="Luminaire Input"
        text="Choose only the initial supported input mode; importing happens inside the project."
      />
      <div className="v4-new-project__input-grid">
        {luminaireInputModeOptions.map((option) => (
          <button
            key={option.value}
            type="button"
            className={value === option.value ? 'selected' : ''}
            onClick={() => onChange(option.value)}
          >
            <FileInput />
            <span>
              <strong>{option.label}</strong>
              <small>{option.detail}</small>
            </span>
            {value === option.value ? <CheckCircle2 /> : null}
          </button>
        ))}
      </div>
    </>
  );
}

function ReviewStep({
  form,
  services,
  customItems,
  sales,
  profile,
  draft,
  edit,
}: {
  form: Record<string, string>;
  services: ProjectServiceCode[];
  customItems: string[];
  sales: Array<{ id: string; displayName: string }>;
  profile: FolderProfilePreset | undefined;
  draft: ProjectFolderDraft;
  edit: (step: number) => void;
}) {
  const cards = [
    {
      title: 'Project Info',
      step: 1,
      Icon: FolderPlus,
      rows: [
        ['Project Name', form.projectName],
        ['Client', form.clientName],
        ['CRM', form.crmReference || '—'],
        ['Project Type', form.projectType],
        [
          'Sales Owner',
          sales.find((u) => u.id === form.salesOwnerId)?.displayName ?? 'Server default',
        ],
        ['Priority', form.priority],
        ['Design Stage', form.designStage],
        ['Due Date', form.requiredDeliveryDate],
        ['Estimated Hours', form.estimatedHours],
        ['Site', form.siteLocation],
        ['Lighting Scope', form.lightingScope],
        [
          'Commercial Value',
          form.commercialValue ? `${form.commercialCurrency} ${form.commercialValue}` : '—',
        ],
      ],
    },
    {
      title: 'Scope & Services',
      step: 2,
      Icon: Layers3,
      rows: [
        ['Services', services.map((s) => projectServiceLabels[s]).join(', ') || 'None'],
        ['Custom Scope', customItems.join(', ') || 'None'],
      ],
    },
    {
      title: 'Folder Structure',
      step: 3,
      Icon: FolderTree,
      rows:
        form.folderMode === 'Create'
          ? [
              ['Mode', 'Create'],
              ['Folder Profile', profile?.name ?? 'Blank'],
              ['Project Root', form.projectRoot],
              ['Folders', String(draft.folders.length)],
            ]
          : form.folderMode === 'Connect'
            ? [
                ['Mode', 'Connect'],
                ['Connected Path', form.connectFolderPath],
              ]
            : [
                ['Mode', 'Later'],
                ['Folder Setup', 'No folder side effects'],
              ],
    },
    {
      title: 'Luminaire Input',
      step: 4,
      Icon: FileInput,
      rows: [
        [
          'Input Mode',
          luminaireInputModeOptions.find((o) => o.value === form.luminaireInputMode)?.label ??
            form.luminaireInputMode,
        ],
      ],
    },
  ];
  return (
    <>
      <SectionTitle
        icon={ClipboardCheck}
        title="Review & Create"
        text="Review the entered configuration before creating the project workspace."
      />
      <div className="v4-new-project__review">
        {cards.map(({ title, step: cardStep, Icon, rows }) => (
          <section key={title}>
            <header>
              <Icon />
              <h3>{title}</h3>
              <button type="button" onClick={() => edit(cardStep)}>
                Edit
              </button>
            </header>
            <dl>
              {rows.map(([label, value]) => (
                <div key={label}>
                  <dt>{label}</dt>
                  <dd>{value}</dd>
                </div>
              ))}
            </dl>
          </section>
        ))}
      </div>
    </>
  );
}

function SectionTitle({
  icon: Icon,
  title,
  text,
}: {
  icon: typeof Folder;
  title: string;
  text: string;
}) {
  return (
    <header className="v4-new-project__section-title">
      <Icon />
      <div>
        <h2>{title}</h2>
        <p>{text}</p>
      </div>
    </header>
  );
}
function profileValue(profile: FolderProfilePreset) {
  return profile.source === 'factory'
    ? `factory:${profile.factoryProfileKey}`
    : profile.profileId
      ? `user:${profile.profileId}`
      : `legacy:${profile.name}`;
}
function guidanceForStep(step: number) {
  const all = [
    {
      Icon: FolderPlus,
      title: 'Project information',
      text: 'These details become the project record.',
      tip: 'Use clear names and realistic delivery estimates.',
    },
    {
      Icon: Layers3,
      title: 'Scope & services',
      text: 'Select only the services this project needs.',
      tip: 'Custom scope belongs to this project only.',
    },
    {
      Icon: FolderTree,
      title: 'Folder structure',
      text: 'Choose create, connect, or later.',
      tip: 'Later is the safest route when the folder is not decided.',
    },
    {
      Icon: FileInput,
      title: 'Luminaire input',
      text: 'Set the initial source preference.',
      tip: 'Actual imports happen after project creation.',
    },
    {
      Icon: ClipboardCheck,
      title: 'Ready to create',
      text: 'Check every entered value before creation.',
      tip: 'Use Edit to return to any completed section.',
    },
  ];
  return all[step - 1]!;
}
