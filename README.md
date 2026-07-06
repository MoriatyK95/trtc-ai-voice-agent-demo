# AI Voice Agent Demo — TRTC Conversational AI

A minimal, generic React demo of a real-time **AI voice agent** built on
[TRTC Conversational AI](https://trtc.io/products/conversational-ai).
Clone it, add your credentials, and you're talking to an AI agent in your
browser (or installed as a PWA on your phone) in a few minutes.

**What you get:**

- Tap a button → an AI agent joins a TRTC room and greets you out loud
- Talk naturally — the agent listens, thinks, and speaks back with low latency
- Live subtitles for both sides of the conversation
- Barge-in: interrupt the agent mid-sentence just by speaking
- An animated orb showing what the agent is doing (listening / thinking / speaking)

## How it works

The AI pipeline (speech-to-text → LLM → text-to-speech) runs entirely in
Tencent's cloud. Your code only does two things: **trigger the session**
(server) and **stream audio** (browser).

```
┌─────────┐  1. POST /api/voice/start   ┌──────────────┐  2. StartAIConversation  ┌───────────────────┐
│ Browser │ ───────────────────────────▶│ Local server │ ────────────────────────▶│   Tencent Cloud   │
│ (React) │ ◀─────────────────────────── │  (Express)   │                          │                   │
└─────────┘  3. userSig + sdkAppId      └──────────────┘                          │  AI bot joins the │
     │                                                                            │  TRTC room:       │
     │  4. Join TRTC room, publish microphone                                     │   ASR → LLM → TTS │
     └───────────────────────────────────────────────────────────────────────────▶│                   │
     ◀──────────────────────────────────────────────────────────────────────────── └───────────────────┘
        5. Agent audio + live subtitles (TRTC custom messages)
```

Why a local server? Your TRTC secret key and Tencent Cloud API keys must
never reach the browser. The server signs a short-lived `UserSig` for the
browser and makes the signed `StartAIConversation` API call.

## Prerequisites

- **Node.js 18+**
- A **Tencent Cloud account** with TRTC enabled ([sign up](https://trtc.io))
- An **OpenAI-compatible LLM API key** (OpenAI, DeepSeek, Groq, or any
  endpoint that speaks the `/v1/chat/completions` protocol)

## Quick start

```bash
# 1. Install dependencies
npm install

# 2. Configure credentials
cp .env.example .env
#    …then edit .env (see the next section)

# 3. Run it
npm run dev
```

Open http://localhost:5173, allow microphone access, and press
**Start talking**.

## Configure credentials

All configuration lives in `.env` (gitignored). Each variable is documented
inline in [`.env.example`](.env.example); here's where to find the values:

| Variable | Where to get it |
|---|---|
| `TRTC_SDK_APP_ID`, `TRTC_SDK_SECRET_KEY` | [TRTC Console](https://console.trtc.io) → create an application → **SDKAppID** & **SDKSecretKey** |
| `TENCENT_SECRET_ID`, `TENCENT_SECRET_KEY` | [CAM Console → API Keys](https://console.tencentcloud.com/cam/capi) |
| `TENCENT_API_REGION` | The TRTC region closest to you, e.g. `ap-singapore` |
| `LLM_API_URL`, `LLM_API_KEY`, `LLM_MODEL` | Your LLM provider (e.g. `https://api.openai.com/v1/chat/completions` + an OpenAI key + `gpt-4o-mini`) |
| `TTS_PROVIDER` + provider keys | `tencent` (default, reuses keys above — also set `TENCENT_APP_ID` from the [console home](https://console.tencentcloud.com/developer)), or `minimax` / `elevenlabs` with their keys |

> **Important:** you must activate the **Conversational AI** capability for
> your TRTC application in the console before `StartAIConversation` will
> succeed. Also note the LLM endpoint is called by *Tencent's cloud*, not
> your laptop — it must be reachable from the public internet.

## Customize the agent

The agent's persona lives in one small file:
[`server/agent-config.mjs`](server/agent-config.mjs)

```js
export const agent = {
  name: 'Aria',
  welcomeMessage: "Hi, I'm Aria, your AI voice assistant. …",
  systemPrompt: `You are Aria, a friendly and helpful AI voice assistant. …`,
};
```

Change the name, greeting, and system prompt, restart the dev server, and
start a new conversation. This is the best place to experiment during the
workshop — try a travel guide, a language tutor, or a support rep.

Other knobs worth exploring:

- **Spoken language** — `ASR_LANGUAGE` in `.env` (`en`, `zh`, `ja`, `th`, …)
- **Voice** — `TENCENT_TTS_VOICE_TYPE` in `.env`, or switch `TTS_PROVIDER`
- **Interruption behaviour** — `interruptMode` in `server/agent-config.mjs`
- **Pipeline tuning** — `VadSilenceTime` (how long a pause ends a sentence)
  in `server/index.mjs`

## Try it as a PWA

The app ships with a web manifest and service worker, so it can be
installed like a native app:

```bash
npm run build      # production build (the service worker is only generated here)
npm run preview    # serves the build + the API server
```

- **Desktop Chrome/Edge:** click the install icon in the address bar.
- **Phone:** the browser needs a secure context for both installation and
  microphone access. The simplest way to test from a phone is to tunnel
  your local server over HTTPS (e.g. `npx ngrok http 4173`), open the URL
  on the phone, then use "Add to Home Screen".

## Project structure

```
├── server/                  # Local API server (keeps secrets off the browser)
│   ├── index.mjs            # /api/voice/start | stop | status routes
│   ├── tencent.mjs          # UserSig generation + TRTC REST API signing
│   └── agent-config.mjs     # ★ Agent persona — edit me!
├── src/                     # React app
│   ├── App.tsx              # The single demo screen
│   ├── hooks/useVoiceAgent.ts       # Session state for the UI
│   ├── services/voiceSession.ts     # All TRTC SDK interaction
│   └── components/          # AgentOrb (animation) + Transcript (subtitles)
├── public/                  # PWA icons
├── .env.example             # Credential template — copy to .env
└── vite.config.ts           # Dev proxy + PWA manifest
```

## Troubleshooting

| Symptom | Likely cause |
|---|---|
| Server exits with "Missing configuration" | You haven't copied `.env.example` to `.env` or some values are still placeholders |
| `AuthFailure` errors on start | Wrong `TENCENT_SECRET_ID` / `TENCENT_SECRET_KEY`, or your account lacks TRTC API permission |
| Agent joins but never speaks | LLM endpoint unreachable from the internet, wrong `LLM_API_KEY`, or TTS credentials invalid |
| Agent speaks but doesn't hear you | Microphone permission denied, or `ASR_LANGUAGE` doesn't match the language you're speaking |
| Works on `localhost` but not from a phone | Microphone requires HTTPS on non-localhost origins — use a tunnel (see PWA section) |

Useful debugging tools:

- The **server terminal** logs every start/stop and the Tencent error code on failure
- `GET /api/voice/status/<taskId>` shows the live task status
- The browser console logs TRTC connection events

## Learn more

- [TRTC Conversational AI docs](https://trtc.io/document/68652)
- [StartAIConversation API reference](https://trtc.io/document/68655)
- [TRTC Web SDK (trtc-sdk-v5)](https://trtc.io/document/34069)
