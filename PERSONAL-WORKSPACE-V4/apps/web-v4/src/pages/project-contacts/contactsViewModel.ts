/**
 * Contacts view model — pure, framework-agnostic.
 *
 * Contacts are role-grouped coordination records. The canonical contract has
 * NO role enum: `role` is a free-text field (max 120 chars, default ''), so
 * visible groups are DERIVED from the actual records present in the workspace
 * (never invented). Contacts without a role are presented under an
 * "Unspecified" group so every record stays reachable.
 *
 * Grouping is a PRESENTATION normalization layer only: free-text roles are
 * mapped to the locked reference groups (Client / Consultant / Contractor /
 * Internal Team) and never written back to the database. Sales is NOT a
 * Contact group — the Sales Representative lives on the Project authority
 * (salesOwner* snapshots) and is surfaced only in the Key Relationship card.
 */
import type { ProjectContact } from '@scli/domain';

/** Display label for contacts whose canonical role is empty. */
export const UNSPECIFIED_ROLE_LABEL = 'Unspecified';

/** Locked reference group order. Sales is intentionally absent (see header). */
const REFERENCE_ROLE_ORDER = ['Client', 'Consultant', 'Contractor', 'Internal Team'];

/**
 * Free-text role → locked group normalization (case-insensitive, exact alias
 * match). Unknown roles keep their own trimmed label so real records stay
 * reachable; only the locked aliases collapse into the reference groups.
 */
const ROLE_GROUP_ALIASES: Record<string, string> = {
  'internal team': 'Internal Team',
  'lighting designer': 'Internal Team',
};

/** Normalize a free-text role to its locked presentation group ('' stays ''). */
export function normalizeRoleGroup(role: string): string {
  const trimmed = role.trim();
  if (!trimmed) return '';
  return ROLE_GROUP_ALIASES[trimmed.toLowerCase()] ?? trimmed;
}

/** Canonical role value -> stable display label ('' is the only rewrite). */
export function roleLabel(role: string): string {
  return normalizeRoleGroup(role) || UNSPECIFIED_ROLE_LABEL;
}

export interface ContactRoleGroup {
  /** Canonical role value ('' for the Unspecified group). */
  role: string;
  /** Display label for the section title and role filter. */
  label: string;
  contacts: ProjectContact[];
}

/**
 * Group contacts by their canonical role, sorted by display label so the
 * section order is deterministic. Counts are real record counts.
 */
export function groupContactsByRole(contacts: readonly ProjectContact[]): ContactRoleGroup[] {
  const byRole = new Map<string, ProjectContact[]>();
  for (const contact of contacts) {
    const label = roleLabel(contact.role);
    const list = byRole.get(label) ?? [];
    list.push(contact);
    byRole.set(label, list);
  }
  return [...byRole.entries()]
    .map(([label, items]) => ({
      role: label === UNSPECIFIED_ROLE_LABEL ? '' : label,
      label,
      contacts: [...items].sort((a, b) =>
        a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }),
      ),
    }))
    .sort((a, b) => {
      const aIndex = REFERENCE_ROLE_ORDER.indexOf(a.label);
      const bIndex = REFERENCE_ROLE_ORDER.indexOf(b.label);
      if (aIndex >= 0 || bIndex >= 0) {
        if (aIndex < 0) return 1;
        if (bIndex < 0) return -1;
        return aIndex - bIndex;
      }
      return a.label.localeCompare(b.label, undefined, { sensitivity: 'base' });
    });
}

export interface ContactFilters {
  query: string;
  /** Role display label; '' means All roles. */
  role: string;
}

/**
 * Lightweight search across every searchable text field the canonical
 * contract actually has: name, role, company, email. (There is no phone
 * field in the contract, so none is searched or displayed.)
 */
export function filterContacts(
  contacts: readonly ProjectContact[],
  filters: ContactFilters,
): ProjectContact[] {
  const query = filters.query.trim().toLowerCase();
  return contacts.filter((contact) => {
    if (filters.role && roleLabel(contact.role) !== filters.role) return false;
    if (!query) return true;
    return [contact.name, contact.role, contact.company, contact.email].some((value) =>
      value.toLowerCase().includes(query),
    );
  });
}

/** Distinct role options for the filter: All + every role present in data. */
export function roleOptions(
  contacts: readonly ProjectContact[],
): { value: string; label: string }[] {
  const labels = [...new Set(contacts.map((contact) => roleLabel(contact.role)))].sort((a, b) =>
    a.localeCompare(b, undefined, { sensitivity: 'base' }),
  );
  return [{ value: '', label: 'All roles' }, ...labels.map((label) => ({ value: label, label }))];
}

/** Avatar initials from a contact name (max two parts, uppercase). */
export function contactInitials(name: string): string {
  return (
    name
      .split(/\s+/)
      .filter(Boolean)
      .map((part) => part[0])
      .join('')
      .slice(0, 2)
      .toUpperCase() || '?'
  );
}

/** Stable CSS identity for role-local presentation; never persisted. */
export function roleSlug(role: string): string {
  return (
    role
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '') || 'unspecified'
  );
}
