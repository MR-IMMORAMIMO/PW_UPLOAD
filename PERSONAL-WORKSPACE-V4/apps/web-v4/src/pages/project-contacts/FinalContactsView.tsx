import * as FinalGlyphs from '../../components/common/SctIcons';
import { C, SHADOW, RADIUS, LAYOUT } from '../../components/final-ui/tokens';
import { createContext, useContext, useState } from 'react';
import { formatBusinessDateTime } from '../../date-time/businessDateTime';
import { V4ResizableTable } from '../../components/common/V4ResizableTable';
import { V4FilterSelect } from '../../components/common/V4FilterSelect';
import { V4Button } from '../../components/common/V4Button';
import { V4ConfirmDialog } from '../../components/common/V4ConfirmDialog';
import type { ReactNode } from 'react';
import type { ProjectContact } from '@scli/domain';

// ── Icons ─────────────────────────────────────────────────────────────────────

function IconSearch() {
  return <FinalGlyphs.SctSearch width="14" height="14" />;
}
function IconFilter() {
  return <FinalGlyphs.SctFilter width="14" height="14" />;
}
function IconCopy() {
  return <FinalGlyphs.SctCopy width="14" height="14" />;
}
function IconMail() {
  return <FinalGlyphs.SctEmail width="14" height="14" />;
}
function IconPhone() {
  return <FinalGlyphs.SctPhone width="14" height="14" />;
}
function IconClientGroup() {
  return <FinalGlyphs.SctClient width="16" height="16" />;
}
function IconSalesGroup() {
  return <FinalGlyphs.SctSales width="16" height="16" />;
}
function IconConsultant() {
  return <FinalGlyphs.SctContacts width="16" height="16" />;
}
function IconContractor() {
  return <FinalGlyphs.SctCommercial width="16" height="16" />;
}
function IconInternal() {
  return <FinalGlyphs.SctCoordination width="16" height="16" />;
}
function IconSummary() {
  return <FinalGlyphs.SctSummary width="16" height="16" />;
}
function IconInfo() {
  return <FinalGlyphs.SctNext width="13" height="13" />;
}

// ── Avatar ────────────────────────────────────────────────────────────────────

function Avatar({ initials, size = 36 }: { initials: string; size?: number }) {
  const c = { bg: C.lightBg, text: C.textDark };
  return (
    <div
      style={{
        width: size,
        height: size,
        borderRadius: '50%',
        background: c.bg,
        color: c.text,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontFamily: "'SCT Final Inter', sans-serif",
        fontSize: size < 30 ? 10 : 12,
        fontWeight: 700,
        flexShrink: 0,
      }}
    >
      {initials}
    </div>
  );
}

// ── Data ──────────────────────────────────────────────────────────────────────

type ContactView = ProjectContact & { initials: string; phone: string; primary: boolean };
type Group = {
  id: string;
  label: string;
  count: number;
  icon: ReactNode;
  iconBg: string;
  dot: string;
  contacts: ContactView[];
};
const GROUP_META = [
  { id: 'client', label: 'Client', icon: <IconClientGroup />, iconBg: '#eff6ff', dot: '#2563eb' },
  { id: 'sales', label: 'Sales', icon: <IconSalesGroup />, iconBg: '#f5f3ff', dot: '#8b5cf6' },
  {
    id: 'consultant',
    label: 'Consultant',
    icon: <IconConsultant />,
    iconBg: '#fffbeb',
    dot: '#f59e0b',
  },
  {
    id: 'contractor',
    label: 'Contractor',
    icon: <IconContractor />,
    iconBg: '#ecfdf5',
    dot: '#10b981',
  },
  {
    id: 'internal',
    label: 'Internal Team',
    icon: <IconInternal />,
    iconBg: '#eef2ff',
    dot: '#6366f1',
  },
];
const ContactContext = createContext<{
  addGroup: (group: string) => void;
  select: (id: string) => void;
  selectedId: string;
  notify: (text: string) => void;
  phoneFallback: (phone: string) => void;
}>({
  addGroup: () => {},
  select: () => {},
  selectedId: '',
  notify: () => {},
  phoneFallback: () => {},
});
function contactRole(c: ProjectContact) {
  return c.group?.trim() || c.role.trim() || 'Unspecified';
}
function groupsFor(contacts: ProjectContact[]): Group[] {
  const labels = [
    ...GROUP_META.map((g) => g.label),
    ...new Set(
      contacts
        .map(contactRole)
        .filter((r) => !GROUP_META.some((g) => g.label.toLowerCase() === r.toLowerCase())),
    ),
  ];
  return labels.map((label) => {
    const meta = GROUP_META.find((g) => g.label === label) ?? {
      id: label,
      label,
      icon: <IconClientGroup />,
      iconBg: '#f3f4f6',
      dot: '#4b5563',
    };
    const rows = contacts
      .filter((c) => contactRole(c).toLowerCase() === label.toLowerCase())
      .map((c) => ({
        ...c,
        name: c.name || '—',
        company: c.company || '—',
        email: c.email || '—',
        role: c.role || '—',
        initials: c.name
          .trim()
          .split(/\s+/)
          .filter(Boolean)
          .map((part) => part[0])
          .join('')
          .toUpperCase(),
        phone: c.phone || '—',
        primary: Boolean(c.isPrimary),
      }));
    return { ...meta, contacts: rows, count: rows.length };
  });
}
function ContactUtility({
  contact,
  kind,
  children,
}: {
  contact: ContactView;
  kind: 'copy' | 'email' | 'phone';
  children: ReactNode;
}) {
  const { notify, phoneFallback } = useContext(ContactContext);
  const available =
    (kind === 'phone' && contact.phone !== '—' && /[0-9]/.test(contact.phone)) ||
    kind === 'copy' ||
    (kind === 'email' && contact.email !== '—' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contact.email));
  return (
    <button
      type="button"
      aria-label={`${kind === 'copy' ? 'Copy details for' : kind === 'email' ? 'Email' : 'Call'} ${contact.name}`}
      aria-disabled={!available}
      title={
        !available
          ? 'Not available in this contact record'
          : kind === 'copy'
            ? 'Copy contact details'
            : kind === 'phone'
              ? 'Call contact'
              : 'Email contact'
      }
      onClick={async (e) => {
        e.stopPropagation();
        if (!available) return;
        if (kind === 'email' || kind === 'phone') {
          const value = kind === 'email' ? contact.email : contact.phone;
          try {
            if (window.scliDesktop?.openContactLink) {
              const opened = await window.scliDesktop.openContactLink({ kind, value });
              if (!opened) {
                if (kind === 'phone') phoneFallback(value);
                else notify('Contact link could not be opened.');
              }
            } else {
              window.location.href = `${kind === 'email' ? 'mailto' : 'tel'}:${encodeURIComponent(value)}`;
              if (kind === 'phone') phoneFallback(value);
            }
          } catch {
            if (kind === 'phone') phoneFallback(value);
            else notify('Contact link could not be opened.');
          }
          return;
        }
        try {
          await navigator.clipboard.writeText(
            [contact.name, contact.company, contact.role, contact.email, contact.phone]
              .filter((v) => v !== '—')
              .join('\n'),
          );
          notify('Contact details copied.');
        } catch {
          notify('Contact details could not be copied.');
        }
      }}
      style={{
        width: 32,
        height: 32,
        borderRadius: 5,
        border: `1px solid ${C.border}`,
        background: C.white,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        cursor: available ? 'pointer' : 'default',
      }}
    >
      {children}
    </button>
  );
}
// ── Contact Row ───────────────────────────────────────────────────────────────

function ContactRow({ c, last }: { c: ContactView; last: boolean }) {
  const { select, selectedId } = useContext(ContactContext);
  return (
    // The native name button below supplies keyboard selection without nesting interactive controls.
    // eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-noninteractive-element-interactions
    <div
      role="group"
      aria-label={`Contact ${c.name}`}
      data-contact-id={c.id}
      data-selected={selectedId === c.id}
      onClick={(event) => {
        if (!(event.target as HTMLElement).closest('button,a,input')) select(c.id);
      }}
      style={{
        display: 'flex',
        alignItems: 'flex-start',
        gap: 10,
        cursor: 'pointer',
        padding: '10px 0',
        borderBottom: last ? 'none' : `1px solid ${C.borderLight}`,
      }}
    >
      <Avatar initials={c.initials} size={36} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2 }}>
          <button
            type="button"
            aria-pressed={selectedId === c.id}
            onClick={() => select(c.id)}
            style={{
              padding: 0,
              border: 0,
              background: 'none',
              textAlign: 'left',
              fontFamily: "'SCT Final Inter', sans-serif",
              fontSize: 12,
              fontWeight: 700,
              color: C.text,
              cursor: 'pointer',
            }}
          >
            {c.name}
          </button>
          {c.primary && (
            <span
              style={{
                padding: '1px 6px',
                borderRadius: 20,
                background: '#dbeafe',
                color: '#1d4ed8',
                fontFamily: "'SCT Final Inter', sans-serif",
                fontSize: 10,
                fontWeight: 600,
              }}
            >
              Primary
            </span>
          )}
        </div>
        <div
          style={{
            fontFamily: "'SCT Final Inter', sans-serif",
            fontSize: 11,
            color: C.textSub,
            marginBottom: 1,
          }}
        >
          {c.company}
        </div>
        <div
          style={{ fontFamily: "'SCT Final Inter', sans-serif", fontSize: 11, color: C.textSub }}
        >
          {c.role}
        </div>
      </div>
      <div style={{ flexShrink: 0, textAlign: 'right' }}>
        <div
          style={{
            fontFamily: "'SCT Final Inter', sans-serif",
            fontSize: 11,
            color: C.textDark,
            marginBottom: 2,
          }}
        >
          {c.email}
        </div>
        <div
          style={{
            fontFamily: "'SCT Final Inter', sans-serif",
            fontSize: 11,
            color: C.textDark,
            marginBottom: 7,
          }}
        >
          {c.phone}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, justifyContent: 'flex-end' }}>
          <ContactUtility contact={c} kind="copy">
            <IconCopy />
          </ContactUtility>
          <ContactUtility contact={c} kind="email">
            <IconMail />
          </ContactUtility>
          <ContactUtility contact={c} kind="phone">
            <IconPhone />
          </ContactUtility>
        </div>
      </div>
    </div>
  );
}

// ── Group Card ────────────────────────────────────────────────────────────────

function GroupCard({ group }: { group: Group }) {
  const context = useContext(ContactContext);
  const [sort, setSort] = useState('name');
  const sorted = [...group.contacts].sort((a, b) =>
    sort === 'primary'
      ? Number(b.primary) - Number(a.primary) || a.name.localeCompare(b.name)
      : a.name.localeCompare(b.name),
  );
  return (
    <div
      style={{
        background: C.white,
        border: `1px solid ${C.border}`,
        borderRadius: RADIUS.card,
        boxShadow: SHADOW.card,
        padding: '12px 14px',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
        <div
          style={{
            width: 28,
            height: 28,
            borderRadius: 7,
            background: group.iconBg,
            color: group.dot,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0,
          }}
        >
          {group.icon}
        </div>
        <span
          style={{
            fontFamily: "'SCT Final Inter', sans-serif",
            fontSize: 13,
            fontWeight: 700,
            color: C.text,
          }}
        >
          {group.label}
        </span>
        <span
          style={{
            padding: '1px 7px',
            borderRadius: 20,
            background: C.lightBg,
            fontFamily: "'SCT Final Inter', sans-serif",
            fontSize: 11,
            fontWeight: 600,
            color: C.textDark,
          }}
        >
          {group.count}
        </span>
        <div style={{ flex: 1 }} />
        <V4FilterSelect
          label={`${group.label} group actions`}
          value=""
          options={[
            { value: '', label: 'Group actions' },
            { value: 'add', label: 'Add contact' },
            { value: 'name', label: 'Sort by name' },
            { value: 'primary', label: 'Primary first' },
          ]}
          onChange={(value) => {
            if (value === 'add') context.addGroup(group.label);
            else setSort(value);
          }}
        />
      </div>
      {sorted.map((c, i) => (
        <ContactRow key={c.id} c={c} last={i === group.contacts.length - 1} />
      ))}
    </div>
  );
}

// ── Main ──────────────────────────────────────────────────────────────────────

export default function FinalContactsView({
  contacts,
  query,
  role,
  onQuery,
  onRole,
  selectedId,
  onSelect,
  state,
  notify,
  onAdd,
  onEdit,
  onArchive,
  relationship,
}: {
  relationship?: ReactNode;
  onArchive?: (contact: ProjectContact, archived: boolean) => void;
  onAdd: (group?: string) => void;
  onEdit: (contact: ProjectContact) => void;
  contacts: ProjectContact[];
  query: string;
  role: string;
  onQuery: (value: string) => void;
  onRole: (value: string) => void;
  selectedId: string;
  onSelect: (id: string) => void;
  state: ReactNode;
  notify: (text: string) => void;
}) {
  const [archived, setArchived] = useState(false);
  const [phone, setPhone] = useState('');
  const [view, setView] = useState('cards');
  const [internalSort, setInternalSort] = useState('name');
  const visibleContacts = contacts.filter((contact) => Boolean(contact.archived) === archived);
  const filtered = visibleContacts.filter(
    (c) =>
      (!role || contactRole(c) === role) &&
      [c.name, c.company, c.email, c.role].some((v) =>
        v.toLowerCase().includes(query.trim().toLowerCase()),
      ),
  );
  const GROUPS = groupsFor(filtered);
  const SUMMARY_ROWS = groupsFor(visibleContacts).map((g) => ({
    label: g.label,
    count: g.count,
    dot: GROUP_META.find((m) => m.id === g.id)?.dot ?? '#6b7280',
  }));
  const selected = visibleContacts.find((c) => c.id === selectedId);
  const primary = visibleContacts.find(
    (c) => c.isPrimary && contactRole(c).toLowerCase() === 'client',
  );
  const inspected = selected ?? primary;
  const roles = [...new Set(contacts.map(contactRole))];
  return (
    <ContactContext.Provider
      value={{ select: onSelect, selectedId, notify, addGroup: onAdd, phoneFallback: setPhone }}
    >
      <V4ConfirmDialog
        open={!!phone}
        title="Call contact"
        description={`If no calling application opened, copy ${phone} and use it in your preferred application.`}
        cancelLabel="Close"
        confirmLabel="Copy number"
        onCancel={() => setPhone('')}
        onConfirm={() => {
          void navigator.clipboard
            .writeText(phone)
            .then(() => {
              setPhone('');
              notify('Phone number copied.');
            })
            .catch(() => notify('Phone number could not be copied.'));
        }}
      />
      <div
        className="final-contacts"
        data-testid="v4-project-contacts"
        data-selected-contact={selected?.id ?? ''}
        style={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          padding: `12px ${LAYOUT.sectionGap}px ${LAYOUT.sectionGap}px`,
          minHeight: 0,
          overflow: 'hidden',
        }}
      >
        {/* Top header bar */}
        <div
          style={{
            display: 'flex',
            alignItems: 'flex-start',
            justifyContent: 'space-between',
            marginBottom: 12,
            flexShrink: 0,
          }}
        >
          <div>
            <h1
              style={{
                fontFamily: "'SCT Final Inter', sans-serif",
                fontSize: 20,
                fontWeight: 700,
                color: C.text,
                margin: 0,
                lineHeight: 1.2,
              }}
            >
              Contacts
            </h1>
            <p
              style={{
                fontFamily: "'SCT Final Inter', sans-serif",
                fontSize: 12,
                color: C.textSub,
                margin: '3px 0 0',
              }}
            >
              Key project people across client, consultant, sales, and contractor teams.
            </p>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
            {/* Search */}
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 7,
                padding: '7px 12px',
                background: C.white,
                border: `1.5px solid ${C.border}`,
                borderRadius: 8,
                width: 200,
              }}
            >
              <IconSearch />
              <input
                aria-label="Search contacts"
                placeholder="Search contacts"
                value={query}
                onChange={(e) => onQuery(e.target.value)}
                style={{
                  minWidth: 0,
                  width: '100%',
                  border: 0,
                  outline: 0,
                  background: 'none',
                  fontFamily: "'SCT Final Inter', sans-serif",
                  fontSize: 12,
                  color: C.textDark,
                }}
              />
            </div>
            {/* Filter */}
            <label
              style={{
                position: 'relative',
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                padding: '7px 12px',
                border: `1.5px solid ${C.border}`,
                borderRadius: 8,
                background: C.white,
                fontFamily: "'SCT Final Inter', sans-serif",
                fontSize: 12,
                fontWeight: 500,
                color: C.textDark,
                cursor: 'pointer',
              }}
            >
              <IconFilter /> Filter
              <select
                aria-label="Filter contacts by role"
                value={role}
                onChange={(e) => onRole(e.target.value)}
                style={{
                  position: 'absolute',
                  inset: 0,
                  opacity: 0,
                  width: '100%',
                  cursor: 'pointer',
                }}
              >
                <option value="">All roles</option>
                {roles.map((r) => (
                  <option key={r}>{r}</option>
                ))}
              </select>
            </label>
            <V4FilterSelect
              label="View"
              value={view}
              onChange={setView}
              options={[
                { value: 'cards', label: 'Cards' },
                { value: 'table', label: 'Table' },
              ]}
            />
            <V4Button
              aria-pressed={archived}
              onClick={() => {
                setArchived(!archived);
                onSelect('');
              }}
            >
              <FinalGlyphs.SctArchive aria-hidden="true" />
              {archived ? 'Show active contacts' : 'Archived contacts'}
            </V4Button>
            {/* Add */}
            <button
              aria-label="Add Contact"
              onClick={() => onAdd()}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                padding: '7px 14px',
                background: '#2563eb',
                color: '#fff',
                border: 'none',
                borderRadius: 8,
                fontSize: 12,
                fontWeight: 600,
                fontFamily: "'SCT Final Inter', sans-serif",
                cursor: 'pointer',
                whiteSpace: 'nowrap',
              }}
            >
              <span style={{ fontSize: 15, lineHeight: 1, marginTop: -1 }}>+</span> Add Contact
            </button>
          </div>
        </div>

        {/* Main content */}
        <div
          className="final-contacts-body"
          style={{ flex: 1, minHeight: 0, overflow: 'hidden', display: 'flex', gap: 12 }}
        >
          {/* Left grid */}
          <div
            className="final-contacts-list"
            style={{
              flex: 1,
              minWidth: 0,
              display: 'flex',
              flexDirection: 'column',
              gap: 12,
              overflow: 'auto',
            }}
          >
            {view === 'table' ? (
              <V4ResizableTable tableKey="project-contacts" className="v4-contacts-table">
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Group</th>
                    <th>Role</th>
                    <th>Company</th>
                    <th>Email</th>
                    <th>Phone</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((contact) => (
                    <tr key={contact.id}>
                      <td>
                        <button type="button" onClick={() => onSelect(contact.id)}>
                          {contact.name}
                        </button>
                      </td>
                      <td>{contactRole(contact)}</td>
                      <td>{contact.role || '—'}</td>
                      <td>{contact.company || '—'}</td>
                      <td>{contact.email || '—'}</td>
                      <td>{contact.phone || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </V4ResizableTable>
            ) : (
              <>
                {/* Top row: Client + Sales */}
                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: '1fr 1fr',
                    gap: 12,
                    flexShrink: 0,
                  }}
                >
                  <GroupCard group={GROUPS[0]!} />
                  <GroupCard group={GROUPS[1]!} />
                </div>
                {/* Middle row: Consultant + Contractor */}
                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: '1fr 1fr',
                    gap: 12,
                    flexShrink: 0,
                  }}
                >
                  <GroupCard group={GROUPS[2]!} />
                  <GroupCard group={GROUPS[3]!} />
                </div>
                {/* Bottom row: Internal Team (full width) */}
                <div style={{ flexShrink: 0 }}>
                  <div
                    style={{
                      background: C.white,
                      border: `1px solid ${C.border}`,
                      borderRadius: RADIUS.card,
                      boxShadow: SHADOW.card,
                      padding: '12px 14px',
                    }}
                  >
                    <div
                      style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}
                    >
                      <div
                        style={{
                          width: 28,
                          height: 28,
                          borderRadius: 7,
                          background: '#eef2ff',
                          color: '#4338ca',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          flexShrink: 0,
                        }}
                      >
                        <IconInternal />
                      </div>
                      <span
                        style={{
                          fontFamily: "'SCT Final Inter', sans-serif",
                          fontSize: 13,
                          fontWeight: 700,
                          color: C.text,
                        }}
                      >
                        Internal Team
                      </span>
                      <span
                        style={{
                          padding: '1px 7px',
                          borderRadius: 20,
                          background: C.lightBg,
                          fontFamily: "'SCT Final Inter', sans-serif",
                          fontSize: 11,
                          fontWeight: 600,
                          color: C.textDark,
                        }}
                      >
                        {GROUPS[4]!.count}
                      </span>
                      <div style={{ flex: 1 }} />
                      <V4FilterSelect
                        label="Internal Team group actions"
                        value=""
                        options={[
                          { value: '', label: 'Group actions' },
                          { value: 'add', label: 'Add contact' },
                          { value: 'name', label: 'Sort by name' },
                          { value: 'primary', label: 'Primary first' },
                        ]}
                        onChange={(value) => {
                          if (value === 'add') onAdd('Internal Team');
                          else setInternalSort(value);
                        }}
                      />
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 0 }}>
                      {[...GROUPS[4]!.contacts]
                        .sort((a, b) =>
                          internalSort === 'primary'
                            ? Number(b.primary) - Number(a.primary) || a.name.localeCompare(b.name)
                            : a.name.localeCompare(b.name),
                        )
                        .map((c, i) => (
                          <div
                            key={c.id}
                            role="button"
                            tabIndex={0}
                            aria-label={`Select ${c.name}`}
                            onClick={() => onSelect(c.id)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter' || e.key === ' ') {
                                e.preventDefault();
                                onSelect(c.id);
                              }
                            }}
                            data-contact-id={c.id}
                            data-selected={selectedId === c.id}
                            style={{
                              display: 'flex',
                              alignItems: 'center',
                              gap: 10,
                              padding: '9px 0',
                              paddingLeft: i === 1 ? 16 : 0,
                              paddingRight: i === 0 ? 16 : 0,
                              borderRight: i === 0 ? `1px solid ${C.borderLight}` : 'none',
                            }}
                          >
                            <Avatar initials={c.initials} size={34} />
                            {/* Name + company */}
                            <div style={{ flex: '0 0 auto', minWidth: 0 }}>
                              <div
                                style={{
                                  fontFamily: "'SCT Final Inter', sans-serif",
                                  fontSize: 12,
                                  fontWeight: 700,
                                  color: C.text,
                                  marginBottom: 1,
                                }}
                              >
                                {c.name}
                              </div>
                              <div
                                style={{
                                  fontFamily: "'SCT Final Inter', sans-serif",
                                  fontSize: 11,
                                  color: C.textSub,
                                }}
                              >
                                {c.company}
                              </div>
                            </div>
                            {/* Role label in middle */}
                            {c.role && (
                              <div
                                style={{
                                  flex: 1,
                                  fontFamily: "'SCT Final Inter', sans-serif",
                                  fontSize: 11,
                                  color: C.textSub,
                                  textAlign: 'center',
                                }}
                              >
                                {c.role}
                              </div>
                            )}
                            {!c.role && <div style={{ flex: 1 }} />}
                            {/* Email + phone */}
                            <div style={{ flexShrink: 0, textAlign: 'right' }}>
                              <div
                                style={{
                                  fontFamily: "'SCT Final Inter', sans-serif",
                                  fontSize: 11,
                                  color: C.textDark,
                                }}
                              >
                                {c.email}
                              </div>
                              <div
                                style={{
                                  fontFamily: "'SCT Final Inter', sans-serif",
                                  fontSize: 11,
                                  color: C.textDark,
                                }}
                              >
                                {c.phone}
                              </div>
                            </div>
                          </div>
                        ))}
                    </div>
                  </div>
                </div>

                {GROUPS.slice(5).map((group) => (
                  <GroupCard key={group.id} group={group} />
                ))}
                {state ||
                  (filtered.length === 0 ? (
                    <p role="status">
                      {contacts.length
                        ? 'No contacts match this search or filter.'
                        : 'No contacts yet.'}
                    </p>
                  ) : null)}
              </>
            )}
            {/* Footer note */}
            <div style={{ flexShrink: 0, display: 'flex', alignItems: 'center', gap: 6 }}>
              <IconInfo />
              <span
                style={{
                  fontFamily: "'SCT Final Inter', sans-serif",
                  fontSize: 11,
                  color: C.textSub,
                }}
              >
                Use the action buttons on each contact to copy details, send an email, or make a
                call.
              </span>
            </div>
          </div>

          {/* Right panel */}
          <div
            className="final-contacts-details"
            style={{
              flex: '0 0 25%',
              minWidth: 240,
              flexShrink: 0,
              display: 'flex',
              flexDirection: 'column',
              gap: 12,
              overflow: 'auto',
            }}
          >
            {/* Contact Summary */}
            <div
              style={{
                background: C.white,
                border: `1px solid ${C.border}`,
                borderRadius: RADIUS.card,
                boxShadow: SHADOW.card,
                padding: '12px 14px',
                flexShrink: 0,
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
                <div
                  style={{
                    width: 26,
                    height: 26,
                    borderRadius: 6,
                    background: '#eff6ff',
                    color: '#1d4ed8',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <IconSummary />
                </div>
                <span
                  style={{
                    fontFamily: "'SCT Final Inter', sans-serif",
                    fontSize: 13,
                    fontWeight: 700,
                    color: C.text,
                  }}
                >
                  Contact Summary
                </span>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
                {SUMMARY_ROWS.map((r, i) => (
                  <div
                    key={r.label}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      padding: '6px 0',
                      borderBottom:
                        i < SUMMARY_ROWS.length - 1 ? `1px solid ${C.borderLight}` : 'none',
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                      <span
                        style={{
                          width: 7,
                          height: 7,
                          borderRadius: '50%',
                          background: r.dot,
                          flexShrink: 0,
                          display: 'inline-block',
                        }}
                      />
                      <span
                        style={{
                          fontFamily: "'SCT Final Inter', sans-serif",
                          fontSize: 12,
                          color: C.textDark,
                        }}
                      >
                        {r.label}
                      </span>
                    </div>
                    <span
                      style={{
                        fontFamily: "'SCT Final Inter', sans-serif",
                        fontSize: 12,
                        fontWeight: 600,
                        color: C.text,
                      }}
                    >
                      {r.count}
                    </span>
                  </div>
                ))}
              </div>
              <div
                style={{
                  borderTop: `1.5px solid ${C.border}`,
                  marginTop: 8,
                  paddingTop: 8,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                }}
              >
                <span
                  style={{
                    fontFamily: "'SCT Final Inter', sans-serif",
                    fontSize: 12,
                    fontWeight: 700,
                    color: C.text,
                  }}
                >
                  Total Contacts
                </span>
                <span
                  style={{
                    fontFamily: "'SCT Final Inter', sans-serif",
                    fontSize: 13,
                    fontWeight: 700,
                    color: C.text,
                  }}
                >
                  {visibleContacts.length}
                </span>
              </div>
            </div>

            <section
              style={{
                background: C.white,
                border: `1px solid ${C.border}`,
                borderRadius: RADIUS.card,
                padding: 14,
              }}
              aria-label="Contact details"
            >
              <div
                style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}
              >
                <h3>{selected ? 'Selected Contact' : 'Client Primary Contact'}</h3>
                {selected && (
                  <button
                    type="button"
                    aria-label="Close contact details"
                    onClick={() => onSelect('')}
                  >
                    <FinalGlyphs.SctClose size={16} />
                  </button>
                )}
              </div>
              {inspected ? (
                <>
                  <strong>{inspected.name}</strong>
                  <dl>
                    {(selected
                      ? [
                          ['Group', contactRole(inspected)],
                          ['Role', inspected.role],
                          ['Company', inspected.company],
                          ['Email', inspected.email],
                          ['Phone', inspected.phone],
                          ['Contact notes', inspected.notes],
                          ['Last Updated', formatBusinessDateTime(inspected.updatedAt)],
                        ]
                      : [
                          ['Company', inspected.company],
                          ['Role', inspected.role],
                        ]
                    ).map(([label, value]) => (
                      <div key={label} style={{ padding: '8px 0', overflowWrap: 'anywhere' }}>
                        <dt style={{ color: C.textSub, fontSize: 11 }}>{label}</dt>
                        <dd style={{ margin: 0, whiteSpace: 'pre-wrap' }}>{value || '—'}</dd>
                      </div>
                    ))}
                  </dl>
                  <V4Button onClick={() => onEdit(inspected)}>
                    <FinalGlyphs.SctEdit aria-hidden="true" />
                    Edit contact
                  </V4Button>
                  {onArchive && (
                    <V4Button onClick={() => onArchive(inspected, !inspected.archived)}>
                      <FinalGlyphs.SctArchive aria-hidden="true" />
                      {inspected.archived ? 'Restore contact' : 'Archive contact'}
                    </V4Button>
                  )}
                </>
              ) : (
                <p>No Client Primary contact has been selected.</p>
              )}
              {!selected && relationship}
            </section>
          </div>
        </div>
      </div>
    </ContactContext.Provider>
  );
}
