// public/js/tts-scheduler.js — the audio pipeline: LLM SSE → sentences → TTS → gapless playback.
//
// This is the heart of the client. It is engine-agnostic: engines are just an
// /api/tts engine name; their differences live in the server lib/tts-*.js adapters.
//
// Pipeline (one per user turn):
//   1. POST /api/chat {stream:true} → SSE deltas from DeepInfra (via server passthrough)
//   2. Sentence splitter: committed only on ".!?…" terminator FOLLOWED BY whitespace,
//      so a terminator at the very end of a chunk waits for the next chunk (safe,
//      stable prefix — never re-splits what was already dispatched). Remainder of the
//      reply is flushed as a final sentence when the stream ends.
//   3. Each sentence → POST /api/tts {engine,text} (max 2 requests in flight)
//   4. An AudioBuffer slot array keeps playback STRICTLY in sentence order while
//      synthesis completes out of order; gapless via queueT schedule-ahead.
//   5. First scheduled clip: state → speaking, mic re-arms (barge-in armed).
//
// KNOWN LIMIT (README bug #1): each sentence's WAV is decodeAudioData()ed in FULL
// before playing, so engines that stream over HTTP (pocket TTFB 0.2 s) still can't
// be HEARD streaming — playback waits for the complete sentence WAV. To make
// streaming audible: decode/queue progressively (AudioWorklet / PCM passthrough).
//
// NOTE: streaming only works if the chat POST is answered with text/event-stream
// (server does SSE passthrough when {stream:true}).

import { log } from './log.js';
import { state, audio, setState } from './state.js';

// ---------- sentence split (batch variant, kept for potential non-stream fallback) ----------
export function splitSentences(t) {
  const parts = t.replace(/\s+/g, ' ').match(/[^.!?…]+[.!?…]+["')\]]*\s*|[^.!?…]+$/g) || [t];
  const out = [];
  for (const p of parts) {
    const s = p.trim(); if (!s) continue;
    if (out.length && out[out.length - 1].length < 25) out[out.length - 1] += ' ' + s; else out.push(s);
  }
  return out;
}

// ---------- TTS fetch + decode ----------
async function ttsFetch(text, engine) {
  const t0 = performance.now();
  const r = await fetch('/api/tts', { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ engine, text }) });
  if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || ('TTS HTTP ' + r.status));
  const ab = await r.arrayBuffer(); const ms = Math.round(performance.now() - t0);
  const dur = ab.byteLength / 48000; // rough (24kHz 16bit mono ≈ 48kB/s) until decoded
  const clip = await audio.audioCtx().decodeAudioData(ab);
  log(`TTS[${engine}] "${text.slice(0, 30)}…" ${ms} ms → ${clip.duration.toFixed(2)}s audio (RTF ${(ms / 1000 / clip.duration).toFixed(2)})`,
    ms / 1000 > clip.duration ? 'warn' : '');
  return clip;
}

// ---------- gapless playback scheduling ----------
function scheduleAudio(clip, myGen, { startRec }) {
  const c = audio.audioCtx(), src = c.createBufferSource();
  src.buffer = clip; src.connect(c.destination);
  const start = Math.max(c.currentTime + 0.03, audio.queueT);
  src.start(start); audio.queueT = start + clip.duration;
  audio.sources.push(src);
  if (!audio.firstLogged) {
    audio.firstLogged = true;
    const wait = Math.max(0, (start - c.currentTime) * 1000);
    setTimeout(() => {
      if (audio.gen !== myGen) return;
      audio.speakingStart = performance.now();
      setState('speaking', 'Speaking');
      if (state.rearm) { log('Mic re-armed (barge-in active)'); state.armed = true; startRec(); } // re-arm hook
    }, wait);
  }
  return new Promise(res => { src.onended = () => { audio.sources = audio.sources.filter(s => s !== src); res() } });
}

// ---------- the turn pipeline ----------
// deps: { history, bubble, startRec } are injected from app.js (DOM chat + mic re-arm)
export async function speakTurn(text, engine, { history, bubble, startRec }) {
  audio.stop();                       // fresh turn: kill any leftovers
  const my = audio.gen;               // generation id for THIS turn
  audio.firstLogged = false;
  setState('thinking', 'Thinking…');
  const tSend = performance.now();

  let wait = bubble('a', '…', 'i'); let live = null; let full = '';
  const deps = { history, bubble, startRec };
  const slots = [], resolved = []; let nextPlay = 0, active = 0, ended = false, pending = [];

  const drainPending = () => {
    while (active < 2 && pending.length) {
      const [i, s] = pending.shift(); active++;
      ttsFetch(s, engine).then(a => { if (audio.gen !== my) return; slots[i] = a; resolved[i] = true; active--; tryPlay() })
        .catch(e => { if (audio.gen !== my) return; log('TTS error: ' + e.message, 'err'); resolved[i] = true; active--; tryPlay() });
    }
  };
  const tryPlay = async () => {
    while (nextPlay < slots.length) {
      if (!resolved[nextPlay]) return;                 // in-order playback
      const a = slots[nextPlay++];
      if (a) { await scheduleAudio(a, my, deps); if (audio.gen !== my) return;
        if (nextPlay === 1) log(`TTFA (send → first audio): ${Math.round(performance.now() - tSend)} ms`, 'ok'); }
    }
    if (ended && active === 0 && nextPlay >= slots.length) {
      log('Playback done');
      setState(state.armed && state.rearm ? 'listening' : 'idle', state.armed && state.rearm ? 'Listening' : 'Idle');
    }
  };
  const pushSentence = s => { if (!s.trim()) return; const i = slots.length; slots.push(null); pending.push([i, s]); drainPending() };

  try {
    const r = await fetch('/api/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages: history.slice(-12), stream: true }) });
    if ((r.headers.get('content-type') || '').includes('application/json')) { const j = await r.json(); throw new Error(j.error || ('HTTP ' + r.status)) }
    const reader = r.body.getReader(), dec = new TextDecoder();
    let acc = '', consumed = 0, usage = null, firstTok = 0, nDelta = 0;
    while (true) {
      const { done, value } = await reader.read(); if (done) break;
      acc += dec.decode(value, { stream: true }); let ix;
      while ((ix = acc.indexOf('\n\n')) >= 0) {
        const chunk = acc.slice(0, ix); acc = acc.slice(ix + 2);
        for (const line of chunk.split('\n')) {
          if (!line.startsWith('data:')) continue;
          const payload = line.slice(5).trim(); if (payload === '[DONE]') continue;
          let j; try { j = JSON.parse(payload) } catch { continue }
          if (j.error && j.message) throw new Error(j.message);
          if (j.error) throw new Error(JSON.stringify(j.error).slice(0, 200));
          const d = j.choices?.[0]?.delta?.content || '';
          if (d) {
            if (!firstTok) { firstTok = performance.now() - tSend; wait && wait.remove && wait.remove(); wait = null; live = bubble('a', '') }
            full += d; if (live) live.textContent = full; nDelta++;
          }
          if (j.usage) usage = j.usage;
        }
      }
      // emit completed sentences (terminator followed by whitespace = safe)
      let seg = full.slice(consumed), m;
      while ((m = seg.match(/^[\s\S]*?[.!?…]+["')\]]*(?=\s)/))) {
        consumed += m[0].length; pushSentence(m[0].trim());
        seg = full.slice(consumed);
      }
    }
    ended = true;
    const rest = full.slice(consumed).trim(); if (rest) pushSentence(rest);
    log(`LLM stream: first token ${Math.round(firstTok)} ms, ${nDelta} deltas, total ${Math.round(performance.now() - tSend)} ms${usage ? `, ${usage.completion_tokens} tok` : ''}`, 'ok');
    history.push({ role: 'assistant', content: full });
    tryPlay();
  } catch (e) {
    wait && wait.remove && wait.remove(); live && live.remove && live.remove();
    log('Chat error: ' + e.message, 'err'); bubble('a', 'Error: ' + e.message, 'i');
    if (full) history.push({ role: 'assistant', content: full });
    setState(state.armed ? 'listening' : 'idle');
  }
}
