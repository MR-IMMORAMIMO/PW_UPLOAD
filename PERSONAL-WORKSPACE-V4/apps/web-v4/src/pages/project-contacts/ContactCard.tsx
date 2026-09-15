import { useState } from 'react';
import { SctMore as MoreVertical } from '../../components/common/SctIcons';
import { Check, Copy, Mail, Pencil } from '../../components/common/SctIcons';
import type { ProjectContact } from '@scli/domain';
import { contactInitials } from './contactsViewModel';

interface ContactCardProps {
  contact: ProjectContact;
  onEdit: () => void;
}

/**
 * Compact coordination card. Only renders the email affordance when the
 * canonical record actually carries the data (no dead buttons). The
 * canonical contract has no phone field, so no phone affordance exists.
 */
export function ContactCard({ contact, onEdit }: ContactCardProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const hasEmail = Boolean(contact.email.trim());

  const copyEmail = async () => {
    await navigator.clipboard.writeText(contact.email);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
  };

  return (
    <article className="v4-contacts__card" data-testid="v4-contact-card">
      <div className="v4-contacts__card-person">
        <span className="v4-contacts__avatar" aria-hidden="true">
          {contactInitials(contact.name)}
        </span>
        <div className="v4-contacts__card-identity">
          <h3 className="v4-contacts__card-name">{contact.name}</h3>
          {contact.company.trim() ? (
            <p className="v4-contacts__card-company">{contact.company.trim()}</p>
          ) : null}
          {contact.role.trim() ? (
            <p className="v4-contacts__card-role">{contact.role.trim()}</p>
          ) : null}
        </div>
      </div>
      <div className="v4-contacts__card-contact">
        {hasEmail ? (
          <>
            <a className="v4-contacts__email" href={`mailto:${contact.email}`}>
              <span>{contact.email}</span>
            </a>
            <div
              className="v4-contacts__contact-actions"
              aria-label={`Email actions for ${contact.name}`}
            >
              <button
                type="button"
                aria-label={`Copy email for ${contact.name}`}
                onClick={() => void copyEmail()}
              >
                {copied ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
              </button>
              <a href={`mailto:${contact.email}`} aria-label={`Email ${contact.name}`}>
                <Mail aria-hidden="true" />
              </a>
            </div>
          </>
        ) : null}
      </div>
      <div className="v4-contacts__row-menu">
        <button
          type="button"
          aria-label={`More actions for ${contact.name}`}
          aria-expanded={menuOpen}
          onClick={() => setMenuOpen((current) => !current)}
        >
          <MoreVertical aria-hidden="true" />
        </button>
        {menuOpen ? (
          <div role="menu">
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                setMenuOpen(false);
                onEdit();
              }}
            >
              <Pencil aria-hidden="true" /> Edit Contact
            </button>
          </div>
        ) : null}
      </div>
    </article>
  );
}
