import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Clock3, Pause, Play, RotateCcw, Square } from 'lucide-react';
import { Link } from 'react-router-dom';
import {
  workCategories,
  workCategoryLabels,
  type TimeEntry,
  type WorkCategory,
} from '@scli/domain';
import { api } from '../api';
import { useAppContext } from '../app-context';
import { useToast } from './toast';

function formatElapsed(seconds: number): string {
  const safe = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(safe / 3_600);
  const minutes = Math.floor((safe % 3_600) / 60);
  const remaining = safe % 60;
  return [hours, minutes, remaining].map((value) => String(value).padStart(2, '0')).join(':');
}

export function LiveTimerCard({
  projectId,
  projectName,
  compact = false,
}: {
  projectId?: string;
  projectName?: string;
  compact?: boolean;
}) {
  const { currentUser } = useAppContext();
  const queryClient = useQueryClient();
  const { showToast } = useToast();
  const [category, setCategory] = useState<WorkCategory>('LightingDesign');
  const [note, setNote] = useState('');
  const [now, setNow] = useState(0);
  const overviewQuery = useQuery({
    queryKey: ['time-tracking', currentUser.id],
    queryFn: api.timeTrackingOverview,
    enabled: currentUser.role === 'Designer',
    refetchInterval: 15_000,
  });

  useEffect(() => {
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, []);

  const invalidate = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['time-tracking'] }),
      queryClient.invalidateQueries({ queryKey: ['timesheets'] }),
      queryClient.invalidateQueries({ queryKey: ['project-timesheets'] }),
      queryClient.invalidateQueries({ queryKey: ['projects'] }),
      queryClient.invalidateQueries({ queryKey: ['project'] }),
      queryClient.invalidateQueries({ queryKey: ['activities'] }),
    ]);
  };

  const timerMutation = useMutation({
    mutationFn: async ({
      action,
      entry,
    }: {
      action: 'pause' | 'resume' | 'stop';
      entry: TimeEntry;
    }) => {
      if (action === 'pause') return api.pauseTimer(entry.projectId, entry.id);
      if (action === 'resume') return api.resumeTimer(entry.projectId, entry.id);
      return api.stopTimer(entry.projectId, entry.id);
    },
    onSuccess: async (entry, variables) => {
      await invalidate();
      showToast(
        variables.action === 'stop'
          ? `${entry.durationMinutes} minutes saved to the timesheet.`
          : variables.action === 'pause'
            ? 'Timer paused.'
            : 'Timer resumed.',
      );
    },
    onError: (error) => showToast((error as Error).message, 'error'),
  });

  const startMutation = useMutation({
    mutationFn: () => api.startTimer(projectId ?? '', { workCategory: category, note }),
    onSuccess: async () => {
      setNote('');
      await invalidate();
      showToast('Live timer started.');
    },
    onError: (error) => showToast((error as Error).message, 'error'),
  });

  if (currentUser.role !== 'Designer') return null;
  const active = overviewQuery.data?.activeTimer ?? null;
  const extraSeconds =
    active?.status === 'Running' && overviewQuery.dataUpdatedAt
      ? Math.max(0, (now - overviewQuery.dataUpdatedAt) / 1_000)
      : 0;
  const elapsed = (active?.durationMinutes ?? 0) * 60 + extraSeconds;
  const onThisProject = Boolean(active && projectId && active.projectId === projectId);

  if (active) {
    return (
      <section
        className={`live-timer-card${compact ? ' compact' : ''}`}
        aria-label="Live project timer"
      >
        <div className="timer-heading">
          <span className={`timer-live-dot${active.status === 'Paused' ? ' paused' : ''}`} />
          <div>
            <small>{active.status === 'Paused' ? 'Timer paused' : 'Tracking live'}</small>
            <strong>{active.projectName}</strong>
          </div>
          <Clock3 size={19} />
        </div>
        <div className="timer-clock" aria-live="off">
          {formatElapsed(elapsed)}
        </div>
        <div className="timer-meta">
          <span>{workCategoryLabels[active.workCategory]}</span>
          {active.note ? <span>{active.note}</span> : null}
        </div>
        {!onThisProject && projectId ? (
          <p className="timer-other-project">
            Another project is active. <Link to={`/projects/${active.projectId}`}>Open it</Link>{' '}
            before starting this one.
          </p>
        ) : null}
        <div className="timer-actions">
          {active.status === 'Running' ? (
            <button
              className="button secondary"
              type="button"
              onClick={() => timerMutation.mutate({ action: 'pause', entry: active })}
              disabled={timerMutation.isPending}
            >
              <Pause size={16} /> Pause
            </button>
          ) : (
            <button
              className="button secondary"
              type="button"
              onClick={() => timerMutation.mutate({ action: 'resume', entry: active })}
              disabled={timerMutation.isPending}
            >
              <RotateCcw size={16} /> Resume
            </button>
          )}
          <button
            className="button danger"
            type="button"
            onClick={() => timerMutation.mutate({ action: 'stop', entry: active })}
            disabled={timerMutation.isPending}
          >
            <Square size={15} /> Stop & save
          </button>
        </div>
      </section>
    );
  }

  if (!projectId) {
    return (
      <section className={`live-timer-card empty${compact ? ' compact' : ''}`}>
        <div className="timer-heading">
          <span className="timer-live-dot idle" />
          <div>
            <small>Live timer</small>
            <strong>No project running</strong>
          </div>
          <Clock3 size={19} />
        </div>
        <p>Open one of your assigned projects and start work when you are ready.</p>
        <Link className="button primary" to="/projects">
          Choose a project
        </Link>
      </section>
    );
  }

  return (
    <section
      className={`live-timer-card empty${compact ? ' compact' : ''}`}
      aria-label={`Start timer for ${projectName ?? 'project'}`}
    >
      <div className="timer-heading">
        <span className="timer-live-dot idle" />
        <div>
          <small>Live timer</small>
          <strong>{projectName ?? 'Ready to work'}</strong>
        </div>
        <Clock3 size={19} />
      </div>
      <div className="timer-start-form">
        <label>
          Work category
          <select
            value={category}
            onChange={(event) => setCategory(event.target.value as WorkCategory)}
          >
            {workCategories.map((item) => (
              <option key={item} value={item}>
                {workCategoryLabels[item]}
              </option>
            ))}
          </select>
        </label>
        <label>
          Optional note
          <input
            value={note}
            onChange={(event) => setNote(event.target.value)}
            maxLength={500}
            placeholder="What are you working on?"
          />
        </label>
        <button
          className="button primary"
          type="button"
          onClick={() => startMutation.mutate()}
          disabled={startMutation.isPending}
        >
          <Play size={16} /> {startMutation.isPending ? 'Starting…' : 'Start work'}
        </button>
      </div>
    </section>
  );
}
