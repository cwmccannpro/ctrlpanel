param(
  [string]$Model = 'qwen2.5vl:7b',
  [string]$Origin = 'https://ctrlpanel.cwmccann.pro',
  [string]$KeepAlive = '15m',
  [switch]$KeepCredential
)
# Installs the CTRLpanel desktop model bridge for this Windows user:
# encrypted key (DPAPI), private .local-ai folder, hidden task at logon.
# Needs Node 22+ and Ollama (https://ollama.com) with the model pulled.
$ErrorActionPreference = 'Stop'
$aiRoot = Split-Path $PSScriptRoot -Parent
$aiLocal = Join-Path $aiRoot '.local-ai'
$aiTask = 'CTRLpanel Local AI Bridge'
$aiBridge = Join-Path $PSScriptRoot 'local-ai-bridge.mjs'
$node = (Get-Command node.exe -ErrorAction SilentlyContinue).Source
if (!$node) { throw 'Node.js 22 or newer is required (node.exe not found on PATH).' }
New-Item -ItemType Directory -Path $aiLocal -Force | Out-Null

Stop-ScheduledTask -TaskName $aiTask -ErrorAction SilentlyContinue
Get-CimInstance Win32_Process | Where-Object { $_.Name -eq 'node.exe' -and $_.CommandLine -and $_.CommandLine.Contains($aiBridge) } | ForEach-Object { Stop-Process -Id $_.ProcessId -ErrorAction SilentlyContinue }

if (!$KeepCredential) {
  $aiKey = Read-Host 'Paste the desktop model key from Settings -> Nutrition (input hidden)' -AsSecureString
  $aiKey | ConvertFrom-SecureString | Set-Content -LiteralPath (Join-Path $aiLocal 'credential.dpapi')
}
if (!(Test-Path -LiteralPath (Join-Path $aiLocal 'credential.dpapi'))) { throw 'No desktop key installed.' }
[ordered]@{ origin = $Origin; ollama = 'http://127.0.0.1:11434'; model = $Model; keepAlive = $KeepAlive } |
  ConvertTo-Json | Set-Content -LiteralPath (Join-Path $aiLocal 'config.json') -Encoding utf8

$aiUser = [Security.Principal.WindowsIdentity]::GetCurrent().Name
& icacls.exe $aiLocal /inheritance:r /grant:r "${aiUser}:(OI)(CI)F" 'SYSTEM:(OI)(CI)F' | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'Could not restrict .local-ai permissions.' }

# conhost --headless runs node without a visible console window.
$aiAction = New-ScheduledTaskAction -Execute "$env:WINDIR\System32\conhost.exe" -Argument ('--headless "' + $node + '" "' + $aiBridge + '"') -WorkingDirectory $aiRoot
$aiTrigger = New-ScheduledTaskTrigger -AtLogOn -User $aiUser
$aiPrincipal = New-ScheduledTaskPrincipal -UserId $aiUser -LogonType Interactive -RunLevel Limited
$aiSettings = New-ScheduledTaskSettingsSet -ExecutionTimeLimit ([TimeSpan]::Zero) -RestartCount 5 -RestartInterval (New-TimeSpan -Minutes 1) -MultipleInstances IgnoreNew -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
Register-ScheduledTask -TaskName $aiTask -Action $aiAction -Trigger $aiTrigger -Principal $aiPrincipal -Settings $aiSettings -Description 'Outbound-only bridge that runs CTRLpanel meal estimates on this computer''s Ollama model.' -Force | Out-Null
Start-ScheduledTask -TaskName $aiTask

try { $tags = Invoke-RestMethod 'http://127.0.0.1:11434/api/tags' -TimeoutSec 3 } catch { $tags = $null }
if (!$tags) { Write-Warning 'Ollama is not running. Install it from https://ollama.com and start it; meals use Claude until then.' }
elseif (!($tags.models.name -contains $(if ($Model.Contains(':')) { $Model } else { "${Model}:latest" }))) { Write-Warning "Model $Model is not pulled yet. Run: ollama pull $Model" }
Write-Output "Desktop model bridge installed and started (model $Model). Log: .local-ai\bridge.log"
