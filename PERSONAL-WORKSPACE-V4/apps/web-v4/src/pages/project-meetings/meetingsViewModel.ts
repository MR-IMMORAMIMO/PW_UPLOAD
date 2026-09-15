import type { MeetingListItem, ProjectMeeting } from '@scli/domain';
import { MEETING_TIME_ZONE, meetingCalendarDay } from '@scli/domain';
import type { ProjectMeetingInput } from '@scli/contracts';

export { MEETING_TIME_ZONE };

const parts = (value: string, options: Intl.DateTimeFormatOptions) =>
  new Intl.DateTimeFormat('en-US', { timeZone: MEETING_TIME_ZONE, ...options }).format(
    new Date(value),
  );

export function meetingDateParts(value: string) {
  return {
    month: parts(value, { month: 'short' }).toUpperCase(),
    day: parts(value, { day: '2-digit' }),
    weekday: parts(value, { weekday: 'short' }).toUpperCase(),
  };
}
export const meetingTime = (value: string) =>
  parts(value, { hour: 'numeric', minute: '2-digit', hour12: true });
export const meetingDuration = (meeting: Pick<ProjectMeeting, 'startAt' | 'endAt'>) =>
  Math.round((Date.parse(meeting.endAt) - Date.parse(meeting.startAt)) / 60000);
export const meetingTimeRange = (meeting: Pick<ProjectMeeting, 'startAt' | 'endAt'>) =>
  `${meetingTime(meeting.startAt)} – ${meetingTime(meeting.endAt)} (${meetingDuration(meeting)} min)`;

export function meetingRelativeDay(value: string, now = new Date()) {
  const day = Date.parse(meetingCalendarDay(value));
  const today = Date.parse(meetingCalendarDay(now));
  const difference = Math.round((day - today) / 86_400_000);
  if (difference === 0) return 'Today';
  if (difference === 1) return 'Tomorrow';
  if (difference > 1) return `in ${difference} days`;
  if (difference === -1) return 'Yesterday';
  return `${Math.abs(difference)} days ago`;
}

export type MeetingTab = 'upcoming' | 'past' | 'all';
export type MeetingFilters = { query: string; status: string; location: string };
const compareAsc = (a: MeetingListItem, b: MeetingListItem) =>
  Date.parse(a.startAt) - Date.parse(b.startAt);
const compareDesc = (a: MeetingListItem, b: MeetingListItem) => compareAsc(b, a);

export function meetingsForTab(
  items: readonly MeetingListItem[],
  tab: MeetingTab,
  now = new Date(),
) {
  const current = now.getTime();
  if (tab === 'upcoming')
    return items
      .filter((item) => item.status === 'Planned' && Date.parse(item.endAt) >= current)
      .sort(compareAsc);
  if (tab === 'past')
    return items
      .filter((item) => item.status !== 'Cancelled' && Date.parse(item.endAt) < current)
      .sort(compareDesc);
  return [...items].sort(compareDesc);
}
export function filterMeetings(items: readonly MeetingListItem[], filters: MeetingFilters) {
  const needle = filters.query.trim().toLocaleLowerCase();
  return items.filter((item) => {
    const text = [item.title, item.purpose, item.decisions, item.location]
      .join(' ')
      .toLocaleLowerCase();
    return (
      (!needle || text.includes(needle)) &&
      (!filters.status || item.status === filters.status) &&
      (!filters.location || item.location === filters.location)
    );
  });
}

/** Builds the only safe base Meeting update payload: hidden legacy fields remain untouched. */
export function meetingUpdateInput(
  meeting: ProjectMeeting,
  overrides: Partial<ProjectMeetingInput>,
): ProjectMeetingInput {
  return {
    title: meeting.title,
    purpose: meeting.purpose,
    startAt: meeting.startAt,
    endAt: meeting.endAt,
    location: meeting.location,
    attendees: meeting.attendees,
    agenda: meeting.agenda,
    notes: meeting.notes,
    decisions: meeting.decisions,
    onlineMeetingUrl: meeting.onlineMeetingUrl,
    externalEventId: meeting.externalEventId,
    status: meeting.status,
    ...overrides,
  };
}

/** Converts an Asia/Dubai wall-clock form value independently of the device timezone. */
export function dubaiDateTimeToUtc(date: string, time: string) {
  return new Date(`${date}T${time}:00+04:00`).toISOString();
}
export function utcToDubaiForm(value: string) {
  const format = new Intl.DateTimeFormat('en-CA', {
    timeZone: MEETING_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  });
  const map = Object.fromEntries(
    format
      .formatToParts(new Date(value))
      .filter((part) => part.type !== 'literal')
      .map((part) => [part.type, part.value]),
  );
  return { date: `${map.year}-${map.month}-${map.day}`, time: `${map.hour}:${map.minute}` };
}
