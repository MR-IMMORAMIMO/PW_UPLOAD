import { useLayoutEffect, useRef, useState } from 'react';
import type { FinalProjectSetup } from '@scli/domain';
import { businessTodayKey, formatBusinessDateOnly } from '../../date-time/businessDateTime';
import { SctAdd, SctRemove } from '../common/SctIcons';

const DAY = 86400000;
const stamp = (key: string) => Date.parse(`${key}T12:00:00Z`);
export function ProjectScheduleTimeline({
  start,
  end,
  milestones,
}: {
  start: string;
  end: string;
  milestones: FinalProjectSetup['schedule']['milestones'];
}) {
  const [zoom, setZoom] = useState(1);
  const [showToday, setShowToday] = useState(false);
  const [todayRequest, setTodayRequest] = useState(0);
  const viewport = useRef<HTMLDivElement>(null);
  const today = stamp(businessTodayKey());
  const points = [
    ...(start ? [{ id: 'start', label: 'Project start', date: start }] : []),
    ...milestones.map((m) => ({ id: m.id, label: `${m.name} · ${m.phase}`, date: m.targetDate })),
    ...(end ? [{ id: 'end', label: 'Target completion', date: end }] : []),
  ].filter((point) => Number.isFinite(stamp(point.date)));
  const times = points.map((point) => stamp(point.date));
  const low = Math.min(...times, ...(showToday ? [today] : []));
  const high = Math.max(...times, ...(showToday ? [today] : []));
  const from = low - DAY;
  const span = Math.max(7 * DAY, high - low + 2 * DAY);
  const position = (value: number) => ((value - from) / span) * 100;
  useLayoutEffect(() => {
    if (!todayRequest || !viewport.current) return;
    const element = viewport.current;
    element.scrollLeft = (position(today) / 100) * element.scrollWidth - element.clientWidth / 2;
  }, [todayRequest, zoom, from, span, today]);
  return (
    <section aria-label="Project timeline">
      <div className="flex items-center justify-between mb-2 gap-2">
        <h3>Project Timeline</h3>
        <div className="flex gap-2">
          <button
            type="button"
            disabled={!points.length}
            onClick={() => {
              setShowToday(true);
              setTodayRequest((n) => n + 1);
            }}
          >
            Today
          </button>
          <button
            type="button"
            aria-label="Zoom out timeline"
            disabled={!points.length || zoom <= 1}
            onClick={() => setZoom((value) => Math.max(1, value - 1))}
          >
            <SctRemove width={16} height={16} />
          </button>
          <button
            type="button"
            aria-label="Zoom in timeline"
            disabled={!points.length || zoom >= 6}
            onClick={() => setZoom((value) => Math.min(6, value + 1))}
          >
            <SctAdd width={16} height={16} />
          </button>
        </div>
      </div>
      {!points.length ? (
        <p>No dates yet. Add a project date or milestone to view the timeline.</p>
      ) : (
        <div
          ref={viewport}
          style={{ overflowX: 'auto', border: '1px solid var(--v4-border)', borderRadius: 12 }}
        >
          <div style={{ width: `${zoom * 100}%`, minWidth: 500, padding: 12 }}>
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                paddingBottom: 12,
                fontSize: 11,
              }}
            >
              {Array.from({ length: 7 }, (_, index) => (
                <span key={index}>
                  {formatBusinessDateOnly(
                    new Date(from + (span * index) / 6).toISOString().slice(0, 10),
                  )}
                </span>
              ))}
            </div>
            {points.map((point) => (
              <div
                key={point.id}
                style={{ borderTop: '1px solid var(--v4-border)', paddingBlock: 8 }}
              >
                <div style={{ fontSize: 12 }}>
                  {point.label} — {formatBusinessDateOnly(point.date)}
                </div>
                <div style={{ height: 18, position: 'relative', marginInline: 5 }}>
                  <span
                    aria-hidden="true"
                    style={{
                      position: 'absolute',
                      left: `${position(stamp(point.date))}%`,
                      width: 10,
                      height: 10,
                      top: 4,
                      background: 'var(--v4-accent)',
                      transform: 'rotate(45deg)',
                    }}
                  />
                  {today >= from && today <= from + span && (
                    <span
                      aria-hidden="true"
                      style={{
                        position: 'absolute',
                        left: `${position(today)}%`,
                        height: 18,
                        borderLeft: '2px solid var(--v4-text-muted)',
                      }}
                    />
                  )}
                </div>
              </div>
            ))}
            {today >= from && today <= from + span && (
              <p style={{ fontSize: 11 }}>Today: {formatBusinessDateOnly(businessTodayKey())}</p>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
