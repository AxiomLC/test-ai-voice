# Runner used by start-all.ps1 ( Kokoro needs these exact env vars )
$env:USE_GPU = $env:USE_ONNX = $false
$env:PYTHONUTF8 = '1'
$env:PYTHONIOENCODING = 'utf-8'
$env:PYTHONPATH = 'C:\Kokoro-FastAPI;C:\Kokoro-FastAPI\api'
$env:MODEL_DIR = 'src\models'
$env:VOICES_DIR = 'src\voices\v1_0'
$env:WEB_PLAYER_PATH = 'C:\Kokoro-FastAPI\web'
$env:PHONEMIZER_ESPEAK_LIBRARY = 'C:\Program Files\eSpeak NG\libespeak-ng.dll'
$env:ESPEAK_DATA_PATH = 'C:\Program Files\eSpeak NG\espeak-ng-data'

Set-Location 'C:\Kokoro-FastAPI'
& .\venv\Scripts\uvicorn.exe api.src.main:app --host 0.0.0.0 --port 8880 *>> kokoro.log
