$ErrorActionPreference = 'Stop'

$root = Resolve-Path (Join-Path $PSScriptRoot '..')
$pidFile = Join-Path $root '.run-logs\dev-stack-pids.json'

if (!(Test-Path -LiteralPath $pidFile)) {
  Write-Host 'No HIVE dev stack PID file found.'
  exit 0
}

$stack = Get-Content -LiteralPath $pidFile -Raw | ConvertFrom-Json
foreach ($processId in @($stack.backendPid, $stack.frontendPid)) {
  if (!$processId) {
    continue
  }
  $process = Get-Process -Id $processId -ErrorAction SilentlyContinue
  if ($process) {
    Stop-Process -Id $processId -Force
    Write-Host "Stopped process $processId."
  }
}

Remove-Item -LiteralPath $pidFile -Force
Write-Host 'HIVE dev stack stopped.'
