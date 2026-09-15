import { V4Button } from '../../components/common/V4Button';
import { V4ConfirmDialog } from '../../components/common/V4ConfirmDialog';
import { SctSave, SctMeetings, SctContacts, SctProjects } from '../../components/common/SctIcons';
import { V4DateInput } from '../../components/common/V4DateInput';
import { useRef, useState, type FormEvent } from 'react';
import { SctCollapse as ArrowDown, SctExpand as ArrowUp } from '../../components/common/SctIcons';
import { Plus, Trash2 } from '../../components/common/SctIcons';
import type { MeetingDetail, ProjectMeeting, ProjectContact } from '@scli/domain';
import type { ProjectMeetingInput } from '@scli/contracts';
import { V4Drawer } from '../../components/common/V4Drawer';
import { V4FilterSelect } from '../../components/common/V4FilterSelect';
import { ContactDrawer, type ContactDraft } from '../project-contacts/ContactDrawer';
import {
  dubaiDateTimeToUtc,
  meetingDuration,
  meetingUpdateInput,
  utcToDubaiForm,
} from './meetingsViewModel';

type ParticipantDraft = { id?: string; key: string; name: string; role: string };
type AgendaDraft = { id?: string; key: string; content: string };
type Draft = {
  title: string;
  date: string;
  time: string;
  duration: number;
  status: ProjectMeeting['status'];
  location: string;
  onlineMeetingUrl: string;
  purpose: string;
  decisions: string;
  participants: ParticipantDraft[];
  agendaItems: AgendaDraft[];
};
const localId = () => crypto.randomUUID();
function meetingTimes(date: string, time: string, duration: number) {
  if (!date || !time || !Number.isFinite(duration) || duration <= 0) return null;
  try {
    const startAt = dubaiDateTimeToUtc(date, time);
    const endAt = new Date(Date.parse(startAt) + duration * 60_000).toISOString();
    return { startAt, endAt };
  } catch {
    return null;
  }
}
function draftFor(meeting: MeetingDetail | null): Draft {
  const start = utcToDubaiForm(meeting?.startAt ?? new Date().toISOString());
  return {
    title: meeting?.title ?? '',
    date: start.date,
    time: start.time,
    duration: meeting ? meetingDuration(meeting) : 60,
    status: meeting?.status ?? 'Planned',
    location: meeting?.location ?? '',
    onlineMeetingUrl: meeting?.onlineMeetingUrl ?? '',
    purpose: meeting?.purpose ?? '',
    decisions: meeting?.decisions ?? '',
    participants:
      meeting?.participants.map(({ id, name, role }) => ({ id, key: id, name, role })) ?? [],
    agendaItems: meeting?.agendaItems.map(({ id, content }) => ({ id, key: id, content })) ?? [],
  };
}
function ordered<T>(items: T[]) {
  return items.map((item, sortOrder) => ({ ...item, sortOrder }));
}

export function MeetingDrawer({
  meeting,
  saving,
  error,
  onClose,
  onSave,
  contacts = [],
  onCreateContact,
  scope = 'full',
}: {
  meeting: MeetingDetail | null;
  saving: boolean;
  error: string | null;
  onClose: () => void;
  onSave: (input: ProjectMeetingInput) => void;
  contacts?: readonly ProjectContact[];
  onCreateContact?: (draft: ContactDraft) => Promise<ProjectContact>;
  scope?: 'full' | 'agenda' | 'outcome';
}) {
  const [draft, setDraft] = useState(() => draftFor(meeting));
  const baseline = useRef(JSON.stringify(draft));
  const [discarding, setDiscarding] = useState(false);
  const [addingContact, setAddingContact] = useState(false);
  const [contactPending, setContactPending] = useState(false);
  const [contactError, setContactError] = useState<string | null>(null);
  const [contactSearch, setContactSearch] = useState('');
  const [participantPickerOpen, setParticipantPickerOpen] = useState(false);
  const close = () => {
    if (!saving) {
      if (baseline.current !== JSON.stringify(draft)) setDiscarding(true);
      else onClose();
    }
  };
  const times = meetingTimes(draft.date, draft.time, draft.duration);
  const valid = Boolean(
    draft.title.trim() &&
    times &&
    draft.participants.every((item) => item.name.trim()) &&
    draft.agendaItems.every((item) => item.content.trim()),
  );
  const endPreview = times ? utcToDubaiForm(times.endAt) : null;
  const daysLater = endPreview
    ? Math.round((Date.parse(endPreview.date) - Date.parse(draft.date)) / 86_400_000)
    : 0;
  const endDateLabel = endPreview
    ? new Intl.DateTimeFormat('en-GB', {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
        timeZone: 'UTC',
      }).format(new Date(endPreview.date))
    : '';
  const participantMatches = (contact: ProjectContact, participant: ParticipantDraft) =>
    contact.name.trim().toLocaleLowerCase() === participant.name.trim().toLocaleLowerCase() &&
    contact.role.trim().toLocaleLowerCase() === participant.role.trim().toLocaleLowerCase();
  const addContact = (contact: ProjectContact) =>
    setDraft((current) =>
      current.participants.some((participant) => participantMatches(contact, participant))
        ? current
        : {
            ...current,
            participants: [
              ...current.participants,
              { key: localId(), name: contact.name, role: contact.role },
            ],
          },
    );
  const change = <K extends keyof Draft>(key: K, value: Draft[K]) =>
    setDraft((current) => ({ ...current, [key]: value }));
  const move = <T,>(items: T[], index: number, delta: number) => {
    const copy = [...items];
    const target = index + delta;
    const current = copy[index]!;
    copy[index] = copy[target]!;
    copy[target] = current;
    return copy;
  };
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!valid || !times || saving) return;
    if (
      !draft.title.trim() ||
      !draft.date ||
      !draft.time ||
      draft.duration <= 0 ||
      draft.participants.some((item) => !item.name.trim()) ||
      draft.agendaItems.some((item) => !item.content.trim())
    )
      return;
    const startAt = times.startAt;
    const values = {
      title: draft.title.trim(),
      startAt,
      endAt: times.endAt,
      status: draft.status,
      location: draft.location.trim(),
      onlineMeetingUrl: draft.onlineMeetingUrl.trim(),
      purpose: draft.purpose.trim(),
      decisions: draft.decisions.trim(),
      participants: ordered(
        draft.participants.map((item) => ({
          ...(item.id ? { id: item.id } : {}),
          name: item.name.trim(),
          role: item.role.trim(),
        })),
      ),
      agendaItems: ordered(
        draft.agendaItems.map((item) => ({
          ...(item.id ? { id: item.id } : {}),
          content: item.content.trim(),
        })),
      ),
    };
    onSave(
      meeting
        ? meetingUpdateInput(meeting, values)
        : { ...values, attendees: [], agenda: '', notes: '', externalEventId: null },
    );
  };
  return (
    <V4Drawer
      presentation="float"
      open
      title={
        scope === 'agenda'
          ? 'Edit Meeting Agenda'
          : scope === 'outcome'
            ? 'Edit Meeting Outcome'
            : meeting
              ? 'Edit Meeting'
              : 'Add Meeting'
      }
      onClose={close}
      className={`v4-meetings__editor${scope !== 'full' ? ' v4-meetings__editor--small' : ''}`}
      footer={
        <div className="v4-meetings__drawer-footer">
          <button type="button" disabled={saving} onClick={close}>
            Cancel
          </button>
          <button
            className="v4-meetings__primary"
            type="submit"
            form="v4-meeting-editor-form"
            disabled={saving || !valid}
          >
            {meeting ? <SctSave /> : <Plus />} {meeting ? 'Save changes' : 'Add Meeting'}
          </button>
        </div>
      }
    >
      <V4ConfirmDialog
        open={discarding}
        title="Unsaved meeting changes"
        description="Save your changes before closing?"
        cancelLabel="Continue editing"
        confirmLabel="Discard changes"
        destructive
        pending={saving}
        onCancel={() => setDiscarding(false)}
        onConfirm={onClose}
        additionalAction={
          <V4Button
            variant="primary"
            type="submit"
            form="v4-meeting-editor-form"
            disabled={saving || !valid}
          >
            <SctSave />
            Save changes
          </V4Button>
        }
      />
      <form id="v4-meeting-editor-form" className="v4-meetings__form" onSubmit={submit}>
        {scope === 'full' && (
          <>
            <label>
              Title{' '}
              <input
                required
                maxLength={300}
                value={draft.title}
                onChange={(event) => change('title', event.target.value)}
              />
            </label>
            <div className="v4-meetings__form-grid">
              <label>
                Date{' '}
                <V4DateInput
                  required
                  type="date"
                  value={draft.date}
                  onChange={(event) => change('date', event.target.value)}
                />
              </label>
              <label>
                Start Time{' '}
                <input
                  required
                  type="time"
                  value={draft.time}
                  onChange={(event) => change('time', event.target.value)}
                />
              </label>
              <label>
                Duration (minutes){' '}
                <input
                  required
                  min={1}
                  type="number"
                  value={draft.duration}
                  onChange={(event) => change('duration', Number(event.target.value))}
                />
              </label>
            </div>
            <p aria-live="polite">
              {endPreview
                ? `Ends at ${endPreview.time}${daysLater === 1 ? ' on the next day (' + endDateLabel + ')' : daysLater > 1 ? ' on ' + endDateLabel : ''}`
                : 'Enter a start time and a positive duration to calculate the end.'}
            </p>
            <V4FilterSelect
              searchable
              label="Meeting platform"
              value={
                ['Microsoft Teams', 'Zoom', 'Google Meet', 'Office', 'Site'].includes(
                  draft.location,
                )
                  ? draft.location
                  : 'custom'
              }
              options={[
                { value: 'custom', label: 'Custom location' },
                ...['Microsoft Teams', 'Zoom', 'Google Meet', 'Office', 'Site'].map((value) => ({
                  value,
                  label: value,
                  icon: ['Office', 'Site'].includes(value) ? <SctProjects /> : <SctMeetings />,
                })),
              ]}
              onChange={(value) => change('location', value === 'custom' ? '' : value)}
            />
            <div className="v4-meetings__form-grid v4-meetings__form-grid--details">
              <label>
                Status{' '}
                <select
                  value={draft.status}
                  onChange={(event) =>
                    change('status', event.target.value as ProjectMeeting['status'])
                  }
                >
                  {['Planned', 'Held', 'Cancelled'].map((value) => (
                    <option key={value}>{value}</option>
                  ))}
                </select>
              </label>
              {!['Microsoft Teams', 'Zoom', 'Google Meet'].includes(draft.location) && (
                <label>
                  Location / Platform{' '}
                  <input
                    maxLength={300}
                    value={draft.location}
                    onChange={(event) => change('location', event.target.value)}
                  />
                </label>
              )}
              {(['Microsoft Teams', 'Zoom', 'Google Meet'].includes(draft.location) ||
                Boolean(draft.onlineMeetingUrl)) && (
                <label className="v4-meetings__url-field">
                  Online Meeting URL{' '}
                  <input
                    type="url"
                    maxLength={2000}
                    value={draft.onlineMeetingUrl}
                    onChange={(event) => change('onlineMeetingUrl', event.target.value)}
                  />
                </label>
              )}
            </div>
            <div className="v4-meetings__form-grid v4-meetings__form-grid--narrative">
              <label>
                Purpose{' '}
                <textarea
                  value={draft.purpose}
                  onChange={(event) => change('purpose', event.target.value)}
                />
              </label>
              <label>
                Outcome{' '}
                <textarea
                  value={draft.decisions}
                  onChange={(event) => change('decisions', event.target.value)}
                />
              </label>
            </div>
            <fieldset>
              <legend>Participants</legend>
              {participantPickerOpen && (
                <>
                  {' '}
                  <label>
                    Find project contacts
                    <input
                      type="search"
                      value={contactSearch}
                      onChange={(event) => setContactSearch(event.target.value)}
                    />
                  </label>
                  <div className="v4-meetings__contact-picker">
                    {contacts
                      .filter(
                        (contact) =>
                          !contact.archived &&
                          `${contact.name} ${contact.role} ${contact.company}`
                            .toLocaleLowerCase()
                            .includes(contactSearch.toLocaleLowerCase()),
                      )
                      .map((contact) => (
                        <label key={contact.id}>
                          <input
                            type="checkbox"
                            checked={draft.participants.some((participant) =>
                              participantMatches(contact, participant),
                            )}
                            onChange={(event) =>
                              event.target.checked
                                ? addContact(contact)
                                : change(
                                    'participants',
                                    draft.participants.filter(
                                      (participant) => !participantMatches(contact, participant),
                                    ),
                                  )
                            }
                          />
                          {contact.name}
                          {contact.role ? ` · ${contact.role}` : ''}
                        </label>
                      ))}
                  </div>
                  {onCreateContact && (
                    <button type="button" onClick={() => setAddingContact(true)}>
                      <SctContacts /> Add project contact
                    </button>
                  )}
                  <V4Button type="button" onClick={() => setParticipantPickerOpen(false)}>
                    Done selecting
                  </V4Button>
                </>
              )}
              {draft.participants.map((item, index) => (
                <div className="v4-meetings__draft-row v4-meetings__participant-row" key={item.key}>
                  <input
                    aria-label={`Participant ${index + 1} name`}
                    placeholder="Name"
                    value={item.name}
                    readOnly
                  />
                  <input
                    aria-label={`Participant ${index + 1} role`}
                    placeholder="Role"
                    value={item.role}
                    readOnly
                  />
                  <button
                    type="button"
                    aria-label="Move participant up"
                    disabled={!index}
                    onClick={() => change('participants', move(draft.participants, index, -1))}
                  >
                    <ArrowUp aria-hidden="true" />
                  </button>
                  <button
                    type="button"
                    aria-label="Move participant down"
                    disabled={index === draft.participants.length - 1}
                    onClick={() => change('participants', move(draft.participants, index, 1))}
                  >
                    <ArrowDown aria-hidden="true" />
                  </button>
                  <button
                    type="button"
                    aria-label="Remove participant"
                    onClick={() =>
                      change(
                        'participants',
                        draft.participants.filter((_, position) => position !== index),
                      )
                    }
                  >
                    <Trash2 aria-hidden="true" />
                  </button>
                </div>
              ))}
              <button type="button" onClick={() => setParticipantPickerOpen(true)}>
                <Plus aria-hidden="true" /> Add Participant
              </button>
            </fieldset>
          </>
        )}
        {scope === 'outcome' && (
          <label>
            Outcome
            <textarea
              value={draft.decisions}
              onChange={(event) => change('decisions', event.target.value)}
            />
          </label>
        )}
        {scope !== 'outcome' && (
          <fieldset>
            <legend>Agenda</legend>
            {draft.agendaItems.map((item, index) => (
              <div className="v4-meetings__draft-row v4-meetings__agenda-row" key={item.key}>
                <span>{index + 1}.</span>
                <input
                  aria-label={`Agenda item ${index + 1}`}
                  value={item.content}
                  onChange={(event) =>
                    change(
                      'agendaItems',
                      draft.agendaItems.map((candidate, position) =>
                        position === index
                          ? { ...candidate, content: event.target.value }
                          : candidate,
                      ),
                    )
                  }
                />
                <button
                  type="button"
                  aria-label="Move agenda item up"
                  disabled={!index}
                  onClick={() => change('agendaItems', move(draft.agendaItems, index, -1))}
                >
                  <ArrowUp aria-hidden="true" />
                </button>
                <button
                  type="button"
                  aria-label="Move agenda item down"
                  disabled={index === draft.agendaItems.length - 1}
                  onClick={() => change('agendaItems', move(draft.agendaItems, index, 1))}
                >
                  <ArrowDown aria-hidden="true" />
                </button>
                <button
                  type="button"
                  aria-label="Remove agenda item"
                  onClick={() =>
                    change(
                      'agendaItems',
                      draft.agendaItems.filter((_, position) => position !== index),
                    )
                  }
                >
                  <Trash2 aria-hidden="true" />
                </button>
              </div>
            ))}
            <button
              type="button"
              onClick={() =>
                change('agendaItems', [...draft.agendaItems, { key: localId(), content: '' }])
              }
            >
              <Plus aria-hidden="true" /> Add agenda item
            </button>
          </fieldset>
        )}
        {error ? (
          <p role="alert" className="v4-meetings__error">
            {error}
          </p>
        ) : null}
      </form>
      {addingContact && onCreateContact && (
        <ContactDrawer
          open
          contact={null}
          contacts={contacts}
          pending={contactPending}
          error={contactError}
          onClose={() => setAddingContact(false)}
          onSave={async (input) => {
            setContactPending(true);
            setContactError(null);
            try {
              const contact = await onCreateContact(input);
              addContact(contact);
              setAddingContact(false);
              return true;
            } catch (error) {
              setContactError(
                error instanceof Error ? error.message : 'Could not save the contact.',
              );
              return false;
            } finally {
              setContactPending(false);
            }
          }}
        />
      )}
    </V4Drawer>
  );
}
