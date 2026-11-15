$ErrorActionPreference = 'Stop'
$roomRoot = Split-Path $PSScriptRoot -Parent
$roomLocal = Join-Path $roomRoot '.room-local'
$roomConfig = Get-Content -LiteralPath (Join-Path $roomLocal 'config.json') -Raw | ConvertFrom-Json
$roomEncrypted = (Get-Content -LiteralPath (Join-Path $roomLocal 'credential.dpapi') -Raw).Trim()
$roomSecure = ConvertTo-SecureString $roomEncrypted
$roomPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($roomSecure)
try {
    $env:ROOM_BRIDGE_KEY = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($roomPointer)
    & $roomConfig.python (Join-Path $PSScriptRoot 'room-bridge.py')
    exit $LASTEXITCODE
} finally {
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($roomPointer)
    Remove-Item Env:ROOM_BRIDGE_KEY -ErrorAction SilentlyContinue
}
