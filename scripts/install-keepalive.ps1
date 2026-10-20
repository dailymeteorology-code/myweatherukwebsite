# Registers the keep-alive to start hidden whenever this user logs on, and re-launches it every
# 5 minutes. Task Scheduler's "restart on failure" only covers a task that fails to START, so on
# 20 Oct 2026 a watchdog that was terminated (0xC000013A) stayed dead and the site with it. The
# repeat trigger fixes that: keepalive.ps1 holds a global mutex, so a launch while one is already
# running exits at once.
#
# It starts through `conhost.exe --headless`: powershell.exe is a console program, so Task Scheduler
# drew its window for a moment before -WindowStyle Hidden took effect, a PowerShell window flashing
# up every 5 minutes. conhost is a windowed program and --headless hosts PowerShell with no window.
$script = Join-Path $PSScriptRoot 'keepalive.ps1'
$action = New-ScheduledTaskAction -Execute "$env:WINDIR\System32\conhost.exe" `
  -Argument "--headless powershell.exe -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$script`""
$logon = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
$repeat = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) -RepetitionInterval (New-TimeSpan -Minutes 5)
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable `
  -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) -ExecutionTimeLimit ([TimeSpan]::Zero) -MultipleInstances IgnoreNew
Register-ScheduledTask -TaskName 'MyWeatherUK Server' -Action $action -Trigger @($logon, $repeat) -Settings $settings -Force | Out-Null
Start-ScheduledTask -TaskName 'MyWeatherUK Server'
'installed'
