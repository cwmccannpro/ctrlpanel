# Entry point for the optional Windows logon task. Credentials and the vault
# path remain in the ignored .env.local file beside the app checkout.
$ErrorActionPreference = 'Stop'
$workspacePath = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
Set-Location -LiteralPath $workspacePath
& node (Join-Path $PSScriptRoot 'ctrlpanel-vault-sync.mjs') --watch
exit $LASTEXITCODE
