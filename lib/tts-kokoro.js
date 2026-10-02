// lib/tts-kokoro.js — Kokoro-FastAPI adapter.
//
// SERVER:   Kokoro-FastAPI (repo + venv at C:\Kokoro-FastAPI). Started by start-all.ps1
//           via its runner C:\Kokoro-FastAPI\kokoro-run.ps1 on port 8880 (CPU build,
//           OpenAI-compatible). The runner pins 9 env vars (USE_GPU, PYTHONPATH,
//           MODEL_DIR, VOICES_DIR, eSpeak NG paths...) — see that file.
//           Model + voices are pre-downloaded under api/src/{models,voices}/v1_0.
//
// API (verified live 2026-10-02):
//   POST /v1/audio/speech   application/json (OpenAI-compatible)
//     { model: "kokoro", input: <text>, voice: "af_heart", response_format: "wav", stream: false }
//   Response: audio/wav, single file. Response formats also include mp3, opus, etc.
//     With stream:true the body streams (wav header + progressive chunks) — NOT yet
//     used by the client; worth trying for audible streaming.
//
// TIMINGS (live, warm): sentence-scale reply ≈ 1.4-1.5 s; FIRST request after server
// start ≈ 5 s (lazy 1.3 GB model load) — the "standby mode" log banner covers this.
// Voice "af_heart" default. Voice list at api/src/voices/v1_0/*.pt (af_*, bf_*, ...).
//
// Config env vars: KOKORO_URL (…/v1/audio/speech), KOKORO_VOICE (default af_heart)
import E_env from './env.js';

export default async function kokoro(text) {
  return fetch(E_env.KOKORO_URL, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: 'kokoro', input: text, voice: E_env.KOKORO_VOICE || 'af_heart',
                           response_format: 'wav', stream: false })
  });
}
