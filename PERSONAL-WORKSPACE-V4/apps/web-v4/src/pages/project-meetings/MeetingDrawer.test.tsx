/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import type { MeetingDetail } from '@scli/domain';
import { cleanupV4 } from '../../test-utils/renderV4';
import { MeetingDrawer } from './MeetingDrawer';

const timestamp = '2099-09-29T06:00:00.000Z';
const meeting: MeetingDetail = {
  id: 'm1',
  projectId: 'p1',
  title: 'Technical Coordination',
  purpose: 'Review layout',
  startAt: timestamp,
  endAt: '2099-09-29T07:00:00.000Z',
  location: 'Microsoft Teams',
  attendees: ['legacy attendee'],
  agenda: 'legacy agenda',
  notes: 'legacy notes',
  decisions: 'Keep the agreed layout',
  onlineMeetingUrl: 'https://example.com/meeting',
  externalEventId: 'event-1',
  status: 'Planned',
  createdAt: timestamp,
  updatedAt: timestamp,
  participants: [
    {
      id: 'participant-1',
      meetingId: 'm1',
      name: 'First Participant',
      role: 'Designer',
      sortOrder: 0,
      createdAt: timestamp,
      updatedAt: timestamp,
    },
    {
      id: 'participant-2',
      meetingId: 'm1',
      name: 'Second Participant',
      role: 'Manager',
      sortOrder: 1,
      createdAt: timestamp,
      updatedAt: timestamp,
    },
  ],
  agendaItems: [
    {
      id: 'agenda-1',
      meetingId: 'm1',
      content: 'First agenda item',
      sortOrder: 0,
      createdAt: timestamp,
      updatedAt: timestamp,
    },
    {
      id: 'agenda-2',
      meetingId: 'm1',
      content: 'Second agenda item',
      sortOrder: 1,
      createdAt: timestamp,
      updatedAt: timestamp,
    },
  ],
  notesCount: 0,
  latestNote: null,
  linkedActions: [],
  actionsCreatedCount: 0,
};

afterEach(cleanupV4);

describe('MeetingDrawer complex editor', () => {
  it('edits only the agenda while retaining meeting and participant values', () => {
    const onSave = vi.fn();
    render(
      <MeetingDrawer
        meeting={meeting}
        scope="agenda"
        saving={false}
        error={null}
        onClose={() => undefined}
        onSave={onSave}
      />,
    );
    expect(screen.queryByLabelText('Title')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Participant 1 name')).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Agenda item 1'), {
      target: { value: 'Updated agenda' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({
        title: meeting.title,
        decisions: meeting.decisions,
        participants: expect.arrayContaining([expect.objectContaining({ id: 'participant-1' })]),
        agendaItems: expect.arrayContaining([
          expect.objectContaining({ id: 'agenda-1', content: 'Updated agenda' }),
        ]),
      }),
    );
  });
  it('guards dirty close and calculates a next-day end without completing a meeting', () => {
    const onClose = vi.fn();
    const onSave = vi.fn();
    render(
      <MeetingDrawer
        meeting={meeting}
        saving={false}
        error={null}
        onClose={onClose}
        onSave={onSave}
      />,
    );
    fireEvent.change(screen.getByLabelText('Start Time'), { target: { value: '23:30' } });
    expect(screen.getByText(/Ends at 00:30 on the next day/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Continue editing' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'Planned', endAt: '2099-09-29T20:30:00.000Z' }),
    );
  });
  it('uses the large editor variant with a fixed external footer', () => {
    render(
      <MeetingDrawer
        meeting={meeting}
        saving={false}
        error={null}
        onClose={() => undefined}
        onSave={() => undefined}
      />,
    );
    const dialog = screen.getByRole('dialog', { name: 'Edit Meeting' });
    expect(dialog).toHaveClass('v4-meetings__editor');
    const footer = dialog.querySelector('footer');
    expect(footer).toContainElement(screen.getByRole('button', { name: 'Save changes' }));
    expect(dialog.querySelector('form')).not.toContainElement(
      screen.getByRole('button', { name: 'Save changes' }),
    );
  });

  it('keeps icon participant and agenda controls functional while preserving stable IDs', () => {
    const onSave = vi.fn();
    render(
      <MeetingDrawer
        meeting={meeting}
        saving={false}
        error={null}
        onClose={() => undefined}
        onSave={onSave}
      />,
    );

    expect(screen.getAllByRole('button', { name: 'Move participant down' })[0]).toBeEnabled();
    fireEvent.click(screen.getAllByRole('button', { name: 'Move participant down' })[0]!);
    fireEvent.click(screen.getAllByRole('button', { name: 'Move agenda item down' })[0]!);
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));

    expect(onSave).toHaveBeenCalledOnce();
    expect(onSave.mock.calls[0]?.[0]).toMatchObject({
      attendees: ['legacy attendee'],
      agenda: 'legacy agenda',
      notes: 'legacy notes',
      externalEventId: 'event-1',
      participants: [
        { id: 'participant-2', sortOrder: 0 },
        { id: 'participant-1', sortOrder: 1 },
      ],
      agendaItems: [
        { id: 'agenda-2', sortOrder: 0 },
        { id: 'agenda-1', sortOrder: 1 },
      ],
    });
  });

  it('removes structured rows through compact accessible icon actions', () => {
    render(
      <MeetingDrawer
        meeting={meeting}
        saving={false}
        error={null}
        onClose={() => undefined}
        onSave={() => undefined}
      />,
    );
    fireEvent.click(screen.getAllByRole('button', { name: 'Remove participant' })[0]!);
    fireEvent.click(screen.getAllByRole('button', { name: 'Remove agenda item' })[0]!);
    expect(screen.queryByDisplayValue('First Participant')).not.toBeInTheDocument();
    expect(screen.queryByDisplayValue('First agenda item')).not.toBeInTheDocument();
  });
});
