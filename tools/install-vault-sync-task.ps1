# Installs/updates a per-user, hidden logon task for continuous vault sync.
$ErrorActionPreference = 'Stop'
$workspacePath = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$envPath = Join-Path $workspacePath '.env.local'
if (-not (Test-Path -LiteralPath $envPath)) { throw 'Create .env.local before installing vault sync.' }
$config = @{}
Get-Content -LiteralPath $envPath | ForEach-Object {
  if ($_ -match '^([A-Z0-9_]+)=(.*)$') { $config[$matches[1]] = $matches[2].Trim('"') }
}
foreach ($name in 'CTRLPANEL_URL','CTRLPANEL_VAULT_ROOT') {
  if (-not $config[$name]) { throw "Set $name in .env.local before installing vault sync." }
}
if (-not ($config['CTRLPANEL_VAULT_KEY'] -or $config['CTRLPANEL_CONTEXT_KEY'])) { throw 'Set CTRLPANEL_VAULT_KEY in .env.local before installing vault sync.' }
if (-not (Test-Path -LiteralPath $config['CTRLPANEL_VAULT_ROOT'] -PathType Container)) { throw 'CTRLPANEL_VAULT_ROOT is not an existing directory.' }
if (-not (Get-Command node -ErrorAction SilentlyContinue)) { throw 'Node.js must be available on PATH.' }

$taskName = 'CTRLpanel Markdown Vault Sync'
$runner = Join-Path $PSScriptRoot 'run-vault-sync.ps1'
$action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$runner`"" -WorkingDirectory $workspacePath
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable -ExecutionTimeLimit ([TimeSpan]::Zero)
$principal = New-ScheduledTaskPrincipal -UserId ([Security.Principal.WindowsIdentity]::GetCurrent().Name) -LogonType Interactive -RunLevel Limited
Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Settings $settings -Principal $principal -Description 'Keeps the local Markdown vault and CTRLpanel Knowledge in two-way sync.' -Force | Out-Null
Start-ScheduledTask -TaskName $taskName
Write-Output "Installed and started: $taskName"
