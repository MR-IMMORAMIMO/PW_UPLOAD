import { V4DateInput } from '../common/V4DateInput';
import { useEffect, useMemo, useRef, useState } from 'react';
import type {
  AppUser,
  DesignStage,
  Project,
  ProjectScopeItem,
  ProjectType,
  ProjectWorkspace,
} from '@scli/domain';
import {
  complexities,
  designStages,
  luminaireInputModeOptions,
  priorities,
  projectServiceCodes,
  projectServiceLabels,
} from '@scli/domain';
import { V4FloatingWorkspace } from '../common/V4FloatingWorkspace';
import { V4ConfirmDialog } from '../common/V4ConfirmDialog';
import { V4Button } from '../common/V4Button';
import { SctSave } from '../common/SctIcons';
import { useV4DirtySurface } from '../interaction/V4DirtyGuard';
import { ProjectStorageHealth } from './ProjectStorageHealth';
import {
  canEditCommercial,
  canEditManagementFields,
  fullEditPayload,
  normalizeProjectFormValues,
  projectFormValues,
  validateProjectForm,
  type ProjectFormValues,
} from './projectFormModel';

type EditWorkspace = ProjectWorkspace & { scopeItems?: ProjectScopeItem[] };

export interface V4ProjectEditWorkspaceProps {
  open: boolean;
  project: Project;
  workspace: EditWorkspace;
  projectTypes: ProjectType[];
  salesUsers: AppUser[];
  actor?: AppUser | undefined;
  saving: boolean;
  error: string | null;
  saved: boolean;
  onClose: () => void;
  onSave: (payload: ReturnType<typeof fullEditPayload>) => void;
  returnFocusRef?: React.RefObject<HTMLElement | null> | undefined;
}

export function V4ProjectEditWorkspace({
  open,
  project,
  workspace,
  projectTypes,
  salesUsers,
  actor,
  saving,
  error,
  saved,
  onClose,
  onSave,
  returnFocusRef,
}: V4ProjectEditWorkspaceProps) {
  const initialRef = useRef<HTMLInputElement>(null);
  const externalProceedRef = useRef<(() => void) | null>(null);
  const externalCancelRef = useRef<(() => void) | null>(null);
  const [baseline, setBaseline] = useState(() => projectFormValues(project, workspace));
  const [values, setValues] = useState(() => projectFormValues(project, workspace));
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const [closeAfterConfirmation, setCloseAfterConfirmation] = useState(false);
  const [customInput, setCustomInput] = useState('');
  const saveThenClose = useRef(false);
  useEffect(() => {
    if (saved && saveThenClose.current) {
      saveThenClose.current = false;
      onClose();
    }
  }, [saved, onClose]);
  useEffect(() => {
    if (!open) return;
    const next = projectFormValues(project, workspace);
    setBaseline(next);
    setValues(next);
    setConfirmDiscard(false);
    setCloseAfterConfirmation(false);
  }, [open, project, workspace]);
  const normalized = useMemo(() => normalizeProjectFormValues(values), [values]);
  const dirty = JSON.stringify(normalized) !== JSON.stringify(baseline);
  const validation = useMemo(() => validateProjectForm(values), [values]);
  const management = canEditManagementFields(actor);
  const commercial = canEditCommercial(actor, project);
  const update = <K extends keyof ProjectFormValues>(field: K, value: ProjectFormValues[K]) =>
    setValues((current) => ({ ...current, [field]: value }));
  const requestClose = () => {
    if (saving) return;
    externalProceedRef.current = null;
    externalCancelRef.current = null;
    if (dirty) setConfirmDiscard(true);
    else onClose();
  };
  useV4DirtySurface(open && dirty, (_reason, proceed, cancel) => {
    if (saving) return;
    externalProceedRef.current = proceed;
    externalCancelRef.current = cancel;
    setConfirmDiscard(true);
  });
  const addCustom = () => {
    const next = customInput.trim();
    if (next && !values.customScope.some((item) => item.toLowerCase() === next.toLowerCase())) {
      update('customScope', [...values.customScope, next]);
    }
    setCustomInput('');
  };

  return (
    <V4FloatingWorkspace
      open={open}
      title="Edit Project"
      description="Update Project configuration. Status, reference, and storage binding remain controlled workflows."
      onRequestClose={requestClose}
      initialFocusRef={initialRef}
      returnFocusRef={returnFocusRef}
      dismissible={!saving}
      onAfterExit={() => {
        const proceed = externalProceedRef.current;
        externalProceedRef.current = null;
        externalCancelRef.current = null;
        proceed?.();
      }}
      footer={
        <div className="v4-project-edit__footer-actions">
          <button
            type="button"
            className="v4-project-edit__secondary"
            onClick={requestClose}
            disabled={saving}
          >
            Cancel
          </button>
          <button
            type="button"
            className="v4-project-edit__save"
            disabled={!dirty || !!validation || saving}
            aria-busy={saving || undefined}
            onClick={() => onSave(fullEditPayload(baseline, values, project))}
          >
            {saving ? 'Saving…' : 'Save Changes'}
          </button>
        </div>
      }
    >
      <>
        <form className="v4-project-edit" onSubmit={(event) => event.preventDefault()}>
          <EditSection title="Project Details" id="details">
            <Field label="Project Name">
              <input
                ref={initialRef}
                value={values.projectName}
                onChange={(e) => update('projectName', e.target.value)}
              />
            </Field>
            <Field label="Project Type">
              <select
                value={values.projectType}
                onChange={(e) => update('projectType', e.target.value)}
              >
                {projectTypes.map((item) => (
                  <option key={item.id} value={item.name}>
                    {item.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Design Stage">
              <select
                value={values.designStage}
                onChange={(e) => update('designStage', e.target.value as DesignStage)}
              >
                {designStages.map((item) => (
                  <option key={item} value={item}>
                    {item}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Site Location">
              <input
                value={values.siteLocation}
                onChange={(e) => update('siteLocation', e.target.value)}
              />
            </Field>
            <Field label="Lighting Scope" wide>
              <textarea
                rows={3}
                value={values.lightingScope}
                onChange={(e) => update('lightingScope', e.target.value)}
              />
            </Field>
            <Field label="Lux Requirements">
              <textarea
                rows={2}
                value={values.luxRequirements}
                onChange={(e) => update('luxRequirements', e.target.value)}
              />
            </Field>
            <Field label="Drawing Reference">
              <textarea
                rows={2}
                value={values.drawingReference}
                onChange={(e) => update('drawingReference', e.target.value)}
              />
            </Field>
          </EditSection>

          <EditSection title="Client / Commercial References" id="commercial">
            <Field label="Client">
              <input
                value={values.clientName}
                onChange={(e) => update('clientName', e.target.value)}
              />
            </Field>
            <Field label="CRM Reference">
              <input
                value={values.crmReference}
                onChange={(e) => update('crmReference', e.target.value)}
              />
            </Field>
            <Field label="Commercial Value">
              <input
                inputMode="decimal"
                disabled={!commercial}
                value={values.commercialValue}
                onChange={(e) => update('commercialValue', e.target.value)}
              />
            </Field>
            <Field label="Currency">
              <input
                maxLength={3}
                disabled={!commercial}
                value={values.commercialCurrency}
                onChange={(e) => update('commercialCurrency', e.target.value.toUpperCase())}
              />
            </Field>
          </EditSection>

          <EditSection
            title="Schedule / Priority / Classification"
            id="schedule"
            className="v4-project-edit__section--wide v4-project-edit__schedule"
          >
            <Field label="Required Delivery Date">
              <V4DateInput
                type="date"
                value={values.requiredDeliveryDate}
                onChange={(e) => update('requiredDeliveryDate', e.target.value)}
              />
            </Field>
            <Field label="Priority">
              <select
                disabled={!management}
                value={values.priority}
                onChange={(e) => update('priority', e.target.value as Project['priority'])}
              >
                {priorities.map((item) => (
                  <option key={item}>{item}</option>
                ))}
              </select>
            </Field>
            <Field label="Complexity">
              <select
                disabled={!management}
                value={values.complexity}
                onChange={(e) => update('complexity', e.target.value as Project['complexity'])}
              >
                {complexities.map((item) => (
                  <option key={item}>{item}</option>
                ))}
              </select>
            </Field>
            <Field label="Estimated Hours">
              <input
                type="number"
                min="0"
                max="10000"
                disabled={!management}
                value={values.estimatedHours}
                onChange={(e) => update('estimatedHours', e.target.value)}
              />
            </Field>
            <Field label="Sales Owner" wide>
              <select
                disabled={!management}
                value={values.salesOwnerId}
                onChange={(e) => update('salesOwnerId', e.target.value)}
              >
                {salesUsers
                  .filter((user) => user.isActive)
                  .map((user) => (
                    <option key={user.id} value={user.id}>
                      {user.displayName}
                    </option>
                  ))}
              </select>
            </Field>
          </EditSection>

          <EditSection
            title="Scope & Services"
            id="scope"
            className="v4-project-edit__section--wide"
          >
            <div className="v4-project-edit__services">
              {projectServiceCodes.map((service) => (
                <label key={service}>
                  <input
                    type="checkbox"
                    checked={values.services.includes(service)}
                    onChange={() =>
                      update(
                        'services',
                        values.services.includes(service)
                          ? values.services.filter((item) => item !== service)
                          : [...values.services, service],
                      )
                    }
                  />
                  {projectServiceLabels[service]}
                </label>
              ))}
            </div>
            <Field label="Custom Scope" wide>
              <div className="v4-project-edit__custom">
                <input
                  aria-label="Custom Scope"
                  value={customInput}
                  onChange={(e) => setCustomInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      addCustom();
                    }
                  }}
                />
                <button type="button" onClick={addCustom}>
                  Add
                </button>
              </div>
              <div className="v4-project-edit__chips">
                {values.customScope.map((item) => (
                  <span key={item}>
                    {item}
                    <button
                      type="button"
                      aria-label={`Remove ${item}`}
                      onClick={() =>
                        update(
                          'customScope',
                          values.customScope.filter((value) => value !== item),
                        )
                      }
                    >
                      ×
                    </button>
                  </span>
                ))}
              </div>
            </Field>
            <Field label="Luminaire Input Mode" wide>
              <select
                value={values.luminaireInputMode}
                onChange={(e) =>
                  update(
                    'luminaireInputMode',
                    e.target.value as ProjectFormValues['luminaireInputMode'],
                  )
                }
              >
                {luminaireInputModeOptions.map((item) => (
                  <option key={item.value} value={item.value}>
                    {item.label}
                  </option>
                ))}
              </select>
            </Field>
          </EditSection>

          <section
            className="v4-project-edit__section v4-project-edit__section--wide"
            aria-labelledby="project-edit-storage"
          >
            <h3 id="project-edit-storage">Storage / Folder</h3>
            <ProjectStorageHealth project={project} />
          </section>
          <EditSection
            title="Notes / Additional Information"
            id="notes"
            className="v4-project-edit__section--wide"
          >
            <Field label="Description / Notes" wide>
              <textarea
                rows={5}
                value={values.description}
                onChange={(e) => update('description', e.target.value)}
              />
            </Field>
          </EditSection>
          <section
            className="v4-project-edit__section v4-project-edit__section--wide"
            aria-labelledby="project-edit-identity"
          >
            <h3 id="project-edit-identity">Read-only Identity</h3>
            <div className="v4-project-edit__code-row">
              <span>Project Code</span>
              <code>{project.projectCode}</code>
            </div>
            <div className="v4-project-edit__code-row">
              <span>Project UUID</span>
              <code>{project.id}</code>
            </div>
          </section>
          {validation ? (
            <p className="v4-project-edit__error" role="alert">
              {validation}
            </p>
          ) : null}
          {error ? (
            <p className="v4-project-edit__error" role="alert">
              {error}
            </p>
          ) : null}
          {saved ? (
            <p className="v4-project-edit__success" role="status">
              Project configuration saved from server truth.
            </p>
          ) : null}
        </form>
        <V4ConfirmDialog
          open={confirmDiscard}
          title="Discard changes?"
          description="Your complete Project configuration has unsaved changes."
          cancelLabel="Keep Editing"
          confirmLabel="Discard"
          destructive
          pending={saving}
          additionalAction={
            <V4Button
              variant="primary"
              leadingIcon={<SctSave />}
              disabled={saving || !!validation}
              onClick={() => {
                saveThenClose.current = true;
                onSave(fullEditPayload(baseline, values, project));
              }}
            >
              Save changes
            </V4Button>
          }
          onCancel={() => {
            externalCancelRef.current?.();
            externalProceedRef.current = null;
            externalCancelRef.current = null;
            setConfirmDiscard(false);
          }}
          onConfirm={() => {
            setCloseAfterConfirmation(true);
            setConfirmDiscard(false);
          }}
          restoreFocus={!closeAfterConfirmation}
          onAfterExit={() => {
            if (!closeAfterConfirmation) return;
            setCloseAfterConfirmation(false);
            onClose();
          }}
        />
      </>
    </V4FloatingWorkspace>
  );
}

function EditSection({
  title,
  id,
  className = '',
  children,
}: {
  title: string;
  id: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <section
      className={`v4-project-edit__section ${className}`}
      aria-labelledby={`project-edit-${id}`}
    >
      <h3 id={`project-edit-${id}`}>{title}</h3>
      <div className="v4-project-edit__fields">{children}</div>
    </section>
  );
}

function Field({
  label,
  wide = false,
  children,
}: {
  label: string;
  wide?: boolean;
  children: React.ReactNode;
}) {
  return (
    <label className={wide ? 'wide' : undefined}>
      {label}
      {children}
    </label>
  );
}
