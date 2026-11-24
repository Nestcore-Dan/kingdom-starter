# Kingdom Core: start automatically after a restart (Kingdom 2.0, phase 1).
# Registers a scheduled task for this Windows user only ("Kingdom One"), at logon, plus a daily verified backup at 03:00.
# No administrator rights; nothing listens beyond 127.0.0.1. Remove with:  Unregister-ScheduledTask -TaskName "Kingdom One*"
# Run only with the Chief's yes: it changes this computer's start-up.
$root = Split-Path -Parent $PSScriptRoot
$start = New-ScheduledTaskAction -Execute "$root\tools\start_kingdom.cmd" -WorkingDirectory $root
$atLogon = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit (New-TimeSpan -Hours 0) -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 5)
Register-ScheduledTask -TaskName "Kingdom One" -Action $start -Trigger $atLogon -Settings $settings -Description "Kingdom One village and Kingdom Core (subscription only, local only)" -Force | Out-Null
$backup = New-ScheduledTaskAction -Execute "python" -Argument "tools\backup.py" -WorkingDirectory $root
$daily = New-ScheduledTaskTrigger -Daily -At 3am
Register-ScheduledTask -TaskName "Kingdom One backup" -Action $backup -Trigger $daily -Settings $settings -Description "Kingdom One: daily backup with a verified restore" -Force | Out-Null
Write-Output "Installed: 'Kingdom One' (at logon) and 'Kingdom One backup' (daily 03:00)."
