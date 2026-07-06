/**
 * ─────────────────────────────────────────────────────────────
 * Local dev server — the "backend" of the demo.
 * ─────────────────────────────────────────────────────────────
 *
 * Why does a voice agent demo need a server at all?
 *
 *   1. TRTC credentials (SDKSecretKey, Tencent API keys) must stay
 *      server-side. The browser only ever receives a short-lived
 *      UserSig.
 *   2. Starting an AI agent is a REST call to Tencent Cloud
 *      (StartAIConversation), which requires request signing with
 *      your secret keys.
 *
 * The flow, end to end:
 *
 *   Browser                This server                Tencent Cloud
 *   ───────                ───────────                ─────────────
 *   POST /api/voice/start ─▶ generate UserSigs
 *                            StartAIConversation ────▶ AI bot joins room
 *   ◀─ userSig, sdkAppId ──
 *   enterRoom + mic on ────────────────────────────▶ user audio → ASR → LLM → TTS
 *   ◀──────────────────────── bot audio + live subtitles (custom messages)
 *   POST /api/voice/stop ──▶ StopAIConversation ────▶ AI bot leaves room
 */
import express from 'express';
import dotenv from 'dotenv';
import { generateUserSig, callTrtcApi } from './tencent.mjs';
import { agent } from './agent-config.mjs';

dotenv.config();

/* ─────────────── Read + validate configuration ─────────────── */

const env = process.env;

const REQUIRED_VARS = [
  'TRTC_SDK_APP_ID',
  'TRTC_SDK_SECRET_KEY',
  'TENCENT_SECRET_ID',
  'TENCENT_SECRET_KEY',
  'LLM_API_URL',
  'LLM_API_KEY',
  'LLM_MODEL',
];

// Treat values still containing "your" or "xxxx" as unedited placeholders.
const isPlaceholder = (value) => !value || /your|xxxx/i.test(value);
const missing = REQUIRED_VARS.filter((name) => isPlaceholder(env[name]));
if (missing.length > 0) {
  console.error('\n❌  Missing configuration. Copy .env.example to .env and fill in:\n');
  for (const name of missing) console.error(`    - ${name}`);
  console.error('\n    See README.md → "Configure credentials" for where to find each value.\n');
  process.exit(1);
}

const config = {
  sdkAppId: Number(env.TRTC_SDK_APP_ID),
  sdkSecretKey: env.TRTC_SDK_SECRET_KEY,
  apiCredentials: {
    secretId: env.TENCENT_SECRET_ID,
    secretKey: env.TENCENT_SECRET_KEY,
    region: env.TENCENT_API_REGION || 'ap-singapore',
  },
  asrLanguage: env.ASR_LANGUAGE || 'en',
  port: Number(env.SERVER_PORT || 3001),
};

/* ────────── Build the three AI pipeline config blocks ────────── */

/**
 * STTConfig — speech-to-text (the agent's ears).
 * We use TRTC's built-in ASR so no extra credentials are needed.
 * AlternativeLanguage lets the ASR auto-detect a second language.
 */
function buildSttConfig() {
  return {
    Language: config.asrLanguage,
    AlternativeLanguage: config.asrLanguage === 'zh' ? ['en'] : ['zh'],
    // How many ms of silence marks the end of a sentence. Lower = snappier
    // replies but the agent may cut users off; higher = more patient.
    VadSilenceTime: 600,
  };
}

/**
 * LLMConfig — the agent's brain.
 * TRTC's cloud calls your OpenAI-compatible endpoint directly (that's why
 * it must be publicly reachable). Anything that speaks the
 * /v1/chat/completions protocol works.
 */
function buildLlmConfig() {
  return {
    LLMType: 'openai',
    APIUrl: env.LLM_API_URL,
    APIKey: env.LLM_API_KEY,
    Model: env.LLM_MODEL,
    Streaming: true, // stream tokens so TTS can start speaking early
    SystemPrompt: agent.systemPrompt,
    History: 20, // how many previous turns the LLM sees
    Timeout: 10,
  };
}

/**
 * TTSConfig — text-to-speech (the agent's voice).
 * Three providers supported here; pick one via TTS_PROVIDER in .env.
 */
function buildTtsConfig() {
  const provider = (env.TTS_PROVIDER || 'tencent').toLowerCase();

  if (provider === 'minimax') {
    return {
      TTSType: 'minimax',
      Model: 'speech-02-turbo',
      APIUrl: 'https://api.minimax.io/v1/t2a_v2',
      APIKey: env.MINIMAX_API_KEY,
      GroupId: env.MINIMAX_GROUP_ID,
      VoiceType: env.MINIMAX_VOICE_ID,
      Speed: 1.0,
    };
  }

  if (provider === 'elevenlabs') {
    return {
      TTSType: 'elevenlabs',
      Model: 'eleven_flash_v2_5',
      APIKey: env.ELEVENLABS_API_KEY,
      VoiceId: env.ELEVENLABS_VOICE_ID,
    };
  }

  // Default: Tencent TTS — reuses the API keys you already configured.
  return {
    TTSType: 'tencent',
    AppId: Number(env.TENCENT_APP_ID),
    SecretId: env.TENCENT_SECRET_ID,
    SecretKey: env.TENCENT_SECRET_KEY,
    VoiceType: Number(env.TENCENT_TTS_VOICE_TYPE || 101051),
    Speed: 1,
    Volume: 5,
    PrimaryLanguage: config.asrLanguage === 'zh' ? 'zh-CN' : 'en-US',
  };
}

/* ───────────────────────── API routes ───────────────────────── */

const app = express();
app.use(express.json());

/**
 * POST /api/voice/start
 * Body: { roomId: string, userId: string }
 *
 * 1. Signs a UserSig for the human user (returned to the browser).
 * 2. Signs a UserSig for the AI bot.
 * 3. Asks Tencent Cloud to start an AI conversation: the bot joins the
 *    room, listens to `userId`, and runs the ASR → LLM → TTS pipeline.
 */
app.post('/api/voice/start', async (req, res) => {
  const { roomId, userId } = req.body ?? {};
  if (!roomId || !userId) {
    return res.status(400).json({ error: 'roomId and userId are required' });
  }

  try {
    const userSig = generateUserSig(config.sdkAppId, config.sdkSecretKey, userId);

    // The bot is just another TRTC user — it needs its own identity + sig.
    const botUserId = `ai_agent_${Date.now().toString(36)}`;
    const botUserSig = generateUserSig(config.sdkAppId, config.sdkSecretKey, botUserId);

    const response = await callTrtcApi(
      'StartAIConversation',
      {
        SdkAppId: config.sdkAppId,
        RoomId: roomId,
        RoomIdType: 1, // 1 = string room IDs
        AgentConfig: {
          UserId: botUserId,
          UserSig: botUserSig,
          TargetUserId: userId, // whose audio the agent listens to
          MaxIdleTime: agent.maxIdleTime,
          WelcomeMessage: agent.welcomeMessage,
          InterruptMode: agent.interruptMode,
          InterruptSpeechDuration: 800, // ms of user speech that triggers barge-in
        },
        STTConfig: buildSttConfig(),
        // LLMConfig and TTSConfig are JSON *strings* by API design.
        LLMConfig: JSON.stringify(buildLlmConfig()),
        TTSConfig: JSON.stringify(buildTtsConfig()),
        SessionId: `session_${roomId}_${Date.now()}`,
      },
      config.apiCredentials,
    );

    console.log(`[voice/start] room=${roomId} task=${response.TaskId}`);
    res.json({
      taskId: response.TaskId,
      sdkAppId: config.sdkAppId,
      userSig,
      botUserId,
      agentName: agent.name,
    });
  } catch (err) {
    console.error('[voice/start] failed:', err.message);
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/voice/stop
 * Body: { taskId: string }
 * Ends the AI conversation task; the bot leaves the room.
 */
app.post('/api/voice/stop', async (req, res) => {
  const { taskId } = req.body ?? {};
  if (!taskId) {
    return res.status(400).json({ error: 'taskId is required' });
  }

  try {
    await callTrtcApi('StopAIConversation', { TaskId: taskId }, config.apiCredentials);
    console.log(`[voice/stop] task=${taskId}`);
    res.json({ ok: true });
  } catch (err) {
    console.error('[voice/stop] failed:', err.message);
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/voice/status/:taskId
 * Handy for debugging: Idle | Preparing | InProgress | Stopped
 */
app.get('/api/voice/status/:taskId', async (req, res) => {
  try {
    const response = await callTrtcApi(
      'DescribeAIConversation',
      { TaskId: req.params.taskId },
      config.apiCredentials,
    );
    res.json({ status: response.Status });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.listen(config.port, () => {
  console.log(`✅  API server ready on http://localhost:${config.port}`);
  console.log(`    Agent persona: "${agent.name}" (edit server/agent-config.mjs to customize)`);
});
