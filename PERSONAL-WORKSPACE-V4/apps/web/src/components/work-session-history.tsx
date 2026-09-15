import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { WorkSession } from '@scli/domain';
import { api } from '../api';
import { formatDate } from './ui';
import {
  activeSessionSeconds,
  completedSessionSeconds,
  formatElapsed,
  formatTrackedTotal,
  projectTrackedSeconds,
} from '../work-session-time';

/**
 * P2.8B — Compact Work Sessions history inside Personal Project Overview.
 *
 * The tracked total is derived ONLY from WorkSession rows (endedAt - startedAt
 * for completed, current clock - startedAt for an active session on this
 * project). It is UI presentation only and never uses actualHours.
 */

export function WorkSessionHistory({ projectId }: { projectId: string }) {
  const [now, setNow] = useState(() => Date.now());

  const sessionsQuery = useQuery({
    queryKey: ['project-work-sessions', projectId],
    queryFn: () => api.projectWorkSessions(projectId),
  });
  const sessions = sessionsQuery.data ?? [];

  // Display-only ticker so an active session's live elapsed advances.
  useEffect(() => {
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, []);

  const trackedSeconds = useMemo(() => projectTrackedSeconds(sessions, now), [sessions, now]);

  if (sessions.length === 0) {
    return (
      <section className="content-card work-session-history" aria-label="Work Sessions">
        <h2>Work Sessions</h2>
        <p className="muted-copy">No tracked work sessions yet.</p>
        <p className="work-session-total">
          Tracked Time: <strong>{formatTrackedTotal(0)}</strong>
        </p>
      </section>
    );
  }

  return (
    <section className="content-card work-session-history" aria-label="Work Sessions">
      <div className="work-session-history-head">
        <h2>Work Sessions</h2>
        <p className="work-session-total">
          Tracked Time: <strong>{formatTrackedTotal(trackedSeconds)}</strong>
        </p>
      </div>
      <ol className="work-session-history-list">
        {sessions.map((session) => (
          <WorkSessionRow key={session.id} session={session} now={now} />
        ))}
      </ol>
    </section>
  );
}

function WorkSessionRow({ session, now }: { session: WorkSession; now: number }) {
  const active = session.endedAt === null;
  const seconds = active ? activeSessionSeconds(session, now) : completedSessionSeconds(session);
  return (
    <li className="work-session-history-row">
      <div className="work-session-history-when">
        <strong>{formatDate(session.startedAt, { day: '2-digit', month: 'short' })}</strong>
        <span>
          {formatDate(session.startedAt, { hour: '2-digit', minute: '2-digit' })}
          {active ? null : (
            <>
              {' – '}
              {formatDate(session.endedAt!, { hour: '2-digit', minute: '2-digit' })}
            </>
          )}
        </span>
      </div>
      <div className="work-session-history-duration">
        {active ? <span className="work-session-in-progress">In progress</span> : null}
        <strong>{formatElapsed(seconds)}</strong>
      </div>
    </li>
  );
}
