import { useState } from 'react';
import type { ProjectContact } from '@scli/domain';
import { V4FilterSelect } from '../../components/common/V4FilterSelect';
import { ContactDrawer, type ContactDraft } from './ContactDrawer';

export function ProjectContactPicker({
  contacts,
  onSelect,
  onCreate,
}: {
  contacts: readonly ProjectContact[];
  onSelect: (contact: ProjectContact) => void;
  onCreate?: ((draft: ContactDraft) => Promise<ProjectContact>) | undefined;
}) {
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState('');
  const [adding, setAdding] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const available = contacts.filter(
    (contact) =>
      !contact.archived &&
      `${contact.name} ${contact.company} ${contact.role}`
        .toLowerCase()
        .includes(query.toLowerCase()),
  );
  return (
    <div>
      <label>
        Find contact
        <input type="search" value={query} onChange={(event) => setQuery(event.target.value)} />
      </label>
      <V4FilterSelect
        label="Project contact"
        value={selected}
        options={[
          { value: '', label: 'Choose contact' },
          ...available.map((contact) => ({
            value: contact.id,
            label: contact.name + (contact.role ? ` · ${contact.role}` : ''),
          })),
        ]}
        onChange={(id) => {
          setSelected(id);
          const contact = available.find((item) => item.id === id);
          if (contact) onSelect(contact);
        }}
      />
      {onCreate && (
        <button type="button" onClick={() => setAdding(true)}>
          Add contact
        </button>
      )}
      {adding && onCreate && (
        <ContactDrawer
          open
          contact={null}
          contacts={contacts}
          initialGroup="Client"
          pending={pending}
          error={error}
          onClose={() => setAdding(false)}
          onSave={async (draft) => {
            setPending(true);
            setError(null);
            try {
              const contact = await onCreate(draft);
              setSelected(contact.id);
              onSelect(contact);
              setAdding(false);
              return true;
            } catch (error) {
              setError(error instanceof Error ? error.message : 'Could not save contact.');
              return false;
            } finally {
              setPending(false);
            }
          }}
        />
      )}
    </div>
  );
}
