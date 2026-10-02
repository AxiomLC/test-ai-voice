// lib/tts-piper.js — Piper TTS adapter (piper1-gpl, rhasspy successor).
//
// SERVER:   `python -m piper.http_server -m <voice.onnx> --port 5000`. Started by
//           start-all.ps1. Piper is installed globally: pip install piper-tts (1.8.0,
//           system Python 3.11). Voice model: voices/en_US-lessac-medium.onnx(+json) in
//           this repo, downloaded with `python -m piper.download_voices en_US-lessac-medium`
//           into the project dir then moved to voices/. Use a medium/low voice on CPU.
//
// API (verified against piper1-gpl docs + live 2026-10-02):
//   POST /synthesize   application/json
//     { "text": "..." }   the ONLY required field
//     optional: voice, speaker, speaker_id, length_scale, noise_scale, noise_w_scale
//     Also: GET /info (server info), GET /voices (voice list)
//   Response: audio/wav, ~22-24 kHz; returned in ONE piece (no progressive streaming).
//
// TIMINGS: instant — measured 0.196 s for a sentence (fastest engine; int8/onnx CPU).
// Because there is no body streaming, start-of-playback latency == full synth time,
// which for a sentence is fine.
//
// Config env vars: PIPER_URL (…/synthesize — note the path, NOT the bare host)
import E_env from './env.js';

export default async function piper(text) {
  return fetch(E_env.PIPER_URL, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text })
  });
}
