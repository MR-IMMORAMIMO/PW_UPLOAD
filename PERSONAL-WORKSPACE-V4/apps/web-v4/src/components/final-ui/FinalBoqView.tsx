import * as CustomGlyphs from '../common/SctIcons';
import type React from 'react';
import { C, SHADOW, RADIUS, LAYOUT } from './tokens';
import type { FinalScheduleBinding } from './FinalScheduleView';
import { V4FilterSelect } from '../common/V4FilterSelect';
import { LuminaireImage } from '../../pages/project-luminaires/LuminaireImage';
import {
  boqRowKey,
  boqCellValue,
  formatBoqDateTime,
} from '../../pages/technical-boq/technicalBoqViewModel';
export type FinalBoqBinding = Omit<FinalScheduleBinding, 'tab' | 'setTab'>;

// ── Luminaire data ────────────────────────────────────────────────────────────

const IconColumns = () => <CustomGlyphs.SctColumns size="14" style={{ color: 'currentColor' }} />;
const IconSettings = () => <CustomGlyphs.SctSettings size="14" style={{ color: 'currentColor' }} />;

const IconClose = () => <CustomGlyphs.SctClose size="14" style={{ color: 'currentColor' }} />;
const IconDuplicate = () => <CustomGlyphs.SctDuplicate size="14" style={{ color: C.blue }} />;
const IconCompare = () => <CustomGlyphs.SctCompare size="14" style={{ color: C.textMedium }} />;
const IconDelete = () => <CustomGlyphs.SctDelete size="14" style={{ color: C.red }} />;
const IconChevronDown = ({
  size = 14,
  color = 'currentColor',
}: {
  size?: number;
  color?: string;
}) => <CustomGlyphs.SctExpand size={size} style={{ color: color }} />;
const IconChevronLeft = () => <CustomGlyphs.SctBack size="14" style={{ color: 'currentColor' }} />;
const IconChevronRight = () => <CustomGlyphs.SctNext size="14" style={{ color: 'currentColor' }} />;

// ── Shared card style ─────────────────────────────────────────────────────────

const card: React.CSSProperties = {
  background: C.white,
  borderRadius: RADIUS.card,
  border: `1px solid ${C.border}`,
  boxShadow: SHADOW.card,
};

// ── Dropdown ──────────────────────────────────────────────────────────────────

export default function FinalBoqView({ binding: b }: { binding: FinalBoqBinding }) {
  const detailOpen = b.detailsOpen;
  const latest = b.revision
    ? b.workspace.outputs.find((item) => item.output.revisionId === b.revision)
    : b.workspace.outputs[0];
  const template = latest?.output.resolvedTemplateSnapshot ?? b.workspace.effectiveTemplate;
  const revision = b.workspace.selectedRevision?.metadata.revision;
  const gridColumns =
    '36px ' +
    b.columns
      .map(
        (column) =>
          `minmax(${Math.max(50, column.width)}px, ${Math.max(0.4, column.width / 100)}fr)`,
      )
      .join(' ');
  const G = LAYOUT.sectionGap;

  return (
    <div
      style={{
        padding: G,
        height: '100%',
        minHeight: 0,
        minWidth: 0,
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        gap: G,
        boxSizing: 'border-box',
        overflow: 'hidden',
        fontFamily: "'SCT Final Inter', sans-serif",
      }}
    >
      {/* ── Main row ─────────────────────────────────────────────────── */}
      <div
        style={{
          flex: 1,
          minHeight: 0,
          display: 'flex',
          gap: G,
        }}
      >
        {/* ── Left / main card ──────────────────────────────────────── */}
        <div
          style={{
            ...card,
            flex: 1,
            minWidth: 0,
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden',
          }}
        >
          {/* Page header */}
          <div style={{ padding: '18px 20px 14px', flexShrink: 0 }}>
            <h1
              style={{
                fontSize: 22,
                fontWeight: 700,
                color: C.text,
                margin: '0 0 4px',
                lineHeight: 1.2,
              }}
            >
              Technical Lighting BOQ
            </h1>
            <p style={{ fontSize: 12, color: C.textSub, margin: 0 }}>
              Prepare and generate technical lighting bill of quantities.
            </p>
          </div>

          {/* Toolbar */}
          <div
            style={{
              padding: '0 20px 12px',
              display: 'flex',
              alignItems: 'flex-end',
              gap: 8,
              borderBottom: `1px solid ${C.border}`,
              flexShrink: 0,
            }}
          >
            <div>
              <div style={{ fontSize: 10, color: C.textSub, marginBottom: 3 }}>Template</div>
              <V4FilterSelect
                label="BOQ template"
                value={b.template}
                onChange={b.setTemplate}
                options={b.workspace.templates.map((item) => ({
                  value: `${item.templateId}::${item.templateVersionId}`,
                  label: `${item.name} · ${item.version}`,
                }))}
                disabled={b.pending}
                triggerStyle={{ height: 32, minHeight: 0, width: 158, fontSize: 12 }}
              />
            </div>
            <div>
              <div style={{ fontSize: 10, color: C.textSub, marginBottom: 3 }}>Revision</div>
              <V4FilterSelect
                label="BOQ revision"
                value={b.revision}
                onChange={b.setRevision}
                options={[
                  { value: '', label: 'Current / Live BOQ' },
                  ...b.workspace.revisions.map((item) => ({
                    value: item.revision.revisionId,
                    label: item.revision.revisionLabel,
                  })),
                ]}
                triggerStyle={{ height: 32, minHeight: 0, width: 112, fontSize: 12 }}
              />
            </div>
            <div style={{ flex: 1 }} />
            {/* Toolbar buttons */}
            {[
              { icon: <IconColumns />, label: 'Columns' },
              { icon: <IconSettings />, label: 'Settings' },
            ].map((btn) => (
              <button
                key={btn.label}
                onClick={btn.label === 'Columns' ? b.columnsAction : b.settingsAction}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 5,
                  border: `1px solid ${C.border}`,
                  borderRadius: RADIUS.control,
                  background: C.white,
                  cursor: 'pointer',
                  padding: '0 12px',
                  height: 32,
                  fontSize: 12,
                  fontWeight: 500,
                  color: C.textDark,
                  fontFamily: "'SCT Final Inter', sans-serif",
                }}
              >
                {btn.icon}
                {btn.label}
              </button>
            ))}
            {b.preview}
            {/* Generate Output — split button */}
            <div style={{ display: 'flex', height: 32 }}>
              {b.generate}
              <button
                aria-label="Output generation options"
                onClick={b.options}
                style={{
                  background: C.teal,
                  color: 'white',
                  border: 'none',
                  borderRadius: `0 ${RADIUS.control}px ${RADIUS.control}px 0`,
                  borderLeft: '1px solid rgba(255,255,255,0.25)',
                  padding: '0 8px',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                }}
              >
                <IconChevronDown color="white" size={13} />
              </button>
            </div>
          </div>

          {b.notice}
          {b.panels}
          {/* Table */}
          <div
            style={{
              flex: 1,
              minHeight: 0,
              display: 'flex',
              flexDirection: 'column',
              overflow: 'hidden',
            }}
          >
            <div style={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
              <div
                role="table"
                aria-label="Technical Lighting BOQ"
                style={{
                  minWidth: Math.max(
                    800,
                    b.columns.reduce((sum, column) => sum + column.width, 76),
                  ),
                  minHeight: '100%',
                  display: 'flex',
                  flexDirection: 'column',
                }}
              >
                <div
                  role="row"
                  style={{
                    display: 'grid',
                    gridTemplateColumns: gridColumns,
                    padding: '0 20px',
                    borderBottom: `1px solid ${C.border}`,
                    background: C.tableHeader,
                  }}
                >
                  <div role="columnheader" aria-label="Select row" />
                  {b.columns.map((column) => (
                    <div
                      key={column.columnId}
                      role="columnheader"
                      style={{
                        padding: '9px 6px',
                        fontSize: 11,
                        fontWeight: 600,
                        color: C.textLabel,
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {column.label}
                    </div>
                  ))}
                </div>
                {b.rows.map((row) => (
                  <div
                    key={boqRowKey(row)}
                    role="row"
                    style={{
                      display: 'grid',
                      gridTemplateColumns: gridColumns,
                      padding: '0 20px',
                      borderBottom: `1px solid ${C.borderLight}`,
                      background:
                        b.selectedId === boqRowKey(row) ? 'var(--v4-accent-selected)' : C.white,
                      alignItems: 'center',
                    }}
                  >
                    <div role="cell" style={{ padding: '10px 6px' }}>
                      <input
                        type="radio"
                        name="boq-row"
                        aria-label={`Select ${row.tag}`}
                        checked={b.selectedId === boqRowKey(row)}
                        onChange={() => b.select(boqRowKey(row))}
                        style={{ width: 15, height: 15, accentColor: C.blue }}
                      />
                    </div>
                    {b.columns.map((column) => (
                      <div
                        key={column.columnId}
                        role="cell"
                        style={{
                          padding: '10px 6px',
                          fontSize: 12,
                          fontWeight: column.fieldKey === 'tag' ? 600 : 400,
                          color: C.textDark,
                          whiteSpace: 'nowrap',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                        }}
                      >
                        {column.fieldKey === 'imagePath' ? (
                          <div
                            className="final-luminaire-image"
                            style={{
                              width: 40,
                              height: 36,
                              borderRadius: 4,
                              border: `1px solid ${C.border}`,
                              overflow: 'hidden',
                              background: '#f5f4f2',
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                            }}
                          >
                            <LuminaireImage path={row.imagePath} alt={`${row.tag} BOQ thumbnail`} />
                          </div>
                        ) : (
                          boqCellValue(row, column.fieldKey)
                        )}
                      </div>
                    ))}
                  </div>
                ))}
                {!b.total ? (
                  <p role="status" style={{ padding: 20, fontSize: 12, color: C.textSub }}>
                    No items available in the selected BOQ.
                  </p>
                ) : null}
              </div>
            </div>
            {/* Pagination footer */}
            <div
              style={{
                padding: '10px 20px',
                borderTop: `1px solid ${C.border}`,
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                flexShrink: 0,
              }}
            >
              <span style={{ fontSize: 12, color: C.textSub }}>
                Showing {b.total ? b.page * b.pageSize + 1 : 0} to{' '}
                {Math.min((b.page + 1) * b.pageSize, b.total)} of {b.total} items
              </span>
              <div style={{ flex: 1 }} />
              <button
                aria-label="Previous page"
                disabled={b.page === 0}
                onClick={() => b.setPage(b.page - 1)}
                style={{
                  width: 28,
                  height: 28,
                  border: `1px solid ${C.border}`,
                  borderRadius: 6,
                  background: C.white,
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <IconChevronLeft />
              </button>
              <div
                style={{
                  width: 28,
                  height: 28,
                  border: `1px solid ${C.blue}`,
                  borderRadius: 6,
                  background: C.white,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: 12,
                  fontWeight: 600,
                  color: C.blue,
                }}
              >
                {b.page + 1}
              </div>
              <button
                aria-label="Next page"
                disabled={b.page >= b.pages - 1}
                onClick={() => b.setPage(b.page + 1)}
                style={{
                  width: 28,
                  height: 28,
                  border: `1px solid ${C.border}`,
                  borderRadius: 6,
                  background: C.white,
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <IconChevronRight />
              </button>
              <select
                aria-label="Rows per page"
                value={b.pageSize}
                onChange={(event) => b.setPageSize(Number(event.target.value))}
                style={{
                  border: `1px solid ${C.border}`,
                  borderRadius: 6,
                  height: 28,
                  fontSize: 12,
                }}
              >
                {[...new Set([b.pageSize, 10, 25, 50])]
                  .sort((a, b) => a - b)
                  .map((size) => (
                    <option value={size} key={size}>
                      {size} / page
                    </option>
                  ))}
              </select>
            </div>
          </div>
        </div>

        {/* ── Right detail panel ────────────────────────────────────── */}
        {detailOpen && (
          <div
            style={{
              ...card,
              width: 310,
              flexShrink: 0,
              display: 'flex',
              flexDirection: 'column',
              overflow: 'hidden',
            }}
          >
            {/* Panel header */}
            <div
              style={{
                padding: '14px 16px 12px',
                borderBottom: `1px solid ${C.border}`,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                flexShrink: 0,
              }}
            >
              <span style={{ fontSize: 13, fontWeight: 700, color: C.text }}>
                BOQ Output Details
              </span>
              <button
                aria-label="Close output details"
                onClick={b.close}
                style={{
                  background: 'none',
                  border: 'none',
                  cursor: 'pointer',
                  padding: 2,
                  display: 'flex',
                  color: C.textMid,
                }}
              >
                <IconClose />
              </button>
            </div>

            {/* Detail rows */}
            <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '12px 16px' }}>
              {/* Output details */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 16 }}>
                {[
                  ['Template', template.displayName],
                  ['Revision', revision?.revisionLabel ?? 'Current / Live BOQ'],
                  ['Paper Size', template.paperSize],
                  ['Orientation', template.orientation],
                  ['Units', 'Metric'],
                  ['Currency', 'Not applicable'],
                  [
                    'Include Images',
                    template.columns.some(
                      (column) => column.fieldKey === 'imagePath' && column.visible,
                    )
                      ? 'Yes'
                      : 'No',
                  ],
                  ['Last Updated', formatBoqDateTime(latest?.output.updatedAt ?? null)],
                ].map(([label, value]) => (
                  <div
                    key={label}
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'flex-start',
                      gap: 8,
                    }}
                  >
                    <span style={{ fontSize: 11, color: C.textSub, flexShrink: 0 }}>{label}</span>
                    <span
                      style={{ fontSize: 12, color: C.text, fontWeight: 500, textAlign: 'right' }}
                    >
                      {value}
                    </span>
                  </div>
                ))}
                {/* Updated By with avatar */}
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    gap: 8,
                  }}
                >
                  <span style={{ fontSize: 11, color: C.textSub }}>Updated By</span>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                    <div
                      style={{
                        width: 20,
                        height: 20,
                        borderRadius: '50%',
                        background: C.teal,
                        color: 'white',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        fontSize: 9,
                        fontWeight: 700,
                      }}
                    >
                      {(latest?.createdByName ?? '')
                        .split(/\s+/)
                        .slice(0, 2)
                        .map((word) => word[0])
                        .join('')}
                    </div>
                    <span style={{ fontSize: 12, color: C.text, fontWeight: 500 }}>
                      {latest?.createdByName ?? '—'}
                    </span>
                  </div>
                </div>
              </div>

              {/* Output History */}
              <div style={{ borderTop: `1px solid ${C.border}`, paddingTop: 12, marginBottom: 14 }}>
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    marginBottom: 10,
                  }}
                >
                  <span style={{ fontSize: 12, fontWeight: 700, color: C.text }}>
                    Output History
                  </span>
                  <button
                    onClick={b.viewHistory}
                    style={{
                      fontSize: 11,
                      color: 'var(--v4-accent-ink)',
                      cursor: 'pointer',
                      fontWeight: 500,
                      border: 0,
                      background: 'none',
                    }}
                  >
                    View All
                  </button>
                </div>
                {b.history}
              </div>

              {/* Quick Actions */}
              <div style={{ borderTop: `1px solid ${C.border}`, paddingTop: 12 }}>
                <span
                  style={{
                    fontSize: 12,
                    fontWeight: 700,
                    color: C.text,
                    display: 'block',
                    marginBottom: 10,
                  }}
                >
                  Quick Actions
                </span>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button
                    onClick={b.duplicate}
                    disabled={!b.canDuplicate || b.pending}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 5,
                      border: `1px solid ${C.border}`,
                      borderRadius: 7,
                      background: C.white,
                      cursor: 'pointer',
                      padding: '7px 10px',
                      fontSize: 11,
                      fontWeight: 500,
                      color: 'var(--v4-accent-ink)',
                      fontFamily: "'SCT Final Inter', sans-serif",
                      flex: 1,
                    }}
                  >
                    <IconDuplicate /> Duplicate Revision
                  </button>
                  <button
                    onClick={b.compare}
                    disabled={!b.canCompare}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 5,
                      border: `1px solid ${C.border}`,
                      borderRadius: 7,
                      background: C.white,
                      cursor: 'pointer',
                      padding: '7px 10px',
                      fontSize: 11,
                      fontWeight: 500,
                      color: C.textMedium,
                      fontFamily: "'SCT Final Inter', sans-serif",
                      flex: 1,
                    }}
                  >
                    <IconCompare /> Compare with Previous
                  </button>
                </div>
                <button
                  onClick={b.remove}
                  disabled={!b.canRevise || b.pending}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 5,
                    border: `1px solid ${C.border}`,
                    borderRadius: 7,
                    background: C.white,
                    cursor: 'pointer',
                    padding: '7px 10px',
                    marginTop: 8,
                    fontSize: 11,
                    fontWeight: 500,
                    color: C.red,
                    fontFamily: "'SCT Final Inter', sans-serif",
                    width: '100%',
                    boxSizing: 'border-box',
                  }}
                >
                  <IconDelete /> Delete Revision
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
