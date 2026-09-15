import { describe, expect, it } from 'vitest';
import type { MeetingListItem, ProjectMeeting } from '@scli/domain';
import {
  dubaiDateTimeToUtc,
  filterMeetings,
  meetingRelativeDay,
  meetingUpdateInput,
  meetingsForTab,
  utcToDubaiForm,
} from './meetingsViewModel';

const meeting = (
  id: string,
  startAt: string,
  endAt: string,
  status: ProjectMeeting['status'] = 'Planned',
): MeetingListItem => ({
  id,
  projectId: 'p',
  title: id,
  purpose: 'Review',
  startAt,
  endAt,
  location: 'Teams',
  attendees: ['legacy'],
  agenda: 'legacy agenda',
  notes: 'legacy notes',
  decisions: 'Decision',
  onlineMeetingUrl: '',
  externalEventId: 'event',
  status,
  createdAt: startAt,
  updatedAt: startAt,
  participantsCount: 0,
  participantPreview: [],
  notesCount: 0,
  latestNoteSummary: null,
  linkedActionsCount: 0,
  actionsCreatedCount: 0,
});

describe('meetingsViewModel', () => {
  it('derives upcoming and past truthfully by end time', () => {
    const now = new Date('2025-09-27T08:00:00.000Z');
    const future = meeting('future', '2025-09-28T06:00:00.000Z', '2025-09-28T07:00:00.000Z');
    const elapsed = meeting('elapsed', '2025-09-26T06:00:00.000Z', '2025-09-26T07:00:00.000Z');
    expect(meetingsForTab([elapsed, future], 'upcoming', now).map((item) => item.id)).toEqual([
      'future',
    ]);
    expect(meetingsForTab([future, elapsed], 'past', now).map((item) => item.id)).toEqual([
      'elapsed',
    ]);
    expect(
      filterMeetings([future], { query: 'review', status: 'Planned', location: 'Teams' }),
    ).toEqual([future]);
  });
  it('uses explicit Dubai wall-clock conversion across a UTC boundary', () => {
    expect(dubaiDateTimeToUtc('2025-09-29', '00:30')).toBe('2025-09-28T20:30:00.000Z');
    expect(utcToDubaiForm('2025-09-28T20:30:00.000Z')).toEqual({
      date: '2025-09-29',
      time: '00:30',
    });
    expect(
      meetingRelativeDay('2025-09-29T06:00:00.000Z', new Date('2025-09-27T20:00:00.000Z')),
    ).toBe('Tomorrow');
  });
  it('preserves complete legacy base authority on safe updates', () => {
    const base = meeting('m1', '2025-09-29T06:00:00.000Z', '2025-09-29T07:00:00.000Z');
    const input = meetingUpdateInput(base, { title: 'Changed' });
    expect(input).toMatchObject({
      title: 'Changed',
      attendees: ['legacy'],
      agenda: 'legacy agenda',
      notes: 'legacy notes',
      externalEventId: 'event',
      purpose: 'Review',
      decisions: 'Decision',
      location: 'Teams',
    });
  });
});
