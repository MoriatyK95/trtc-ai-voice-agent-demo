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
