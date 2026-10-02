// lib/env.js — single place that exposes the process env (list of TTS config vars).
// Kept separate so lib files stay importable/isolated in tests.
export default process.env;
