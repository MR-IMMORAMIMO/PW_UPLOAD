import { V4DateInput } from '../common/V4DateInput';
import { V4Button } from '../common/V4Button';
import { ProjectWizardHelp, type WizardHelpMode } from './ProjectWizardHelp';
import { projectWizardIssues } from './projectWizardReadiness';
import { useV4DirtySurface } from '../interaction/V4DirtyGuard';
import './projectWizard.css';
import { ProjectDirectoryEditor } from './ProjectDirectoryEditor';
import * as InlineGlyphs from '../common/SctIcons';
import {
  useState,
  useRef,
  useEffect,
  useLayoutEffect,
  useId,
  createContext,
  useContext,
} from 'react';
import { C, GAP, SHADOW } from './tokens';
import { ProjectFolderTree } from './ProjectFolderTree';
import { ProjectScheduleTimeline } from './ProjectScheduleTimeline';
import { formatBusinessDateOnly } from '../../date-time/businessDateTime';

import type { FinalProjectSetup } from '@scli/domain';
import { useFinalProjectCreation } from './useFinalProjectCreation';
import { V4FloatingWorkspace } from '../common/V4FloatingWorkspace';
import { createPortal } from 'react-dom';
import { useV4Overlay, V4ParentLayer, ensureV4OverlayRoot } from '../interaction/V4OverlayProvider';
import './referenceUtilities.css';
const FieldContext = createContext<ReturnType<typeof useFinalProjectCreation> | null>(null);
const HelpContext = createContext<(mode: WizardHelpMode) => void>(() => undefined);
function useFields() {
  const value = useContext(FieldContext);
  if (!value) throw new Error('Project creation provider required.');
  return value;
}
const fieldKeys: Record<string, string> = {
  'Enter project name': 'projectName',
  'Enter CRM reference number': 'crmReference',
  'Enter contract reference (optional)': 'contractReference',
  'Project code': 'projectCode',
  'Project name': 'projectName',
  '': 'clientName',
  'Select project type': 'projectType',
  'Select source or lead': 'sourceLead',
  'Select sales owner': 'salesOwnerId',
  'Select project manager': 'managerId',
  'Select priority': 'priority',
  'Select probability': 'probability',
  Commercial: 'category',
  'Lighting Design': 'discipline',
  'Schematic Design (SD)': 'designStage',
  'New Construction': 'projectNature',
  'Standard Package': 'packageType',
  Months: 'timelineUnit',
  'Lighting Design Standard (Default)': 'folderProfile',
};
type Origin = { x: number; y: number } | null;

const STEPS = [
  { n: 1, label: 'Project Info', sub: 'Basic information' },
  { n: 2, label: 'Scope & Services', sub: 'Define scope' },
  { n: 3, label: 'Schedule', sub: 'Key dates & milestones' },
  { n: 4, label: 'Project Structure', sub: 'Folders & organization' },
  { n: 5, label: 'Review', sub: 'Confirm details' },
];

const NEXT_LABELS = [
  'Next: Scope & Services',
  'Next: Schedule',
  'Next: Project Structure',
  'Next: Review',
  'Create Project',
];

const BACK_LABELS = [
  '',
  'Back: Project Info',
  'Back: Scope & Services',
  'Back: Schedule',
  'Back: Project Structure',
];

// ── Small helpers ────────────────────────────────────────────────

function Cb({ on }: { on: boolean }) {
  return (
    <div
      className="w-[15px] h-[15px] rounded flex items-center justify-center shrink-0 transition-colors border"
      style={{ background: on ? C.teal : C.white, borderColor: on ? C.teal : C.formBorder }}
    >
      {on && <InlineGlyphs.SctCheck width="9" height="9" color="white" />}
    </div>
  );
}

function Drop({ value, icon }: { value: string; icon?: React.ReactNode }) {
  const data = useFields();
  const key = fieldKeys[value] ?? value;
  const options: Record<string, Array<{ value: string; label: string }>> = {
    projectType: data.projectTypes.map((name) => ({ value: name, label: name })),
    salesOwnerId: data.sales.map((user) => ({ value: user.id, label: user.displayName })),
    managerId: data.managers
      .filter((user) => user.isActive)
      .map((user) => ({ value: user.id, label: user.displayName })),
    priority: ['High', 'Normal', 'Low'].map((value) => ({ value, label: value })),
    probability: ['0', '10', '25', '50', '75', '90', '100'].map((value) => ({
      value,
      label: `${value}%`,
    })),
    designStage: [
      'Concept',
      'SchematicDesign',
      'DetailedDesign',
      'Tender',
      'Construction',
      'AsBuilt',
    ].map((value) => ({ value, label: value })),
    folderProfile: data.profiles.map((profile) => ({ value: profile.name, label: profile.name })),
    timelineUnit: [
      { value: 'Months', label: 'Months' },
      { value: 'Weeks', label: 'Weeks' },
    ],
  };
  const selected =
    data.fields[key] ??
    (key === 'folderProfile'
      ? (data.selectedProfile?.name ?? '')
      : ['category', 'discipline', 'projectNature', 'packageType'].includes(key)
        ? value
        : '');
  return (
    <div
      className="flex items-center gap-2 w-full px-3 rounded-lg border cursor-pointer hover:border-teal-600 transition-colors"
      style={{ height: '42px', borderColor: C.formBorder, background: C.white }}
    >
      {icon && (
        <span className="shrink-0" style={{ color: C.textFaint }}>
          {icon}
        </span>
      )}
      {options[key] ? (
        <>
          <select
            aria-label={key}
            value={selected}
            onChange={(event) => data.update(key, event.target.value)}
            className="flex-1 min-w-0 h-full text-[13px] appearance-none bg-transparent outline-none"
            style={{ color: C.inputText }}
          >
            <option value="">{value || 'Select'}</option>
            {options[key]!.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
          <InlineGlyphs.SctExpand
            aria-hidden="true"
            width={14}
            height={14}
            style={{ pointerEvents: 'none' }}
          />
        </>
      ) : (
        <>
          <input
            aria-label={key}
            list={key === 'clientName' ? 'final-project-clients' : undefined}
            value={selected}
            onChange={(event) => data.update(key, event.target.value)}
            className="flex-1 min-w-0 text-[13px] bg-transparent outline-none"
            style={{ color: C.inputText }}
          />
          {key === 'clientName' ? (
            <datalist id="final-project-clients">
              {data.clients.map((name) => (
                <option key={name} value={name} />
              ))}
            </datalist>
          ) : null}
        </>
      )}
    </div>
  );
}

function Field({
  placeholder,
  note,
  icon,
}: {
  placeholder: string;
  defaultValue?: string;
  note?: string;
  icon?: React.ReactNode;
}) {
  const data = useFields();
  const key = fieldKeys[placeholder] ?? placeholder;
  return (
    <div>
      <div
        className="flex items-center gap-2 px-3 rounded-lg border"
        style={{ height: '42px', borderColor: C.formBorder, background: C.white }}
      >
        {icon && <span style={{ color: C.textFaint }}>{icon}</span>}
        <input
          className="flex-1 min-w-0 outline-none bg-transparent text-[13px] placeholder-[#94a3b8]"
          style={{ color: C.inputText }}
          aria-label={key}
          placeholder={placeholder}
          readOnly={key === 'projectCode'}
          value={key === 'projectCode' ? 'Assigned when created' : (data.fields[key] ?? '')}
          onChange={(event) => data.update(key, event.target.value)}
        />
      </div>
      {note && (
        <p className="text-[11px] mt-1" style={{ color: C.textFaint }}>
          {note}
        </p>
      )}
    </div>
  );
}

function Lbl({
  children,
  required,
}: {
  children: React.ReactNode;
  required?: boolean | undefined;
}) {
  return (
    <label className="block text-[13px] font-semibold mb-1.5" style={{ color: C.textLabel }}>
      {children}
      {required && <span className="text-red-500 ml-0.5">*</span>}
    </label>
  );
}

function PhaseBadge({ phase }: { phase: string }) {
  const M: Record<string, [string, string]> = {
    Design: ['#e0f7f6', '#0d9488'],
    Documentation: ['#ede9fe', '#6d28d9'],
    Procurement: ['#fef3c7', '#b45309'],
    Construction: ['#d1fae5', '#065f46'],
  };
  const [bg, color] = M[phase] || ['#f3f4f6', 'var(--v4-text-muted)'];
  return (
    <span
      className="px-2.5 py-1 rounded-md text-[11px] font-semibold"
      style={{ background: bg, color }}
    >
      {phase}
    </span>
  );
}

function Tick({ items }: { items: string[] }) {
  return (
    <div className="flex flex-col gap-2">
      {items.map((t, i) => (
        <div key={i} className="flex items-center gap-2">
          <InlineGlyphs.SctCheck width="12" height="12" color={C.teal} />
          <span className="text-[12px]" style={{ color: C.textMedium }}>
            {t}
          </span>
        </div>
      ))}
    </div>
  );
}

function LearnMore() {
  const showHelp = useContext(HelpContext);
  return (
    <button
      type="button"
      className="mt-3 text-[12px]"
      style={{ color: 'var(--v4-accent-ink)' }}
      onClick={() => showHelp('guide')}
    >
      Learn more
    </button>
  );
}

function S1Sidebar() {
  const showHelp = useContext(HelpContext);
  return (
    <>
      <div
        className="bg-white rounded-xl border"
        style={{ borderColor: C.formBorder, padding: GAP.lg }}
      >
        <div className="flex items-center gap-2 mb-2">
          <InlineGlyphs.SctInfo width="16" height="16" color={C.teal} />
          <span className="text-[13px] font-bold" style={{ color: C.textStrong }}>
            About Project Codes
          </span>
        </div>
        <p className="text-[12px] leading-relaxed" style={{ color: C.textSub }}>
          Project codes are generated automatically based on your company settings.
        </p>
        <button
          onClick={() => showHelp('code')}
          className="flex items-center gap-1 mt-3 text-[12px] font-semibold"
          style={{ color: 'var(--v4-accent-ink)' }}
        >
          View example
          <InlineGlyphs.SctNext width="11" height="11" color="currentColor" />
        </button>
      </div>
      <div className="bg-white rounded-xl border p-4" style={{ borderColor: C.formBorder }}>
        <div className="text-[13px] font-bold mb-3" style={{ color: C.textStrong }}>
          What you will set up next
        </div>
        <div className="flex flex-col gap-2.5">
          {[
            'Define project scope & services',
            'Set key dates & milestones',
            'Set up folder structure',
            'Review and create project',
          ].map((item, i) => (
            <div key={i} className="flex items-start gap-2.5">
              <div
                className="w-5 h-5 rounded-full flex items-center justify-center shrink-0 mt-0.5"
                style={{ background: C.tealLight, border: `1.5px solid ${C.tealBorder}` }}
              >
                <InlineGlyphs.SctCheck width="10" height="10" color={C.teal} />
              </div>
              <span className="text-[12px] leading-snug" style={{ color: C.textMedium }}>
                {item}
              </span>
            </div>
          ))}
        </div>
      </div>
      <div
        className="rounded-xl border"
        style={{ borderColor: C.tealBorder, padding: GAP.lg, background: 'rgba(13,148,136,0.06)' }}
      >
        <div className="flex items-center gap-2 mb-2">
          <InlineGlyphs.SctInfo width="16" height="16" color={C.textSub} />
          <span className="text-[13px] font-bold" style={{ color: C.textStrong }}>
            Need help?
          </span>
        </div>
        <p className="text-[12px] leading-relaxed" style={{ color: C.textSub }}>
          Enter the project name, client, and type, then define the scope. Dates and value are
          optional. Save a draft at any step to resume later.
        </p>
      </div>
    </>
  );
}

function S2Sidebar({
  onApply,
}: {
  onApply(template: ReturnType<typeof useFinalProjectCreation>['scopeTemplates'][number]): void;
}) {
  const data = useFields();
  const showHelp = useContext(HelpContext);
  return (
    <>
      <div
        className="bg-white rounded-xl border"
        style={{ borderColor: C.formBorder, padding: GAP.lg }}
      >
        <div className="flex items-center gap-2 mb-2">
          <InlineGlyphs.SctInfo width="16" height="16" color={C.teal} />
          <span className="text-[13px] font-bold" style={{ color: C.textStrong }}>
            About Scope & Services
          </span>
        </div>
        <p className="text-[12px] leading-relaxed" style={{ color: C.textSub }}>
          Define what work will be done and the services you will provide. Use templates to get
          started quickly.
        </p>
        <LearnMore />
      </div>
      <div className="bg-white rounded-xl border p-4" style={{ borderColor: C.formBorder }}>
        <div className="text-[13px] font-bold mb-3" style={{ color: C.textStrong }}>
          What you will set up next
        </div>
        <Tick
          items={[
            'Set key dates & milestones',
            'Define project schedule',
            'Align with deliverable timeline',
            'Identify critical deadlines',
          ]}
        />
      </div>
      <div className="bg-white rounded-xl border p-4" style={{ borderColor: C.formBorder }}>
        <div className="flex items-center gap-2 mb-2">
          <InlineGlyphs.SctScope width="14" height="14" color={C.textSub} />
          <span className="text-[13px] font-bold" style={{ color: C.textStrong }}>
            Scope Templates
          </span>
        </div>
        <p className="text-[12px] mb-3" style={{ color: C.textSub }}>
          Use a template to apply a prebuilt scope, services, and deliverables.
        </p>
        {data.scopeTemplates.map((t) => (
          <div
            key={t.id}
            role="button"
            tabIndex={0}
            onClick={() => onApply(t)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') onApply(t);
            }}
            className="flex items-center justify-between py-2.5 border-b last:border-0 cursor-pointer hover:opacity-70"
            style={{ borderColor: C.formBorder }}
          >
            <span className="text-[12px] font-medium" style={{ color: C.textMedium }}>
              {t.name}
            </span>
            <InlineGlyphs.SctNext width="12" height="12" color={C.textFaint} />
          </div>
        ))}
        <button
          onClick={() => showHelp('scope-templates')}
          className="flex items-center gap-1 mt-2 text-[12px] font-semibold"
          style={{ color: 'var(--v4-accent-ink)' }}
        >
          Browse all templates
          <InlineGlyphs.SctNext width="11" height="11" color="currentColor" />
        </button>
      </div>
    </>
  );
}

function S3Sidebar({ milestoneCount }: { milestoneCount: number }) {
  const data = useFields();
  const summary = [
    [
      'Project Start',
      data.fields.startDate ? formatBusinessDateOnly(data.fields.startDate) : 'Not scheduled',
    ],
    [
      'Target Completion',
      data.fields.completionDate
        ? formatBusinessDateOnly(data.fields.completionDate)
        : 'Not scheduled',
    ],
    [
      'Project Duration',
      data.fields.startDate && data.fields.completionDate
        ? `${Math.round((Date.parse(data.fields.completionDate) - Date.parse(data.fields.startDate)) / 86400000)} days`
        : 'Not scheduled',
    ],
    ['Milestones', String(milestoneCount)],
  ];
  return (
    <>
      <div
        className="bg-white rounded-xl border"
        style={{ borderColor: C.formBorder, padding: GAP.lg }}
      >
        <div className="flex items-center gap-2 mb-2">
          <InlineGlyphs.SctInfo width="16" height="16" color={C.teal} />
          <span className="text-[13px] font-bold" style={{ color: C.textStrong }}>
            About Schedule
          </span>
        </div>
        <p className="text-[12px] leading-relaxed" style={{ color: C.textSub }}>
          Set realistic dates and milestones to keep the project on track. You can adjust these
          later as the project evolves.
        </p>
        <LearnMore />
      </div>
      <div className="bg-white rounded-xl border p-4" style={{ borderColor: C.formBorder }}>
        <div className="flex items-center gap-2 mb-3">
          <InlineGlyphs.SctLight width="14" height="14" color="#f59e0b" />
          <span className="text-[13px] font-bold" style={{ color: C.textStrong }}>
            Tips for a better schedule
          </span>
        </div>
        <Tick
          items={[
            'Set achievable milestone dates',
            'Include review and approval time',
            'Consider procurement lead times',
            'Build in contingency for risks',
          ]}
        />
      </div>
      <div className="bg-white rounded-xl border p-4" style={{ borderColor: C.formBorder }}>
        <div className="text-[13px] font-bold mb-2" style={{ color: C.textStrong }}>
          What you will set up next
        </div>
        <Tick
          items={[
            'Organize project folders',
            'Define file structure',
            'Set up permissions (optional)',
          ]}
        />
      </div>
      <div className="bg-white rounded-xl border p-4" style={{ borderColor: C.formBorder }}>
        <div className="flex items-center gap-2 mb-3">
          <InlineGlyphs.SctDate width="14" height="14" color={C.textSub} />
          <span className="text-[13px] font-bold" style={{ color: C.textStrong }}>
            Schedule Summary
          </span>
        </div>
        {summary.map(([label, value]) => (
          <div
            key={label}
            className="flex items-center justify-between py-1.5 border-b last:border-0"
            style={{ borderColor: C.formBorder }}
          >
            <span className="text-[12px]" style={{ color: C.textSub }}>
              {label}
            </span>
            <span className="text-[12px] font-semibold" style={{ color: C.textStrong }}>
              {value}
            </span>
          </div>
        ))}
      </div>
    </>
  );
}

function S4Sidebar() {
  const data = useFields();
  const showHelp = useContext(HelpContext);
  const templates = data.profiles.map((profile) => ({
    label: profile.name,
    badge: profile.name === data.selectedProfile?.name ? 'Selected' : '',
  }));
  return (
    <>
      <div
        className="bg-white rounded-xl border"
        style={{ borderColor: C.formBorder, padding: GAP.lg }}
      >
        <div className="flex items-center gap-2 mb-2">
          <InlineGlyphs.SctInfo width="16" height="16" color={C.teal} />
          <span className="text-[13px] font-bold" style={{ color: C.textStrong }}>
            About Project Structure
          </span>
        </div>
        <p className="text-[12px] leading-relaxed mb-2" style={{ color: C.textSub }}>
          Define a clear, consistent folder structure to keep your project organized and easy to
          navigate.
        </p>
        <Tick
          items={[
            'Follows industry best practices',
            'Improves team collaboration',
            'Simplifies version control',
            'Supports long-term archiving',
          ]}
        />
        <LearnMore />
      </div>
      <div className="bg-white rounded-xl border p-4" style={{ borderColor: C.formBorder }}>
        <div className="flex items-center gap-2 mb-2">
          <InlineGlyphs.SctFolderProfile width="14" height="14" color="#f59e0b" />
          <span className="text-[13px] font-bold" style={{ color: C.textStrong }}>
            Recommended folder setup
          </span>
        </div>
        <p className="text-[12px] mb-2" style={{ color: C.textSub }}>
          Our standard setup is optimized for lighting design projects.
        </p>
        <Tick
          items={[
            'Logical workflow order',
            'Clear separation of content',
            'Easy to find and maintain',
            'Scalable for any project size',
          ]}
        />
      </div>
      <div className="bg-white rounded-xl border p-4" style={{ borderColor: C.formBorder }}>
        <div className="flex items-center gap-2 mb-2">
          <InlineGlyphs.SctFolderProfile width="14" height="14" color={C.textSub} />
          <span className="text-[13px] font-bold" style={{ color: C.textStrong }}>
            Structure Templates
          </span>
        </div>
        {templates.map((t) => (
          <div
            key={t.label}
            role="button"
            tabIndex={0}
            onClick={() => data.update('folderProfile', t.label)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') data.update('folderProfile', t.label);
            }}
            className="flex items-center justify-between py-2.5 border-b last:border-0 cursor-pointer hover:opacity-70"
            style={{ borderColor: C.formBorder }}
          >
            <div className="flex items-center gap-2">
              <span className="text-[12px] font-medium" style={{ color: C.textMedium }}>
                {t.label}
              </span>
              {t.badge && (
                <span
                  className="text-[10px] font-semibold px-1.5 py-0.5 rounded"
                  style={{ background: C.tealLight, color: 'var(--v4-accent-ink)' }}
                >
                  {t.badge}
                </span>
              )}
            </div>
            <InlineGlyphs.SctNext width="12" height="12" color={C.textFaint} />
          </div>
        ))}
        <button
          onClick={() => showHelp('folder-templates')}
          className="flex items-center gap-1 mt-2 text-[12px] font-semibold"
          style={{ color: 'var(--v4-accent-ink)' }}
        >
          Browse all templates
          <InlineGlyphs.SctNext width="11" height="11" color="currentColor" />
        </button>
      </div>
    </>
  );
}

function S5Sidebar({
  scopeSummary,
  milestones,
}: {
  scopeSummary: string;
  milestones: FinalProjectSetup['schedule']['milestones'];
}) {
  const data = useFields();
  const issues = Object.values(projectWizardIssues(data.fields, scopeSummary)).flat();
  const late = milestones.filter(
    (item) => data.fields.completionDate && item.targetDate > data.fields.completionDate,
  );
  return (
    <>
      <div
        className="rounded-xl border p-4"
        style={{ borderColor: C.tealBorder, background: C.tealLight }}
      >
        <div className="flex items-center gap-2 mb-2">
          <div
            className="w-7 h-7 rounded-full flex items-center justify-center shrink-0"
            style={{ background: C.teal }}
          >
            {issues.length ? (
              <InlineGlyphs.SctInfo width="14" height="14" color="white" />
            ) : (
              <InlineGlyphs.SctCheck width="14" height="14" color="white" />
            )}
          </div>
          <span className="text-[13px] font-bold" style={{ color: C.textStrong }}>
            Project Readiness
          </span>
        </div>
        <div className="text-[12px] font-semibold mb-0.5" style={{ color: C.textStrong }}>
          {issues.length ? 'Complete the required information' : 'Ready for your review'}
        </div>
        <div className="text-[12px] mb-3" style={{ color: C.textSub }}>
          Review the values before creating your Planning project.
        </div>
        {issues.length > 0 ? (
          <ul aria-label="Information to correct">
            {issues.map((issue) => (
              <li key={issue}>{issue}</li>
            ))}
          </ul>
        ) : (
          <p>Required information provided. Optional dates and value may remain blank.</p>
        )}
        <p>{data.folderDraft.folders.length} folders selected</p>
        {late.length > 0 && (
          <p role="status">
            Schedule warning: {late.map((item) => item.name).join(', ')}{' '}
            {late.length === 1 ? 'is' : 'are'} after target completion. Review the dates; this
            warning does not prevent creation.
          </p>
        )}
        <LearnMore />
      </div>
      <div className="bg-white rounded-xl border p-4" style={{ borderColor: C.formBorder }}>
        <div className="flex items-center gap-2 mb-3">
          <InlineGlyphs.SctTimeline width="14" height="14" color="#f59e0b" />
          <span className="text-[13px] font-bold" style={{ color: C.textStrong }}>
            What happens next
          </span>
        </div>
        {[
          'Click Create Project to set up your project and generate the folder structure.',
          'Your project workspace will be ready to use with the selected template and settings.',
          'You can start adding files and managing deliverables right away.',
        ].map((text, i) => (
          <div key={i} className="flex items-start gap-3 mb-3 last:mb-0">
            <div
              className="w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold text-white shrink-0 mt-0.5"
              style={{ background: C.teal }}
            >
              {i + 1}
            </div>
            <span className="text-[12px] leading-snug" style={{ color: C.textMedium }}>
              {text}
            </span>
          </div>
        ))}
      </div>
      <div className="bg-white rounded-xl border p-4" style={{ borderColor: C.formBorder }}>
        <div className="flex items-center gap-2 mb-3">
          <InlineGlyphs.SctSummary width="14" height="14" color={C.textSub} />
          <span className="text-[13px] font-bold" style={{ color: C.textStrong }}>
            Project Creation Summary
          </span>
        </div>
        {[
          ['Template', data.selectedProfile?.name ?? 'Blank'],
          ['Discipline', data.fields.discipline ?? 'Lighting Design'],
          ['Project Stage', data.fields.designStage],
          ['Site Type', data.fields.projectNature ?? 'New Construction'],
          ['Total Estimated Size', '—'],
        ].map(([label, value]) => (
          <div key={label} className="mb-2.5 last:mb-0">
            <div className="text-[11px]" style={{ color: C.textFaint }}>
              {label}
            </div>
            <div className="text-[12px] font-semibold" style={{ color: C.textStrong }}>
              {value}
            </div>
          </div>
        ))}
      </div>
    </>
  );
}

// ── Main modal ───────────────────────────────────────────────────

export default function FinalNewProjectModal({
  open,
  origin,
  onClose,
}: {
  open: boolean;
  origin: Origin;
  onClose: () => void;
}) {
  const data = useFinalProjectCreation();
  const [step, setStep] = useState(1);
  const [helpMode, setHelpMode] = useState<WizardHelpMode | null>(null);
  const [folderPreview, setFolderPreview] = useState(false);
  const [directoryKind, setDirectoryKind] = useState<'Client' | 'Manager' | 'Sales' | null>(null);
  const [description, setDescription] = useState('');
  // Step 2
  const [scopeSummary, setScopeSummary] = useState('');
  const [deliverables, setDeliverables] = useState<string[]>([]);
  const [ldServices, setLdServices] = useState<string[]>([]);
  const [docs, setDocs] = useState<string[]>([]);
  const [coordination, setCoordination] = useState('standard');
  const [standards, setStandards] = useState(['IES RP-7', 'ASHRAE 90.1', 'IECC 2021', 'ADA 2010']);
  const [optionalNotes, setOptionalNotes] = useState('');
  // Step 4
  const { enabledGroups, setEnabledGroups } = data;

  const [scheduleMilestones, setScheduleMilestones] = useState<
    FinalProjectSetup['schedule']['milestones']
  >([]);
  const [milestoneEdit, setMilestoneEdit] = useState<
    FinalProjectSetup['schedule']['milestones'][number] | null
  >(null);
  const [customDeliverable, setCustomDeliverable] = useState<string | null>(null);
  const milestoneDrag = useRef<string | null>(null);
  function moveMilestone(id: string, targetIndex: number) {
    setScheduleMilestones((items) => {
      const item = items.find((candidate) => candidate.id === id);
      if (!item) return items;
      const next = items.filter((candidate) => candidate.id !== id);
      next.splice(Math.max(0, Math.min(next.length, targetIndex)), 0, item);
      return next;
    });
  }
  const days = (from: string, to: string) =>
    Math.max(0, Math.round((Date.parse(to) - Date.parse(from)) / 86400000));
  const hasDates = Boolean(data.fields.startDate && data.fields.completionDate);
  const duration = hasDates ? days(data.fields.startDate!, data.fields.completionDate!) : 0;
  function setup(): FinalProjectSetup {
    return {
      schemaVersion: 1,
      sourceLead: data.fields.sourceLead ?? '',
      contractReference: data.fields.contractReference ?? '',
      managerId: data.fields.managerId || null,
      probability: data.fields.probability ? Number(data.fields.probability) : null,
      category: data.fields.category ?? 'Commercial',
      discipline: data.fields.discipline ?? 'Lighting Design',
      projectNature: data.fields.projectNature ?? 'New Construction',
      packageType: data.fields.packageType ?? 'Standard Package',
      deliverables,
      designServices: ldServices,
      documentation: docs,
      coordination: coordination as FinalProjectSetup['coordination'],
      standards,
      notes: optionalNotes,
      schedule: {
        startDate: data.fields.startDate!,
        completionDate: data.fields.completionDate!,
        designDurationDays: Number(data.fields.designDuration),
        constructionDurationDays: Number(data.fields.constructionDuration),
        milestones: scheduleMilestones,
      },
      structure: {
        enabledGroups,
        documentCategory: data.fields.documentCategory ?? 'MEET',
        sequenceDigits: Number(data.fields.sequenceDigits),
        separator: (data.fields.separator ?? '-') as '-' | '_',
        extension: (data.fields.extension ?? '.pdf') as '.pdf',
      },
    };
  }
  const snapshot = () => ({
    schemaVersion: 1 as const,
    step,
    fields: data.fields,
    description,
    scopeSummary,
    setup: setup(),
  });
  // Loading a folder preset is not a user edit. Track the explicit exclusions,
  // while retaining the complete resolved structure in the persisted draft.
  const fingerprint = JSON.stringify({
    ...snapshot(),
    setup: { ...setup(), structure: { ...setup().structure, enabledGroups: data.excludedGroups } },
  });
  const [clean, setClean] = useState(fingerprint);
  const resuming = useRef(false);
  useEffect(() => {
    if (resuming.current) {
      setClean(fingerprint);
      resuming.current = false;
    }
  }, [fingerprint]);
  const [confirmClose, setConfirmClose] = useState(false);
  const allowLeave = useRef(false);
  const [leave, setLeave] = useState<{ proceed: () => void; cancel: () => void } | null>(null);
  const [autosaveState, setAutosaveState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [adoptedDraft, setAdoptedDraft] = useState(false);
  const lastAttempt = useRef('');
  const autoSaveRef = useRef({ snapshot, save: data.saveDraft, fingerprint });
  useLayoutEffect(() => {
    autoSaveRef.current = { snapshot, save: data.saveDraft, fingerprint };
  });
  const canAutosave =
    open &&
    !data.loading &&
    !data.draftLoading &&
    !data.draftError &&
    !data.pending &&
    (data.savedDraft === null || adoptedDraft) &&
    fingerprint !== clean;
  useEffect(() => {
    if (!canAutosave || lastAttempt.current === fingerprint) return;
    const timer = window.setTimeout(() => {
      const current = autoSaveRef.current;
      lastAttempt.current = current.fingerprint;
      setAutosaveState('saving');
      void current
        .save(current.snapshot(), true)
        .then(() => {
          setAdoptedDraft(true);
          setClean(current.fingerprint);
          setAutosaveState('saved');
        })
        .catch(() => setAutosaveState('error'));
    }, 1200);
    return () => window.clearTimeout(timer);
  }, [canAutosave, fingerprint]);
  useV4DirtySurface(open && (fingerprint !== clean || data.pending), (_reason, proceed, cancel) => {
    if (data.creationCommitted.current || allowLeave.current) {
      proceed();
      return;
    }
    setLeave({ proceed, cancel });
    setConfirmClose(true);
  });
  const continueEditing = () => {
    leave?.cancel();
    setLeave(null);
    setConfirmClose(false);
  };
  const closeConfirmed = () => {
    allowLeave.current = true;
    setConfirmClose(false);
    if (leave) {
      leave.proceed();
      setLeave(null);
    } else onClose();
  };
  const requestClose = () => {
    if (data.pending) return;
    if (fingerprint !== clean) setConfirmClose(true);
    else onClose();
  };
  const save = (asDraft: boolean) => {
    if (asDraft)
      void data
        .saveDraft(snapshot())
        .then(() => {
          setAdoptedDraft(true);
          setClean(fingerprint);
          setAutosaveState('idle');
        })
        .catch(() => undefined);
    else void data.submit(setup(), description, scopeSummary);
  };
  const resumeDraft = () => {
    const saved = data.savedDraft;
    if (!saved) return;
    setAdoptedDraft(true);
    data.restoreDraftFields(saved.fields, saved.setup.structure.enabledGroups);
    setStep(saved.step);
    setDescription(saved.description);
    setScopeSummary(saved.scopeSummary);
    setDeliverables(saved.setup.deliverables);
    setLdServices(saved.setup.designServices);
    setDocs(saved.setup.documentation);
    setStandards(saved.setup.standards);
    setCoordination(saved.setup.coordination);
    setOptionalNotes(saved.setup.notes);
    setScheduleMilestones(saved.setup.schedule.milestones);
    resuming.current = true;
  };
  const nextStep = () => {
    if (step === 5) save(false);
    else if (data.validateStep(step, scopeSummary)) setStep((current) => current + 1);
  };
  const topCount = data.folderDraft.folders.filter((folder) => !folder.parentDraftFolderId).length;
  const subCount = data.folderDraft.folders.length - topCount;
  const namingPreview = `[Project Code] – ${data.fields.projectName || 'Project name'}`;
  const modalRef = useRef<HTMLDivElement>(null);
  const layerId = useId();
  const { register } = useV4Overlay();
  const closeRef = useRef(requestClose);
  const pendingRef = useRef(data.pending);
  useLayoutEffect(() => {
    closeRef.current = requestClose;
    pendingRef.current = data.pending;
  });
  useEffect(() => {
    if (!open) return;
    return register({
      id: layerId,
      parentId: null,
      kind: 'modal',
      dismissible: true,
      panelRef: modalRef,
      requestClose: () => {
        if (!pendingRef.current) closeRef.current();
      },
      shouldRestoreFocus: () => true,
    });
  }, [open, register, layerId]);
  const [tOrigin, setTOrigin] = useState('50% 50%');

  useLayoutEffect(() => {
    if (!open || !origin || !modalRef.current) return;
    const r = modalRef.current.getBoundingClientRect();
    const ox = ((origin.x - r.left) / r.width) * 100;
    const oy = ((origin.y - r.top) / r.height) * 100;
    setTOrigin(`${ox}% ${oy}%`);
  }, [open, origin]);

  function toggleArr<T>(arr: T[], item: T, set: (v: T[]) => void) {
    set(arr.includes(item) ? arr.filter((x) => x !== item) : [...arr, item]);
  }

  const subtitle =
    step === 5
      ? 'Review your project details and confirm to create.'
      : 'Create a new lighting design project and set it up for success.';

  return createPortal(
    <FieldContext.Provider value={data}>
      <V4ParentLayer id={layerId}>
        <HelpContext.Provider value={setHelpMode}>
          <div
            inert={!open}
            className="final-ui-reference fixed inset-0 flex items-center justify-center z-50"
            style={{
              background: open ? 'rgba(15,23,42,0.45)' : 'transparent',
              pointerEvents: open ? 'auto' : 'none',
              transition:
                'background var(--dur-slow) var(--ease-out), backdrop-filter var(--dur-slow) var(--ease-out)',
              backdropFilter: open ? 'blur(4px)' : 'blur(0px)',
            }}
            role="presentation"
            onClick={(event) => {
              if (event.target === event.currentTarget && !data.pending) requestClose();
            }}
          >
            <div
              ref={modalRef}
              inert={
                milestoneEdit ||
                customDeliverable !== null ||
                confirmClose ||
                folderPreview ||
                directoryKind ||
                helpMode
                  ? true
                  : undefined
              }
              aria-hidden={
                milestoneEdit ||
                customDeliverable !== null ||
                confirmClose ||
                folderPreview ||
                directoryKind ||
                helpMode
                  ? true
                  : undefined
              }
              role="dialog"
              aria-modal="true"
              aria-label="New Project"
              className="flex flex-col overflow-hidden"
              style={{
                width: 'calc(100vw - 48px)',
                height: 'calc(100dvh - 48px)',
                maxHeight: 'calc(100dvh - 48px)',
                background: C.modalBg,
                borderRadius: 16,
                transformOrigin: tOrigin,
                transform: open ? 'none' : 'perspective(1400px) rotateX(-14deg) scale(0.12, 0.06)',
                opacity: open ? 1 : 0,
                transition: open
                  ? 'transform 300ms cubic-bezier(0.16, 1, 0.3, 1), opacity 300ms ease'
                  : 'transform 300ms cubic-bezier(0.16, 1, 0.3, 1), opacity 300ms ease',
                boxShadow: SHADOW.newProj,
              }}
            >
              {/* ── Header ─────────────────────────────────────────────── */}
              <header
                className="flex items-start justify-between flex-wrap gap-3 px-8 pt-6 pb-4 bg-white border-b flex-shrink-0"
                style={{ borderColor: C.formBorder }}
              >
                <div className="flex items-center gap-4">
                  <div
                    className="w-11 h-11 rounded-xl flex items-center justify-center shrink-0"
                    style={{ background: C.tealLight, border: `1.5px solid ${C.tealBorder}` }}
                  >
                    <InlineGlyphs.SctProjects width="22" height="22" color={C.teal} />
                  </div>
                  <div>
                    <h1
                      className="text-[22px] font-bold leading-tight"
                      style={{ color: C.textStrong }}
                    >
                      New Project
                    </h1>
                    <p className="text-[13px] mt-0.5" style={{ color: C.textSub }}>
                      {subtitle}
                    </p>
                  </div>
                </div>
                <div className="flex items-center flex-wrap gap-3 mt-1">
                  <span role="status" className="text-[11px]" style={{ color: C.textSub }}>
                    {autosaveState === 'saving'
                      ? 'Saving draft…'
                      : autosaveState === 'error'
                        ? 'Draft not saved — use Save as Draft to retry'
                        : autosaveState === 'saved' && fingerprint === clean
                          ? 'Draft saved automatically'
                          : adoptedDraft || data.savedDraft === null
                            ? 'Draft autosave on'
                            : 'Resume saved draft to enable autosave'}
                  </span>
                  {data.savedDraft ? (
                    <button type="button" disabled={data.pending} onClick={resumeDraft}>
                      Resume saved draft
                    </button>
                  ) : null}
                  <button
                    disabled={data.pending}
                    onClick={() => save(true)}
                    className="flex items-center gap-2 px-4 py-2 rounded-lg border text-[13px] font-semibold transition-colors hover:bg-gray-50"
                    style={{ borderColor: C.formBorder, color: C.textMedium }}
                  >
                    <InlineGlyphs.SctSave width="15" height="15" color="currentColor" />
                    Save as Draft
                  </button>
                  <button
                    aria-label="Close New Project"
                    onClick={() => {
                      requestClose();
                    }}
                    className="w-8 h-8 rounded-full flex items-center justify-center hover:bg-gray-100 transition-colors"
                    style={{ color: C.textFaint }}
                  >
                    <InlineGlyphs.SctClose width="16" height="16" color="currentColor" />
                  </button>
                </div>
              </header>

              {data.notice || data.error ? (
                <p role="alert" className="px-8 py-2">
                  {data.notice || data.error}
                </p>
              ) : null}
              {data.loading ? (
                <p role="status" className="px-8">
                  Loading Project setup…
                </p>
              ) : null}
              {/* ── Step Wizard ──────────────────────────────────────────── */}
              <div
                className="flex items-center px-8 py-3.5 bg-white border-b flex-shrink-0"
                style={{ borderColor: C.formBorder }}
              >
                {STEPS.map((s, i) => (
                  <div
                    key={s.n}
                    className="flex items-center"
                    style={{ flex: i < STEPS.length - 1 ? '1' : 'none' }}
                  >
                    <button
                      onClick={() => s.n <= step && setStep(s.n)}
                      className="flex items-center gap-3 shrink-0"
                    >
                      <div
                        className="w-8 h-8 rounded-full flex items-center justify-center text-[13px] font-bold shrink-0 transition-colors"
                        style={{
                          background: s.n === step ? C.teal : s.n < step ? C.tealLight : C.lightBg,
                          color:
                            s.n === step
                              ? 'var(--v4-action-primary-foreground)'
                              : s.n < step
                                ? C.teal
                                : C.textFaint,
                          border: s.n < step ? `1.5px solid ${C.teal}` : 'none',
                        }}
                      >
                        {s.n < step ? (
                          <InlineGlyphs.SctCheck width="14" height="14" color={C.teal} />
                        ) : (
                          s.n
                        )}
                      </div>
                      <div className="text-left">
                        <div
                          className="text-[13px] font-semibold leading-tight"
                          style={{ color: s.n === step ? C.textStrong : C.textFaint }}
                        >
                          {s.label}
                        </div>
                        <div className="text-[11px]" style={{ color: C.textFaint }}>
                          {s.sub}
                        </div>
                      </div>
                    </button>
                    {i < STEPS.length - 1 && (
                      <div className="flex-1 mx-3">
                        <svg width="100%" height="2" viewBox="0 0 40 2" preserveAspectRatio="none">
                          <path
                            d="M0 1h40"
                            stroke={s.n < step ? C.teal : C.formBorder}
                            strokeWidth="1.5"
                            strokeDasharray="4 3"
                          />
                        </svg>
                      </div>
                    )}
                  </div>
                ))}
              </div>

              {/* ── Body ─────────────────────────────────────────────────── */}
              <div className="flex-1 overflow-hidden">
                <div className="flex h-full p-3" style={{ gap: GAP.lg }}>
                  {/* ── Main Form Card ────────────────────────────────── */}
                  <div className="flex-1 min-w-0 flex flex-col">
                    <div
                      className="bg-white rounded-xl border flex flex-col flex-1 overflow-hidden"
                      style={{ borderColor: C.formBorder, padding: GAP.lg }}
                    >
                      {/* ── STEP 1: Project Info ──────────────────────── */}
                      {step === 1 && (
                        <div className="flex-1 overflow-y-auto">
                          <div className="flex items-center gap-2 mb-1">
                            <InlineGlyphs.SctProjects width="17" height="17" color={C.textSub} />
                            <h2 className="text-[15px] font-bold" style={{ color: C.textStrong }}>
                              Project Information
                            </h2>
                          </div>
                          <p className="text-[13px] mb-5" style={{ color: C.textSub }}>
                            Enter the basic details of your project.
                          </p>

                          <div className="grid grid-cols-3 mb-3" style={{ gap: GAP.lg }}>
                            <div>
                              <Lbl required>Project Name</Lbl>
                              <Field
                                placeholder="Enter project name"
                                icon={
                                  <InlineGlyphs.SctProjects
                                    width="14"
                                    height="14"
                                    color="currentColor"
                                  />
                                }
                              />
                            </div>
                            <div>
                              <Lbl required>Client Name</Lbl>
                              <div className="flex gap-1.5">
                                <div className="flex-1">
                                  <Drop
                                    value=""
                                    icon={
                                      <InlineGlyphs.SctClient
                                        width="14"
                                        height="14"
                                        color="currentColor"
                                      />
                                    }
                                  />
                                </div>
                                <button
                                  type="button"
                                  aria-label="Add client"
                                  onClick={() => setDirectoryKind('Client')}
                                  className="w-9 rounded-lg border flex items-center justify-center shrink-0 hover:bg-gray-50 transition-colors"
                                  style={{
                                    height: '42px',
                                    borderColor: C.formBorder,
                                    color: 'var(--v4-accent-ink)',
                                  }}
                                >
                                  <InlineGlyphs.SctAdd
                                    width="14"
                                    height="14"
                                    color="currentColor"
                                  />
                                </button>
                              </div>
                            </div>
                            <div>
                              <Lbl>CRM Reference</Lbl>
                              <Field
                                placeholder="Enter CRM reference number"
                                note="Optional. Link to your CRM system."
                                icon={
                                  <InlineGlyphs.SctTag
                                    width="14"
                                    height="14"
                                    color="currentColor"
                                  />
                                }
                              />
                            </div>
                          </div>

                          <div className="grid grid-cols-3 mb-3" style={{ gap: GAP.lg }}>
                            <div>
                              <Lbl required>Project Type</Lbl>
                              <Drop
                                value="Select project type"
                                icon={
                                  <InlineGlyphs.SctCategory
                                    width="14"
                                    height="14"
                                    color="currentColor"
                                  />
                                }
                              />
                            </div>
                            <div>
                              <Lbl>Project Source / Lead</Lbl>
                              <Drop
                                value="Select source or lead"
                                icon={
                                  <InlineGlyphs.SctSources
                                    width="14"
                                    height="14"
                                    color="currentColor"
                                  />
                                }
                              />
                            </div>
                            <div>
                              <Lbl>Contract Reference</Lbl>
                              <Field
                                placeholder="Enter contract reference (optional)"
                                icon={
                                  <InlineGlyphs.SctFile
                                    width="14"
                                    height="14"
                                    color="currentColor"
                                  />
                                }
                              />
                            </div>
                          </div>

                          <div className="grid grid-cols-3 mb-3" style={{ gap: GAP.lg }}>
                            <div>
                              <div className="flex justify-between">
                                <Lbl>Sales Owner</Lbl>
                                <button type="button" onClick={() => setDirectoryKind('Sales')}>
                                  Add sales contact
                                </button>
                              </div>
                              <Drop
                                value="Select sales owner"
                                icon={
                                  <InlineGlyphs.SctSales
                                    width="14"
                                    height="14"
                                    color="currentColor"
                                  />
                                }
                              />
                            </div>
                            <div>
                              <div className="flex justify-between">
                                <Lbl>Project Manager</Lbl>
                                <button type="button" onClick={() => setDirectoryKind('Manager')}>
                                  Add manager
                                </button>
                              </div>
                              <Drop
                                value="Select project manager"
                                icon={
                                  <InlineGlyphs.SctProfile
                                    width="14"
                                    height="14"
                                    color="currentColor"
                                  />
                                }
                              />
                            </div>
                            <div>
                              <Lbl required>Priority</Lbl>
                              <Drop
                                value="Select priority"
                                icon={
                                  <InlineGlyphs.SctPriority
                                    width="14"
                                    height="14"
                                    color="currentColor"
                                  />
                                }
                              />
                            </div>
                          </div>

                          <label className="block mb-3 text-[13px]">
                            Site location (optional)
                            <input
                              aria-label="Site location"
                              className="block w-full rounded-lg border px-3 py-2"
                              style={{
                                background: C.white,
                                borderColor: C.formBorder,
                                color: C.inputText,
                              }}
                              value={data.fields.siteLocation ?? ''}
                              onChange={(event) => data.update('siteLocation', event.target.value)}
                            />
                          </label>
                          <div className="grid grid-cols-3 mb-4" style={{ gap: GAP.lg }}>
                            <div>
                              <Lbl>Current Stage</Lbl>
                              <div
                                className="flex items-center gap-2 w-full px-3 py-2.5 rounded-lg border"
                                style={{ borderColor: C.formBorder, background: C.white }}
                              >
                                <span
                                  className="w-2.5 h-2.5 rounded-full shrink-0"
                                  style={{ background: C.blue }}
                                />
                                <span
                                  className="flex-1 text-[13px] font-medium"
                                  style={{ color: C.inputText }}
                                >
                                  Planning
                                </span>
                              </div>
                            </div>
                            <div>
                              <Lbl>Value (Currency) — optional</Lbl>
                              <div className="flex gap-1.5">
                                <div
                                  className="flex items-center gap-1 px-3 py-2.5 rounded-lg border text-[13px] font-semibold cursor-pointer shrink-0"
                                  style={{
                                    borderColor: C.formBorder,
                                    color: C.inputText,
                                    background: C.white,
                                  }}
                                >
                                  <input
                                    aria-label="Currency"
                                    value={data.fields.currency}
                                    maxLength={3}
                                    onChange={(event) =>
                                      data.update('currency', event.target.value.toUpperCase())
                                    }
                                    style={{
                                      width: 34,
                                      background: 'transparent',
                                      border: 0,
                                      padding: 0,
                                      color: 'inherit',
                                    }}
                                  />
                                </div>
                                <input
                                  className="py-2.5 rounded-lg border text-[13px] outline-none"
                                  style={{
                                    paddingLeft: 10,
                                    paddingRight: 10,
                                    minWidth: 0,
                                    width: '100%',
                                    flexGrow: 1,
                                    borderColor: C.formBorder,
                                    color: C.inputText,
                                    background: C.white,
                                  }}
                                  aria-label="Project value"
                                  value={data.fields.commercialValue ?? ''}
                                  onChange={(event) =>
                                    data.update('commercialValue', event.target.value)
                                  }
                                  placeholder="Enter project value"
                                />
                              </div>
                            </div>
                            <div>
                              <Lbl>Probability (%)</Lbl>
                              <Drop
                                value="Select probability"
                                icon={
                                  <InlineGlyphs.SctPriority
                                    width="14"
                                    height="14"
                                    color="currentColor"
                                  />
                                }
                              />
                            </div>
                          </div>

                          <div>
                            <Lbl>Description / Notes</Lbl>
                            <div className="relative">
                              <textarea
                                aria-label="Description"
                                rows={4}
                                maxLength={1000}
                                value={description}
                                onChange={(e) => setDescription(e.target.value)}
                                placeholder="Add a brief description of the project, background, and any important notes..."
                                className="w-full px-4 py-3 rounded-lg border text-[13px] outline-none resize-none placeholder-[#94a3b8] transition-colors focus:border-teal-600"
                                style={{
                                  borderColor: C.formBorder,
                                  color: C.inputText,
                                  background: C.white,
                                  fontFamily: 'inherit',
                                }}
                              />
                              <span
                                className="absolute bottom-2.5 right-3 text-[11px]"
                                style={{ color: C.textFaint }}
                              >
                                {description.length} / 1000
                              </span>
                            </div>
                          </div>
                        </div>
                      )}

                      {/* ── STEP 2: Scope & Services ──────────────────── */}
                      {step === 2 && (
                        <div className="flex-1 overflow-y-auto pr-1">
                          <div className="flex items-center gap-2 mb-1">
                            <InlineGlyphs.SctScope width="17" height="17" color={C.textSub} />
                            <h2 className="text-[15px] font-bold" style={{ color: C.textStrong }}>
                              Scope & Services
                            </h2>
                          </div>
                          <p className="text-[13px] mb-4" style={{ color: C.textSub }}>
                            Define the project scope, services, and key requirements.
                          </p>

                          {/* Row 1: 4 dropdowns */}
                          <div className="grid grid-cols-4 gap-3 mb-4">
                            <div>
                              <Lbl required>Project Category</Lbl>
                              <Drop
                                value="Commercial"
                                icon={
                                  <InlineGlyphs.SctCategory
                                    width="14"
                                    height="14"
                                    color="currentColor"
                                  />
                                }
                              />
                            </div>
                            <div>
                              <Lbl required>Discipline / Service Type</Lbl>
                              <Drop
                                value="Lighting Design"
                                icon={
                                  <InlineGlyphs.SctLightingDesign
                                    width="14"
                                    height="14"
                                    color="currentColor"
                                  />
                                }
                              />
                            </div>
                            <div>
                              <Lbl required>Project Stage / Design Phase</Lbl>
                              <Drop
                                value="Schematic Design (SD)"
                                icon={
                                  <InlineGlyphs.SctTimeline
                                    width="14"
                                    height="14"
                                    color="currentColor"
                                  />
                                }
                              />
                            </div>
                            <div>
                              <Lbl required>Site Type</Lbl>
                              <Drop
                                value="New Construction"
                                icon={
                                  <InlineGlyphs.SctWorkspace
                                    width="14"
                                    height="14"
                                    color="currentColor"
                                  />
                                }
                              />
                            </div>
                          </div>

                          {/* Scope Summary + Service Package */}
                          <div className="grid grid-cols-2 gap-3 mb-4">
                            <div>
                              <Lbl required>Scope Summary</Lbl>
                              <div className="relative">
                                <textarea
                                  rows={3}
                                  maxLength={500}
                                  aria-label="Scope Summary"
                                  value={scopeSummary}
                                  onChange={(e) => setScopeSummary(e.target.value)}
                                  className="w-full px-3 py-2.5 rounded-lg border text-[13px] outline-none resize-none placeholder-[#94a3b8] focus:border-teal-600 transition-colors"
                                  style={{
                                    borderColor: C.formBorder,
                                    color: C.inputText,
                                    background: C.white,
                                    fontFamily: 'inherit',
                                    height: 42,
                                  }}
                                />
                                <span
                                  className="absolute bottom-2 right-2.5 text-[11px]"
                                  style={{ color: C.textFaint }}
                                >
                                  {scopeSummary.length} / 500
                                </span>
                              </div>
                            </div>
                            <div>
                              <Lbl required>Service Package</Lbl>
                              <Drop
                                value="Standard Package"
                                icon={
                                  <InlineGlyphs.SctPackages
                                    width="14"
                                    height="14"
                                    color="currentColor"
                                  />
                                }
                              />
                              <p className="text-[11px] mt-1" style={{ color: C.textFaint }}>
                                Predefined package of services and deliverables.
                              </p>
                            </div>
                          </div>

                          {/* Deliverables Included */}
                          <div className="mb-4">
                            <Lbl required>Deliverables Included</Lbl>
                            <div className="flex flex-wrap gap-2">
                              {[
                                'Lighting Plans',
                                'Calculations',
                                'Schedules',
                                'Details',
                                'Specifications',
                              ].map((d) => (
                                <button
                                  key={d}
                                  onClick={() => toggleArr(deliverables, d, setDeliverables)}
                                  className="flex items-center gap-2 px-3 py-1.5 rounded-lg border text-[12px] font-medium transition-all"
                                  style={{
                                    borderColor: deliverables.includes(d) ? C.teal : C.formBorder,
                                    background: deliverables.includes(d) ? C.tealLight : C.white,
                                    color: deliverables.includes(d) ? C.teal : C.textMedium,
                                  }}
                                >
                                  <Cb on={deliverables.includes(d)} />
                                  {d}
                                </button>
                              ))}
                              <button
                                onClick={() => setCustomDeliverable('')}
                                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-[12px] font-medium transition-colors hover:bg-gray-50"
                                style={{ borderColor: C.formBorder, color: C.textMedium }}
                              >
                                <InlineGlyphs.SctAdd width="12" height="12" color="currentColor" />
                                Add custom
                              </button>
                            </div>
                          </div>

                          {/* Lighting Design Services */}
                          <div className="mb-4">
                            <Lbl required>Lighting Design Services</Lbl>
                            <div className="grid grid-cols-4 gap-2">
                              {[
                                'Concept Design',
                                'Lighting Layout',
                                'Calculations & Analysis',
                                'Fixture Selection',
                                'Energy Code Compliance',
                                'Controls Design',
                                'Daylight Analysis',
                                'Mockups & Renderings',
                                'Cost Estimating',
                                'Value Engineering',
                                'Site Lighting Design',
                                'Post-Occupancy Support',
                              ].map((s) => (
                                <button
                                  key={s}
                                  onClick={() => toggleArr(ldServices, s, setLdServices)}
                                  className="flex items-center gap-2 px-3 py-2 rounded-lg border text-left text-[12px] transition-all"
                                  style={{
                                    borderColor: ldServices.includes(s) ? C.teal : C.formBorder,
                                    background: ldServices.includes(s) ? C.tealLight : C.white,
                                    color: ldServices.includes(s) ? C.teal : C.textMedium,
                                  }}
                                >
                                  <Cb on={ldServices.includes(s)} />
                                  <span className="leading-snug">{s}</span>
                                </button>
                              ))}
                            </div>
                          </div>

                          {/* Documentation + Coordination */}
                          <div className="grid grid-cols-2 gap-4 mb-4">
                            <div>
                              <Lbl required>Documentation Required</Lbl>
                              <div className="flex flex-col gap-2">
                                {[
                                  ['Lighting Plans (DWG/PDF)', 'Schedules / Luminaire Schedule'],
                                  ['Calculations (PDF)', 'Details & Sections'],
                                  ['Specifications (CSI)', 'BIM / Revit Deliverables'],
                                ].map(([left, right], ri) => (
                                  <div key={ri} className="grid grid-cols-2 gap-2">
                                    {[left, right]
                                      .filter((value): value is string => Boolean(value))
                                      .map((d) => (
                                        <button
                                          key={d}
                                          onClick={() => toggleArr(docs, d, setDocs)}
                                          className="flex items-center gap-2 text-[12px] text-left"
                                        >
                                          <Cb on={docs.includes(d)} />
                                          <span style={{ color: C.textMedium }}>{d}</span>
                                        </button>
                                      ))}
                                  </div>
                                ))}
                              </div>
                            </div>
                            <div>
                              <Lbl required>Coordination Requirements</Lbl>
                              <div className="flex flex-col gap-3">
                                {[
                                  { id: 'none', label: 'None / Minimal', desc: '' },
                                  { id: 'standard', label: 'Standard Coordination', desc: '' },
                                  {
                                    id: 'extensive',
                                    label: 'Extensive Coordination',
                                    desc: 'Includes meetings, reviews, and cross-discipline coordination.',
                                  },
                                ].map((opt) => (
                                  <button
                                    key={opt.id}
                                    onClick={() => setCoordination(opt.id)}
                                    className="flex items-start gap-2.5 text-left"
                                  >
                                    <div
                                      className="w-4 h-4 rounded-full border-2 flex items-center justify-center shrink-0 mt-0.5 transition-colors"
                                      style={{
                                        borderColor:
                                          coordination === opt.id ? C.teal : C.formBorder,
                                        background: 'transparent',
                                      }}
                                    >
                                      {coordination === opt.id && (
                                        <div
                                          className="w-2 h-2 rounded-full"
                                          style={{ background: C.teal }}
                                        />
                                      )}
                                    </div>
                                    <div>
                                      <div
                                        className="text-[13px] font-medium"
                                        style={{ color: C.textMedium }}
                                      >
                                        {opt.label}
                                      </div>
                                      {opt.desc && (
                                        <div className="text-[11px]" style={{ color: C.textFaint }}>
                                          {opt.desc}
                                        </div>
                                      )}
                                    </div>
                                  </button>
                                ))}
                              </div>
                            </div>
                          </div>

                          {/* Design Standards + Optional Notes */}
                          <div className="grid grid-cols-2 gap-4 mb-4">
                            <div>
                              <Lbl required>Design Standards / Codes</Lbl>
                              <div
                                className="flex flex-wrap items-center gap-1.5 px-3 py-2 rounded-lg border min-h-[42px]"
                                style={{ borderColor: C.formBorder, background: C.white }}
                              >
                                {standards.map((s) => (
                                  <span
                                    key={s}
                                    className="flex items-center gap-1 px-2 py-0.5 rounded text-[12px] font-semibold"
                                    style={{ background: C.lightBg, color: C.textMedium }}
                                  >
                                    {s}
                                    <button
                                      onClick={() =>
                                        setStandards((prev) => prev.filter((x) => x !== s))
                                      }
                                      style={{ color: C.textFaint }}
                                    >
                                      <InlineGlyphs.SctClose
                                        width="10"
                                        height="10"
                                        color="currentColor"
                                      />
                                    </button>
                                  </span>
                                ))}
                                <InlineGlyphs.SctExpand
                                  width="14"
                                  height="14"
                                  color={C.textFaint}
                                />
                              </div>
                            </div>
                            <div>
                              <Lbl>Optional Notes</Lbl>
                              <div className="relative">
                                <textarea
                                  rows={3}
                                  maxLength={500}
                                  aria-label="Optional Notes"
                                  value={optionalNotes}
                                  onChange={(e) => setOptionalNotes(e.target.value)}
                                  placeholder="Add any additional notes or special requirements..."
                                  className="w-full px-3 py-2.5 rounded-lg border text-[13px] outline-none resize-none placeholder-[#94a3b8] focus:border-teal-600 transition-colors"
                                  style={{
                                    borderColor: C.formBorder,
                                    color: C.inputText,
                                    background: C.white,
                                    fontFamily: 'inherit',
                                    height: 42,
                                  }}
                                />
                                <span
                                  className="absolute bottom-2 right-2.5 text-[11px]"
                                  style={{ color: C.textFaint }}
                                >
                                  {optionalNotes.length} / 500
                                </span>
                              </div>
                            </div>
                          </div>
                        </div>
                      )}

                      {/* ── STEP 3: Schedule ──────────────────────────── */}
                      {step === 3 && (
                        <div className="flex-1 overflow-y-auto pr-1">
                          <div className="flex items-center gap-2 mb-1">
                            <InlineGlyphs.SctDate width="17" height="17" color={C.textSub} />
                            <h2 className="text-[15px] font-bold" style={{ color: C.textStrong }}>
                              Schedule
                            </h2>
                          </div>
                          <p className="text-[13px] mb-4" style={{ color: C.textSub }}>
                            Define key dates, milestones, and project duration.
                          </p>

                          {/* Key Dates */}
                          <div className="mb-1">
                            <div
                              className="text-[13px] font-bold mb-2"
                              style={{ color: C.textStrong }}
                            >
                              Key Dates
                            </div>
                            <div className="grid grid-cols-3 gap-3">
                              {[
                                {
                                  label: 'Project Start',
                                  required: false,
                                  key: 'startDate',
                                  type: 'date',
                                },
                                {
                                  label: 'Target Completion',
                                  required: false,
                                  key: 'completionDate',
                                  type: 'date',
                                },
                              ].map((f) => (
                                <div key={f.label}>
                                  <Lbl required={f.required}>{f.label}</Lbl>
                                  <div
                                    className="flex items-center gap-2 px-3 rounded-lg border"
                                    style={{
                                      height: '42px',
                                      borderColor: C.formBorder,
                                      background: C.white,
                                    }}
                                  >
                                    <V4DateInput
                                      className="flex-1 min-w-0 outline-none bg-transparent text-[13px]"
                                      style={{ color: C.inputText }}
                                      aria-label={f.label}
                                      type={f.type}
                                      value={data.fields[f.key] ?? ''}
                                      onChange={(event) => data.update(f.key, event.target.value)}
                                    />
                                  </div>
                                </div>
                              ))}
                              <div>
                                <Lbl>Project Duration</Lbl>
                                <div
                                  className="px-3 py-2.5 rounded-lg border"
                                  style={{ borderColor: C.formBorder, background: C.lightBg }}
                                >
                                  <div
                                    className="text-[15px] font-bold"
                                    style={{ color: C.textStrong }}
                                  >
                                    {hasDates ? `${duration} days` : 'Not scheduled'}
                                  </div>
                                  <div className="text-[11px]" style={{ color: C.textSub }}>
                                    {data.fields.startDate} – {data.fields.completionDate}
                                  </div>
                                </div>
                              </div>
                            </div>
                          </div>

                          {/* Milestones */}
                          <div className="mb-3 mt-4">
                            <div className="flex items-center justify-between mb-2">
                              <div>
                                <div
                                  className="text-[13px] font-bold"
                                  style={{ color: C.textStrong }}
                                >
                                  Milestones
                                </div>
                                <div className="text-[12px]" style={{ color: C.textSub }}>
                                  Add, edit, or reorder milestones to align with the project
                                  roadmap.
                                </div>
                              </div>
                              <button
                                onClick={() =>
                                  setMilestoneEdit({
                                    id: crypto.randomUUID(),
                                    name: '',
                                    description: '',
                                    targetDate: data.fields.completionDate!,
                                    phase: 'Design',
                                  })
                                }
                                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-[12px] font-semibold transition-colors hover:bg-gray-50"
                                style={{ borderColor: C.formBorder, color: C.textMedium }}
                              >
                                <InlineGlyphs.SctAdd width="12" height="12" color="currentColor" />
                                Add Milestone
                              </button>
                            </div>
                            <div
                              className="rounded-xl border overflow-hidden"
                              style={{ borderColor: C.formBorder }}
                            >
                              <div
                                className="grid text-[11px] font-bold px-4 py-2.5 border-b"
                                style={{
                                  gridTemplateColumns: '1fr 160px 140px 120px 32px',
                                  borderColor: C.formBorder,
                                  color: C.textFaint,
                                  background: C.lightBg,
                                }}
                              >
                                <span>Milestone</span>
                                <span>Target Date</span>
                                <span>Phase</span>
                                <span>Status</span>
                                <span />
                              </div>
                              {scheduleMilestones.map((m, i) => (
                                <div
                                  key={m.id}
                                  draggable
                                  role="group"
                                  aria-label={`Milestone ${m.name}`}
                                  title="Drag to reorder, or use Alt+Up and Alt+Down"
                                  onDragStart={() => {
                                    milestoneDrag.current = m.id;
                                  }}
                                  onDragOver={(event) => event.preventDefault()}
                                  onDrop={(event) => {
                                    event.preventDefault();
                                    if (milestoneDrag.current)
                                      moveMilestone(milestoneDrag.current, i);
                                    milestoneDrag.current = null;
                                  }}
                                  className="grid items-center px-4 py-2.5 border-b last:border-0 hover:bg-gray-50 transition-colors"
                                  style={{
                                    gridTemplateColumns: '1fr 160px 140px 120px 32px',
                                    borderColor: C.formBorder,
                                  }}
                                >
                                  <div className="flex items-center gap-3">
                                    <button
                                      type="button"
                                      aria-label={`Reorder milestone ${m.name}`}
                                      style={{ border: 0, background: 'transparent', padding: 0 }}
                                      onKeyDown={(event) => {
                                        if (
                                          event.altKey &&
                                          (event.key === 'ArrowUp' || event.key === 'ArrowDown')
                                        ) {
                                          event.preventDefault();
                                          moveMilestone(
                                            m.id,
                                            i + (event.key === 'ArrowUp' ? -1 : 1),
                                          );
                                        }
                                      }}
                                    >
                                      <InlineGlyphs.SctDrag
                                        width="12"
                                        height="12"
                                        color={C.textFaint}
                                      />
                                    </button>
                                    <div
                                      className="w-6 h-6 rounded-md flex items-center justify-center shrink-0"
                                      style={{ background: C.lightBg }}
                                    >
                                      <InlineGlyphs.SctDate
                                        width="12"
                                        height="12"
                                        color={C.textSub}
                                      />
                                    </div>
                                    <div>
                                      <div
                                        className="text-[12px] font-semibold"
                                        style={{ color: C.textStrong }}
                                      >
                                        {m.name}
                                      </div>
                                      <div className="text-[11px]" style={{ color: C.textFaint }}>
                                        {m.description}
                                      </div>
                                    </div>
                                  </div>
                                  <div className="flex items-center gap-1.5">
                                    <InlineGlyphs.SctDate
                                      width="12"
                                      height="12"
                                      color={C.textFaint}
                                    />
                                    <span className="text-[12px]" style={{ color: C.textMedium }}>
                                      {formatBusinessDateOnly(m.targetDate)}
                                    </span>
                                  </div>
                                  <div>
                                    <PhaseBadge phase={m.phase} />
                                  </div>
                                  <div>
                                    <span
                                      className="px-2.5 py-1 rounded-md text-[11px] font-semibold"
                                      style={{
                                        background: 'var(--v4-surface-muted)',
                                        color: 'var(--v4-text-muted)',
                                      }}
                                    >
                                      Upcoming
                                    </span>
                                  </div>
                                  <button
                                    aria-label={`Edit milestone ${m.name}`}
                                    onClick={() => setMilestoneEdit(m)}
                                    style={{ color: C.textFaint }}
                                  >
                                    <InlineGlyphs.SctEdit
                                      width="14"
                                      height="14"
                                      color="currentColor"
                                    />
                                  </button>
                                </div>
                              ))}
                            </div>
                          </div>

                          <ProjectScheduleTimeline
                            start={data.fields.startDate ?? ''}
                            end={data.fields.completionDate ?? ''}
                            milestones={scheduleMilestones}
                          />
                        </div>
                      )}

                      {/* ── STEP 4: Project Structure ─────────────────── */}
                      {step === 4 && (
                        <div className="flex-1 overflow-y-auto">
                          <div className="flex items-center gap-2 mb-1">
                            <InlineGlyphs.SctProjects width="17" height="17" color={C.textSub} />
                            <h2 className="text-[15px] font-bold" style={{ color: C.textStrong }}>
                              Project Structure
                            </h2>
                          </div>
                          <p className="text-[13px] mb-4" style={{ color: C.textSub }}>
                            Set up folder organization, file standards, and project workspace
                            structure.
                          </p>

                          <div className="grid grid-cols-2 gap-4" style={{ minHeight: 0 }}>
                            {/* Left col */}
                            <div className="flex flex-col gap-3">
                              {/* Folder Template */}
                              <div>
                                <Lbl>Folder Template</Lbl>
                                <div className="flex gap-2">
                                  <div className="flex-1">
                                    <Drop
                                      value="Lighting Design Standard (Default)"
                                      icon={
                                        <InlineGlyphs.SctFolderProfile
                                          width="14"
                                          height="14"
                                          color="currentColor"
                                        />
                                      }
                                    />
                                  </div>
                                  <button
                                    onClick={() => setFolderPreview(true)}
                                    className="flex items-center gap-1.5 px-3 rounded-lg border text-[12px] font-semibold hover:bg-gray-50 transition-colors shrink-0"
                                    style={{ borderColor: C.formBorder, color: C.textMedium }}
                                  >
                                    <InlineGlyphs.SctPreview
                                      width="13"
                                      height="13"
                                      color="currentColor"
                                    />
                                    Preview template
                                  </button>
                                </div>
                              </div>

                              {/* Project Code + Name */}
                              <div className="grid grid-cols-2 gap-3">
                                <div>
                                  <Lbl>Project Code</Lbl>
                                  <Field placeholder="Project code" />
                                  <p className="text-[11px] mt-1" style={{ color: C.textFaint }}>
                                    Used in folder paths and document numbering.
                                  </p>
                                </div>
                                <div>
                                  <Lbl>Project Name (for paths)</Lbl>
                                  <Field placeholder="Project name" />
                                  <p className="text-[11px] mt-1" style={{ color: C.textFaint }}>
                                    Used for folder names and readability.
                                  </p>
                                </div>
                              </div>

                              {/* Naming Convention Preview */}
                              <div>
                                <div className="flex items-center gap-1.5 mb-1.5">
                                  <Lbl>Naming Convention Preview</Lbl>
                                  <InlineGlyphs.SctInfo
                                    width="13"
                                    height="13"
                                    color={C.textFaint}
                                  />
                                </div>
                                <div
                                  className="px-3 py-2.5 rounded-lg border text-[12px] font-mono"
                                  style={{
                                    borderColor: C.formBorder,
                                    background: 'rgba(241,245,249,0)',
                                    color: C.textMedium,
                                    lineHeight: 1.6,
                                  }}
                                >
                                  {namingPreview} / {data.folderNames[0] ?? ''}
                                </div>
                                <div className="flex items-center gap-1 mt-1.5">
                                  <InlineGlyphs.SctCheck width="12" height="12" color={C.teal} />
                                  <span
                                    className="text-[12px] font-semibold"
                                    style={{ color: 'var(--v4-accent-ink)' }}
                                  >
                                    Server-generated Project code
                                  </span>
                                </div>
                              </div>

                              <div>
                                <Lbl>Project root</Lbl>
                                <div className="flex gap-2">
                                  <input
                                    aria-label="Project root"
                                    value={data.projectRoot}
                                    readOnly
                                    className="flex-1 min-w-0 rounded-lg border px-3 py-2"
                                    style={{
                                      background: C.white,
                                      color: C.inputText,
                                      borderColor: C.formBorder,
                                    }}
                                  />
                                  <button
                                    type="button"
                                    onClick={() => void data.browseProjectRoot()}
                                  >
                                    Browse
                                  </button>
                                </div>
                                <p className="text-[12px] mt-1" style={{ color: C.textSub }}>
                                  Uses the Settings folder by default. Changing it here affects this
                                  project only.
                                </p>
                              </div>

                              {/* Enabled Folder Groups */}
                              <div style={{ height: 162 }}>
                                <div className="flex items-center justify-between mb-2">
                                  <div className="flex items-center gap-1.5">
                                    <div
                                      className="text-[13px] font-bold"
                                      style={{ color: C.textStrong }}
                                    >
                                      Enabled Folder Groups
                                    </div>
                                    <InlineGlyphs.SctInfo
                                      width="13"
                                      height="13"
                                      color={C.textFaint}
                                    />
                                  </div>
                                  <span className="text-[12px]" style={{ color: C.textSub }}>
                                    {enabledGroups.length} of {data.roots.length} enabled
                                  </span>
                                </div>
                                <div className="grid grid-cols-2 gap-y-2.5 gap-x-4">
                                  {data.roots
                                    .map((root) => root.name)
                                    .map((g) => (
                                      <div
                                        key={g}
                                        role="checkbox"
                                        aria-checked={enabledGroups.includes(g)}
                                        tabIndex={0}
                                        onKeyDown={(event) => {
                                          if (event.key === ' ' || event.key === 'Enter') {
                                            event.preventDefault();
                                            toggleArr(enabledGroups, g, setEnabledGroups);
                                          }
                                        }}
                                        onClick={() =>
                                          toggleArr(enabledGroups, g, setEnabledGroups)
                                        }
                                        className="flex items-center gap-2 cursor-pointer"
                                      >
                                        <Cb on={enabledGroups.includes(g)} />
                                        <span
                                          className="text-[12px]"
                                          style={{ color: C.textMedium }}
                                        >
                                          {g}
                                        </span>
                                      </div>
                                    ))}
                                </div>
                                <p className="text-[11px] mt-2" style={{ color: C.textFaint }}>
                                  Select the groups to include in this project.
                                </p>
                              </div>
                            </div>

                            {/* Right col: Project Structure Preview */}
                            <div className="flex flex-col gap-3">
                              <div
                                className="rounded-xl border flex-1 flex flex-col overflow-hidden"
                                style={{ borderColor: C.formBorder }}
                              >
                                <div
                                  className="flex items-center justify-between px-4 py-3 border-b"
                                  style={{ borderColor: C.formBorder }}
                                >
                                  <div className="flex items-center gap-2">
                                    <span
                                      className="text-[13px] font-bold"
                                      style={{ color: C.textStrong }}
                                    >
                                      Project Structure Preview
                                    </span>
                                    <InlineGlyphs.SctInfo
                                      width="13"
                                      height="13"
                                      color={C.textFaint}
                                    />
                                  </div>
                                </div>
                                <div
                                  data-folder-preview
                                  className="flex-1 overflow-y-auto px-3 py-2"
                                >
                                  <ProjectFolderTree
                                    paths={data.folderNames}
                                    root={namingPreview}
                                  />
                                </div>
                                {/* Stats */}
                                <div
                                  className="border-t px-4 py-2.5 grid grid-cols-4 gap-2"
                                  style={{ borderColor: C.formBorder }}
                                >
                                  {[
                                    {
                                      icon: (
                                        <InlineGlyphs.SctFolder
                                          width="14"
                                          height="14"
                                          color={C.teal}
                                        />
                                      ),
                                      val: String(topCount),
                                      label: 'Top-level folders',
                                    },
                                    {
                                      icon: (
                                        <InlineGlyphs.SctFolder
                                          width="14"
                                          height="14"
                                          color={C.teal}
                                        />
                                      ),
                                      val: String(subCount),
                                      label: 'Total subfolders',
                                    },
                                    {
                                      icon: (
                                        <InlineGlyphs.SctFile
                                          width="14"
                                          height="14"
                                          color={C.teal}
                                        />
                                      ),
                                      val: '0',
                                      label: 'Sample files',
                                    },
                                    {
                                      icon: (
                                        <InlineGlyphs.SctDimensions
                                          width="14"
                                          height="14"
                                          color={C.teal}
                                        />
                                      ),
                                      val: '—',
                                      label: 'Total size (est.)',
                                    },
                                  ].map(({ icon, val, label }) => (
                                    <div key={label} className="flex items-center gap-1.5">
                                      {icon}
                                      <div>
                                        <div
                                          className="text-[13px] font-bold"
                                          style={{ color: C.textStrong }}
                                        >
                                          {val}
                                        </div>
                                        <div className="text-[10px]" style={{ color: C.textFaint }}>
                                          {label}
                                        </div>
                                      </div>
                                    </div>
                                  ))}
                                </div>
                                {/* Info note */}
                                <div
                                  className="mx-3 mb-3 flex items-start gap-2 px-3 py-2.5 rounded-lg"
                                  style={{ background: C.lightBg }}
                                >
                                  <InlineGlyphs.SctInfo
                                    width="14"
                                    height="14"
                                    className="shrink-0 mt-0.5"
                                    color={C.textSub}
                                  />
                                  <span className="text-[11px]" style={{ color: C.textSub }}>
                                    This is a live preview. Folder names will be created when the
                                    project is created.
                                  </span>
                                </div>
                              </div>
                            </div>
                          </div>
                        </div>
                      )}

                      {/* ── STEP 5: Review ────────────────────────────── */}
                      {step === 5 && (
                        <div className="flex-1 overflow-y-auto pr-1">
                          {/* Section 1: Project Information */}
                          <div
                            className="rounded-xl border mb-3"
                            style={{ borderColor: C.formBorder }}
                          >
                            <div
                              className="flex items-center justify-between px-5 py-3 border-b"
                              style={{ borderColor: C.formBorder }}
                            >
                              <div className="flex items-center gap-3">
                                <div
                                  className="w-7 h-7 rounded-full flex items-center justify-center text-[12px] font-bold text-white"
                                  style={{ background: C.teal }}
                                >
                                  1
                                </div>
                                <span
                                  className="text-[14px] font-bold"
                                  style={{ color: C.textStrong }}
                                >
                                  Project Information
                                </span>
                              </div>
                              <button
                                onClick={() => setStep(1)}
                                className="px-3 py-1 rounded-lg border text-[12px] font-semibold hover:bg-gray-50"
                                style={{ borderColor: C.formBorder, color: C.textMedium }}
                              >
                                Edit
                              </button>
                            </div>
                            <div className="px-5 py-3 grid grid-cols-2 gap-x-12 gap-y-2">
                              {[
                                { label: 'Project Code', value: '[Project Code]' },
                                { label: 'Created', value: 'Not created yet' },
                                { label: 'Project Name', value: data.fields.projectName ?? '' },
                                { label: 'Last Updated', value: 'Not created yet' },
                                {
                                  label: 'Folder Template',
                                  value: data.selectedProfile?.name ?? 'Blank',
                                },
                                {
                                  label: 'Project Stage / Design Phase',
                                  value: data.fields.designStage ?? '',
                                },
                                { label: 'Description', value: description || '—' },
                                { label: 'Client', value: data.fields.clientName || '—' },
                                { label: 'Project Type', value: data.fields.projectType || '—' },
                                {
                                  label: 'Sales Owner',
                                  value:
                                    data.sales.find((item) => item.id === data.fields.salesOwnerId)
                                      ?.displayName || 'Not selected',
                                },
                                {
                                  label: 'Project Manager',
                                  value:
                                    data.managers.find((item) => item.id === data.fields.managerId)
                                      ?.displayName || 'Not selected',
                                },
                                {
                                  label: 'Value',
                                  value: data.fields.commercialValue
                                    ? `${data.fields.currency} ${data.fields.commercialValue}`
                                    : 'Not provided',
                                },
                                { label: 'CRM Reference', value: data.fields.crmReference || '—' },
                                {
                                  label: 'Contract Reference',
                                  value: data.fields.contractReference || '—',
                                },
                                { label: 'Source / Lead', value: data.fields.sourceLead || '—' },
                                { label: 'Site Location', value: data.fields.siteLocation || '—' },
                                { label: 'Priority', value: data.fields.priority || 'Normal' },
                                {
                                  label: 'Project root',
                                  value: data.projectRoot || 'Select before creation',
                                },
                                {
                                  label: 'Site Type',
                                  value: data.fields.projectNature ?? 'New Construction',
                                },
                              ].map(({ label, value }) => (
                                <div key={label} className="flex gap-4">
                                  <span
                                    className="text-[12px] w-44 shrink-0"
                                    style={{ color: C.textSub }}
                                  >
                                    {label}
                                  </span>
                                  <span
                                    className="text-[12px] font-semibold"
                                    style={{ color: C.textStrong }}
                                  >
                                    {value}
                                  </span>
                                </div>
                              ))}
                            </div>
                          </div>

                          {/* Section 2: Scope & Services */}
                          <div
                            className="rounded-xl border mb-3"
                            style={{ borderColor: C.formBorder }}
                          >
                            <div
                              className="flex items-center justify-between px-5 py-3 border-b"
                              style={{ borderColor: C.formBorder }}
                            >
                              <div className="flex items-center gap-3">
                                <div
                                  className="w-7 h-7 rounded-full flex items-center justify-center text-[12px] font-bold text-white"
                                  style={{ background: C.teal }}
                                >
                                  2
                                </div>
                                <span
                                  className="text-[14px] font-bold"
                                  style={{ color: C.textStrong }}
                                >
                                  Scope & Services
                                </span>
                              </div>
                              <button
                                onClick={() => setStep(2)}
                                className="px-3 py-1 rounded-lg border text-[12px] font-semibold hover:bg-gray-50"
                                style={{ borderColor: C.formBorder, color: C.textMedium }}
                              >
                                Edit
                              </button>
                            </div>
                            <div className="px-5 py-3 grid grid-cols-3 gap-6">
                              <div>
                                {[
                                  ['Project Category', data.fields.category ?? 'Commercial'],
                                  [
                                    'Discipline / Service Type',
                                    data.fields.discipline ?? 'Lighting Design',
                                  ],
                                  [
                                    'Service Package',
                                    data.fields.packageType ?? 'Standard Package',
                                  ],
                                ].map(([l, v]) => (
                                  <div key={l} className="mb-2.5">
                                    <div className="text-[11px]" style={{ color: C.textSub }}>
                                      {l}
                                    </div>
                                    <div
                                      className="text-[12px] font-semibold"
                                      style={{ color: C.textStrong }}
                                    >
                                      {v}
                                    </div>
                                  </div>
                                ))}
                                <div className="mb-2.5">
                                  <div className="text-[11px] mb-0.5" style={{ color: C.textSub }}>
                                    Scope Summary
                                  </div>
                                  <div
                                    className="text-[12px]"
                                    style={{ color: C.textStrong, lineHeight: 1.5 }}
                                  >
                                    {scopeSummary}
                                  </div>
                                </div>
                              </div>
                              <div>
                                <div className="mb-3">
                                  <div className="text-[11px] mb-1" style={{ color: C.textSub }}>
                                    Deliverables Included ({deliverables.length})
                                  </div>
                                  <Tick items={deliverables} />
                                </div>
                                <div>
                                  <div className="text-[11px] mb-1" style={{ color: C.textSub }}>
                                    Lighting Design Services ({ldServices.length})
                                  </div>
                                  <div className="flex items-center gap-1.5">
                                    <InlineGlyphs.SctScope width="12" height="12" color={C.teal} />
                                    <span className="text-[12px]" style={{ color: C.textMedium }}>
                                      {ldServices.length} services selected
                                    </span>
                                  </div>
                                </div>
                              </div>
                              <div>
                                <div className="mb-3">
                                  <div className="text-[11px] mb-1" style={{ color: C.textSub }}>
                                    Design Standards / Codes ({standards.length})
                                  </div>
                                  <div className="text-[12px]" style={{ color: C.textStrong }}>
                                    {standards.join(', ')}
                                  </div>
                                </div>
                                <div className="mb-3">
                                  <div className="text-[11px] mb-1" style={{ color: C.textSub }}>
                                    Documentation Required ({docs.length})
                                  </div>
                                  <div className="text-[12px]" style={{ color: C.textMedium }}>
                                    {docs.length} items selected
                                  </div>
                                </div>
                                <div>
                                  <div className="text-[11px] mb-0.5" style={{ color: C.textSub }}>
                                    Coordination Requirements
                                  </div>
                                  <div
                                    className="text-[12px] font-semibold capitalize"
                                    style={{ color: C.textStrong }}
                                  >
                                    {coordination === 'standard'
                                      ? 'Standard Coordination'
                                      : coordination === 'extensive'
                                        ? 'Extensive Coordination'
                                        : 'None / Minimal'}
                                  </div>
                                </div>
                              </div>
                            </div>
                            <div
                              className="px-5 pb-3 border-t mx-5"
                              style={{ borderColor: C.formBorder }}
                            >
                              <div className="grid grid-cols-5 gap-3 mt-3">
                                {[
                                  {
                                    label: 'Project Complexity',
                                    value: 'Medium',
                                    color: '#0d9488',
                                  },
                                  { label: 'Estimated Workload', value: '—', color: '#0d9488' },
                                  { label: 'Team Size (Suggested)', value: '—', color: '#3b82f6' },
                                  { label: 'Risk Level', value: '—', color: '#f59e0b' },
                                  {
                                    label: 'Budget Impact',
                                    value: '—',
                                    color: 'var(--v4-text-muted)',
                                  },
                                ].map(({ label, value, color }) => (
                                  <div key={label}>
                                    <div className="text-[11px]" style={{ color: C.textFaint }}>
                                      {label}
                                    </div>
                                    <div className="text-[13px] font-bold" style={{ color }}>
                                      {value}
                                    </div>
                                  </div>
                                ))}
                              </div>
                            </div>
                          </div>

                          {/* Section 3: Schedule */}
                          <div
                            className="rounded-xl border mb-3"
                            style={{ borderColor: C.formBorder }}
                          >
                            <div
                              className="flex items-center justify-between px-5 py-3 border-b"
                              style={{ borderColor: C.formBorder }}
                            >
                              <div className="flex items-center gap-3">
                                <div
                                  className="w-7 h-7 rounded-full flex items-center justify-center text-[12px] font-bold text-white"
                                  style={{ background: C.teal }}
                                >
                                  3
                                </div>
                                <span
                                  className="text-[14px] font-bold"
                                  style={{ color: C.textStrong }}
                                >
                                  Schedule
                                </span>
                              </div>
                              <button
                                onClick={() => setStep(3)}
                                className="px-3 py-1 rounded-lg border text-[12px] font-semibold hover:bg-gray-50"
                                style={{ borderColor: C.formBorder, color: C.textMedium }}
                              >
                                Edit
                              </button>
                            </div>
                            <div className="px-5 py-3 grid grid-cols-3 gap-6">
                              {[
                                [
                                  [
                                    'Project Start Date',
                                    formatBusinessDateOnly(data.fields.startDate ?? '') ||
                                      'Not scheduled',
                                  ],
                                  [
                                    'Project End Date',
                                    formatBusinessDateOnly(data.fields.completionDate ?? '') ||
                                      'Not scheduled',
                                  ],
                                  ['Duration', hasDates ? `${duration} days` : 'Not scheduled'],
                                ],
                                [['Key Milestones', `${scheduleMilestones.length} milestones`]],
                                [
                                  [
                                    'Deliverable Timeline',
                                    scheduleMilestones.length
                                      ? 'See authored milestone dates'
                                      : 'No milestones added',
                                  ],
                                  ['Calendars', 'Calendar days'],
                                ],
                              ].map((col, ci) => (
                                <div key={ci}>
                                  {col.map(([l, v]) => (
                                    <div key={l} className="mb-2.5">
                                      <div className="text-[11px]" style={{ color: C.textSub }}>
                                        {l}
                                      </div>
                                      <div
                                        className="text-[12px] font-semibold"
                                        style={{ color: C.textStrong }}
                                      >
                                        {v}
                                      </div>
                                    </div>
                                  ))}
                                </div>
                              ))}
                            </div>
                          </div>

                          {/* Section 4: Project Structure */}
                          <div className="rounded-xl border" style={{ borderColor: C.formBorder }}>
                            <div
                              className="flex items-center justify-between px-5 py-3 border-b"
                              style={{ borderColor: C.formBorder }}
                            >
                              <div className="flex items-center gap-3">
                                <div
                                  className="w-7 h-7 rounded-full flex items-center justify-center text-[12px] font-bold text-white"
                                  style={{ background: C.teal }}
                                >
                                  4
                                </div>
                                <span
                                  className="text-[14px] font-bold"
                                  style={{ color: C.textStrong }}
                                >
                                  Project Structure
                                </span>
                              </div>
                              <button
                                onClick={() => setStep(4)}
                                className="px-3 py-1 rounded-lg border text-[12px] font-semibold hover:bg-gray-50"
                                style={{ borderColor: C.formBorder, color: C.textMedium }}
                              >
                                Edit
                              </button>
                            </div>
                            <div className="px-5 py-3 grid grid-cols-2 gap-6">
                              <div>
                                {[
                                  ['Folder Template', data.selectedProfile?.name ?? 'Blank'],
                                  [
                                    'Enabled Folders',
                                    `${enabledGroups.length} of ${data.roots.length} enabled`,
                                  ],
                                ].map(([l, v]) => (
                                  <div key={l} className="mb-2.5">
                                    <div className="text-[11px]" style={{ color: C.textSub }}>
                                      {l}
                                    </div>
                                    <div
                                      className="text-[12px] font-semibold"
                                      style={{ color: C.textStrong }}
                                    >
                                      {v}
                                    </div>
                                  </div>
                                ))}
                                <div>
                                  <div className="text-[11px] mb-0.5" style={{ color: C.textSub }}>
                                    Naming Convention
                                  </div>
                                  <div
                                    className="text-[12px] font-mono"
                                    style={{ color: C.textStrong }}
                                  >
                                    {namingPreview} / {data.folderNames[0] ?? ''}
                                  </div>
                                  <div className="flex items-center gap-1 mt-1">
                                    <InlineGlyphs.SctCheck width="11" height="11" color={C.teal} />
                                    <span
                                      className="text-[11px] font-semibold"
                                      style={{ color: 'var(--v4-accent-ink)' }}
                                    >
                                      Server-generated Project code
                                    </span>
                                  </div>
                                </div>
                              </div>
                              <div>
                                <div
                                  className="text-[12px] font-bold mb-2"
                                  style={{ color: C.textStrong }}
                                >
                                  Structure Summary
                                </div>
                                <div className="grid grid-cols-4 gap-2 mb-3">
                                  {[
                                    [String(topCount), 'Top-level folders'],
                                    [String(subCount), 'Total subfolders'],
                                    ['0', 'Sample files'],
                                    ['—', 'Total size (est.)'],
                                  ].map(([v, l]) => (
                                    <div key={l}>
                                      <div
                                        className="text-[16px] font-bold"
                                        style={{ color: C.textStrong }}
                                      >
                                        {v}
                                      </div>
                                      <div className="text-[10px]" style={{ color: C.textFaint }}>
                                        {l}
                                      </div>
                                    </div>
                                  ))}
                                </div>
                                <div
                                  className="flex items-start gap-2 px-3 py-2.5 rounded-lg"
                                  style={{ background: C.lightBg }}
                                >
                                  <InlineGlyphs.SctInfo
                                    width="13"
                                    height="13"
                                    className="shrink-0 mt-0.5"
                                    color={C.textSub}
                                  />
                                  <span className="text-[11px]" style={{ color: C.textSub }}>
                                    Folders and naming convention will be created when the project
                                    is created.
                                  </span>
                                </div>
                              </div>
                            </div>
                          </div>
                        </div>
                      )}

                      {/* ── Footer ───────────────────────────────────────── */}
                      <div
                        className="flex items-center justify-between border-t mt-auto"
                        style={{
                          height: '72px',
                          alignItems: 'center',
                          marginRight: 0,
                          marginBottom: 0,
                          marginLeft: 0,
                          paddingRight: 0,
                          paddingBottom: 0,
                          paddingLeft: 0,
                          borderColor: C.lightBg,
                          flexShrink: 0,
                        }}
                      >
                        {step === 1 ? (
                          <button
                            onClick={() => {
                              requestClose();
                            }}
                            className="px-5 py-2.5 rounded-lg border text-[13px] font-semibold transition-colors hover:bg-gray-50"
                            style={{ borderColor: C.formBorder, color: C.textMedium }}
                          >
                            Cancel
                          </button>
                        ) : (
                          <button
                            onClick={() => setStep((s) => Math.max(s - 1, 1))}
                            className="flex items-center gap-2 px-5 py-2.5 rounded-lg border text-[13px] font-semibold transition-colors hover:bg-gray-50"
                            style={{ borderColor: C.formBorder, color: C.textMedium }}
                          >
                            <InlineGlyphs.SctBack width="15" height="15" color="currentColor" />
                            {BACK_LABELS[step - 1]}
                          </button>
                        )}
                        <div className="flex items-center gap-3">
                          {step === 5 && (
                            <button
                              disabled={data.pending}
                              onClick={() => save(true)}
                              className="flex items-center gap-2 px-5 py-2.5 rounded-lg border text-[13px] font-semibold transition-colors hover:bg-gray-50"
                              style={{ borderColor: C.formBorder, color: C.textMedium }}
                            >
                              <InlineGlyphs.SctSave width="14" height="14" color="currentColor" />
                              Save as Draft
                            </button>
                          )}
                          <button
                            disabled={data.pending}
                            onClick={nextStep}
                            className="flex items-center gap-2 px-6 py-2.5 rounded-lg text-[13px] font-semibold text-white transition-colors hover:opacity-90"
                            style={{ background: C.teal }}
                          >
                            {NEXT_LABELS[step - 1]}
                            <InlineGlyphs.SctNext width="15" height="15" color="currentColor" />
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* ── Right Sidebar ─────────────────────────────────── */}
                  <div
                    className="w-64 shrink-0 flex flex-col overflow-y-auto"
                    style={{ gap: GAP.lg, paddingLeft: 2, paddingRight: 2 }}
                  >
                    {step === 1 && <S1Sidebar />}
                    {step === 2 && (
                      <S2Sidebar
                        onApply={(template) => {
                          setScopeSummary(template.scope);
                          setDeliverables(template.setup.deliverables);
                          setLdServices(template.setup.designServices);
                          setDocs(template.setup.documentation);
                          setStandards(template.setup.standards);
                          setCoordination(template.setup.coordination);
                          setOptionalNotes(template.setup.notes);
                        }}
                      />
                    )}
                    {step === 3 && <S3Sidebar milestoneCount={scheduleMilestones.length} />}
                    {step === 4 && <S4Sidebar />}
                    {step === 5 && (
                      <S5Sidebar scopeSummary={scopeSummary} milestones={scheduleMilestones} />
                    )}
                  </div>
                </div>
              </div>
            </div>
          </div>
          {helpMode && (
            <ProjectWizardHelp
              mode={helpMode}
              step={step}
              data={data}
              onApplyScope={(template) => {
                setScopeSummary(template.scope);
                setDeliverables(template.setup.deliverables);
                setLdServices(template.setup.designServices);
                setDocs(template.setup.documentation);
                setStandards(template.setup.standards);
                setCoordination(template.setup.coordination);
                setOptionalNotes(template.setup.notes);
              }}
              onClose={() => setHelpMode(null)}
            />
          )}
          {directoryKind ? (
            <ProjectDirectoryEditor
              kind={directoryKind}
              findExisting={(name, email) =>
                data.findExistingDirectoryEntry(directoryKind, name, email)
              }
              onSave={(name, email) => data.addDirectoryEntry(directoryKind, name, email)}
              onClose={() => setDirectoryKind(null)}
            />
          ) : null}
          {folderPreview ? (
            <V4FloatingWorkspace
              open
              title="Project folder preview"
              description="These folders will be created when you create the project."
              onRequestClose={() => setFolderPreview(false)}
              footer={
                <button type="button" onClick={() => setFolderPreview(false)}>
                  Close
                </button>
              }
            >
              <ProjectFolderTree paths={data.folderNames} root={namingPreview} />
            </V4FloatingWorkspace>
          ) : null}
          {confirmClose ? (
            <V4FloatingWorkspace
              open
              title="Unsaved project draft"
              panelClassName="v4-compact-dialog"
              onRequestClose={continueEditing}
              footer={
                <>
                  <button onClick={continueEditing}>Continue editing</button>
                  <button
                    disabled={data.pending}
                    onClick={() => {
                      closeConfirmed();
                    }}
                  >
                    Discard changes
                  </button>
                  <button
                    disabled={data.pending}
                    onClick={() =>
                      void data
                        .saveDraft(snapshot())
                        .then(() => {
                          setClean(fingerprint);
                          setAdoptedDraft(true);
                          closeConfirmed();
                        })
                        .catch(() => undefined)
                    }
                  >
                    Save draft
                  </button>
                </>
              }
            >
              <p>
                Save your inputs to resume later. Saving a draft does not create a Project or
                folders.
              </p>
            </V4FloatingWorkspace>
          ) : null}
          {milestoneEdit ? (
            <V4FloatingWorkspace
              open
              title="Milestone"
              panelClassName="v4-wizard-small-editor"
              bodyClassName="v4-scope-edit"
              onRequestClose={() => setMilestoneEdit(null)}
              footer={
                <>
                  {scheduleMilestones.some((item) => item.id === milestoneEdit.id) ? (
                    <V4Button
                      variant="danger"
                      leadingIcon={<InlineGlyphs.SctRemove />}
                      onClick={() => {
                        setScheduleMilestones((items) =>
                          items.filter((item) => item.id !== milestoneEdit.id),
                        );
                        setMilestoneEdit(null);
                      }}
                    >
                      Remove
                    </V4Button>
                  ) : null}
                  <V4Button onClick={() => setMilestoneEdit(null)}>Cancel</V4Button>
                  <V4Button
                    variant="primary"
                    leadingIcon={<InlineGlyphs.SctSave />}
                    disabled={!milestoneEdit.name.trim() || !milestoneEdit.targetDate}
                    onClick={() => {
                      setScheduleMilestones((items) =>
                        items.some((item) => item.id === milestoneEdit.id)
                          ? items.map((item) =>
                              item.id === milestoneEdit.id ? milestoneEdit : item,
                            )
                          : [...items, milestoneEdit],
                      );
                      setMilestoneEdit(null);
                    }}
                  >
                    Save
                  </V4Button>
                </>
              }
            >
              {data.fields.completionDate &&
              milestoneEdit.targetDate > data.fields.completionDate ? (
                <p role="alert">
                  This milestone is after the target completion date. Review the milestone or
                  project dates; neither date will be changed automatically.
                </p>
              ) : null}
              <label className="v4-scope-edit__field">
                Name
                <input
                  value={milestoneEdit.name}
                  onChange={(event) =>
                    setMilestoneEdit({ ...milestoneEdit, name: event.target.value })
                  }
                />
              </label>
              <label className="v4-scope-edit__field">
                Description
                <textarea
                  value={milestoneEdit.description}
                  onChange={(event) =>
                    setMilestoneEdit({ ...milestoneEdit, description: event.target.value })
                  }
                />
              </label>
              <label className="v4-scope-edit__field" htmlFor="milestone-target-date">
                Target Date
                <V4DateInput
                  id="milestone-target-date"
                  type="date"
                  value={milestoneEdit.targetDate}
                  onChange={(event) =>
                    setMilestoneEdit({ ...milestoneEdit, targetDate: event.target.value })
                  }
                />
              </label>
              <label className="v4-scope-edit__field">
                Phase
                <select
                  value={milestoneEdit.phase}
                  onChange={(event) =>
                    setMilestoneEdit({
                      ...milestoneEdit,
                      phase: event.target.value as typeof milestoneEdit.phase,
                    })
                  }
                >
                  {['Design', 'Documentation', 'Procurement', 'Construction'].map((phase) => (
                    <option key={phase}>{phase}</option>
                  ))}
                </select>
              </label>
            </V4FloatingWorkspace>
          ) : null}
          {customDeliverable !== null ? (
            <V4FloatingWorkspace
              open
              title="Custom deliverable"
              onRequestClose={() => setCustomDeliverable(null)}
              footer={
                <button
                  disabled={!customDeliverable.trim()}
                  onClick={() => {
                    setDeliverables((items) => [...new Set([...items, customDeliverable.trim()])]);
                    setCustomDeliverable(null);
                  }}
                >
                  Add
                </button>
              }
            >
              <label>
                Name
                <input
                  maxLength={120}
                  value={customDeliverable}
                  onChange={(event) => setCustomDeliverable(event.target.value)}
                />
              </label>
            </V4FloatingWorkspace>
          ) : null}
        </HelpContext.Provider>
      </V4ParentLayer>
    </FieldContext.Provider>,
    ensureV4OverlayRoot(),
  );
}
