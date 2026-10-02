// public/js/app.js — boot + wiring: config panel, chat state, UI controls.
// Owns: chat history, bubbles, engine picker, buttons. Delegates:
//   STT/turn logic      → stt.js     (startRec/stopRec, silence timer, barge-in)
//   LLM/TTS/playback    → tts-scheduler.js (speakTurn)
//   Logging             → log.js     (panel + ui.log echo)

import { log, installErrorHandlers } from './log.js';
import { state, setState, audio } from './state.js';
import { init as initStt, startRec, stopRec, supported, resetStt } from './stt.js';
import { speakTurn } from './tts-scheduler.js';

const $ = s => document.querySelector(s);
installErrorHandlers();

let history = [];

// ---------- chat DOM ----------
function bubble(role, text, cls = '') {
  const d = document.createElement('div');
  d.className = `m ${role} ${cls}`; d.textContent = text;
  $('#chat').append(d); $('#chat').scrollTop = 1e9;
  return d;
}

// ---------- config/specs panel ----------
fetch('/api/config').then(r => r.json()).then(c => {
  $('#specs').textContent =
    `Host   ${c.host}\nGPU    none (Intel Iris Xe, CPU inference)\nLLM    ${c.model}  key:${c.keySet ? 'set' : 'MISSING'}\nKokoro ${c.engines.kokoro}\nPocket ${c.engines.pocket}\nPiper  ${c.engines.piper}\nSTT    ${supported() ? 'Web Speech (Chrome)' : 'NOT SUPPORTED — use Chrome'}\nSilence timeout 2000 ms`;
  if (!c.keySet) log('DEEPINFRA_API_KEY missing in .env', 'err');
}).catch(e => log('config failed: ' + e.message, 'err'));
if (!supported()) log('Web Speech API unavailable. Use Chrome (typing still works).', 'err');

// ---------- STT wiring (turn commit → speakTurn) ----------
initStt({
  commit: text => send(text),
  stopAudio: reason => audio.stop(reason),
});

// ---------- shared send ----------
async function send(text) {
  $('#mic').blur();
  try { await speakTurn(text, state.engine, { history, bubble, startRec }); }
  catch (e) { log('send failed: ' + e.message, 'err'); }
}

// ---------- controls ----------
$('#mic').onclick = () => {
  audio.audioCtx(); // unlock audio on user gesture
  if (state.armed || state.phase === 'speaking' || state.phase === 'listening') {
    stopRec(); audio.stop('user stop'); setState('idle'); log('Stopped'); return;
  }
  state.armed = true; resetStt();
  log('Talk pressed'); startRec();
};
$('#stop').onclick = () => { stopRec(); audio.stop('stop button'); setState('idle'); log('Stopped') };
$('#rearm').onclick = e => {
  state.rearm = !state.rearm; e.target.classList.toggle('on', state.rearm);
  e.target.textContent = 'Re-arm: ' + (state.rearm ? 'On' : 'Off'); log('Re-arm ' + (state.rearm ? 'ON' : 'OFF'), 'warn');
};
$('#engines').onclick = e => {
  const b = e.target.closest('button'); if (!b) return; state.engine = b.dataset.e;
  document.querySelectorAll('#engines button').forEach(x => x.classList.toggle('on', x === b));
  log('TTS engine → ' + state.engine, 'warn');
};
$('#kbd').onclick = e => {
  const on = $('#typed').style.display !== 'flex';
  $('#typed').style.display = on ? 'flex' : 'none'; e.target.classList.toggle('on', on);
  if (on) $('#txt').focus();
};
const sendTyped = () => { const t = $('#txt').value.trim(); if (!t) return; $('#txt').value = ''; audio.audioCtx(); send(t) };
$('#send').onclick = sendTyped;
$('#txt').onkeydown = e => { if (e.key === 'Enter') sendTyped() };
$('#clear').onclick = () => { $('#chat').innerHTML = ''; history = []; log('Chat cleared') };
