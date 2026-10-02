// public/js/state.js — tiny shared state bus.
// The UI state machine (idle | listening | thinking | speaking) drives CSS
// (body[data-s=…]) and the status label; modules import `state`/`setState`/`log`
// instead of having their own copies.

export const state = { engine: 'kokoro', rearm: true, armed: false, phase: 'idle' };
export let logRef = null;
export function bindLog(fn) { logRef = fn; }

export function setState(phase, label) {
  state.phase = phase;
  document.body.dataset.s = phase;
  document.querySelector('#status').textContent = label || phase[0].toUpperCase() + phase.slice(1);
}

// ---------- shared audio/playback primitives (used by tts-scheduler) ----------
export const audio = {
  ctx: null, sources: [], queueT: 0, speakingStart: 0, gen: 0, firstLogged: false,

  audioCtx() {
    if (!this.ctx) this.ctx = new AudioContext();
    if (this.ctx.state === 'suspended') this.ctx.resume();
    return this.ctx;
  },
  // Bump generation: invalidates every in-flight/queued clip belonging to older gens.
  stop(reason) {
    this.gen++;
    this.sources.forEach(s => { try { s.onended = null; s.stop() } catch {} });
    this.sources = []; this.queueT = 0;
    if (logRef && reason) logRef('Playback cut: ' + reason, 'warn');
  },
};

export { logRef as _logRef };
