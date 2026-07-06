/**
 * useVoiceAgent — React state management for a voice session.
 *
 * The UI components stay simple: they render whatever this hook exposes
 * (status, transcript, agent state) and call start()/stop() on button taps.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { startVoiceSession, type VoiceSession } from '../services/voiceSession';
import type { AgentState, SessionStatus, TranscriptEntry } from '../types';

/** A random-ish user ID, kept for the lifetime of the page. */
function makeUserId(): string {
  return `user_${Math.random().toString(36).slice(2, 8)}`;
}

export function useVoiceAgent() {
  const [status, setStatus] = useState<SessionStatus>('disconnected');
  const [agentState, setAgentState] = useState<AgentState>('idle');
  const [agentName, setAgentName] = useState('AI Agent');
  const [transcript, setTranscript] = useState<TranscriptEntry[]>([]);
  const [error, setError] = useState<string | null>(null);

  // Refs for things that shouldn't trigger re-renders.
  const sessionRef = useRef<VoiceSession | null>(null);
  const userIdRef = useRef(makeUserId());

  /** Insert or update a transcript entry (partial ASR results update in place). */
  const upsertEntry = useCallback((entry: TranscriptEntry) => {
    setTranscript((prev) => {
      const index = prev.findIndex((e) => e.id === entry.id);
      if (index === -1) return [...prev, entry];
      const next = [...prev];
      next[index] = entry;
      return next;
    });
  }, []);

  const start = useCallback(async () => {
    setError(null);
    setTranscript([]);
    setStatus('connecting');
    try {
      const session = await startVoiceSession(userIdRef.current, {
        onSubtitle: ({ id, role, text, end }) =>
          upsertEntry({ id, role, text, inProgress: !end }),
        onAgentState: setAgentState,
        onError: (message) => setError(message),
      });
      sessionRef.current = session;
      setAgentName(session.agentName);
      setStatus('connected');
      setAgentState('listening');
    } catch (err) {
      setStatus('disconnected');
      setError(err instanceof Error ? err.message : 'Failed to start the session');
    }
  }, [upsertEntry]);

  const stop = useCallback(async () => {
    const session = sessionRef.current;
    sessionRef.current = null;
    setStatus('disconnected');
    setAgentState('idle');
    if (session) {
      await session.stop().catch(() => {});
    }
  }, []);

  // Safety net: end the session if the component unmounts mid-call.
  useEffect(() => {
    return () => {
      sessionRef.current?.stop().catch(() => {});
    };
  }, []);

  return { status, agentState, agentName, transcript, error, start, stop };
}
