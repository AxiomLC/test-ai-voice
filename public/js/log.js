// public/js/log.js — log panel + server-side echo.
// Every log line is shown in the right panel AND appended to ui.log by the server
// (/api/ui-log), so another session/thread can read the test history from disk.

export function log(msg, cls = '') {
  const d = document.createElement('div');
  d.className = cls;
  d.textContent = `${new Date().toLocaleTimeString()}  ${msg}`;
  document.querySelector('#log').append(d);
  document.querySelector('#log').scrollTop = 1e9;
  fetch('/api/ui-log', { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ cls, msg }) }).catch(() => {});
}

// Global error capture — same panel + echo
export function installErrorHandlers() {
  window.addEventListener('error', e => log('JS error: ' + e.message, 'err'));
  window.addEventListener('unhandledrejection', e => log('Unhandled: ' + (e.reason?.message || e.reason), 'err'));
}
