import { meetingDateParts } from './meetingsViewModel';

export function MeetingDateBlock({ value, compact = false }: { value: string; compact?: boolean }) {
  const date = meetingDateParts(value);
  return (
    <time
      className={`v4-meetings__date${compact ? ' v4-meetings__date--compact' : ''}`}
      dateTime={value}
    >
      <span className="v4-meetings__date-tile">
        <span>{date.month}</span>
        <strong>{date.day}</strong>
      </span>
      {compact ? null : <small>{date.weekday}</small>}
    </time>
  );
}
