# start-all.ps1 - start the app + verify engines; start any missing engine.
# Default: fast path (never touches running engines). Use -Clean to stop all first
# (only needed when you edited a TTS engine's own source code).
# Engines log to: pocket.log / pocket.err.log / kokoro.log / piper.log / app.log

param([switch]$Clean)

$ErrorActionPreference = 'Stop'

$proj   = 'C:\Users\q1fre\ZED\test_voice_ai_20261002'
$pocket = 'C:\Users\q1fre\AppData\Local\hermes\desktop-plugins\lars\voice\.venv\Scripts\python.exe'

function Test-Port($port) {
  try { $c = New-Object Net.Sockets.TcpClient; $c.Connect('127.0.0.1', $port); $c.Close(); return $true }
  catch { return $false }
}
function Wait-Port($port, $name, $timeoutS) {
  $t0 = Get-Date
  while (((Get-Date) - $t0).TotalSeconds -le $timeoutS) {
    if (Test-Port $port) { Write-Host "  [ok] $name up on :$port"; return $true }
    Start-Sleep -Milliseconds 1000
  }
  Write-Host "  [FAIL] $name not listening on :$port after $timeoutS s (check its .log)" -ForegroundColor Red
  return $false
}

# ---------- 1. stop ----------
if ($Clean) {
  Write-Host '== CLEAN: stopping app + all TTS engines =='
  foreach ($port in 4400, 8001, 8880, 5000) {
    $pids = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue | Select-Object -Expand OwningProcess -Unique
    foreach ($p in $pids) {
      Write-Host "  stop pid $p (port $port)"
      Stop-Process -Id $p -Force -ErrorAction SilentlyContinue
    }
  }
  Start-Sleep -Seconds 2
}
else {
  Write-Host '== Stopping app only (engines stay warm) =='
  $pids = Get-NetTCPConnection -LocalPort 4400 -State Listen -ErrorAction SilentlyContinue | Select-Object -Expand OwningProcess -Unique
  foreach ($p in $pids) { Write-Host "  stop pid $p (app, port 4400)"; Stop-Process -Id $p -Force -ErrorAction SilentlyContinue }
  Start-Sleep -Seconds 1
}

# ---------- 2. engines: start only if missing ----------
Write-Host '== Pocket TTS :8001 =='
if (Test-Port 8001) { Write-Host '  already up, skip' }
else {
  Write-Host '  starting (cold start can take 2-3 min)...'
  Start-Process -WindowStyle Hidden -FilePath $pocket `
    -ArgumentList '-m','pocket_tts','serve','--port','8001','--default-voice','alba' `
    -WorkingDirectory $proj -RedirectStandardOutput "$proj\pocket.log" -RedirectStandardError "$proj\pocket.err.log"
  Wait-Port 8001 'Pocket' 180 | Out-Null
}

Write-Host '== Kokoro-FastAPI :8880 =='
if (Test-Port 8880) { Write-Host '  already up, skip' }
else {
  Write-Host '  starting (cold start can take 2-3 min)...'
  Start-Process -WindowStyle Hidden -FilePath 'powershell' -ArgumentList '-NoProfile','-ExecutionPolicy','Bypass','-File','C:\Kokoro-FastAPI\kokoro-run.ps1'
  Wait-Port 8880 'Kokoro' 240 | Out-Null
}

Write-Host '== Piper :5000 =='
if (Test-Port 5000) { Write-Host '  already up, skip' }
else {
  Write-Host '  starting...'
  Start-Process -WindowStyle Hidden -FilePath 'python' `
    -ArgumentList '-m','piper.http_server','-m',"$proj\voices\en_US-lessac-medium.onnx",'--port','5000' `
    -WorkingDirectory $proj -RedirectStandardOutput "$proj\piper.log" -RedirectStandardError "$proj\piper.err.log"
  Wait-Port 5000 'Piper' 60 | Out-Null
}

# ---------- 3. app: always (re)start ----------
Write-Host '== App :4400 =='
# In -Clean mode it was already stopped above; otherwise stopped just before this.
Start-Process -WindowStyle Hidden -FilePath 'node' -ArgumentList '--env-file=.env','server.js' `
  -WorkingDirectory $proj -RedirectStandardOutput "$proj\app.log" -RedirectStandardError "$proj\app.err.log"
Wait-Port 4400 'App' 60 | Out-Null

# ---------- 4. health summary ----------
Write-Host ''
Write-Host '== Status =='
$items = @()
$items += ,@('Pocket', 8001)
$items += ,@('Kokoro', 8880)
$items += ,@('Piper', 5000)
$items += ,@('App', 4400)
foreach ($x in $items) {
  $ok = Test-Port $x[1]
  $tag = if ($ok) { '[ok]  ' } else { '[DOWN]' }
  Write-Host "  $tag $($x[0]) :$($x[1])"
}
Write-Host ''
Write-Host 'Open http://localhost:4400'
