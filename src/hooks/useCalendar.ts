/**
 * useCalendar — holds the agent's booked appointments.
 *
 * This is the "state" half of the agentic loop: the booking parser
 * (services/agentTools.ts) turns a spoken confirmation into a structured
 * appointment, and `book()` commits it here. The Calendar component simply
 * renders whatever lives in this hook.
 *
 * Appointments persist to localStorage so a live demo survives a refresh.
 */
import { useCallback, useEffect, useState } from 'react';
import type { Appointment } from '../types';

const STORAGE_KEY = 'trtc-demo-appointments';

function load(): Appointment[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as Appointment[]) : [];
  } catch {
    return [];
  }
}

export function useCalendar() {
  const [appointments, setAppointments] = useState<Appointment[]>(load);
  // The id of the most recently booked appointment, so the UI can flash it.
  const [lastBookedId, setLastBookedId] = useState<string | null>(null);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(appointments));
    } catch {
      // Storage full / disabled — non-fatal for a demo.
    }
  }, [appointments]);

  /**
   * Commit a new appointment. De-dupes on (date + title) so repeated
   * partial transcript matches for the same booking don't stack up.
   * Returns the appointment that ended up in state (existing or new).
   */
  const book = useCallback((input: { date: string; title: string; time?: string }): Appointment => {
    const normalizedTitle = input.title.trim().toLowerCase();
    let committed: Appointment | undefined;

    setAppointments((prev) => {
      const existing = prev.find(
        (a) => a.date === input.date && a.title.trim().toLowerCase() === normalizedTitle,
      );
      if (existing) {
        committed = existing;
        return prev;
      }
      const appt: Appointment = {
        id: `appt_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        date: input.date,
        title: input.title.trim(),
        time: input.time,
        createdAt: Date.now(),
      };
      committed = appt;
      return [...prev, appt];
    });

    if (committed) setLastBookedId(committed.id);
    return committed as Appointment;
  }, []);

  const remove = useCallback((id: string) => {
    setAppointments((prev) => prev.filter((a) => a.id !== id));
  }, []);

  /**
   * Cancel an appointment the agent just confirmed removing.
   *
   * Matching strategy, in order of confidence:
   *   1. date + title  → exact appointment
   *   2. date only     → the (first) appointment on that day
   *   3. title only    → the (first) appointment with that subject
   *   4. neither       → the most recently created appointment ("cancel that")
   *
   * Returns the id that was removed, or null if nothing matched.
   */
  const cancel = useCallback((input: { date: string | null; title?: string }): string | null => {
    const wantTitle = input.title?.trim().toLowerCase();
    let removedId: string | null = null;

    setAppointments((prev) => {
      if (prev.length === 0) return prev;

      const byDate = (a: Appointment) => input.date != null && a.date === input.date;
      const byTitle = (a: Appointment) =>
        wantTitle != null && a.title.trim().toLowerCase().includes(wantTitle);

      let target: Appointment | undefined;

      if (input.date && wantTitle) {
        target = prev.find((a) => byDate(a) && byTitle(a)) ?? prev.find(byDate);
      } else if (input.date) {
        target = prev.find(byDate);
      } else if (wantTitle) {
        target = prev.find(byTitle);
      }

      // Fallback: most recently created booking.
      if (!target) {
        target = [...prev].sort((a, b) => b.createdAt - a.createdAt)[0];
      }

      if (!target) return prev;
      removedId = target.id;
      return prev.filter((a) => a.id !== target!.id);
    });

    if (removedId) setLastBookedId((cur) => (cur === removedId ? null : cur));
    return removedId;
  }, []);

  const clearAll = useCallback(() => {
    setAppointments([]);
    setLastBookedId(null);
  }, []);

  return { appointments, lastBookedId, book, remove, cancel, clearAll };
}
