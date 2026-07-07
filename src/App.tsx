/**
 * App — two-column demo screen.
 *
 * Left  (voice panel):  header · animated orb · live transcript · call button
 * Right (agent panel):  a live calendar the agent books into by voice
 *
 * The "agentic" loop: the voice agent confirms a booking out loud → the
 * transcript parser turns that into a book_appointment tool call → the
 * calendar state updates → the day lights up in real time.
 */
import { useVoiceAgent } from './hooks/useVoiceAgent';
import { useCalendar } from './hooks/useCalendar';
import { AgentOrb } from './components/AgentOrb';
import { Transcript } from './components/Transcript';
import { Calendar } from './components/Calendar';

const STATE_LABELS: Record<string, string> = {
  idle: 'Connected',
  listening: 'Listening…',
  thinking: 'Thinking…',
  speaking: 'Speaking…',
  interrupted: 'Interrupted',
};

export default function App() {
  const { appointments, lastBookedId, book, remove, cancel, clearAll } = useCalendar();

  const { status, agentState, agentName, transcript, error, start, stop } = useVoiceAgent({
    onBooking: (call) => book(call.args),
    onCancel: (call) => cancel(call.args),
  });

  const isConnected = status === 'connected';
  const isConnecting = status === 'connecting';

  const statusLabel = isConnecting
    ? 'Connecting…'
    : isConnected
      ? STATE_LABELS[agentState] ?? 'Connected'
      : 'Tap the button to start a voice conversation';

  return (
    <div className="layout">
      <div className="app">
        <header className="header">
          <div className="header__badge">TRTC Conversational AI</div>
          <h1 className="header__title">{agentName}</h1>
          <p className="header__status">{statusLabel}</p>
        </header>

        <AgentOrb state={agentState} active={isConnected} />

        <Transcript entries={transcript} agentName={agentName} />

        {error && (
          <div className="error" role="alert">
            {error}
          </div>
        )}

        <footer className="footer">
          {isConnected ? (
            <button className="button button--end" onClick={stop}>
              End conversation
            </button>
          ) : (
            <button className="button button--start" onClick={start} disabled={isConnecting}>
              {isConnecting ? (
                <>
                  <span className="spinner" /> Connecting…
                </>
              ) : (
                <>
                  <MicIcon /> Start talking
                </>
              )}
            </button>
          )}
          <p className="footer__hint">Ask {agentName} to book an appointment — watch the calendar →</p>
        </footer>
      </div>

      <Calendar
        appointments={appointments}
        lastBookedId={lastBookedId}
        onRemove={remove}
        onClear={clearAll}
      />
    </div>
  );
}

function MicIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
      <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
      <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
      <line x1="12" y1="19" x2="12" y2="23" />
    </svg>
  );
}
