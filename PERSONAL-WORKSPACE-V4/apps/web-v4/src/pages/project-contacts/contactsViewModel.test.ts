import { describe, expect, it } from 'vitest';
import type { ProjectContact } from '@scli/domain';
import {
  contactInitials,
  filterContacts,
  groupContactsByRole,
  normalizeRoleGroup,
  roleOptions,
  roleSlug,
} from './contactsViewModel';

const contact = (
  id: string,
  role: string,
  overrides: Partial<ProjectContact> = {},
): ProjectContact => ({
  id,
  projectId: 'p1',
  name: `Contact ${id}`,
  email: `${id}@example.test`,
  company: 'SCLI',
  role,
  createdAt: '2026-08-16T00:00:00.000Z',
  updatedAt: '2026-08-16T00:00:00.000Z',
  ...overrides,
});

describe('contactsViewModel', () => {
  it('uses the locked reference order, keeps other real roles, and sorts contacts by name', () => {
    const groups = groupContactsByRole([
      contact('vendor', 'Vendor'),
      contact('internal', 'Internal Team'),
      contact('client-z', 'Client', { name: 'Zara' }),
      contact('consultant', 'Consultant'),
      contact('client-a', 'Client', { name: 'Aisha' }),
      contact('contractor', 'Contractor'),
      contact('sales', 'Sales'),
    ]);

    expect(groups.map((group) => group.label)).toEqual([
      'Client',
      'Consultant',
      'Contractor',
      'Internal Team',
      'Sales',
      'Vendor',
    ]);
    expect(groups[0]?.contacts.map((item) => item.name)).toEqual(['Aisha', 'Zara']);
  });

  it('normalizes free-text roles into the locked groups without persisting them', () => {
    const groups = groupContactsByRole([
      contact('designer', 'Lighting Designer'),
      contact('team', 'internal team'),
      contact('client', 'Client'),
    ]);

    expect(groups.map((group) => group.label)).toEqual(['Client', 'Internal Team']);
    expect(groups[1]?.contacts.map((item) => item.name)).toEqual([
      'Contact designer',
      'Contact team',
    ]);
    expect(normalizeRoleGroup('Lighting Designer')).toBe('Internal Team');
    expect(normalizeRoleGroup('internal team')).toBe('Internal Team');
    expect(normalizeRoleGroup('Client')).toBe('Client');
    expect(normalizeRoleGroup('')).toBe('');
  });

  it('searches every canonical searchable field and filters by real role', () => {
    const contacts = [
      contact('a', 'Client', { name: 'Aisha Rahman', company: 'Boutique Hotel' }),
      contact('b', 'Consultant', { email: 'lina@farouk.test' }),
    ];

    expect(filterContacts(contacts, { query: 'boutique', role: '' })).toHaveLength(1);
    expect(filterContacts(contacts, { query: 'lina@', role: 'Consultant' })).toHaveLength(1);
    expect(filterContacts(contacts, { query: 'aisha', role: 'Consultant' })).toHaveLength(0);
    expect(roleOptions(contacts)).toEqual([
      { value: '', label: 'All roles' },
      { value: 'Client', label: 'Client' },
      { value: 'Consultant', label: 'Consultant' },
    ]);
  });

  it('creates presentation-only initials and safe role slugs', () => {
    expect(contactInitials('Aisha Noor Rahman')).toBe('AN');
    expect(roleSlug('Internal Team')).toBe('internal-team');
    expect(roleSlug('')).toBe('unspecified');
  });
});
