// lib/tts-pocket.js — Kyutai Pocket TTS adapter.
//
// SERVER:   `pocket-tts serve` (FastAPI). Started by start-all.ps1 on port 8001
//           (`--default-voice alba`). Install: pip install pocket-tts (in any Python venv;
//           we reuse the Lars venv because it already has pocket-tts 3.3.0 + torch CPU).
//           NOTE the Lars *app* runs its own server on port 8000 — ours must stay on 8001.
//
// API (verified against the running server's /openapi.json, 2026-10-02):
//   POST /tts   multipart/form-data
//     text       string, required — the text to speak
//     voice_url  string, optional — a BUILT-IN VOICE NAME (e.g. "alba") works here too,
//                despite the name saying "url". hf://, http(s):// voice URLs also accepted.
//                If empty, the server's --default-voice is used (which we set to alba).
//     voice_wav  file, optional — uploaded voice sample (mutually exclusive with voice_url)
//   Response: HTTP 200, Content-Type audio/wav, Transfer-Encoding chunked.
//     THE BODY STREAMS: measured TTFB ≈ 0.205 s for a reply whose full synth takes ≈ 2.6 s
//     (model generates faster than realtime, ~11x, and flushes chunks as produced).
//     Voice "alba": 24 kHz mono 16-bit PCM WAV.
//
// STREAMING BEHAVIOR: this adapter streams. /api/tts in server.js pipes the body
// through unbuffered. The client, however, currently decodeAudioData()s the whole
// response before playing, so the streaming is (as of 2026-10-02) not AUDIBLE end-to-end.
// Known quirk: weights load at server start (~1-2 min cold), then every request is warm.
//
// Config env vars: POCKET_URL (default http://localhost:8001/tts), POCKET_VOICE (default "alba")
import E_env from './env.js';

export default async function pocket(text) {
  const f = new FormData();
  f.append('text', text);
  if (E_env.POCKET_VOICE) f.append('voice_url', E_env.POCKET_VOICE);
  return fetch(E_env.POCKET_URL, { method: 'POST', body: f });
}
