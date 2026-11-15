param([string]$Python = '', [switch]$KeepCredential)
$ErrorActionPreference = 'Stop'
$roomRoot = Split-Path $PSScriptRoot -Parent
$roomLocal = Join-Path $roomRoot '.room-local'
New-Item -ItemType Directory -Path $roomLocal -Force | Out-Null
$roomConfigPath = Join-Path $roomLocal 'config.json'
if (!(Test-Path -LiteralPath $roomConfigPath)) { throw 'Provision .room-local/config.json with the approved lights first. See docs/room-control.md.' }
$roomConfig = Get-Content -LiteralPath $roomConfigPath -Raw | ConvertFrom-Json
if ($Python) { $roomConfig.python = $Python }
if (!(Test-Path -LiteralPath $roomConfig.python)) { throw 'Supply -Python with the full path to Python 3.12 or newer.' }
$roomTask = 'CTRLpanel Room Bridge'
$roomBridgePath = Join-Path $PSScriptRoot 'room-bridge.py'
Stop-ScheduledTask -TaskName $roomTask -ErrorAction SilentlyContinue
# Release loaded Bluetooth DLLs before updating dependencies. Match this exact script.
Get-CimInstance Win32_Process | Where-Object { $_.Name -in @('python.exe','pythonw.exe') -and $_.CommandLine -and $_.CommandLine.Contains($roomBridgePath) } | ForEach-Object { Stop-Process -Id $_.ProcessId -ErrorAction SilentlyContinue }
& $roomConfig.python -m pip install --target (Join-Path $roomLocal 'pydeps') -r (Join-Path $PSScriptRoot 'room-requirements.txt') --upgrade
if ($LASTEXITCODE -ne 0) { throw 'Bluetooth dependency installation failed.' }
if (!$KeepCredential) {
    $roomKey = Read-Host 'Paste the Room Control desktop key (input hidden)' -AsSecureString
    $roomKey | ConvertFrom-SecureString | Set-Content -LiteralPath (Join-Path $roomLocal 'credential.dpapi')
}
if (!(Test-Path -LiteralPath (Join-Path $roomLocal 'credential.dpapi'))) { throw 'No desktop credential installed.' }
$roomConfig | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $roomConfigPath
$roomUser = [Security.Principal.WindowsIdentity]::GetCurrent().Name
& icacls.exe $roomLocal /inheritance:r /grant:r "${roomUser}:(OI)(CI)F" 'SYSTEM:(OI)(CI)F' | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'Could not restrict local controller files.' }
$roomPythonWindowless = Join-Path (Split-Path $roomConfig.python -Parent) 'pythonw.exe'
if (!(Test-Path -LiteralPath $roomPythonWindowless)) { throw 'This Python installation needs pythonw.exe for hidden background operation.' }
$roomAction = New-ScheduledTaskAction -Execute $roomPythonWindowless -Argument ('"' + $roomBridgePath + '"') -WorkingDirectory $roomRoot
$roomTrigger = New-ScheduledTaskTrigger -AtLogOn -User $roomUser
$roomPrincipal = New-ScheduledTaskPrincipal -UserId $roomUser -LogonType Interactive -RunLevel Limited
$roomSettings = New-ScheduledTaskSettingsSet -ExecutionTimeLimit ([TimeSpan]::Zero) -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1) -MultipleInstances IgnoreNew -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
Register-ScheduledTask -TaskName $roomTask -Action $roomAction -Trigger $roomTrigger -Principal $roomPrincipal -Settings $roomSettings -Description 'Outbound-only Bluetooth light controller for CTRLpanel.' -Force | Out-Null
Start-ScheduledTask -TaskName $roomTask
Write-Output 'Room bridge installed and started. Keep this desktop awake for remote control.'
