/**
 * Transcript — live subtitles of the conversation.
 * The agent's speech and the user's recognized speech both stream in
 * word-by-word; entries marked `inProgress` show a blinking caret.
 */
import { useEffect, useRef } from 'react';
import type { TranscriptEntry } from '../types';

interface Props {
  entries: TranscriptEntry[];
  agentName: string;
}

export function Transcript({ entries, agentName }: Props) {
  const bottomRef = useRef<HTMLDivElement>(null);

  // Keep the newest message in view as text streams in.
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [entries]);

  if (entries.length === 0) {
    return (
      <div className="transcript transcript--empty">
        <p>Say something — your words and {agentName}&apos;s replies will appear here.</p>
      </div>
    );
  }

  return (
    <div className="transcript">
      {entries.map((entry) => (
        <div key={entry.id} className={`bubble bubble--${entry.role}`}>
          <span className="bubble__label">{entry.role === 'user' ? 'You' : agentName}</span>
          <p className="bubble__text">
            {entry.text}
            {entry.inProgress && <span className="bubble__caret" />}
          </p>
        </div>
      ))}
      <div ref={bottomRef} />
    </div>
  );
}
