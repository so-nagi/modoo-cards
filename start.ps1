param([switch]$Local, [int]$Port = 4190, [switch]$Build)
$ErrorActionPreference = 'Stop'
$appRoot = $PSScriptRoot
$pythonPath = Join-Path $appRoot '.venv\Scripts\python.exe'
if (-not (Test-Path -LiteralPath $pythonPath)) { throw 'Python 환경이 없습니다. README.md의 설치 절차를 먼저 실행하세요.' }
if ($Build -or -not (Test-Path -LiteralPath (Join-Path $appRoot 'dist\index.html'))) {
  Push-Location -LiteralPath $appRoot
  try { & npm.cmd run build; if ($LASTEXITCODE -ne 0) { throw '앱 빌드 실패' } } finally { Pop-Location }
}
$url = "http://127.0.0.1:$Port"
try {
  $health = Invoke-RestMethod "$url/api/health" -TimeoutSec 2
  if ($health.engine -eq 'anki') { Write-Output "이미 실행 중: $url"; exit 0 }
} catch {}
$logRoot = Join-Path $appRoot 'logs'
New-Item -ItemType Directory -Force -Path $logRoot | Out-Null
$oldLocal = $env:MODOO_LOCAL_AUTH
$oldData = $env:MODOO_DATA_DIR
try {
  if ($Local) { $env:MODOO_LOCAL_AUTH = '1'; $env:MODOO_DATA_DIR = Join-Path $appRoot 'data-local' }
  else { $env:MODOO_LOCAL_AUTH = $null; $env:MODOO_DATA_DIR = Join-Path $appRoot 'data' }
  $process = Start-Process -FilePath $pythonPath -ArgumentList @('-m', 'uvicorn', 'server.app:app', '--host', '127.0.0.1', '--port', "$Port") -WorkingDirectory $appRoot -WindowStyle Hidden -RedirectStandardOutput (Join-Path $logRoot "server-$Port.out.log") -RedirectStandardError (Join-Path $logRoot "server-$Port.err.log") -PassThru
  for ($attempt = 0; $attempt -lt 20; $attempt++) {
    Start-Sleep -Milliseconds 300
    if ($process.HasExited) { throw "서버 시작 실패. logs/server-$Port.err.log를 확인하세요." }
    try { $health = Invoke-RestMethod "$url/api/health" -TimeoutSec 1; if ($health.ok) { break } } catch {}
  }
  if (-not $health.ok) { throw '서버 시작을 확인하지 못했습니다. 로그를 확인하세요.' }
  [pscustomobject]@{ url = $url; mode = $(if ($Local) { 'local' } else { 'Google' }); processId = $process.Id } | ConvertTo-Json
} finally { $env:MODOO_LOCAL_AUTH = $oldLocal; $env:MODOO_DATA_DIR = $oldData }
