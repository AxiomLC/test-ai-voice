# Test3-Voice-AI

Voice-assistant test harness: talk → STT → LLM → TTS → gapless playback, with barge-in.
Purpose: serve as a clean, minimal testbed for three local TTS engines (Pocket TTS,
Kokoro-FastAPI, Piper) over HTTP, plus LLM streaming and turn-taking behavior.
It is NOT part of the Hermes/Lars app — it only *borrows* the Lars venv to host the
`pocket-tts` server process (stock `pocket-tts serve`, no Lars code).

## Quick start

```
start-all.bat        (double-click)   — normal start
start-all.bat clean  (cmd window)     — full restart incl. TTS engines
```

Then Chrome opens / open http://localhost:4400. Click **Talk**, speak, stop talking;
after 2 s silence the LLM answers and TTS speaks it.

- `start-all.ps1` does the work; the `.bat` is only a double-clickable wrapper.
- Default run: stops/restarts **only the app**; engines are started **only if their
  port is down** (`already up, skip` otherwise).
- `-Clean` (= `start-all.bat clean`): stops all four, then starts + verifies each.
  Needed **only** after editing a TTS engine's own source code (e.g. `C:\Kokoro-FastAPI\api\**`),
  because cold reload of torch models takes 2–3 min per engine.
- The app itself restarts in ~2 s, so the normal dev loop is: edit app code → run
  `start-all.bat` → reload browser page.

## Architecture

```
Chrome (public/index.html)
  │ Web Speech STT (webkitSpeechRecognition)  — Chrome only
  │ 2 s silence timer → commit turn
  ▼
node server.js  (port 4400, stdlib only, no npm deps)
  ├─ POST /api/chat   stream:true → SSE passthrough from DeepInfra (OpenAI-compatible)
  │                   stream:false → JSON (used only as fallback)
  ├─ POST /api/tts    {engine, text} → proxies to the selected TTS server,
  │                   pipes the WAV body through as it arrives (no buffering)
  ├─ POST /api/ui-log appends browser log lines to ui.log
  └─ GET  /api/config model/key/engine URLs for the "Specs & log" panel
Engine servers (separate processes, managed by start-all.ps1):
  ├─ Pocket TTS :8001  `python -m pocket_tts serve --port 8001 --default-voice alba`
  │                    (runs from the Lars venv; POST /tts multipart form: text, voice_url)
  ├─ Kokoro-FastAPI :8880  runner script C:\Kokoro-FastAPI\kokoro-run.ps1 (9 env vars)
  │                        (OpenAI-compatible POST /v1/audio/speech, model "kokoro")
  └─ Piper :5000   `python -m piper.http_server -m voices/en_US-lessac-medium.onnx`
                   (POST /synthesize JSON {"text": ...})
```

Client streaming pipeline (index.html `send()`):
SSE deltas → sentence splitter (on `.!?…` followed by whitespace; remainder flushed
at stream end) → per-sentence `/api/tts` (max 2 in flight) → in-order gapless
playback (`queueT` scheduling) → mic re-arms when the first clip starts (barge-in).

## Current state (2026-10-02)

Working / verified:
- DeepInfra LLM: `zai-org/GLM-5.3-Flash` via key in `.env` (non-stream and SSE both verified).
- All three TTS engines return valid WAV via the app's `/api/tts` proxy (kokoro 1.5 s,
  pocket 1.0 s, piper 0.2 s per sentence after warm) and stream their HTTP bodies
  progressively (measured Pocket **TTFB 0.205 s** for a 2.6 s reply — a real file stream).
- App boots via start-all; engine processes verified; `ui.log` echo wired.
- Barge-in wiring exists client-side (speaking state, `stopAudio`, mic re-arm on first audio).

## Known bugs / TODO (as of 2026-10-02)

1. **Pocket streaming not felt end-to-end.** Pocket's `/tts` streams over HTTP (chunked),
   and `/api/tts` pipes it through — but the client does `decodeAudioData()` on the
   **whole response**, so playback of a sentence starts only when its full WAV arrived.
   Result: streaming is real on the wire, invisible to the ear. To fix: decode on the fly
   (e.g. fetch → stream → `AudioWorklet`/PCM hand-off) or crossfade-schedule sentence N+1
   while N plays. None of the three engines is *heard* streaming today; Kokoro/SSE audio
   (`stream:true`) not tried yet in the client.
2. **Self-hearing / feedback loop.** Without headphones the speaker output is picked up
   by the mic (Web Speech + barge-in hear the assistant's own voice). Must use headphones,
   or add echo cancellation (`echoCancellation: true` in getUserMedia constraints) — Web
   Speech API currently gives no mic constraints control; may need MediaStream track
   passthrough or switch STT to server-side.
3. **Barge-in threshold needs dev time.** `BARGE_GRACE_MS=500`, `BARGE_MIN_CHARS=4` were
   guesses; tune with ui.log timings.
4. **LLM reasoning latency.** DeepInfra GLM-5.3-Flash emits `reasoning_content` deltas
   before visible content; the client ignores them (correct) but they delay first token.
   If TTFA is slow, try disabling reasoning for this model or a non-thinking variant.
5. **Sentence splitter is naive.** "e.g." / "Mr." abbreviations split wrongly (they become
   short clips; playback handles it but it may sound choppy). Consider soft-pause rules.
6. **`favicon.ico` returns 204** silently in the log; fine.
7. **Kokoro first TTS request ~5 s** (lazy 1.3 GB model load); every later request fast.
   Pocket warms up at server start; Piper is instant.

## Files

```
server.js           node server: static + /api/chat (SSE) + /api/tts (piping proxy) + /api/ui-log
public/index.html   whole UI: STT, SSE reader, sentence queue, gapless playback, barge-in, log panel
.env                PORT, DEEPINFRA_API_KEY/MODEL/URL, SYSTEM_PROMPT, MAX_TOKENS,
                    *_URL engine endpoints (pocket on 8001, kokoro 8880, piper /synthesize),
                    *_CMD engine auto-launch commands (currently all blank — start-all.ps1 manages engines)
voices/             piper voice: en_US-lessac-medium.onnx(+json)
start-all.ps1 / start-all.bat   launcher: app restart; engines start-if-down; -Clean = stop all first
kokoro-run.ps1      (also copied to C:\Kokoro-FastAPI\)  runner with the 9 required env vars
ui.log / pocket.log / kokoro.log / piper.log / app.log   run logs
start.bat           legacy: opens Chrome + npm start (no engine management, engine cmds blank)
```

`.env` holds the DeepInfra key — never commit it. Gitignored along with logs and voices.
