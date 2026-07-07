/**
 * ─────────────────────────────────────────────────────────────
 * agentTools.ts — the "agentic" layer.
 * ─────────────────────────────────────────────────────────────
 *
 * The voice agent's LLM runs in Tencent's cloud, so we can't intercept
 * OpenAI-style function calls directly. Instead we implement a lightweight
 * tool layer on the client: we watch the *assistant's* finalized speech for
 * a booking intent, extract the structured arguments (date + title), and
 * hand back a tool call the app can execute against calendar state.
 *
 * This mirrors how an LLM tool works — INTENT → PARSE ARGS → TOOL RESULT —
 * but with zero extra latency and no second model round-trip, which is
 * ideal for a live demo.
 */

export interface BookingToolCall {
  tool: 'book_appointment';
  args: {
    /** YYYY-MM-DD (local) */
    date: string;
    title: string;
    time?: string;
  };
}

export interface CancelToolCall {
  tool: 'cancel_appointment';
  args: {
    /** YYYY-MM-DD (local), or null when the agent didn't name a date */
    date: string | null;
    /** best-effort subject to disambiguate when multiple are booked */
    title?: string;
  };
}

export type ToolCall = BookingToolCall | CancelToolCall;

/* ───────────────────────── date helpers ───────────────────────── */

const MONTHS = [
  'january', 'february', 'march', 'april', 'may', 'june',
  'july', 'august', 'september', 'october', 'november', 'december',
];

const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

/** Format a Date as local YYYY-MM-DD (no UTC drift). */
export function toDateKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function ordinalToInt(word: string): number | null {
  const map: Record<string, number> = {
    first: 1, second: 2, third: 3, fourth: 4, fifth: 5, sixth: 6, seventh: 7,
    eighth: 8, ninth: 9, tenth: 10, eleventh: 11, twelfth: 12, thirteenth: 13,
    fourteenth: 14, fifteenth: 15, sixteenth: 16, seventeenth: 17, eighteenth: 18,
    nineteenth: 19, twentieth: 20, thirtieth: 30, thirtyfirst: 31,
  };
  return map[word] ?? null;
}

/**
 * Try to pull a concrete calendar date out of free text.
 * Handles: "tomorrow", "today", "next monday", "on friday",
 * "july 12", "12th of july", "the 5th", "in 3 days".
 * Returns a YYYY-MM-DD key, or null if no date is found.
 * `now` is injectable for testing.
 */
export function parseDate(text: string, now: Date = new Date()): string | null {
  const t = text.toLowerCase();

  // today / tomorrow / day after tomorrow
  if (/\bday after tomorrow\b/.test(t)) return toDateKey(addDays(now, 2));
  if (/\btomorrow\b/.test(t)) return toDateKey(addDays(now, 1));
  if (/\btoday\b|\btonight\b/.test(t)) return toDateKey(now);

  // "in N days" / "in a week"
  const inDays = t.match(/\bin (\d+) days?\b/);
  if (inDays) return toDateKey(addDays(now, parseInt(inDays[1], 10)));
  if (/\bin a week\b|\bnext week\b/.test(t)) return toDateKey(addDays(now, 7));

  // weekday, optionally "next" (e.g. "next friday", "on monday")
  const wdMatch = t.match(/\b(next\s+)?(sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/);
  if (wdMatch) {
    const target = WEEKDAYS.indexOf(wdMatch[2]);
    const forceNext = Boolean(wdMatch[1]);
    return toDateKey(nextWeekday(now, target, forceNext));
  }

  // "july 12", "july 12th", "12 july", "12th of july"
  const monthName = MONTHS.find((m) => t.includes(m));
  if (monthName) {
    const monthIdx = MONTHS.indexOf(monthName);
    // number near the month name
    const numMatch = t.match(/\b(\d{1,2})(st|nd|rd|th)?\b/);
    const day = numMatch ? parseInt(numMatch[1], 10) : 1;
    if (day >= 1 && day <= 31) {
      let year = now.getFullYear();
      // If that month/day is already in the past this year, roll to next year.
      const candidate = new Date(year, monthIdx, day);
      if (candidate < startOfDay(now)) year += 1;
      return toDateKey(new Date(year, monthIdx, day));
    }
  }

  // "the 5th" / "on the twelfth" — assume this month (or next if past)
  const bareOrdinalNum = t.match(/\bthe (\d{1,2})(st|nd|rd|th)\b/);
  const bareOrdinalWord = t.match(/\bthe (\w+)\b/);
  let dom: number | null = null;
  if (bareOrdinalNum) dom = parseInt(bareOrdinalNum[1], 10);
  else if (bareOrdinalWord) dom = ordinalToInt(bareOrdinalWord[1]);
  if (dom && dom >= 1 && dom <= 31) {
    let d = new Date(now.getFullYear(), now.getMonth(), dom);
    if (d < startOfDay(now)) d = new Date(now.getFullYear(), now.getMonth() + 1, dom);
    return toDateKey(d);
  }

  return null;
}

/** Pull a rough time-of-day string like "3pm", "3:30 pm", "15:00". */
export function parseTime(text: string): string | undefined {
  const m = text.toLowerCase().match(/\b(\d{1,2})(:\d{2})?\s*(am|pm)\b|\b(\d{1,2}):(\d{2})\b/);
  if (!m) return undefined;
  return m[0].replace(/\s+/g, '').trim();
}

/* ───────────────────── intent + title extraction ───────────────────── */

const BOOKING_VERBS = /\b(book(ed)?|schedul(e|ed)|set(ting)?\s+up|reminder|remind(ed)?|appointment|added|put\s+(you\s+)?down|penciled?\s+in|marked)\b/;

const CANCEL_VERBS = /\b(cancel(l?ed|l?ing)?|remov(e|ed|ing)|delete[d]?|clear(ed)?|call(ed)?\s+off|took?\s+(it\s+)?off|scratch(ed)?|unbook(ed)?)\b/;

/** Words that are dates/times/glue — never a valid standalone title. */
const DATE_WORD = /^(on|at|for|to|tomorrow|today|tonight|next|this|week|day|the|a|an|your|you|is|are|has|have|been|and|okay|ok|sure|done|now|it|that|appointment|reminder|booking|january|february|march|april|may|june|july|august|september|october|november|december|monday|tuesday|wednesday|thursday|friday|saturday|sunday|\d{1,2}(st|nd|rd|th)?)$/i;

/** Strip trailing date/time tokens off a candidate title. */
function trimDateTail(s: string): string {
  const words = s.split(/\s+/).filter(Boolean);
  while (words.length && DATE_WORD.test(words[words.length - 1])) words.pop();
  return words.join(' ');
}

/**
 * Extract a short human title for the appointment.
 *
 * Handles both orderings the agent uses:
 *   • subject AFTER the preposition — "for a dentist appointment on Friday"
 *   • subject BEFORE the date       — "your haircut appointment for July 13th"
 * plus reminder-style — "reminder to call mom".
 */
function extractTitle(text: string): string {
  const t = text.trim();

  // "reminder to call mom" → "call mom"
  const toMatch = t.match(/\b(?:reminder|remind you)\s+to\s+([^.,!?]+?)(?=\s+(?:on|at|tomorrow|today|next|this|in \d|the \d|\d{1,2}(?:st|nd|rd|th)|january|february|march|april|may|june|july|august|september|october|november|december|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b|[.,!?]|$)/i);
  if (toMatch) {
    const cleaned = trimDateTail(cleanupTitle(toMatch[1]));
    if (cleaned.length > 1) return titleCase(cleaned);
  }

  // subject BEFORE "for <date>": "your haircut appointment for July 13th"
  //   → capture "haircut appointment", then drop the "appointment" glue word.
  const beforeMatch = t.match(/\b(?:your|the|a|an)\s+([a-z][a-z\s]*?)\s+(?:appointment|reminder|booking|meeting|session)\b/i);
  if (beforeMatch) {
    const cleaned = trimDateTail(cleanupTitle(beforeMatch[1]));
    if (cleaned.length > 1 && !DATE_WORD.test(cleaned)) return titleCase(cleaned);
  }

  // subject AFTER "for/about": "for a dentist appointment on ..." → "dentist appointment"
  //   but ONLY if what follows "for" isn't itself a date.
  const forMatch = t.match(/\b(?:for|about|:)\s+(?:a |an |the |your )?([^.,!?]+?)(?=\s+(?:on|at|tomorrow|today|tonight|next|this|in \d|the \d|\d{1,2}(?:st|nd|rd|th)|january|february|march|april|may|june|july|august|september|october|november|december|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b|[.,!?]|$)/i);
  if (forMatch) {
    const cleaned = trimDateTail(cleanupTitle(forMatch[1]));
    // reject if it collapsed to a date/glue word (e.g. "for July 13th")
    if (cleaned.length > 1 && !DATE_WORD.test(cleaned)) return titleCase(cleaned);
  }

  return 'Appointment';
}

function cleanupTitle(s: string): string {
  return s
    .replace(/\b(an?|the|your|you|for|is|has been|have been|been)\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function titleCase(s: string): string {
  return s.replace(/\b\w/g, (c) => c.toUpperCase());
}

/**
 * Detect a booking confirmation. Kept as a named export for the tests and any
 * callers that only care about bookings.
 */
export function detectBooking(assistantText: string, now: Date = new Date()): BookingToolCall | null {
  if (!BOOKING_VERBS.test(assistantText.toLowerCase())) return null;

  const date = parseDate(assistantText, now);
  if (!date) return null; // no concrete date → not actionable yet

  const time = parseTime(assistantText);
  const title = extractTitle(assistantText);

  return { tool: 'book_appointment', args: { date, title, time } };
}

/**
 * Detect a cancellation confirmation.
 *
 * A cancel is actionable even without a concrete date — "I've canceled that
 * for you" should still clear the most recent booking. When the agent names a
 * date and/or subject, we pass those through so the calendar can target the
 * exact appointment.
 */
export function detectCancellation(assistantText: string, now: Date = new Date()): CancelToolCall | null {
  const lower = assistantText.toLowerCase();
  if (!CANCEL_VERBS.test(lower)) return null;

  // Must actually reference an appointment/booking/reminder to avoid firing on
  // unrelated uses of "clear"/"remove" in casual speech.
  if (!/\b(appointment|booking|reminder|schedule[d]?|slot|that|it)\b/.test(lower)) return null;

  const date = parseDate(assistantText, now); // may be null → "cancel that"
  const rawTitle = extractTitle(assistantText);
  const title = rawTitle === 'Appointment' ? undefined : rawTitle;

  return { tool: 'cancel_appointment', args: { date, title } };
}

/**
 * The one public entry point. Given a finalized ASSISTANT line, decide whether
 * it confirms a tool action (book OR cancel) and return the structured call.
 *
 * We deliberately only act on the assistant's confirmation (not the user's
 * request) so the calendar updates exactly when the agent says it's done —
 * which is what the user hears, and avoids double-firing on the request +
 * confirmation pair.
 *
 * Cancellation is checked FIRST: "cancel my booking" contains the word
 * "booking", so a naive booking check would misfire on a cancel sentence.
 */
export function detectToolCall(assistantText: string, now: Date = new Date()): ToolCall | null {
  const cancel = detectCancellation(assistantText, now);
  if (cancel) return cancel;
  return detectBooking(assistantText, now);
}

/* ───────────────────────── small date utils ───────────────────────── */

function addDays(d: Date, n: number): Date {
  const r = new Date(d);
  r.setDate(r.getDate() + n);
  return r;
}

function startOfDay(d: Date): Date {
  const r = new Date(d);
  r.setHours(0, 0, 0, 0);
  return r;
}

/**
 * Next occurrence of `targetDow` (0=Sun..6=Sat).
 * If `forceNext`, always jump at least 7 days ("next friday" when today is
 * not Friday still means the upcoming Friday; when today IS Friday it means
 * the Friday a week out).
 */
function nextWeekday(now: Date, targetDow: number, forceNext: boolean): Date {
  const today = startOfDay(now);
  const cur = today.getDay();
  let delta = (targetDow - cur + 7) % 7;
  if (delta === 0) delta = forceNext ? 7 : 0; // today matches
  else if (forceNext && delta < 7) {
    // "next monday" said mid-week → the monday of next week, not this week's
    // upcoming one, only when it would otherwise fall in the current week.
    // Keep it simple/predictable for a demo: upcoming occurrence.
  }
  return addDays(today, delta);
}
