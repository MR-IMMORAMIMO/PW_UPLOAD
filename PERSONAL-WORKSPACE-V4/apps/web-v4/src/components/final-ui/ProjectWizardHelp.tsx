import { useState } from 'react';
import { formatProjectCode, type FolderNodePreset } from '@scli/domain';
import { V4FloatingWorkspace } from '../common/V4FloatingWorkspace';
import { V4Button } from '../common/V4Button';
import { SctCheck, SctPreview } from '../common/SctIcons';
import { ProjectFolderTree } from './ProjectFolderTree';
import type { useFinalProjectCreation } from './useFinalProjectCreation';
import { BUSINESS_TIME_ZONE } from '../../date-time/businessDateTime';

type Data = ReturnType<typeof useFinalProjectCreation>;
export type WizardHelpMode = 'guide' | 'code' | 'scope-templates' | 'folder-templates';
const guides = [
  [
    'Project information',
    'Enter the project name, client and type. Sales and manager entries are shared with Settings. Their names are required; email is optional. Value and currency can both remain blank. Projects are created in Planning.',
  ],
  [
    'Scope & Services',
    'Describe the scope, then select the services, deliverables and documentation you intend to provide. Free-text classification fields describe your project; Design Phase offers the supported phases. Templates replace the scope selections only when you choose Use template.',
  ],
  [
    'Schedule',
    'Start and target completion dates are optional. Duration is calculated when both dates exist. Add actual milestones to see them on the timeline. A milestone after completion produces a warning without changing either date. Start Project on Summary records a missing start date; starting a work session is separate.',
  ],
  [
    'Project Structure',
    'Choose a folder template, enable the required groups and expand the tree to review the exact paths. Browse changes the root for this project only. Preview creates no folders. Folders are created when you select Create Project.',
  ],
  [
    'Review & Create',
    'Review all cards and use Edit to return to a step. Missing required fields or invalid dates/value must be corrected. Blank optional dates and value are allowed. Create Project opens Summary in Planning and does not start a work session. Save as Draft preserves every step without creating a project or allocating its code.',
  ],
];
function pathsOf(nodes: FolderNodePreset[], parent = ''): string[] {
  return nodes.flatMap((node) => {
    const path = parent ? `${parent}/${node.name}` : node.name;
    return [path, ...pathsOf(node.children, path)];
  });
}

export function ProjectWizardHelp({
  mode,
  step,
  data,
  onApplyScope,
  onClose,
}: {
  mode: WizardHelpMode;
  step: number;
  data: Data;
  onApplyScope: (template: Data['scopeTemplates'][number]) => void;
  onClose: () => void;
}) {
  const [preview, setPreview] = useState<string | null>(null);
  const scope = data.scopeTemplates.find((item) => item.id === preview);
  const folder = data.profiles.find((item) => item.name === preview);
  const guide = guides[step - 1] ?? guides[0]!;
  const title =
    mode === 'guide'
      ? guide[0]!
      : mode === 'code'
        ? 'Project code example'
        : mode === 'scope-templates'
          ? 'Scope templates'
          : 'Structure templates';
  const items =
    mode === 'scope-templates'
      ? data.scopeTemplates.map((item) => ({ id: item.id, name: item.name }))
      : data.profiles.map((item) => ({ id: item.name, name: item.name }));
  return (
    <V4FloatingWorkspace
      open
      title={title}
      onRequestClose={onClose}
      panelClassName="v4-editor-float"
      footer={
        <>
          <V4Button onClick={onClose}>Close</V4Button>
          {preview && (scope || folder) && (
            <V4Button
              variant="primary"
              leadingIcon={<SctCheck />}
              onClick={() => {
                if (mode === 'scope-templates' && scope) onApplyScope(scope);
                if (mode === 'folder-templates' && folder)
                  data.update('folderProfile', folder.name);
                onClose();
              }}
            >
              Use template
            </V4Button>
          )}
        </>
      }
    >
      {mode === 'guide' ? (
        <p>{guide[1]}</p>
      ) : mode === 'code' ? (
        <>
          <p>Example using the current project name and the workspace code format:</p>
          <p>
            <strong>
              {formatProjectCode(
                1,
                new Date(),
                data.fields.projectName || 'Example Project',
                BUSINESS_TIME_ZONE,
              )}
            </strong>
          </p>
          <p>
            The sequence 001 is illustrative. The actual unique sequence is assigned only when the
            project is created. This preview reserves no number.
          </p>
        </>
      ) : (
        <div className="v4-wizard-template-browser">
          <div aria-label="Available templates">
            {items.length ? (
              items.map((item) => (
                <V4Button
                  key={item.id}
                  leadingIcon={<SctPreview />}
                  aria-pressed={preview === item.id}
                  onClick={() => setPreview(item.id)}
                >
                  {item.name}
                </V4Button>
              ))
            ) : (
              <p>No saved templates are available.</p>
            )}
          </div>
          {mode === 'scope-templates' && scope ? (
            <section aria-label="Scope template preview">
              <h3>{scope.name}</h3>
              <p>{scope.scope}</p>
              {(
                [
                  ['Services', scope.setup.designServices],
                  ['Deliverables', scope.setup.deliverables],
                  ['Documentation', scope.setup.documentation],
                  ['Standards', scope.setup.standards],
                ] as const
              ).map(([label, values]) => (
                <div key={label}>
                  <h4>{label}</h4>
                  <p>{values.join(', ') || 'None selected'}</p>
                </div>
              ))}
            </section>
          ) : null}
          {mode === 'folder-templates' && folder ? (
            <ProjectFolderTree paths={pathsOf(folder.folders)} root={folder.name} />
          ) : null}
          {!preview && items.length > 0 ? (
            <p>
              Select a template to preview it. Your current inputs stay unchanged until you choose
              Use template.
            </p>
          ) : null}
        </div>
      )}
    </V4FloatingWorkspace>
  );
}
