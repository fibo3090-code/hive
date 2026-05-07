$ErrorActionPreference = 'Stop'

$root = Resolve-Path (Join-Path $PSScriptRoot '..')
$logDir = Join-Path $root '.run-logs'
New-Item -ItemType Directory -Force -Path $logDir | Out-Null

$pidFile = Join-Path $logDir 'dev-stack-pids.json'

if (Test-Path -LiteralPath $pidFile) {
  $existing = Get-Content -LiteralPath $pidFile -Raw | ConvertFrom-Json
  $alive = @($existing.backendPid, $existing.frontendPid) | Where-Object {
    $_ -and (Get-Process -Id $_ -ErrorAction SilentlyContinue)
  }
  if ($alive.Count -gt 0) {
    Write-Host "HIVE dev stack already appears to be running. Use 'just down' first."
    exit 1
  }
}

$backend = Start-Process -FilePath 'powershell.exe' `
  -ArgumentList @(
    '-NoLogo',
    '-NoExit',
    '-Command',
    "Set-Location '$root\back-end'; cargo run -p hive-api -- serve"
  ) `
  -PassThru

$frontend = Start-Process -FilePath 'powershell.exe' `
  -ArgumentList @(
    '-NoLogo',
    '-NoExit',
    '-Command',
    "Set-Location '$root\front-end'; npm run dev"
  ) `
  -PassThru

@{
  backendPid = $backend.Id
  frontendPid = $frontend.Id
  startedAt = (Get-Date).ToString('o')
} | ConvertTo-Json | Set-Content -LiteralPath $pidFile

Write-Host "HIVE dev stack started."
Write-Host "Backend PID: $($backend.Id)"
Write-Host "Frontend PID: $($frontend.Id)"
Write-Host "Use 'just down' to stop both."
