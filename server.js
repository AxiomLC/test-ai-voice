// Test3-Voice-AI — single launcher. Serves UI + proxies LLM and TTS (keys stay server-side).
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { Readable } from 'node:stream';
import { fileURLToPath } from 'node:url';

const __dir = path.dirname(fileURLToPath(import.meta.url));
const E = process.env;
const PORT = +E.PORT || 4400;
const children = [];

// ---------- optional: launch TTS servers from this one process ----------
for (const k of ['KOKORO', 'POCKET', 'PIPER']) {
  const cmd = E[k + '_CMD'];
  if (!cmd) continue;
  const c = spawn(cmd, { shell: true, stdio: 'inherit' });
  c.on('exit', code => console.log(`[${k}] exited (${code})`));
  children.push(c);
  console.log(`[${k}] started: ${cmd}`);
}
const bye = () => { children.forEach(c => { try { c.kill(); } catch {} }); process.exit(); };
process.on('SIGINT', bye); process.on('SIGTERM', bye);

// ---------- TTS adapters: each returns a fetch Response with a WAV body ----------
const tts = {
  kokoro: text => fetch(E.KOKORO_URL, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: 'kokoro', input: text, voice: E.KOKORO_VOICE || 'af_heart',
                           response_format: 'wav', stream: false })
  }),
  pocket: text => {
    const f = new FormData(); f.append('text', text);
    if (E.POCKET_VOICE) f.append('voice_url', E.POCKET_VOICE);
    return fetch(E.POCKET_URL, { method: 'POST', body: f });
  },
  piper: text => fetch(E.PIPER_URL, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text })
  }),
};

// ---------- LLM ----------
async function llm(messages) {
  // >>> HERMES HOOK (commented placeholder) <<<
  // To route to a Hermes profile instead of DeepInfra, replace the fetch below with e.g.:
  //
  // const r = await fetch(process.env.HERMES_URL /* e.g. http://localhost:XXXX/chat */, {
  //   method: 'POST',
  //   headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.HERMES_TOKEN}` },
  //   body: JSON.stringify({ profile: process.env.HERMES_PROFILE, messages })
  // });
  // const j = await r.json();
  // return { text: j.reply /* map to Hermes response shape */, usage: j.usage };
  // See AxiomLC/lars13 for the Hermes connection notes.

  if (!E.DEEPINFRA_API_KEY || !E.DEEPINFRA_MODEL) throw new Error('Set DEEPINFRA_API_KEY and DEEPINFRA_MODEL in .env');
  const r = await fetch(E.DEEPINFRA_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${E.DEEPINFRA_API_KEY}` },
    body: JSON.stringify({
      model: E.DEEPINFRA_MODEL, max_tokens: +E.MAX_TOKENS || 300, stream: false,
      messages: [{ role: 'system', content: E.SYSTEM_PROMPT || 'Reply briefly.' }, ...messages]
    })
  });
  const j = await r.json();
  if (!r.ok) throw new Error(`DeepInfra ${r.status}: ${JSON.stringify(j).slice(0, 300)}`);
  return { text: j.choices?.[0]?.message?.content?.trim() || '', usage: j.usage };
}

// ---------- HTTP ----------
const body = req => new Promise(res => { let d = ''; req.on('data', c => d += c); req.on('end', () => res(d)); });
const json = (res, code, o) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(o)); };

http.createServer(async (req, res) => {
  try {
    if (req.method === 'GET' && req.url === '/api/config') {
      const cpu = os.cpus()[0]?.model || '?';
      return json(res, 200, {
        model: E.DEEPINFRA_MODEL || '(not set)', keySet: !!E.DEEPINFRA_API_KEY,
        engines: { kokoro: E.KOKORO_URL, pocket: E.POCKET_URL, piper: E.PIPER_URL },
        host: `${cpu}, ${(os.totalmem() / 2 ** 30).toFixed(1)} GB RAM, node ${process.version}`
      });
    }
    if (req.method === 'POST' && req.url === '/api/ui-log') {
      const { cls, msg } = JSON.parse(await body(req));
      fs.appendFileSync(path.join(__dir, 'ui.log'), `[${new Date().toLocaleTimeString()}] ${cls ? '['+cls+'] ' : ''}${msg}\n`);
      return json(res, 200, { ok: true });
    }
    if (req.method === 'POST' && req.url === '/api/chat') {
      const t0 = Date.now(); const { messages, stream } = JSON.parse(await body(req));
      if (!stream) { const out = await llm(messages); return json(res, 200, { ...out, ms: Date.now() - t0 }); }
      // SSE passthrough from DeepInfra (OpenAI-compatible)
      if (!E.DEEPINFRA_API_KEY || !E.DEEPINFRA_MODEL) return json(res, 500, { error: 'Set DEEPINFRA_API_KEY and DEEPINFRA_MODEL in .env' });
      const r = await fetch(E.DEEPINFRA_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${E.DEEPINFRA_API_KEY}` },
        body: JSON.stringify({
          model: E.DEEPINFRA_MODEL, max_tokens: +E.MAX_TOKENS || 300, stream: true,
          messages: [{ role: 'system', content: E.SYSTEM_PROMPT || 'Reply briefly.' }, ...messages]
        })
      });
      if (!r.ok) return json(res, 502, { error: `DeepInfra ${r.status}: ${(await r.text()).slice(0, 200)}` });
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', 'Connection': 'keep-alive' });
      return Readable.fromWeb(r.body).pipe(res);
    }
    if (req.method === 'POST' && req.url === '/api/tts') {
      const t0 = Date.now(); const { engine, text } = JSON.parse(await body(req));
      if (!tts[engine]) return json(res, 400, { error: 'unknown engine' });
      const r = await tts[engine](text);
      if (!r.ok) return json(res, 502, { error: `${engine} ${r.status}: ${(await r.text()).slice(0, 200)}` });
      // pipe the upstream body through as it arrives (enables TTS audio streaming)
      res.writeHead(200, { 'Content-Type': r.headers.get('content-type') || 'audio/wav', 'X-TTS-Ms': Date.now() - t0 });
      return Readable.fromWeb(r.body).pipe(res);
    }
    // static
    if (req.url === '/favicon.ico') { res.writeHead(204); return res.end(); }
    const f = path.join(__dir, 'public', req.url === '/' ? 'index.html' : req.url.split('?')[0]);
    if (!f.startsWith(path.join(__dir, 'public')) || !fs.existsSync(f)) { res.writeHead(404); return res.end('not found'); }
    res.writeHead(200, { 'Content-Type': f.endsWith('.html') ? 'text/html' : 'text/plain' });
    fs.createReadStream(f).pipe(res);
  } catch (e) {
    const refused = /fetch failed|ECONNREFUSED/.test(String(e) + String(e.cause));
    json(res, 500, { error: refused ? 'Could not reach upstream server (is the TTS/LLM server running?)' : e.message });
  }
}).listen(PORT, () => console.log(`Test3-Voice-AI → http://localhost:${PORT}  (open in Chrome)`));
