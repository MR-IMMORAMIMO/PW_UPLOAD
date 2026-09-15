import * as CustomGlyphs from '../common/SctIcons';
import { C, SHADOW, RADIUS, LAYOUT } from './tokens';
import type { ShellProject as Project } from './ShellData';
import { useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../api/environment';
import { V4ProjectEditAction } from '../project/V4ProjectEditAction';
import { shellProject } from './ShellData';

export function FinalProjectHeader() {
  const { projectId } = useParams();
  const project = useQuery({
    queryKey: ['v4', 'final-shell', 'project', projectId],
    queryFn: () => api.project(projectId!),
    enabled: Boolean(projectId),
  });
  return <ProjectHeader project={shellProject(project.isError ? null : project.data)} />;
}
// ── Edit icon ─────────────────────────────────────────────────────────────────

function IconEdit() {
  return <CustomGlyphs.SctEdit size="14" style={{ color: 'currentColor' }} />;
}

// ── Meta cell ─────────────────────────────────────────────────────────────────

function MetaCell({
  label,
  value,
  accent,
  width,
}: {
  label: string;
  value: string;
  accent?: string | undefined;
  width?: number;
}) {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'flex-start',
        justifyContent: 'center',
        gap: 3,
        flexShrink: 1,
        flexGrow: width ?? 140,
        flexBasis: 0,
        minWidth: label === 'Due Date' ? 110 : label === 'Project Name' ? 140 : 85,
        paddingLeft: 10,
      }}
    >
      <span
        style={{
          fontFamily: "'SCT Final Inter', sans-serif",
          fontSize: 10,
          fontWeight: 700,
          color: 'var(--v4-text-disabled)',
          letterSpacing: '0.08em',
          textTransform: 'uppercase',
          whiteSpace: 'nowrap',
        }}
      >
        {label}
      </span>
      <span
        title={value}
        style={{
          fontFamily: "'SCT Final Inter', sans-serif",
          fontSize: 13,
          fontWeight: 600,
          color: accent ?? 'var(--v4-text-primary)',
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          maxWidth: '100%',
        }}
      >
        {value}
      </span>
    </div>
  );
}

function Divider() {
  return (
    <div
      style={{
        width: 1,
        alignSelf: 'stretch',
        background: 'var(--v4-border-subtle)',
        flexShrink: 0,
        margin: '0 4px',
      }}
    />
  );
}

// ── Project Context Header ────────────────────────────────────────────────────

export function ProjectHeader({ project }: { project: Project }) {
  const { projectId } = useParams();
  const canonical = useQuery({
    queryKey: ['v4', 'final-shell', 'project', projectId],
    queryFn: () => api.project(projectId!),
    enabled: Boolean(projectId),
  });
  const projectName = project.name || project.code;
  const dueDateAccent = project.overdue ? '#f97316' : undefined;

  return (
    // Floating card — positioned with page gap, sticky
    <div
      style={{
        flexShrink: 0,
        width: '100%',
        minWidth: 0,
        padding: `${LAYOUT.sectionGap}px ${LAYOUT.sectionGap}px 0`,
        position: 'sticky',
        top: 0,
        zIndex: 50,
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          paddingLeft: 20,
          paddingRight: 16,
          height: 62,
          background: C.white,
          borderRadius: RADIUS.section,
          border: `1px solid ${C.border}`,
          boxShadow: SHADOW.card,
          gap: 0,
        }}
      >
        {/* Meta cells */}
        {/* Keyboard focus is required to scroll the fixed-width metadata region. */}
        <div
          className="final-ui-project-metadata"
          // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- Scrollable metadata must be keyboard reachable.
          tabIndex={0}
          role="region"
          aria-label="Project metadata"
          style={{
            flex: 1,
            minWidth: 0,
            display: 'flex',
            alignItems: 'center',
            gap: 0,
            overflowX: 'auto',
          }}
        >
          <MetaCell label="Project Code" value={project.code} width={200} />
          <Divider />
          <MetaCell label="Project Name" value={projectName} width={300} />
          <Divider />
          <MetaCell label="Client" value={project.client} width={110} />
          <Divider />
          <MetaCell label="Project Type" value={project.type} width={170} />
          <Divider />
          <MetaCell label="Current Stage" value={project.stage} accent="#2563eb" width={150} />
          <Divider />
          <MetaCell label="Due Date" value={project.dueDate} accent={dueDateAccent} />
        </div>

        {/* Edit Project button */}
        <V4ProjectEditAction
          project={canonical.data}
          projectQueryKey={['v4', 'final-shell', 'project', projectId]}
          renderTrigger={(open, pending) => (
            <button
              disabled={pending}
              onClick={(event) => open(event.currentTarget)}
              style={{
                flexShrink: 0,
                display: 'flex',
                alignItems: 'center',
                gap: 7,
                padding: '8px 16px',
                background: 'var(--v4-action-primary)',
                color: 'var(--v4-action-primary-foreground)',
                border: 'none',
                borderRadius: 8,
                fontSize: 13,
                fontWeight: 600,
                fontFamily: "'SCT Final Inter', sans-serif",
                cursor: 'pointer',
                boxShadow: '0 2px 8px rgba(106,66,171,0.25)',
                transition: 'background 140ms ease',
                whiteSpace: 'nowrap',
                marginLeft: 16,
              }}
              onMouseEnter={(e) => {
                (e.currentTarget as HTMLElement).style.background = 'var(--v4-accent)';
              }}
              onMouseLeave={(e) => {
                (e.currentTarget as HTMLElement).style.background = 'var(--v4-action-primary)';
              }}
            >
              <IconEdit />
              Edit Project
            </button>
          )}
        />
      </div>
    </div>
  );
}
