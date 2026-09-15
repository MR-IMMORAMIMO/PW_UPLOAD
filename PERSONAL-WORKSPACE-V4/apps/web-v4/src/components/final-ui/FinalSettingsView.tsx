import * as InlineGlyphs from '../common/SctIcons';
import * as CustomGlyphs from '../common/SctIcons';
import { useState, type CSSProperties, type ReactNode } from 'react';
import { C, SHADOW, RADIUS, LAYOUT } from './tokens';
import { V4_ACCENT_CHOICES } from '../../theme/V4AccentProvider';

import type { SettingsForm } from '../../pages/settings/SettingsWorkspace';
import { luminaireInputModeOptions, type BackupRecord } from '@scli/domain';
import type { ThemePreference } from '@scli/theme';
import { formatBusinessDateTime } from '../../date-time/businessDateTime';
import { formatBytes } from '../../pages/settings/settingsModel';
import { V4FilterSelect } from '../common/V4FilterSelect';
const G = LAYOUT.sectionGap;
type Item = { id: string; name: string; badge?: string };
interface Binding {
  form: SettingsForm;
  update: <K extends keyof SettingsForm>(key: K, value: SettingsForm[K]) => void;
  theme: ThemePreference;
  onTheme: (value: ThemePreference) => void;
  defaultValue: string;
  defaultOptions: { value: string; label: string }[];
  defaultPending: boolean;
  onDefault: (value: string) => void;
  projectTypes: Item[];
  folderProfiles: Item[];
  categories: Item[];
  sales: Item[];
  onManage: (value: 'project-types' | 'folder-profiles' | 'action-categories' | 'sales') => void;
  backups: BackupRecord[];
  onRestore: (record: BackupRecord) => void;
  onBackup: () => void;
  backupPending: boolean;
  onSave: () => void;
  saveDisabled: boolean;
  dirty: boolean;
  saving: boolean;
  onError: (message: string) => void;
  onIntegrations?: () => void;
}

// ── shared styles ─────────────────────────────────────────────────────────────

const card: CSSProperties = {
  background: C.white,
  borderRadius: RADIUS.card,
  border: `1px solid ${C.border}`,
  boxShadow: SHADOW.card,
  overflow: 'hidden',
};

const label: CSSProperties = {
  fontSize: 12,
  fontWeight: 500,
  color: C.textLabel,
  whiteSpace: 'nowrap',
};

const inputStyle: CSSProperties = {
  border: `1px solid ${C.border}`,
  borderRadius: RADIUS.control,
  padding: '0 10px',
  height: 34,
  fontSize: 12,
  color: C.text,
  background: C.white,
  outline: 'none',
  width: '100%',
  boxSizing: 'border-box',
  fontFamily: "'Inter', sans-serif",
};

const row: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  padding: '0 20px',
  minHeight: 42,
  borderBottom: `1px solid ${C.borderLight}`,
  gap: 12,
};

// ── icons ─────────────────────────────────────────────────────────────────────

const IcoWorkspace = () => (
  <CustomGlyphs.SctWorkspace size="28" style={{ color: 'currentColor' }} />
);
const IcoCatalogues = () => (
  <CustomGlyphs.SctCategory size="28" style={{ color: 'currentColor' }} />
);
const IcoIdentity = () => <CustomGlyphs.SctBranding size="28" style={{ color: 'currentColor' }} />;
const IcoDataBackup = () => <CustomGlyphs.SctBackup size="28" style={{ color: 'currentColor' }} />;
const IcoAppearance = () => (
  <CustomGlyphs.SctAppearance size="28" style={{ color: 'currentColor' }} />
);

const IcoBrowse = () => <CustomGlyphs.SctFolder size="13" style={{ color: C.textMid }} />;
const IcoSelectFile = () => <CustomGlyphs.SctFile size="13" style={{ color: C.textMid }} />;
const IcoPlus = ({ color = C.teal }: { color?: string }) => (
  <CustomGlyphs.SctAdd size="12" style={{ color: color }} />
);
const IcoDragDots = () => <CustomGlyphs.SctDrag size="12" style={{ color: C.border }} />;
const IcoItemDots = () => <CustomGlyphs.SctMore size="14" style={{ color: C.textMid }} />;
const IcoChevRight = ({ color = C.teal }: { color?: string }) => (
  <CustomGlyphs.SctNext size="12" style={{ color: color }} />
);
const IcoCloud = () => <CustomGlyphs.SctBackup size="13" style={{ color: 'white' }} />;
const IcoSave = () => <CustomGlyphs.SctSave size="13" style={{ color: 'white' }} />;
const IcoGearSettings = () => (
  <CustomGlyphs.SctSettings size="32" style={{ color: 'currentColor' }} />
);

// ── Toggle ────────────────────────────────────────────────────────────────────

function Toggle({ on, onChange }: { on: boolean; onChange: () => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-label="Auto-open Project Folder"
      aria-checked={on}
      onClick={onChange}
      style={{
        border: 0,
        padding: 0,
        width: 36,
        height: 20,
        borderRadius: 10,
        background: on ? C.teal : C.border,
        position: 'relative',
        cursor: 'pointer',
        flexShrink: 0,
        transition: 'background 180ms',
      }}
    >
      <div
        style={{
          position: 'absolute',
          top: 2,
          left: on ? 18 : 2,
          width: 16,
          height: 16,
          borderRadius: '50%',
          background: C.white,
          transition: 'left 180ms',
          boxShadow: '0 1px 3px rgba(0,0,0,0.18)',
        }}
      />
    </button>
  );
}

// ── SelectDropdown ────────────────────────────────────────────────────────────

function SelectField({
  value,
  options,
  onChange,
  label,
  disabled = false,
}: {
  value: string;
  options: { value: string; label: string }[];
  onChange: (value: string) => void;
  label: string;
  disabled?: boolean;
}) {
  return (
    <V4FilterSelect
      label={label}
      value={value}
      options={options}
      onChange={onChange}
      disabled={disabled}
      triggerStyle={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        border: `1px solid ${C.border}`,
        borderRadius: RADIUS.control,
        padding: '0 10px',
        height: 34,
        background: C.white,
        fontSize: 12,
        color: C.text,
        width: '100%',
      }}
    />
  );
}

// ── SectionHeader ─────────────────────────────────────────────────────────────

function SectionHeader({
  icon,
  title,
  description,
}: {
  icon: ReactNode;
  title: string;
  description: string;
}) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        padding: '14px 20px',
        borderBottom: `1px solid ${C.border}`,
        flexShrink: 0,
      }}
    >
      {icon}
      <div>
        <h2 style={{ margin: 0, fontSize: 14, fontWeight: 700, color: C.text }}>{title}</h2>
        <div style={{ fontSize: 11, color: C.textSub }}>{description}</div>
      </div>
    </div>
  );
}

// ── CatalogueList ─────────────────────────────────────────────────────────────

function CatalogueList({
  title,
  icon,
  items,
  manageLabel,
  onManage,
}: {
  title: string;
  icon: ReactNode;
  items: Item[];
  manageLabel: string;
  onManage: () => void;
}) {
  return (
    <div
      style={{
        flex: 1,
        minWidth: 0,
        display: 'flex',
        flexDirection: 'column',
        border: `1px solid ${C.border}`,
        borderRadius: 10,
        overflow: 'hidden',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '9px 12px',
          borderBottom: `1px solid ${C.border}`,
          background: C.cardBg,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
          {icon}
          <span style={{ fontSize: 12, fontWeight: 700, color: C.text }}>
            {title} ({items.length})
          </span>
        </div>
        <button
          onClick={onManage}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 4,
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            fontSize: 11,
            fontWeight: 600,
            color: 'var(--v4-accent-ink)',
          }}
        >
          <IcoPlus /> Add
        </button>
      </div>
      <div style={{ maxHeight: 180, minHeight: 0, overflow: 'auto' }}>
        {items.map((it) => (
          <div
            key={it.id}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 7,
              padding: '7px 12px',
              borderBottom: `1px solid ${C.borderLight}`,
            }}
          >
            <IcoDragDots />
            <span style={{ fontSize: 12, color: C.text, flex: 1 }}>{it.name}</span>
            {it.badge && (
              <span
                style={{
                  fontSize: 10,
                  fontWeight: 600,
                  color: 'var(--v4-accent-ink)',
                  background: 'var(--v4-surface-muted)',
                  border: `1px solid ${C.border}`,
                  borderRadius: 4,
                  padding: '1px 6px',
                }}
              >
                {it.badge}
              </span>
            )}
            <button
              onClick={onManage}
              aria-label={`Manage ${it.name}`}
              style={{ background: 'none', border: 0, padding: 0, display: 'flex' }}
            >
              <IcoItemDots />
            </button>
          </div>
        ))}
      </div>
      <div style={{ padding: '8px 12px', borderTop: `1px solid ${C.border}` }}>
        <button
          onClick={onManage}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 5,
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            fontSize: 11,
            color: 'var(--v4-accent-ink)',
            fontWeight: 500,
          }}
        >
          {manageLabel} <IcoChevRight />
        </button>
      </div>
    </div>
  );
}

// ── Main ──────────────────────────────────────────────────────────────────────

export function FinalSettingsView(b: Binding) {
  const [allBackups, setAllBackups] = useState(false);
  const accentColor = b.form.accentColor;
  const setAccentColor = (value: string) => b.update('accentColor', value);
  const selectFolder = async () => {
    try {
      const selected = await window.scliDesktop?.selectFolder?.();
      if (selected) b.update('projectRoot', selected);
    } catch (error) {
      b.onError(error instanceof Error ? error.message : 'Folder selection failed.');
    }
  };
  const selectLogo = async () => {
    try {
      const selected = await window.scliDesktop?.selectFile?.([
        { name: 'Logo images', extensions: ['png', 'jpg', 'jpeg', 'webp'] },
      ]);
      if (selected) b.update('companyLogoPath', selected);
    } catch (error) {
      b.onError(error instanceof Error ? error.message : 'Logo selection failed.');
    }
  };
  const openBackup = async (record: BackupRecord) => {
    try {
      const error = await window.scliDesktop?.openPath?.(record.filePath);
      if (typeof error === 'string' && error) b.onError(error);
    } catch (error) {
      b.onError(error instanceof Error ? error.message : 'Backup could not be opened.');
    }
  };
  const backupRows = (allBackups ? b.backups : b.backups.slice(0, 3)).map((record) => ({
    record,
    date: formatBusinessDateTime(record.createdAt),
    time: '',
    size: formatBytes(record.sizeBytes),
    status: record.managedAssetsVerified ? 'Verified' : 'Available',
  }));

  return (
    <div
      style={{
        padding: G,
        height: '100%',
        width: '100%',
        minHeight: 0,
        display: 'flex',
        flexDirection: 'column',
        gap: G,
        boxSizing: 'border-box',
        overflow: 'auto',
        fontFamily: "'Inter', sans-serif",
        background: C.pageBg,
      }}
    >
      {/* ── Page header ─────────────────────────────────────────────── */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexShrink: 0,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <IcoGearSettings />
          <div>
            <h1
              style={{ fontSize: 20, fontWeight: 700, color: C.text, margin: 0, lineHeight: 1.2 }}
            >
              Settings
            </h1>
            <p style={{ fontSize: 11, color: C.textSub, margin: 0 }}>
              Manage workspace configuration, catalogues, backup, and appearance.
            </p>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <span role="status" style={{ color: C.textSub, fontSize: 12 }}>
            {b.saving ? 'Saving changes…' : b.dirty ? 'Unsaved changes' : 'All changes saved'}
          </span>
          <button
            onClick={b.onSave}
            disabled={b.saveDisabled}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              border: 'none',
              borderRadius: RADIUS.control,
              background: C.teal,
              cursor: 'pointer',
              padding: '0 16px',
              height: 36,
              fontSize: 12,
              fontWeight: 600,
              color: 'white',
            }}
          >
            <IcoSave /> Save Changes
          </button>
        </div>
      </div>

      {/* ── Two-column grid ──────────────────────────────────────────── */}
      <div
        className="v4-settings-content-grid"
        style={{ display: 'flex', gap: G, alignItems: 'flex-start' }}
      >
        {/* ── Left column ─────────────────────────────────────────────── */}
        <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: G }}>
          {/* Workspace card */}
          <div style={{ ...card, flexShrink: 0 }}>
            <SectionHeader
              icon={<IcoWorkspace />}
              title="Workspace"
              description="Configure workspace paths and default behaviors."
            />
            {/* Project Root */}
            <div style={{ ...row }}>
              <span style={{ ...label, width: 180 }}>Project Root</span>
              <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 8 }}>
                <input
                  style={{ ...inputStyle }}
                  aria-label="Project Root"
                  value={b.form.projectRoot}
                  onChange={(event) => b.update('projectRoot', event.target.value)}
                />
                <button
                  onClick={() => void selectFolder()}
                  disabled={!window.scliDesktop?.selectFolder}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 5,
                    border: `1px solid ${C.border}`,
                    borderRadius: RADIUS.control,
                    background: C.white,
                    cursor: 'pointer',
                    padding: '0 12px',
                    height: 34,
                    flexShrink: 0,
                    fontSize: 12,
                    fontWeight: 500,
                    color: C.textDark,
                  }}
                >
                  <IcoBrowse /> Browse
                </button>
              </div>
            </div>
            {/* Default Folder Profile */}
            <div style={{ ...row }}>
              <span style={{ ...label, width: 180 }}>Default Folder Profile</span>
              <SelectField
                label="Default Folder Profile"
                value={b.defaultValue}
                options={b.defaultOptions}
                onChange={b.onDefault}
                disabled={b.defaultPending}
              />
            </div>
            {/* Default Input Mode */}
            <div style={{ ...row }}>
              <span style={{ ...label, width: 180 }}>Default Input Mode</span>
              <SelectField
                label="Default Input Mode"
                value={b.form.defaultInputMode}
                options={[...luminaireInputModeOptions]}
                onChange={(value) => {
                  const option = luminaireInputModeOptions.find((o) => o.value === value);
                  if (option) b.update('defaultInputMode', option.value);
                }}
              />
            </div>
            {/* Auto-open */}
            <div style={{ ...row, borderBottom: 'none' }}>
              <span style={{ ...label, width: 180 }}>Auto-open Project Folder</span>
              <div style={{ flex: 1 }}>
                <Toggle
                  on={b.form.autoOpenProjectFolder}
                  onChange={() => b.update('autoOpenProjectFolder', !b.form.autoOpenProjectFolder)}
                />
                <div style={{ fontSize: 10, color: C.textSub, marginTop: 3 }}>
                  Automatically open the project folder after creating or opening a project.
                </div>
              </div>
            </div>
          </div>

          {/* Catalogues card */}
          <div style={{ ...card, flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
            <SectionHeader
              icon={<IcoCatalogues />}
              title="Catalogues"
              description="Manage core catalogues used across projects and the workspace."
            />
            {/* 2×2 catalogue grid */}
            <div
              style={{
                flex: 1,
                minHeight: 0,
                padding: 14,
                display: 'flex',
                flexDirection: 'column',
                gap: 10,
                overflow: 'auto',
              }}
            >
              {/* Row 1 */}
              <div style={{ display: 'flex', gap: 10, flex: 1, minHeight: 0 }}>
                <CatalogueList
                  title="Project Types"
                  icon={<InlineGlyphs.SctCategory width="14" height="14" color={C.teal} />}
                  items={b.projectTypes}
                  onManage={() => b.onManage('project-types')}
                  manageLabel="Manage Project Types"
                />
                <CatalogueList
                  title="Folder Profiles"
                  icon={<InlineGlyphs.SctFolderProfile width="14" height="14" color="#f97316" />}
                  items={b.folderProfiles}
                  onManage={() => b.onManage('folder-profiles')}
                  manageLabel="Manage Folder Profiles"
                />
              </div>
              {/* Row 2 */}
              <div style={{ display: 'flex', gap: 10, flex: 1, minHeight: 0 }}>
                <CatalogueList
                  title="Action Categories"
                  icon={<InlineGlyphs.SctCategory width="14" height="14" color="#a855f7" />}
                  items={b.categories}
                  onManage={() => b.onManage('action-categories')}
                  manageLabel="Manage Action Categories"
                />
                <CatalogueList
                  title="Sales Directory"
                  icon={<InlineGlyphs.SctSales width="14" height="14" color={C.blue} />}
                  items={b.sales}
                  onManage={() => b.onManage('sales')}
                  manageLabel="Manage Sales Directory"
                />
              </div>
            </div>
          </div>
        </div>

        {/* ── Right column ────────────────────────────────────────────── */}
        <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: G }}>
          {/* Identity & Branding */}
          <div style={{ ...card, flexShrink: 0 }}>
            <SectionHeader
              icon={<IcoIdentity />}
              title="Identity & Branding"
              description="Manage your identity, logo, and branding preferences."
            />
            {/* Designer Name */}
            <div style={{ ...row }}>
              <span style={{ ...label, width: 140 }}>Designer Name</span>
              <input
                style={{ ...inputStyle }}
                aria-label="Designer Name"
                value={b.form.designerName}
                onChange={(event) => b.update('designerName', event.target.value)}
              />
            </div>
            {/* Company Name */}
            <div style={{ ...row }}>
              <span style={{ ...label, width: 140 }}>Company Name</span>
              <input
                style={{ ...inputStyle }}
                aria-label="Company Name"
                value={b.form.companyName}
                onChange={(event) => b.update('companyName', event.target.value)}
              />
            </div>
            {/* Company Logo */}
            <div style={{ ...row }}>
              <span style={{ ...label, width: 140 }}>Company Logo</span>
              <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 8 }}>
                <input
                  style={{ ...inputStyle }}
                  aria-label="Company Logo"
                  value={b.form.companyLogoPath}
                  onChange={(event) => b.update('companyLogoPath', event.target.value)}
                />
                <button
                  onClick={() => void selectLogo()}
                  disabled={!window.scliDesktop?.selectFile}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 5,
                    border: `1px solid ${C.border}`,
                    borderRadius: RADIUS.control,
                    background: C.white,
                    cursor: 'pointer',
                    padding: '0 12px',
                    height: 34,
                    flexShrink: 0,
                    fontSize: 12,
                    fontWeight: 500,
                    color: C.textDark,
                  }}
                >
                  <IcoSelectFile /> Select File
                </button>
              </div>
            </div>
            {/* Accent Color */}
            <div style={{ ...row }}>
              <span style={{ ...label, width: 140 }}>Accent Color</span>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                {V4_ACCENT_CHOICES.map((color) => ({
                  color,
                  selected: accentColor.toLowerCase() === color.toLowerCase(),
                })).map((s) => (
                  <button
                    type="button"
                    aria-label={`Accent ${s.color}`}
                    aria-pressed={s.selected}
                    key={s.color}
                    onClick={() => setAccentColor(s.color)}
                    style={{
                      border: 0,
                      padding: 0,
                      width: 24,
                      height: 24,
                      borderRadius: '50%',
                      background: s.color,
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      boxShadow: s.selected ? `0 0 0 2px white, 0 0 0 3.5px ${s.color}` : 'none',
                    }}
                  >
                    {s.selected && <InlineGlyphs.SctCheck width="12" height="12" color="white" />}
                  </button>
                ))}
              </div>
            </div>
            {/* Time Zone */}
            <div style={{ ...row, borderBottom: 'none' }}>
              <span style={{ ...label, width: 140 }}>Time Zone</span>
              <SelectField
                label="Time Zone"
                value={b.form.timeZone}
                options={[
                  ...new Set([
                    b.form.timeZone,
                    'Asia/Dubai',
                    'Asia/Riyadh',
                    'Africa/Cairo',
                    'Europe/London',
                  ]),
                ].map((value) => ({ value, label: value }))}
                onChange={(value) => b.update('timeZone', value)}
              />
            </div>
          </div>

          {/* Data & Backup */}
          <div style={{ ...card, flexShrink: 0 }}>
            <SectionHeader
              icon={<IcoDataBackup />}
              title="Data & Backup"
              description="Manage database backups and recovery."
            />
            {/* Retention + Create Backup */}
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 12,
                padding: '10px 20px',
                borderBottom: `1px solid ${C.border}`,
              }}
            >
              <span style={{ ...label, width: 140 }}>Backup Retention</span>
              <input
                aria-label="Backup Retention"
                title="Number of backups to retain"
                type="number"
                min={3}
                max={100}
                value={b.form.backupRetention}
                onChange={(event) => b.update('backupRetention', Number(event.target.value))}
                style={{ ...inputStyle, flex: '0 0 130px', width: 130 }}
              />
              <div style={{ flex: 1 }} />
              <button
                onClick={b.onBackup}
                disabled={b.backupPending}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  border: `1px solid ${C.border}`,
                  borderRadius: RADIUS.control,
                  background: C.white,
                  cursor: 'pointer',
                  padding: '0 16px',
                  height: 34,
                  fontSize: 12,
                  fontWeight: 600,
                  color: C.text,
                }}
              >
                <IcoCloud /> Create Backup
              </button>
            </div>
            {/* Recent Backups table */}
            <div style={{ padding: '10px 20px 6px' }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: C.text, marginBottom: 8 }}>
                Recent Backups
              </div>
              {/* Table header */}
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: '1fr 80px 80px 1fr',
                  padding: '5px 0',
                  borderBottom: `1px solid ${C.border}`,
                }}
              >
                {['DATE & TIME', 'SIZE', 'STATUS', 'ACTIONS'].map((h) => (
                  <span
                    key={h}
                    style={{
                      fontSize: 10,
                      fontWeight: 700,
                      color: C.textSub,
                      letterSpacing: '0.04em',
                    }}
                  >
                    {h}
                  </span>
                ))}
              </div>
              {backupRows.map((backupRow) => (
                <div
                  key={backupRow.record.filePath}
                  style={{
                    display: 'grid',
                    gridTemplateColumns: '1fr 80px 80px 1fr',
                    padding: '7px 0',
                    borderBottom: `1px solid ${C.borderLight}`,
                    alignItems: 'center',
                  }}
                >
                  <div>
                    <div style={{ fontSize: 12, color: C.text }}>{backupRow.date}</div>
                    <div style={{ fontSize: 10, color: C.textSub }}>{backupRow.time}</div>
                  </div>
                  <span style={{ fontSize: 12, color: C.textDark }}>{backupRow.size}</span>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                    <div
                      style={{ width: 7, height: 7, borderRadius: '50%', background: '#22c55e' }}
                    />
                    <span style={{ fontSize: 12, color: '#16a34a', fontWeight: 500 }}>
                      {backupRow.status}
                    </span>
                  </div>
                  <div style={{ display: 'flex', gap: 12 }}>
                    <button
                      disabled={!window.scliDesktop?.openPath}
                      onClick={() => void openBackup(backupRow.record)}
                      style={{
                        background: 'none',
                        border: 0,
                        padding: 0,
                        fontSize: 11,
                        color: 'var(--v4-accent-ink)',
                        cursor: 'pointer',
                        fontWeight: 500,
                      }}
                    >
                      Open
                    </button>
                    <button
                      onClick={() => b.onRestore(backupRow.record)}
                      style={{
                        background: 'none',
                        border: 0,
                        padding: 0,
                        fontSize: 11,
                        color: 'var(--v4-accent-ink)',
                        cursor: 'pointer',
                        fontWeight: 500,
                      }}
                    >
                      Restore
                    </button>
                  </div>
                </div>
              ))}
              <div style={{ padding: '7px 0', display: 'flex', alignItems: 'center', gap: 5 }}>
                <button
                  onClick={() => setAllBackups((current) => !current)}
                  style={{
                    background: 'none',
                    border: 0,
                    padding: 0,
                    fontSize: 11,
                    color: 'var(--v4-accent-ink)',
                    cursor: 'pointer',
                    fontWeight: 500,
                  }}
                >
                  {allBackups ? 'Show Recent Backups' : 'View All Backups'}
                </button>
                <IcoChevRight />
              </div>
            </div>
          </div>

          {/* Appearance */}
          {b.onIntegrations ? (
            <div style={card}>
              <div
                style={{
                  padding: 16,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: 12,
                }}
              >
                <div>
                  <strong>Desktop integrations</strong>
                  <p style={{ color: C.textSub, fontSize: 12 }}>AutoCAD and DIALux installations</p>
                </div>
                <button
                  type="button"
                  style={{ ...inputStyle, color: 'var(--v4-accent-ink)', cursor: 'pointer' }}
                  onClick={b.onIntegrations}
                >
                  Manage
                </button>
              </div>
            </div>
          ) : null}
          <div style={{ ...card, flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
            <SectionHeader
              icon={<IcoAppearance />}
              title="Appearance"
              description="Customize the look and feel of the application."
            />
            <div style={{ padding: '12px 20px', flex: 1 }}>
              {/* Theme row */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 14 }}>
                <span style={{ ...label, width: 60 }}>Theme</span>
                <div
                  style={{
                    display: 'flex',
                    border: `1px solid ${C.border}`,
                    borderRadius: RADIUS.control,
                    overflow: 'hidden',
                  }}
                >
                  {[
                    {
                      id: 'light',
                      label: 'Light',
                      icon: <InlineGlyphs.SctLight width="12" height="12" color="currentColor" />,
                    },
                    {
                      id: 'dark',
                      label: 'Dark',
                      icon: <InlineGlyphs.SctDark width="12" height="12" color="currentColor" />,
                    },
                    {
                      id: 'system',
                      label: 'System',
                      icon: <InlineGlyphs.SctSystem width="12" height="12" color="currentColor" />,
                    },
                  ].map((t) => (
                    <button
                      key={t.id}
                      aria-pressed={t.id === b.theme}
                      onClick={() =>
                        b.onTheme(t.id === 'light' ? 'light' : t.id === 'dark' ? 'dark' : 'system')
                      }
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 5,
                        padding: '6px 14px',
                        background: t.id === b.theme ? C.teal : C.white,
                        color: t.id === b.theme ? 'white' : C.textMid,
                        border: 'none',
                        cursor: 'pointer',
                        fontSize: 12,
                        fontWeight: t.id === b.theme ? 600 : 400,
                        borderRight: t.id !== 'system' ? `1px solid ${C.border}` : 'none',
                        fontFamily: "'Inter', sans-serif",
                      }}
                    >
                      {t.icon} {t.label}
                    </button>
                  ))}
                </div>
              </div>
              <div style={{ fontSize: 11, color: C.textSub, marginTop: 8 }}>
                Theme changes save immediately. System follows your operating system preference.
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
