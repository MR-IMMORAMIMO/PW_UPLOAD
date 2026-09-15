import { useEffect, useMemo, useState } from 'react';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  CalendarDays,
  Check,
  CheckCircle2,
  ChevronDown,
  Clock3,
  FolderOpen,
  LayoutTemplate,
  LoaderCircle,
  Sparkles,
} from 'lucide-react';
import { useForm } from 'react-hook-form';
import { useNavigate } from 'react-router-dom';
import { z } from 'zod';
import { createProjectSchema, type CreateProjectInput } from '@scli/contracts';
import { api } from '../api';
import { useAppContext } from '../app-context';
import { useToast } from '../components/toast';
import { Avatar, PageHeader, ProgressBar } from '../components/ui';
import { teamProjectTemplates, type TeamProjectTemplate } from '../team-project-templates';

function defaultDeliveryDate(): string {
  const date = new Date();
  date.setDate(date.getDate() + 7);
  return date.toISOString().slice(0, 10);
}

export function NewProjectScreen() {
  const { currentUser } = useAppContext();
  const manager = currentUser.role === 'LineManager' || currentUser.role === 'Admin';
  const [selectedTemplate, setSelectedTemplate] = useState<string | null>(null);
  const [workflow, setWorkflow] = useState<
    Array<{ key: string; label: string; completedAt: string }>
  >([]);
  const [createdCode, setCreatedCode] = useState<string | null>(null);
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { showToast } = useToast();
  const salesQuery = useQuery({
    queryKey: ['sales-users'],
    queryFn: api.salesUsers,
    enabled: manager,
  });
  const workloadsQuery = useQuery({
    queryKey: ['workloads'],
    queryFn: api.workloads,
    enabled: manager,
  });
  const typesQuery = useQuery({ queryKey: ['project-types'], queryFn: api.projectTypes });

  const {
    register,
    handleSubmit,
    setValue,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<z.input<typeof createProjectSchema>, unknown, CreateProjectInput>({
    resolver: zodResolver(createProjectSchema),
    defaultValues: {
      projectName: '',
      clientName: '',
      projectType: '',
      description: '',
      salesOwnerId: manager ? undefined : currentUser.id,
      assignedDesignerId: null,
      collaboratorDesignerIds: [],
      siteLocation: '',
      designStage: 'Concept',
      lightingScope: '',
      luxRequirements: '',
      drawingReference: '',
      priority: 'Normal',
      complexity: 'Medium',
      estimatedHours: 8,
      requiredDeliveryDate: defaultDeliveryDate(),
      projectFolderUrl: null,
      idempotencyKey: crypto.randomUUID(),
    },
  });

  const ownerId = watch('salesOwnerId');
  const selectedDesignerId = watch('assignedDesignerId');
  const selectedOwner = manager
    ? salesQuery.data?.find((user) => user.id === ownerId)
    : currentUser;
  const selectedWorkload = workloadsQuery.data?.find(
    (item) => item.designer.id === selectedDesignerId,
  );

  useEffect(() => {
    if (!manager || ownerId || !salesQuery.data?.[0]) return;
    setValue('salesOwnerId', salesQuery.data[0].id, { shouldValidate: true });
  }, [manager, ownerId, salesQuery.data, setValue]);

  const projectTypes = useMemo(
    () =>
      [
        ...new Set([
          ...(typesQuery.data?.map((type) => type.name) ?? []),
          ...teamProjectTemplates.map((template) => template.projectType),
        ]),
      ].sort((a, b) => a.localeCompare(b)),
    [typesQuery.data],
  );

  const applyTemplate = (template: TeamProjectTemplate) => {
    setSelectedTemplate(template.id);
    setValue('projectType', template.projectType, { shouldValidate: true });
    setValue('description', template.description);
    setValue('lightingScope', template.lightingScope, { shouldValidate: true });
    setValue('luxRequirements', template.luxRequirements);
    setValue('drawingReference', template.drawingReference);
    setValue('designStage', template.designStage);
    setValue('complexity', template.complexity);
    setValue('estimatedHours', template.estimatedHours);
  };

  const mutation = useMutation({
    mutationFn: api.createProject,
    onSuccess: async (result) => {
      setWorkflow(result.workflow);
      setCreatedCode(result.project.projectCode);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['projects'] }),
        queryClient.invalidateQueries({ queryKey: ['notifications'] }),
        queryClient.invalidateQueries({ queryKey: ['workloads'] }),
      ]);
      showToast(`${result.project.projectCode} created successfully.`);
      window.setTimeout(() => navigate(`/projects/${result.project.id}`), 700);
    },
    onError: (error) =>
      showToast(error instanceof Error ? error.message : 'Project creation failed.', 'error'),
  });

  const submit = handleSubmit(async (values) => {
    if (manager && !values.salesOwnerId) {
      showToast('Select the Sales Owner before creating the project.', 'error');
      return;
    }
    setWorkflow([]);
    setCreatedCode(null);
    await mutation.mutateAsync({
      ...values,
      salesOwnerId: manager ? values.salesOwnerId : currentUser.id,
      projectFolderUrl: values.projectFolderUrl || null,
    });
  });

  return (
    <>
      <PageHeader
        eyebrow="Quick project intake"
        title="Create a lighting project"
        description="Start with a proven template, complete the essentials, and open technical details only when needed."
      />

      <section className="template-picker" aria-labelledby="template-heading">
        <div className="section-heading">
          <div>
            <h2 id="template-heading">Start with a template</h2>
            <p>Templates fill the typical scope and effort. Every field remains editable.</p>
          </div>
          <LayoutTemplate size={20} />
        </div>
        <div className="template-grid">
          {teamProjectTemplates.map((template) => (
            <button
              key={template.id}
              type="button"
              className={`template-card${selectedTemplate === template.id ? ' selected' : ''}`}
              aria-pressed={selectedTemplate === template.id}
              onClick={() => applyTemplate(template)}
            >
              <span className="template-icon">
                <LayoutTemplate size={17} />
              </span>
              <strong>{template.name}</strong>
              <small>{template.summary}</small>
              {selectedTemplate === template.id ? <Check size={17} /> : null}
            </button>
          ))}
        </div>
      </section>

      <form className="new-project-layout simplified-project-form" onSubmit={submit} noValidate>
        <div className="form-main-column">
          <section className="form-section">
            <div className="form-section-heading">
              <span className="section-number">01</span>
              <div>
                <h2>Project essentials</h2>
                <p>Only the information needed to route and start the work.</p>
              </div>
            </div>
            <div className="form-grid">
              <label className="field field-wide">
                Project name<span className="required">Required</span>
                <input
                  {...register('projectName')}
                  placeholder="e.g. Marina hotel lighting layout"
                  aria-invalid={Boolean(errors.projectName)}
                />
                {errors.projectName ? (
                  <small className="field-error">{errors.projectName.message}</small>
                ) : null}
              </label>
              <label className="field">
                Client<span className="required">Required</span>
                <input {...register('clientName')} placeholder="Client or business unit" />
                {errors.clientName ? (
                  <small className="field-error">{errors.clientName.message}</small>
                ) : null}
              </label>
              <label className="field">
                Project type<span className="required">Required</span>
                <span className="select-wrap">
                  <select {...register('projectType')}>
                    <option value="">Select a type</option>
                    {projectTypes.map((type) => (
                      <option key={type}>{type}</option>
                    ))}
                  </select>
                  <ChevronDown size={16} />
                </span>
                {errors.projectType ? (
                  <small className="field-error">{errors.projectType.message}</small>
                ) : null}
              </label>
              <label className="field">
                Site location<span className="required">Required</span>
                <input {...register('siteLocation')} placeholder="Dubai, UAE — Level 12" />
                {errors.siteLocation ? (
                  <small className="field-error">{errors.siteLocation.message}</small>
                ) : null}
              </label>
              <label className="field">
                Required delivery<span className="required">Required</span>
                <span className="input-icon">
                  <CalendarDays size={16} />
                  <input
                    type="date"
                    min={new Date().toISOString().slice(0, 10)}
                    {...register('requiredDeliveryDate')}
                  />
                </span>
                {errors.requiredDeliveryDate ? (
                  <small className="field-error">{errors.requiredDeliveryDate.message}</small>
                ) : null}
              </label>
              <label className="field field-wide">
                Lighting scope<span className="required">Required</span>
                <textarea
                  {...register('lightingScope')}
                  rows={3}
                  placeholder="What should the Lighting Design team deliver?"
                />
                {errors.lightingScope ? (
                  <small className="field-error">{errors.lightingScope.message}</small>
                ) : null}
              </label>
              <label className="field">
                Priority
                <select {...register('priority')}>
                  <option>Normal</option>
                  <option>High</option>
                  <option>Urgent</option>
                </select>
              </label>
              {manager ? (
                <label className="field">
                  Sales Owner<span className="required">Required</span>
                  <select {...register('salesOwnerId')} aria-label="Sales Owner">
                    <option value="">Select Sales Owner</option>
                    {salesQuery.data?.map((user) => (
                      <option key={user.id} value={user.id}>
                        {user.displayName}
                      </option>
                    ))}
                  </select>
                </label>
              ) : (
                <div className="locked-owner compact-owner">
                  <Avatar user={currentUser} />
                  <div>
                    <small>Sales Owner</small>
                    <strong>{currentUser.displayName}</strong>
                  </div>
                  <span className="locked-pill">Locked</span>
                </div>
              )}
            </div>
          </section>

          <details className="form-section advanced-details">
            <summary>
              <span>
                <Sparkles size={18} />
                <strong>More lighting details</strong>
              </span>
              <small>Stage, calculations, drawings, effort, assignment and links</small>
            </summary>
            <div className="form-grid">
              <label className="field">
                Design stage
                <select {...register('designStage')}>
                  <option value="Concept">Concept</option>
                  <option value="SchematicDesign">Schematic Design</option>
                  <option value="DetailedDesign">Detailed Design</option>
                  <option value="Tender">Tender</option>
                  <option value="Construction">Construction</option>
                  <option value="AsBuilt">As Built</option>
                </select>
              </label>
              <label className="field">
                Complexity
                <select {...register('complexity')}>
                  <option>Small</option>
                  <option>Medium</option>
                  <option>Large</option>
                </select>
              </label>
              <label className="field">
                Estimated hours
                <span className="input-icon">
                  <Clock3 size={16} />
                  <input type="number" min="0" step="0.5" {...register('estimatedHours')} />
                </span>
              </label>
              {manager ? (
                <label className="field">
                  Primary Lighting Designer
                  <select
                    {...register('assignedDesignerId', {
                      setValueAs: (value) => (value ? value : null),
                    })}
                  >
                    <option value="">Leave unassigned</option>
                    {workloadsQuery.data?.map((item) => (
                      <option key={item.designer.id} value={item.designer.id}>
                        {item.designer.displayName} — {item.availabilityPercent}% available
                      </option>
                    ))}
                  </select>
                </label>
              ) : null}
              <label className="field">
                Lux requirements
                <textarea rows={3} {...register('luxRequirements')} />
              </label>
              <label className="field">
                Drawing reference
                <textarea rows={3} {...register('drawingReference')} />
              </label>
              <label className="field field-wide">
                Additional brief
                <textarea
                  rows={4}
                  {...register('description')}
                  placeholder="Constraints, deliverables or coordination notes"
                />
              </label>
              <label className="field field-wide">
                Project folder / reference URL
                <span className="input-icon">
                  <FolderOpen size={16} />
                  <input type="url" {...register('projectFolderUrl')} placeholder="https://…" />
                </span>
                {errors.projectFolderUrl ? (
                  <small className="field-error">{errors.projectFolderUrl.message}</small>
                ) : (
                  <small>Optional. HTTPS links only.</small>
                )}
              </label>
            </div>
          </details>
        </div>

        <aside className="form-summary-column">
          <div className="form-summary-card">
            <div className="summary-accent">
              <Sparkles size={18} /> Ready to route
            </div>
            <dl>
              <div>
                <dt>Sales Owner</dt>
                <dd>{selectedOwner?.displayName ?? 'Select an owner'}</dd>
              </div>
              <div>
                <dt>Assignment</dt>
                <dd>{selectedWorkload?.designer.displayName ?? 'Manager queue'}</dd>
              </div>
              <div>
                <dt>Template</dt>
                <dd>
                  {teamProjectTemplates.find((item) => item.id === selectedTemplate)?.name ??
                    'Custom request'}
                </dd>
              </div>
              <div>
                <dt>Project code</dt>
                <dd>Generated on submit</dd>
              </div>
            </dl>
            {selectedWorkload ? (
              <ProgressBar
                value={Math.min(selectedWorkload.utilizationPercent, 100)}
                label={`${selectedWorkload.designer.displayName} workload`}
              />
            ) : null}
            <div className="summary-note">
              <CheckCircle2 size={17} />
              <span>The manager can assign or adjust the team after creation.</span>
            </div>
            <button
              className="button primary create-project-button"
              type="submit"
              disabled={isSubmitting || mutation.isPending || (manager && !selectedOwner)}
            >
              {mutation.isPending ? (
                <>
                  <LoaderCircle className="spin" size={18} /> Creating project…
                </>
              ) : (
                'CREATE PROJECT'
              )}
            </button>
            {mutation.error ? (
              <p className="inline-error">{(mutation.error as Error).message}</p>
            ) : null}
          </div>
        </aside>
      </form>

      {mutation.isPending || createdCode ? (
        <div className="creation-overlay">
          <div className="creation-dialog" role="status" aria-live="polite">
            <div className={createdCode ? 'success-orb complete' : 'success-orb'}>
              {createdCode ? <Check size={34} /> : <LoaderCircle className="spin" size={34} />}
            </div>
            <h2>{createdCode ? 'Project created' : 'Creating your project'}</h2>
            <p>
              {createdCode ??
                workflow.at(-1)?.label ??
                'Validating the request and generating its code.'}
            </p>
          </div>
        </div>
      ) : null}
    </>
  );
}
