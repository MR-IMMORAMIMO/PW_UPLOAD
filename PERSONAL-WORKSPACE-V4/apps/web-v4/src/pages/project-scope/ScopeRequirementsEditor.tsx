import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { Project, ProjectRequirement, ProjectWorkspace, ProjectScopeItem } from '@scli/domain';
import type { ProjectRequirementInput } from '@scli/contracts';
import { api, apiRequest } from '../../api/environment';
import { V4Drawer } from '../../components/common/V4Drawer';
import { V4Button } from '../../components/common/V4Button';
import { V4ConfirmDialog } from '../../components/common/V4ConfirmDialog';
import { SctSave } from '../../components/common/SctIcons';

export const scopeCriteria = [
  { title: 'Controls', unit: '' },
  { title: 'CCT', unit: 'K' },
  { title: 'CRI', unit: '' },
  { title: 'Design Life', unit: 'hours' },
  { title: 'Site / Design Constraints', unit: '' },
] as const;
const findCriterion = (items: ProjectRequirement[], title: string) =>
  items.find(
    (item) =>
      item.title.toLowerCase() === title.toLowerCase() &&
      item.category === 'Technical requirements',
  );

export function ScopeRequirementsEditor({
  project,
  workspace,
  onClose,
}: {
  project: Project;
  workspace: ProjectWorkspace & { scopeItems: ProjectScopeItem[] };
  onClose: () => void;
}) {
  const client = useQueryClient();
  const [initial] = useState<Record<string, string>>(() => ({
    Lux: project.luxRequirements,
    Standards:
      project.finalSetup?.standards.join('\n') ??
      findCriterion(workspace.requirements, 'Standards')?.details ??
      '',
    ...Object.fromEntries(
      scopeCriteria.map((field) => [
        field.title,
        findCriterion(workspace.requirements, field.title)?.details ?? '',
      ]),
    ),
  }));
  const [draft, setDraft] = useState<Record<string, string>>(initial);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [discard, setDiscard] = useState(false);
  const dirty = JSON.stringify(draft) !== JSON.stringify(initial);
  const close = () => {
    if (!saving) {
      if (dirty) setDiscard(true);
      else onClose();
    }
  };
  const save = async () => {
    setDiscard(false);
    setSaving(true);
    setError('');
    try {
      // Reload before each attempt: successful earlier fields are retained after a partial failure.
      const currentProject = await api.project(project.id);
      const currentWorkspace = await apiRequest<
        ProjectWorkspace & { scopeItems: ProjectScopeItem[] }
      >(`/api/projects/${project.id}/workspace`);
      const standards = [
        ...new Set(
          (draft.Standards ?? '')
            .split('\n')
            .map((s) => s.trim())
            .filter(Boolean),
        ),
      ];
      const luxChanged = draft.Lux !== initial.Lux;
      const standardsChanged = draft.Standards !== initial.Standards;
      if (
        luxChanged &&
        currentProject.luxRequirements !== initial.Lux &&
        currentProject.luxRequirements !== draft.Lux
      )
        throw new Error('Lux changed elsewhere. Close and reopen to review the latest value.');
      if (
        standardsChanged &&
        currentProject.finalSetup &&
        currentProject.finalSetup.standards.join('\n') !== initial.Standards &&
        JSON.stringify(currentProject.finalSetup.standards) !== JSON.stringify(standards)
      )
        throw new Error(
          'Standards changed elsewhere. Close and reopen to review the latest value.',
        );
      if (
        (luxChanged && currentProject.luxRequirements !== draft.Lux) ||
        (standardsChanged &&
          currentProject.finalSetup &&
          JSON.stringify(currentProject.finalSetup.standards) !== JSON.stringify(standards))
      ) {
        await api.updateProjectConfiguration(project.id, {
          ...(luxChanged ? { luxRequirements: draft.Lux ?? '' } : {}),
          ...(standardsChanged && currentProject.finalSetup ? { scopeStandards: standards } : {}),
          expectedVersion: currentProject.version,
          scopeItems: currentWorkspace.scopeItems.map(({ code, label, custom }) => ({
            code,
            label,
            custom,
          })),
          luminaireInputMode: currentProject.luminaireInputMode ?? 'Later',
        });
      }
      const fields = [
        ...scopeCriteria.map((f) => f.title),
        ...(!currentProject.finalSetup ? ['Standards'] : []),
      ];
      for (const title of fields) {
        if (draft[title] === initial[title]) continue;
        const current = findCriterion(currentWorkspace.requirements, title);
        const value = (draft[title] ?? '').trim();
        if ((current?.details ?? '') === value) continue;
        if ((current?.details ?? '') !== initial[title])
          throw new Error(
            `${title} changed elsewhere. Close and reopen to review its latest value.`,
          );
        const input: ProjectRequirementInput = {
          category: 'Technical requirements',
          title,
          details: value,
          requestedFrom: current?.requestedFrom ?? '',
          requestedAt: current?.requestedAt ?? null,
          dueDate: current?.dueDate ?? null,
          status: current?.status ?? 'Received',
          impact: current?.impact ?? 'Low',
          sourceType: current?.sourceType ?? 'Manual',
          sourceReference: current?.sourceReference ?? '',
          notes: current?.notes ?? '',
          sortOrder:
            current?.sortOrder ?? currentWorkspace.requirements.length + fields.indexOf(title),
        };
        await apiRequest(
          `/api/projects/${project.id}/requirements${current ? '/' + current.id : ''}`,
          { method: current ? 'PATCH' : 'POST', body: input },
        );
      }
      await client.invalidateQueries({ queryKey: ['v4', 'scope'] });
      onClose();
    } catch (cause) {
      setError(
        `Some fields may already be saved. Your remaining changes are retained; retry to finish. ${cause instanceof Error ? cause.message : 'Could not save requirements.'}`,
      );
    } finally {
      setSaving(false);
    }
  };
  return (
    <V4Drawer
      open
      presentation="float"
      className="v4-scope-requirements-editor"
      title="Edit Requirements"
      description="All fields are optional. Leave unknown values empty."
      onClose={close}
      dismissible={!saving}
      footer={
        <>
          <V4Button disabled={saving} onClick={close}>
            Cancel
          </V4Button>
          <V4Button variant="primary" disabled={saving || !dirty} onClick={() => void save()}>
            <SctSave />
            {saving ? 'Saving…' : 'Save changes'}
          </V4Button>
        </>
      }
    >
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2,minmax(0,1fr))', gap: 16 }}>
        {[
          { title: 'Lux', unit: 'lx' },
          ...scopeCriteria,
          { title: 'Standards', unit: 'one per line' },
        ].map((field) => (
          <label
            key={field.title}
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: 8,
              gridColumn:
                field.title === 'Standards' || field.title === 'Site / Design Constraints'
                  ? '1 / -1'
                  : undefined,
            }}
          >
            {field.title}
            {field.unit && <small>{field.unit}</small>}
            {field.title === 'Standards' || field.title === 'Site / Design Constraints' ? (
              <textarea
                maxLength={1000}
                rows={3}
                value={draft[field.title]}
                onChange={(e) => setDraft({ ...draft, [field.title]: e.target.value })}
              />
            ) : (
              <input
                maxLength={1000}
                value={draft[field.title]}
                onChange={(e) => setDraft({ ...draft, [field.title]: e.target.value })}
              />
            )}
          </label>
        ))}
      </div>
      {error && <p role="alert">{error}</p>}
      <V4ConfirmDialog
        open={discard}
        title="Unsaved requirements"
        description="Save your changes before closing?"
        confirmLabel="Discard"
        cancelLabel="Continue editing"
        destructive
        onCancel={() => setDiscard(false)}
        onConfirm={onClose}
        additionalAction={
          <V4Button variant="primary" onClick={() => void save()}>
            <SctSave />
            Save changes
          </V4Button>
        }
      />
    </V4Drawer>
  );
}
