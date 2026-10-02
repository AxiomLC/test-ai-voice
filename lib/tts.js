// lib/tts.js — TTS adapter registry.
// server.js imports `tts` from here; each engine lives in its own tts-<name>.js file.
// An adapter is a function: async (text: string) => fetch Response with an audio body.
// The response body is piped straight to the browser (do NOT buffer it) so engines
// that stream over HTTP (pocket, kokoro) deliver their first bytes early.

// To add an engine: write lib/tts-<name>.js exporting the same shape, then add one line here.
import pocket from './tts-pocket.js';
import kokoro from './tts-kokoro.js';
import piper from './tts-piper.js';

export const tts = { pocket, kokoro, piper };
