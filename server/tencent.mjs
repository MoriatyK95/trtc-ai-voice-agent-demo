/**
 * Helpers for talking to Tencent Cloud:
 *
 *   1. generateUserSig()  — creates the signed token every TRTC client
 *                           (your browser AND the AI bot) needs to join a room.
 *   2. callTrtcApi()      — signs and sends a request to the TRTC REST API
 *                           (StartAIConversation / StopAIConversation / …)
 *                           using Tencent's TC3-HMAC-SHA256 scheme.
 *
 * Both run on the server only, so your SecretKey never reaches the browser.
 * Uses only Node built-ins (crypto + zlib) — no SDK required.
 */
import crypto from 'node:crypto';
import zlib from 'node:zlib';

/* ───────────────────────── UserSig ───────────────────────── */

/**
 * A UserSig is a signed JSON blob proving "user X may join app Y".
 * Algorithm: HMAC-SHA256 sign → JSON → zlib deflate → URL-safe base64.
 * Docs: https://trtc.io/document/35166
 */
export function generateUserSig(sdkAppId, secretKey, userId, expireSeconds = 604800) {
  const now = Math.floor(Date.now() / 1000);

  // The exact string Tencent expects to be signed (order + trailing \n matter).
  const contentToSign =
    `TLS.identifier:${userId}\n` +
    `TLS.sdkappid:${sdkAppId}\n` +
    `TLS.time:${now}\n` +
    `TLS.expire:${expireSeconds}\n`;

  const signature = crypto
    .createHmac('sha256', secretKey)
    .update(contentToSign)
    .digest('base64');

  const token = JSON.stringify({
    'TLS.ver': '2.0',
    'TLS.identifier': userId,
    'TLS.sdkappid': sdkAppId,
    'TLS.expire': expireSeconds,
    'TLS.time': now,
    'TLS.sig': signature,
  });

  // Compress, then base64 with Tencent's custom URL-safe alphabet.
  return zlib
    .deflateSync(Buffer.from(token))
    .toString('base64')
    .replace(/\+/g, '*')
    .replace(/\//g, '-')
    .replace(/=/g, '_');
}

/* ─────────────────── TRTC REST API caller ─────────────────── */

const API_HOST = 'trtc.intl.tencentcloudapi.com';
const API_VERSION = '2019-07-22';
const API_SERVICE = 'trtc';

const sha256Hex = (data) => crypto.createHash('sha256').update(data).digest('hex');
const hmac = (key, data) => crypto.createHmac('sha256', key).update(data).digest();

/**
 * Calls a TRTC API action (e.g. "StartAIConversation") with the given
 * JSON payload. Handles the TC3-HMAC-SHA256 request signing that all
 * Tencent Cloud APIs require.
 * Docs: https://www.tencentcloud.com/document/api/647/39804
 */
export async function callTrtcApi(action, payload, { secretId, secretKey, region }) {
  const timestamp = Math.floor(Date.now() / 1000);
  const date = new Date(timestamp * 1000).toISOString().slice(0, 10);
  const body = JSON.stringify(payload);

  // Step 1: canonical request — a normalized description of the HTTP call.
  const canonicalRequest = [
    'POST',
    '/',
    '',
    `content-type:application/json\nhost:${API_HOST}\nx-tc-action:${action.toLowerCase()}\n`,
    'content-type;host;x-tc-action',
    sha256Hex(body),
  ].join('\n');

  // Step 2: string to sign — binds the request to a date and service scope.
  const credentialScope = `${date}/${API_SERVICE}/tc3_request`;
  const stringToSign = ['TC3-HMAC-SHA256', timestamp, credentialScope, sha256Hex(canonicalRequest)].join('\n');

  // Step 3: derive the signing key and compute the signature.
  const kDate = hmac(`TC3${secretKey}`, date);
  const kService = hmac(kDate, API_SERVICE);
  const kSigning = hmac(kService, 'tc3_request');
  const signature = crypto.createHmac('sha256', kSigning).update(stringToSign).digest('hex');

  const authorization =
    `TC3-HMAC-SHA256 Credential=${secretId}/${credentialScope}, ` +
    `SignedHeaders=content-type;host;x-tc-action, Signature=${signature}`;

  const res = await fetch(`https://${API_HOST}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Host: API_HOST,
      Authorization: authorization,
      'X-TC-Action': action,
      'X-TC-Version': API_VERSION,
      'X-TC-Region': region,
      'X-TC-Timestamp': String(timestamp),
    },
    body,
  });

  const json = await res.json();

  // Tencent wraps everything in { Response: { ..., Error? } }.
  const response = json.Response ?? {};
  if (response.Error) {
    throw new Error(`${response.Error.Code}: ${response.Error.Message}`);
  }
  return response;
}
