$ErrorActionPreference = 'Stop'
$roomRoot = Split-Path $PSScriptRoot -Parent
$roomLocal = Join-Path $roomRoot '.room-local'
$roomConfig = Get-Content -LiteralPath (Join-Path $roomLocal 'config.json') -Raw | ConvertFrom-Json
& $roomConfig.python (Join-Path $PSScriptRoot 'room-bridge.py')
exit $LASTEXITCODE
