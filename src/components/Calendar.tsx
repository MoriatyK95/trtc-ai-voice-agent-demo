/**
 * Calendar — the agentic side panel.
 *
 * Renders a month grid. Days with an appointment are highlighted; the most
 * recently booked appointment flashes so it's obvious in a live demo when
 * the agent just booked something. Below the grid is a chronological list
 * of upcoming appointments.
 */
import { useEffect, useMemo, useState } from 'react';
import type { Appointment } from '../types';
import { toDateKey } from '../services/agentTools';

interface Props {
  appointments: Appointment[];
  lastBookedId: string | null;
  onRemove: (id: string) => void;
  onClear: () => void;
}

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];
const WEEKDAY_LABELS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

export function Calendar({ appointments, lastBookedId, onRemove, onClear }: Props) {
  // Which month the grid shows. Defaults to the current month; if the newest
  // booking is in another month, jump to it so the highlight is visible.
  const [cursor, setCursor] = useState(() => {
    const now = new Date();
    return { year: now.getFullYear(), month: now.getMonth() };
  });

  // When a new booking lands, snap the grid to that month so the highlight
  // is visible even if the booking is in a future month.
  useEffect(() => {
    if (!lastBookedId) return;
    const newest = appointments.find((a) => a.id === lastBookedId);
    if (newest) {
      const [y, m] = newest.date.split('-').map(Number);
      setCursor({ year: y, month: m - 1 });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lastBookedId]);

  const byDate = useMemo(() => {
    const map = new Map<string, Appointment[]>();
    for (const a of appointments) {
      const list = map.get(a.date) ?? [];
      list.push(a);
      map.set(a.date, list);
    }
    return map;
  }, [appointments]);

  const cells = useMemo(() => buildMonthCells(cursor.year, cursor.month), [cursor]);
  const todayKey = toDateKey(new Date());

  const upcoming = useMemo(
    () => [...appointments].sort((a, b) => a.date.localeCompare(b.date) || a.createdAt - b.createdAt),
    [appointments],
  );

  return (
    <aside className="calendar">
      <div className="calendar__head">
        <div>
          <div className="calendar__badge">Agent Calendar</div>
          <h2 className="calendar__title">
            {MONTH_NAMES[cursor.month]} {cursor.year}
          </h2>
        </div>
        <div className="calendar__nav">
          <button aria-label="Previous month" onClick={() => setCursor(shiftMonth(cursor, -1))}>‹</button>
          <button aria-label="Next month" onClick={() => setCursor(shiftMonth(cursor, 1))}>›</button>
        </div>
      </div>

      <div className="calendar__grid">
        {WEEKDAY_LABELS.map((d, i) => (
          <div key={`h${i}`} className="calendar__dow">{d}</div>
        ))}
        {cells.map((cell, i) => {
          if (!cell) return <div key={`e${i}`} className="calendar__cell calendar__cell--empty" />;
          const key = toDateKey(cell);
          const appts = byDate.get(key);
          const booked = Boolean(appts?.length);
          const isToday = key === todayKey;
          const isNew = Boolean(appts?.some((a) => a.id === lastBookedId));
          return (
            <div
              key={key}
              className={[
                'calendar__cell',
                booked ? 'calendar__cell--booked' : '',
                isToday ? 'calendar__cell--today' : '',
                isNew ? 'calendar__cell--new' : '',
              ].join(' ').trim()}
              title={appts?.map((a) => a.title).join(', ')}
            >
              <span className="calendar__day">{cell.getDate()}</span>
              {booked && <span className="calendar__dot" />}
            </div>
          );
        })}
      </div>

      <div className="calendar__list">
        <div className="calendar__list-head">
          <span>Upcoming</span>
          {appointments.length > 0 && (
            <button className="calendar__clear" onClick={onClear}>Clear all</button>
          )}
        </div>
        {upcoming.length === 0 ? (
          <p className="calendar__empty">
            No appointments yet. Try saying: <em>"Book a dentist appointment next Friday at 3pm."</em>
          </p>
        ) : (
          upcoming.map((a) => (
            <div
              key={a.id}
              className={`calendar__item ${a.id === lastBookedId ? 'calendar__item--new' : ''}`}
            >
              <div className="calendar__item-date">{formatDayLabel(a.date)}</div>
              <div className="calendar__item-body">
                <div className="calendar__item-title">{a.title}</div>
                {a.time && <div className="calendar__item-time">{a.time}</div>}
              </div>
              <button
                className="calendar__item-del"
                aria-label={`Remove ${a.title}`}
                onClick={() => onRemove(a.id)}
              >
                ×
              </button>
            </div>
          ))
        )}
      </div>
    </aside>
  );
}

/* ── helpers ── */

function shiftMonth(c: { year: number; month: number }, delta: number) {
  const d = new Date(c.year, c.month + delta, 1);
  return { year: d.getFullYear(), month: d.getMonth() };
}

/** A 6-row grid (42 cells): leading blanks, the days, trailing blanks. */
function buildMonthCells(year: number, month: number): (Date | null)[] {
  const first = new Date(year, month, 1);
  const startDow = first.getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const cells: (Date | null)[] = [];
  for (let i = 0; i < startDow; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(new Date(year, month, d));
  while (cells.length % 7 !== 0) cells.push(null);
  return cells;
}

function formatDayLabel(dateKey: string): string {
  const [y, m, d] = dateKey.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  const wd = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][date.getDay()];
  return `${wd} ${MONTH_NAMES[m - 1].slice(0, 3)} ${d}`;
}
