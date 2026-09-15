import { AdaptiveScopeCard } from './AdaptiveScopeCard';
import { projectActivityProjection } from '../../pages/project-summary/projectActivityProjection';
import { V4Button } from '../common/V4Button';
import * as InlineGlyphs from '../common/SctIcons';
import * as CustomGlyphs from '../common/SctIcons';
import type {
  Project,
  ProjectWorkspace,
  ProjectScopeItem,
  ProjectTag,
  ScopeNote,
  ProjectRequirement,
  ProjectActivity,
} from '@scli/domain';
import { formatBusinessDateTime } from '../../date-time/businessDateTime';
import './referenceUtilities.css';
export interface FinalScopeBinding {
  project: Project;
  workspace: ProjectWorkspace & { scopeItems: ProjectScopeItem[] };
  edit: () => void;
  addTag: () => void;
  editTag: (tag: ProjectTag) => void;
  editNote: (note: ScopeNote) => void;
  editSetupNotes: () => void;
  addNote: () => void;
  addRequirement: () => void;
  editRequirements: () => void;
  editRequirement: (item: ProjectRequirement) => void;
  pending: boolean;
  audit?: readonly ProjectActivity[];
}

const F = "'Inter', sans-serif";

const C = {
  teal: 'var(--v4-action-primary)',
  bg: 'var(--v4-surface-base)',
  white: 'var(--v4-surface-raised)',
  border: 'var(--v4-border-control)',
  text: 'var(--v4-text-primary)',
  textMid: 'var(--v4-text-secondary)',
  textSub: 'var(--v4-text-muted)',
  textFaint: 'var(--v4-text-disabled)',
  blue: '#2563eb',
  blueLight: 'var(--v4-accent-selected)',
  blueBorder: '#bfdbfe',
  green: '#16a34a',
  greenLight: '#f0fdf4',
  greenBorder: '#bbf7d0',
  red: '#dc2626',
  purple: '#7c3aed',
  purpleLight: '#f5f3ff',
  purpleBorder: '#ddd6fe',
  amber: '#d97706',
};

// ── Icons ─────────────────────────────────────────────────────────────────────

function IcoTarget() {
  return <CustomGlyphs.SctScope size="18" style={{ color: C.blue }} />;
}
function IcoDoc() {
  return <CustomGlyphs.SctFile size="18" style={{ color: C.blue }} />;
}
function IcoClipboard() {
  return <CustomGlyphs.SctActions size="18" style={{ color: C.blue }} />;
}
function IcoNotes() {
  return <CustomGlyphs.SctNotes size="18" style={{ color: C.blue }} />;
}

// item icons (small, gray)
function IcoGrid() {
  return <CustomGlyphs.SctLightingLayout size="16" style={{ color: C.textSub }} />;
}
function IcoCalc() {
  return <CustomGlyphs.SctCalculations size="16" style={{ color: C.textSub }} />;
}
function IcoLamp() {
  return <CustomGlyphs.SctLuminaires size="16" style={{ color: C.textSub }} />;
}
function IcoFile() {
  return <CustomGlyphs.SctFile size="16" style={{ color: C.textSub }} />;
}
function IcoPerson() {
  return <CustomGlyphs.SctProfile size="16" style={{ color: C.textSub }} />;
}

// deliverable icons
function IcoDocLines() {
  return <CustomGlyphs.SctSpecifications size="16" style={{ color: C.textSub }} />;
}
function IcoTable() {
  return <CustomGlyphs.SctSchedule size="16" style={{ color: C.textSub }} />;
}
function IcoPkg() {
  return <CustomGlyphs.SctPackages size="16" style={{ color: C.textSub }} />;
}

// sidebar icons
function IcoClients() {
  return <CustomGlyphs.SctClient size="16" style={{ color: C.textSub }} />;
}
function IcoPersonSb() {
  return <CustomGlyphs.SctSales size="16" style={{ color: C.textSub }} />;
}
function IcoFlag() {
  return <CustomGlyphs.SctPriority size="16" style={{ color: C.textSub }} />;
}
function IcoFolder() {
  return <CustomGlyphs.SctFolder size="16" style={{ color: C.textSub }} />;
}
function IcoTag() {
  return <CustomGlyphs.SctTag size="16" style={{ color: C.textSub }} />;
}
function IcoInfo() {
  return <CustomGlyphs.SctInfo size="15" style={{ color: C.textFaint }} />;
}
function IcoInfoBlue() {
  return <CustomGlyphs.SctInfo size="16" style={{ color: C.blue }} />;
}
function IcoEdit() {
  return <CustomGlyphs.SctEdit size="14" style={{ color: '#fff' }} />;
}
function IcoSun() {
  return <CustomGlyphs.SctLight size="14" style={{ color: C.textSub }} />;
}
function IcoStandards() {
  return <CustomGlyphs.SctVerify size="14" style={{ color: C.textSub }} />;
}
function IcoClock() {
  return <CustomGlyphs.SctDuration size="14" style={{ color: C.textFaint }} />;
}

// ── Checkbox ──────────────────────────────────────────────────────────────────

function IncludedMark() {
  return (
    <div
      style={{
        width: 18,
        height: 18,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        flexShrink: 0,
      }}
    >
      <InlineGlyphs.SctCheck width="16" height="16" color={C.green} aria-label="Included" />
    </div>
  );
}

// ── Included badge ────────────────────────────────────────────────────────────

function IncludedBadge() {
  return (
    <span
      style={{
        padding: '2px 10px',
        borderRadius: 12,
        border: `1px solid ${C.greenBorder}`,
        background: C.greenLight,
        color: C.green,
        fontSize: 11,
        fontWeight: 600,
        whiteSpace: 'nowrap',
        flexShrink: 0,
      }}
    >
      Included
    </span>
  );
}

// ── Section header ────────────────────────────────────────────────────────────

// ── Scope item row ────────────────────────────────────────────────────────────

function ScopeItem({ icon, title, desc }: { icon: React.ReactNode; title: string; desc: string }) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'flex-start',
        gap: 10,
        paddingBottom: 12,
        marginBottom: 12,
        borderBottom: `1px solid ${C.border}`,
      }}
    >
      <IncludedMark />
      <div
        style={{
          width: 35,
          height: 35,
          flexShrink: 0,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: 'rgba(0,128,255,0.1)',
          borderRadius: 25,
          gap: 0,
        }}
      >
        {icon}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: C.text, marginBottom: 2 }}>{title}</div>
        <div style={{ fontSize: 11, color: C.textSub, lineHeight: 1.5 }}>{desc}</div>
      </div>
      <IncludedBadge />
    </div>
  );
}

// ── Card ──────────────────────────────────────────────────────────────────────

function Card({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <div
      style={{
        background: C.white,
        border: `1px solid ${C.border}`,
        borderRadius: 10,
        padding: 18,
        ...style,
      }}
    >
      {children}
    </div>
  );
}

// ── Requirement row ───────────────────────────────────────────────────────────

function ReqItem({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '6px 0' }}>
      {icon}
      <span style={{ fontSize: 12, color: C.textSub, width: 116, flexShrink: 0 }}>{label}</span>
      <span style={{ fontSize: 13, fontWeight: 600, color: C.text, marginRight: 9 }}>{value}</span>
    </div>
  );
}

// ── Summary row ───────────────────────────────────────────────────────────────

function SummaryRow({
  icon,
  label,
  value,
  valueNode,
}: {
  icon: React.ReactNode;
  label: string;
  value?: string;
  valueNode?: React.ReactNode;
}) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        padding: '12px 0',
        borderBottom: `1px solid ${C.border}`,
      }}
    >
      <div
        style={{
          width: 20,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexShrink: 0,
          color: C.textSub,
        }}
      >
        {icon}
      </div>
      <span style={{ fontSize: 13, color: C.textSub, flex: 1 }}>{label}</span>
      {valueNode ?? (
        <span style={{ fontSize: 13, fontWeight: 600, color: C.text, textAlign: 'right' }}>
          {value}
        </span>
      )}
    </div>
  );
}

// ── Main ──────────────────────────────────────────────────────────────────────

export default function FinalScopeView({ binding }: { binding: FinalScopeBinding }) {
  const { project, workspace } = binding;
  const lastUpdated = [
    project.updatedAt,
    ...workspace.scopeNotes.map((n) => n.updatedAt),
    ...workspace.tags.map((n) => n.updatedAt),
    ...workspace.requirements.map((n) => n.updatedAt),
  ]
    .filter(Boolean)
    .sort()
    .at(-1)!;
  const updatedActor = projectActivityProjection(
    project.id,
    workspace.activity ?? [],
    binding.audit ?? [],
  ).find((a) => a.createdAt === lastUpdated)?.actorName;
  const scope = workspace.scopeItems.map((item) => ({
    title: item.label,
    desc: item.custom ? 'Project-specific scope' : '',
    icon:
      item.code === 'LuminaireSchedule' ? (
        <CustomGlyphs.SctSchedule size="16" />
      ) : item.code === 'TechnicalBoq' ? (
        <CustomGlyphs.SctBoq size="16" />
      ) : item.code === 'DialuxCalculation' ? (
        <IcoCalc />
      ) : item.code === 'LightingDesign' ? (
        <IcoLamp />
      ) : item.code === 'Custom' ? (
        <IcoPerson />
      ) : item.code === 'Datasheets' ? (
        <IcoFile />
      ) : (
        <IcoGrid />
      ),
  }));
  const deliverables = workspace.deliverables.map((item) => ({
    title: item.title,
    desc: item.required ? 'Required deliverable' : 'Optional deliverable',
    icon:
      item.serviceCode === 'LuminaireSchedule' ? (
        <IcoTable />
      ) : item.serviceCode === 'TechnicalBoq' ? (
        <CustomGlyphs.SctBoq size="16" />
      ) : item.serviceCode === 'Datasheets' ? (
        <IcoFile />
      ) : item.serviceCode === 'Presentation' ? (
        <IcoPkg />
      ) : (
        <IcoDocLines />
      ),
  }));
  const palette = {
    teal: { bg: '#f0fdfa', color: '#0d9488', border: '#99f6e4' },
    blue: { bg: C.blueLight, color: C.blue, border: C.blueBorder },
    purple: { bg: C.purpleLight, color: C.purple, border: C.purpleBorder },
    green: { bg: '#f0fdf4', color: C.green, border: '#bbf7d0' },
    gray: { bg: '#f3f4f6', color: C.textSub, border: 'var(--v4-border-control)' },
  };
  const tags = workspace.tags.map((tag) => ({
    ...tag,
    ...(palette[tag.colorKey as keyof typeof palette] ?? palette.gray),
  }));
  return (
    <div
      style={{
        flex: 1,
        minHeight: 0,
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        background: C.bg,
        fontFamily: F,
      }}
    >
      {/* Scrollable body */}
      <div
        style={{
          flex: 1,
          overflowY: 'hidden',
          padding: '20px 20px 0',
          display: 'flex',
          flexDirection: 'column',
          minHeight: 0,
        }}
      >
        {/* Page title */}
        <div
          style={{
            display: 'flex',
            alignItems: 'flex-start',
            justifyContent: 'space-between',
            marginBottom: 18,
          }}
        >
          <div>
            <h1
              style={{ fontSize: 22, fontWeight: 700, color: C.text, margin: 0, lineHeight: 1.2 }}
            >
              Scope &amp; Services
            </h1>
            <p style={{ fontSize: 13, color: C.textSub, margin: '4px 0 0' }}>
              Define project brief, deliverables, technical requirements, and exclusions.
            </p>
          </div>
          <button
            onClick={binding.edit}
            disabled={binding.pending}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 7,
              padding: '8px 16px',
              background: C.teal,
              color: 'var(--v4-action-primary-foreground)',
              border: 'none',
              borderRadius: 8,
              fontSize: 13,
              fontWeight: 600,
              fontFamily: F,
              cursor: 'pointer',
              flexShrink: 0,
              boxShadow: '0 1px 4px rgba(37,99,235,0.25)',
            }}
          >
            <IcoEdit />
            Edit Scope
          </button>
        </div>

        {/* Main layout: left cards + right summary */}
        <div style={{ display: 'flex', gap: 16, alignItems: 'stretch', flex: 1, minHeight: 0 }}>
          <div
            style={{
              flex: 3,
              minWidth: 0,
              minHeight: 0,
              display: 'grid',
              gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
              gridTemplateRows: 'repeat(2, minmax(0, 1fr))',
              gap: 12,
            }}
          >
            <AdaptiveScopeCard
              title="Project Scope"
              icon={<IcoTarget />}
              rows={scope.map((item) => (
                <ScopeItem key={item.title} {...item} />
              ))}
            />
            <AdaptiveScopeCard
              title="Deliverables"
              icon={<IcoDoc />}
              rows={deliverables.map((item) => (
                <ScopeItem key={item.title} {...item} />
              ))}
            />
            <AdaptiveScopeCard
              title="Requirements"
              icon={<IcoClipboard />}
              action={
                <div style={{ display: 'flex', gap: 6 }}>
                  <V4Button size="compact" onClick={binding.editRequirements}>
                    <CustomGlyphs.SctEdit />
                    Edit
                  </V4Button>
                  <V4Button size="compact" onClick={binding.addRequirement}>
                    <CustomGlyphs.SctAdd aria-hidden="true" />
                    Add
                  </V4Button>
                </div>
              }
              rows={[
                ...(project.luxRequirements
                  ? [
                      <ReqItem
                        key="lux"
                        icon={<IcoSun />}
                        label="Target Average Lux"
                        value={project.luxRequirements}
                      />,
                    ]
                  : []),
                ...(project.finalSetup?.standards.length
                  ? [
                      <ReqItem
                        key="standards"
                        icon={<IcoStandards />}
                        label="Standards"
                        value={project.finalSetup.standards.join(' / ')}
                      />,
                    ]
                  : []),
                ...workspace.requirements.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => binding.editRequirement(item)}
                    style={{
                      textAlign: 'left',
                      width: '100%',
                      background: 'transparent',
                      color: 'inherit',
                      border: 0,
                      padding: 0,
                    }}
                  >
                    <strong>{item.title}</strong>
                    <p
                      style={{
                        margin: '4px 0',
                        fontSize: 12,
                        whiteSpace: 'pre-wrap',
                      }}
                    >
                      {item.details || 'No details'}
                    </p>
                  </button>
                )),
              ]}
            />
            <AdaptiveScopeCard
              title="Notes / Exclusions"
              icon={<IcoNotes />}
              action={
                <V4Button size="compact" onClick={binding.addNote}>
                  <CustomGlyphs.SctAdd aria-hidden="true" />
                  Add
                </V4Button>
              }
              rows={[
                ...(project.finalSetup?.notes
                  ? [
                      <button
                        key="setup-notes"
                        type="button"
                        onClick={binding.editSetupNotes}
                        style={{
                          textAlign: 'left',
                          whiteSpace: 'pre-wrap',
                          border: 0,
                          background: 'transparent',
                          color: 'inherit',
                          padding: 0,
                        }}
                      >
                        <strong style={{ display: 'block' }}>Notes</strong>
                        {project.finalSetup.notes}
                      </button>,
                    ]
                  : []),
                ...workspace.scopeNotes.map((note) => (
                  <button
                    key={note.id}
                    type="button"
                    onClick={() => binding.editNote(note)}
                    style={{
                      textAlign: 'left',
                      width: '100%',
                      background: 'transparent',
                      color: 'inherit',
                      border: 0,
                      padding: 0,
                      whiteSpace: 'pre-wrap',
                    }}
                  >
                    <strong style={{ display: 'block', marginBottom: 4 }}>
                      {note.type === 'Exclusion' ? 'Exclusions' : 'Notes'}
                    </strong>
                    {note.text}
                  </button>
                )),
              ]}
            />
          </div>

          {/* Right: Project Summary */}
          <div
            style={{ flex: 1, minWidth: 220, display: 'flex', flexDirection: 'column', gap: 12 }}
          >
            <Card style={{ padding: '16px 18px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                <span style={{ fontSize: 14, fontWeight: 700, color: C.text }}>
                  Project Summary
                </span>
                <IcoInfo />
              </div>

              <SummaryRow icon={<IcoClients />} label="Client" value={project.clientName || '—'} />
              <SummaryRow
                icon={<IcoPersonSb />}
                label="Sales Owner"
                value={project.salesOwnerNameSnapshot || '—'}
              />
              <SummaryRow
                icon={<IcoFlag />}
                label="Priority"
                valueNode={
                  <span
                    style={{
                      padding: '2px 12px',
                      borderRadius: 10,
                      background:
                        project.priority === 'High' || project.priority === 'Urgent'
                          ? '#fee2e2'
                          : project.priority === 'Low'
                            ? C.greenLight
                            : 'var(--v4-surface-muted)',
                      color:
                        project.priority === 'High' || project.priority === 'Urgent'
                          ? C.red
                          : project.priority === 'Low'
                            ? C.green
                            : C.textMid,
                      fontSize: 12,
                      fontWeight: 700,
                    }}
                  >
                    {project.priority === 'Normal' ? 'Medium' : project.priority}
                  </span>
                }
              />
              <SummaryRow
                icon={<IcoFolder />}
                label="Folder Profile"
                value={workspace.folderProfile || '—'}
              />

              {/* Tags */}
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, paddingTop: 10 }}>
                <div
                  style={{
                    width: 20,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    flexShrink: 0,
                    marginTop: 2,
                  }}
                >
                  <IcoTag />
                </div>
                <div>
                  <span
                    style={{ fontSize: 13, color: C.textSub, display: 'block', marginBottom: 6 }}
                  >
                    Tags
                  </span>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
                    {tags.map((tag) => (
                      <button
                        key={tag.id}
                        onClick={() => {
                          const record = binding.workspace.tags.find((item) => item.id === tag.id);
                          if (record) binding.editTag(record);
                        }}
                        aria-label={`Manage ${tag.label}`}
                        style={{
                          padding: '3px 10px',
                          borderRadius: 10,
                          background: tag.bg,
                          color: tag.color,
                          border: `1px solid ${tag.border}`,
                          fontSize: 12,
                          fontWeight: 600,
                        }}
                      >
                        {tag.label}
                      </button>
                    ))}
                    <button
                      onClick={binding.addTag}
                      aria-label="Add tag"
                      style={{
                        width: 26,
                        height: 26,
                        borderRadius: '50%',
                        border: `1px solid ${C.border}`,
                        background: C.white,
                        cursor: 'pointer',
                        fontSize: 15,
                        color: C.textSub,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        lineHeight: 1,
                      }}
                    >
                      +
                    </button>
                  </div>
                </div>
              </div>
            </Card>

            {/* Key Info */}
            <Card
              style={{
                padding: '14px 16px',
                background: 'var(--v4-accent-selected)',
                borderColor: C.blueBorder,
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 8 }}>
                <IcoInfoBlue />
                <span style={{ fontSize: 13, fontWeight: 700, color: C.text }}>Key Info</span>
              </div>
              <p style={{ fontSize: 12, color: C.textMid, margin: 0, lineHeight: 1.6 }}>
                Scope and services establish the boundaries of work and expected deliverables.
                Changes to scope may impact timeline and pricing.
              </p>
            </Card>
          </div>
        </div>
      </div>

      {/* Footer bar */}
      <div
        style={{
          flexShrink: 0,
          padding: '12px 20px',
          borderTop: `1px solid ${C.border}`,
          background: C.white,
          display: 'flex',
          alignItems: 'center',
          gap: 10,
        }}
      >
        <IcoClock />
        <span style={{ fontSize: 12, color: C.textSub }}>
          Last updated: {formatBusinessDateTime(lastUpdated)}
        </span>
        <span style={{ color: C.border, fontSize: 14 }}>|</span>
        <div
          style={{
            width: 24,
            height: 24,
            borderRadius: '50%',
            background: 'var(--v4-text-muted)',
            color: 'var(--v4-action-primary-foreground)',
            fontSize: 10,
            fontWeight: 700,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          {updatedActor
            ? updatedActor
                .split(/\s+/)
                .slice(0, 2)
                .map((n) => n[0])
                .join('')
                .toUpperCase()
            : '—'}
        </div>
        <span style={{ fontSize: 12, color: C.textSub }}>
          {updatedActor || 'Editor not recorded'}
        </span>
      </div>
    </div>
  );
}
