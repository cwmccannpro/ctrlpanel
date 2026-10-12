# Daily CTRLpanel context sync (config: tools/context-projects.json).
# Credentials are read by node from the ignored .env.local file; nothing secret is logged here.
$ErrorActionPreference = 'Continue'
$workspacePath = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
Set-Location -LiteralPath $workspacePath
$output = & node (Join-Path $PSScriptRoot 'ctrlpanel-file-sync.mjs') @args 2>&1 | ForEach-Object { "$_" }
$code = $LASTEXITCODE
@("[$(Get-Date -Format o)] exit $code") + $output | Set-Content -LiteralPath (Join-Path $workspacePath '.context-sync-run.local') -Encoding UTF8
exit $code