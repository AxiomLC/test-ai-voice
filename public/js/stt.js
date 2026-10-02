// public/js/stt.js — Speech recognition (Web Speech API, Chrome only) + turn logic.
//
// Turn flow: mic listens continuously; when the user stops speaking for SILENCE_MS
// (2 s) the accumulated transcript is "committed" (sent to the LLM).
//
// Barge-in: while the assistant is SPEAKING, recognized speech (after a grace window
// and minimum length, so playback doesn't cut itself) stops playback immediately.
//
// Known bug (see README #2): without headphones the mic hears the assistant's own
// voice → self-triggering. Web Speech API offers no getUserMedia constraint control,
// so echo cancellation can't be enabled from here; server-side STT is the alternative.

import { log } from './log.js';
import { state, setState, audio } from './state.js';

const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
export const SILENCE_MS = 2000;        // user silence that ends the turn
export const BARGE_GRACE_MS = 500;     // ignore STT heard < this long after speech starts (echo guard)
export const BARGE_MIN_CHARS = 4;      // barge-in needs at least this many chars heard

let rec = null, recRunning = false, buf = '', interim = '', silenceT = null;
let onCommit = null, onStopAudio = null;

export function init({ commit, stopAudio }) { onCommit = commit; onStopAudio = stopAudio; }
export const supported = () => !!SR;

// reset accumulated transcript (used when starting a fresh Talk press)
export function resetStt() { buf = ''; interim = ''; document.querySelector('#interim').textContent = '' }

export function startRec() {
  if (!SR || recRunning) return;
  rec = new SR();
  rec.lang = 'en-US'; rec.continuous = true; rec.interimResults = true;
  rec.onstart = () => { recRunning = true; if (state.phase !== 'speaking') setState('listening', 'Listening') };
  rec.onerror = e => {
    if (e.error === 'no-speech' || e.error === 'aborted') return;
    log('STT error: ' + e.error, 'err');
    if (e.error === 'not-allowed' || e.error === 'service-not-allowed') { state.armed = false; setState('idle', 'Mic blocked') }
  };
  rec.onend = () => {
    recRunning = false;
    if (state.armed && state.phase !== 'thinking') setTimeout(startRec, 150);   // auto-restart (Chrome stops rec often)
    else if (!state.armed && state.phase === 'listening') setState('idle');
  };
  rec.onresult = ev => {
    let fin = '', int = '';
    for (let i = ev.resultIndex; i < ev.results.length; i++) {
      const t = ev.results[i][0].transcript;
      ev.results[i].isFinal ? fin += t : int += t;
    }
    if (fin) buf += (buf ? ' ' : '') + fin.trim();
    interim = int;
    const heard = (buf + ' ' + interim).trim();
    document.querySelector('#interim').textContent = heard;
    if (!heard) return;
    // barge-in while assistant speaks
    if (state.phase === 'speaking') {
      if (performance.now() - audio.speakingStart < BARGE_GRACE_MS || heard.length < BARGE_MIN_CHARS) return;
      onStopAudio?.('barge-in'); setState('listening', 'Listening');
    }
    clearTimeout(silenceT); silenceT = setTimeout(commit, SILENCE_MS);
  };
  try { rec.start() } catch (e) { log('rec.start: ' + e.message, 'warn') }
}

function commit() {
  const text = (buf + ' ' + interim).trim(); buf = ''; interim = '';
  document.querySelector('#interim').textContent = '';
  if (!text) return;
  log(`Silence ${SILENCE_MS} ms → sending`);
  try { rec && rec.abort() } catch {} recRunning = false;   // mic closed while thinking; re-armed on first audio
  onCommit?.(text);
}

export function stopRec() { state.armed = false; clearTimeout(silenceT); try { rec && rec.abort() } catch {}; recRunning = false }
