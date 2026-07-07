/**
 * ─────────────────────────────────────────────────────────────
 * voiceSession.ts — everything that talks to TRTC lives here.
 * ─────────────────────────────────────────────────────────────
 *
 * A voice session has two halves:
 *
 *   1. Our local server (/api/voice/*) — asks Tencent Cloud to spin up
 *      the AI agent and gives us the credentials to join the room.
 *   2. The TRTC Web SDK — joins the room, publishes the microphone,
 *      plays the agent's audio, and receives live subtitle/state events.
 *
 * The AI pipeline itself (ASR → LLM → TTS) runs entirely in Tencent's
 * cloud; the browser just streams audio in and out.
 */
import TRTC from 'trtc-sdk-v5';
import type { AgentState, Role } from '../types';

/** Callbacks the UI passes in so it can react to live events. */
export interface SessionCallbacks {
  /** Live subtitle: fires repeatedly as a sentence grows, `end` marks it final. */
  onSubtitle: (payload: { id: string; role: Role; text: string; end: boolean }) => void;
  /** The agent switched state (listening / thinking / speaking / …). */
  onAgentState: (state: AgentState) => void;
  /** The connection dropped unexpectedly. */
  onError: (message: string) => void;
}

export interface VoiceSession {
  agentName: string;
  stop: () => Promise<void>;
}

/**
 * TRTC delivers AI events as "custom messages" — small JSON blobs
 * broadcast into the room. Two message types matter for this demo:
 *
 *   type 10000 → live subtitle (both the user's ASR text and the agent's reply)
 *   type 10001 → agent state change (1 listening, 2 thinking, 3 speaking, 4 interrupted)
 */
const AGENT_STATES: Record<number, AgentState> = {
  1: 'listening',
  2: 'thinking',
  3: 'speaking',
  4: 'interrupted',
};

/** Starts a full voice session. Resolves once we're in the room with mic on. */
export async function startVoiceSession(
  userId: string,
  callbacks: SessionCallbacks,
): Promise<VoiceSession> {
  // Every session gets a fresh room so state never leaks between runs.
  const roomId = `room_${userId}_${Date.now()}`;

  // ── Step 1: ask our server to start the AI agent ──
  const res = await fetch('/api/voice/start', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ roomId, userId }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: 'Failed to start the agent' }));
    throw new Error(body.error || `Server error (${res.status})`);
  }
  const { taskId, sdkAppId, userSig, botUserId, agentName } = await res.json();

  // ── Step 2: join the same TRTC room from the browser ──
  const trtc = TRTC.create();

  trtc.on(TRTC.EVENT.CUSTOM_MESSAGE, (event) => {
    try {
      const message = JSON.parse(new TextDecoder().decode(event.data));

      if (message.type === 10000 && message.payload?.text) {
        const { text, end, roundid } = message.payload;
        // The speaker's userId is the TOP-LEVEL `sender` field per the TRTC
        // subtitle spec (https://trtc.io/document/68333) — NOT payload.userid.
        // Fall back to payload.userid for older/edge message shapes.
        const sender: string = message.sender ?? message.payload?.userid ?? '';
        callbacks.onSubtitle({
          // sender + roundid groups partial results of the same sentence, so
          // the UI updates one bubble in place instead of appending duplicates.
          // Including sender guarantees the user's and agent's bubbles stay
          // distinct even if their roundids ever collide.
          id: `${sender}_${roundid}`,
          role: sender === botUserId ? 'assistant' : 'user',
          text,
          end: Boolean(end),
        });
      }

      if (message.type === 10001) {
        callbacks.onAgentState(AGENT_STATES[message.payload?.state] ?? 'idle');
      }
    } catch {
      // Not JSON — some other custom message we don't care about.
    }
  });

  trtc.on(TRTC.EVENT.KICKED_OUT, () => callbacks.onError('Disconnected from the room.'));
  trtc.on(TRTC.EVENT.ERROR, (err) => callbacks.onError(err.message ?? 'TRTC connection error'));

  try {
    await trtc.enterRoom({
      sdkAppId: Number(sdkAppId),
      strRoomId: roomId, // string room ID — matches RoomIdType: 1 on the server
      userId,
      userSig,
      scene: TRTC.TYPE.SCENE_RTC,
    });

    // Publish the microphone (48 kHz mono — plenty for speech recognition).
    // The agent's audio plays automatically once it joins; no extra code needed.
    await trtc.startLocalAudio({ option: { profile: TRTC.TYPE.AUDIO_PROFILE_STANDARD } });
  } catch (err) {
    // Clean up the half-started session so the agent doesn't sit in an empty room.
    trtc.destroy();
    await fetch('/api/voice/stop', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ taskId }),
    }).catch(() => {});
    throw err;
  }

  // ── Step 3: hand the UI a way to end the session ──
  const stop = async () => {
    try {
      await trtc.stopLocalAudio();
      await trtc.exitRoom();
    } finally {
      trtc.destroy();
    }
    // Tell Tencent Cloud to shut the agent down (it would also time out
    // on its own after `maxIdleTime`, but explicit is better).
    await fetch('/api/voice/stop', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ taskId }),
    }).catch(() => {});
  };

  return { agentName, stop };
}
