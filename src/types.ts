/** Shared types used across the app. */

/** Who said a line of the conversation. */
export type Role = 'user' | 'assistant';

/** One entry in the live transcript. */
export interface TranscriptEntry {
  id: string;
  role: Role;
  text: string;
  /** True while the sentence is still being spoken/recognized. */
  inProgress: boolean;
}

/** What the AI agent is currently doing (drives the animated orb). */
export type AgentState = 'idle' | 'listening' | 'thinking' | 'speaking' | 'interrupted';

/** Connection lifecycle of a voice session. */
export type SessionStatus = 'disconnected' | 'connecting' | 'connected';

/**
 * A calendar appointment the agent booked on the user's behalf.
 * `date` is a plain YYYY-MM-DD string (local day, no timezone math needed
 * for a demo calendar). `time` is optional free-text like "3pm".
 */
export interface Appointment {
  id: string;
  /** YYYY-MM-DD */
  date: string;
  title: string;
  time?: string;
  /** When the agent created it — used to animate the newest one. */
  createdAt: number;
}
