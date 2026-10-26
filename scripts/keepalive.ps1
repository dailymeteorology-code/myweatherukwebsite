# MyWeatherUK keep-alive: checks the site every 30 s and (re)starts it if it is not answering.
# Started hidden at logon by the "MyWeatherUK Server" scheduled task (scripts/install-keepalive.ps1).
#
# A start is watched until the site answers (26 Oct 2026: after a restart of the PC, two starts in
# a row hung before opening the port, with nothing in the log, and the site stayed down for a
# quarter of an hour):
#   - no port after ListenLimit seconds: the start has hung, so it is stopped and started again;
#   - the port open but no answer after BootGrace seconds: the same;
#   - the server process gone during boot: started again at once.
# While a start is within those limits it is left alone: loading the lightning archive and the rest
# can keep it busy for a while, and killing a server that is still booting only starts the wait
# again. A copy started by hand counts as a start too, so the watchdog never starts a second one
# beside it.
#
# Once up, the site is down when nothing is on the port for two checks in a row, or when it is
# listening but has not answered three checks in a row (a long job can stall it for a few seconds,
# which is not a reason to kill it).
#
# Every restart stops every copy first (the listener, the shells that started it, and any server
# process left behind), so two copies can never race each other at startup.
#
# The parameters are for testing it against a stand-in server; the scheduled task runs it with none.
param(
  [int]$Port = 8787,
  [string]$Root = (Split-Path -Parent $PSScriptRoot),
  [string]$StartCmd = 'npm start',                  # run by cmd.exe in $Root
  [string]$ServerMatch = 'env-file-if-exists=\.env server[\\/]index\.js',   # how this site's server shows in node's command line
  [int]$ListenLimit = 150,
  [int]$BootGrace = 300,
  [int]$CheckEvery = 30,
  [int]$Timeout = 20,                               # seconds to wait for the site to answer a check
  [string]$Log = '',                                # the server's own output
  [string]$WatchLog = ''                            # what the watchdog does
)
$ErrorActionPreference = 'SilentlyContinue'
if (-not $Log) { $Log = Join-Path $Root 'server-run.log' }
# its own file: the running server's shell holds server-run.log open, so a line added to it while
# the site is up is lost (as every "answering" note was when it shared that log)
if (-not $WatchLog) { $WatchLog = Join-Path $Root 'keepalive.log' }

# one watchdog only (per port)
$name = if ($Port -eq 8787) { 'Global\MyWeatherUK-KeepAlive' } else { "Global\MyWeatherUK-KeepAlive-$Port" }
$me = [System.Threading.Mutex]::new($false, $name)
if (-not $me.WaitOne(0)) { exit }

function Say($m) { Add-Content $WatchLog "[$(Get-Date -Format s)] $m" }
function Up {
  try { (Invoke-WebRequest "http://localhost:$Port/" -UseBasicParsing -TimeoutSec $Timeout).StatusCode -lt 500 } catch { $false }
}
function Listener { (Get-NetTCPConnection -LocalPort $Port -State Listen | Select-Object -First 1).OwningProcess }
function Copies { @(Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object { $_.CommandLine -match $ServerMatch }) }
function Shells { @(Get-CimInstance Win32_Process -Filter "Name='cmd.exe'" | Where-Object { $_.CommandLine -like "*$StartCmd*" }) }

# The site runs above normal priority, so heavy jobs on this PC (model runs, analysis) can
# never starve it into missing health checks -- that is what took it down on 19 Oct 2026.
function Prioritise {
  Get-NetTCPConnection -LocalPort $Port -State Listen | ForEach-Object {
    try { $p = Get-Process -Id $_.OwningProcess; if ($p.PriorityClass -ne 'AboveNormal') { $p.PriorityClass = 'AboveNormal' } } catch {}
  }
}

# every copy: the listener, the shells that started one (with all they started, which also frees
# the log they hold open), and any server process left behind
function Stop-All {
  Get-NetTCPConnection -LocalPort $Port -State Listen | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force }
  Shells | ForEach-Object { & taskkill.exe /PID $_.ProcessId /T /F | Out-Null }
  Copies | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }
  Start-Sleep 2
}
function Start-Site($why) {
  Stop-All
  Say "$why, starting server"
  Start-Process -FilePath 'cmd.exe' -ArgumentList '/c', "$StartCmd >> `"$Log`" 2>&1" -WorkingDirectory $Root -WindowStyle Hidden
  $script:startedAt = Get-Date
  $script:fails = 0
}

$fails = 0
$startedAt = $null
Say "watching http://localhost:$Port/ (watchdog pid $PID)"
while ($true) {
  $up = Up
  # a copy that is still booting, whoever started it, is watched as a start
  if (-not $startedAt -and -not $up) {
    $young = Copies | Sort-Object CreationDate | Select-Object -Last 1
    if ($young -and ((Get-Date) - $young.CreationDate).TotalSeconds -lt $BootGrace) { $startedAt = $young.CreationDate; Say "a server is already starting (pid $($young.ProcessId)), watching it" }
  }

  if ($startedAt) {
    $age = [int]((Get-Date) - $startedAt).TotalSeconds
    if ($up) { Say "server answering after $age s"; $startedAt = $null; $fails = 0; Prioritise }
    elseif (-not @(Copies).Count) { Start-Site "the start exited after $age s" }   # @(): one process alone has no Count in PowerShell 5.1
    elseif (-not (Listener) -and $age -ge $ListenLimit) { Start-Site "the start hung (no port after $age s)" }
    elseif ($age -ge $BootGrace) { Start-Site "the start never answered ($age s)" }
    Start-Sleep ([Math]::Min(10, $CheckEvery))
    continue
  }

  if ($up) { $fails = 0; Prioritise }
  else {
    $fails++
    $listening = [bool](Listener)
    # nothing on the port twice in a row: down; listening but silent three times: stalled for good
    if ($fails -ge $(if ($listening) { 3 } else { 2 })) {
      Start-Site "site not answering ($fails checks, $(if ($listening) { 'listening but silent' } else { 'nothing on the port' }))"
    }
  }
  Start-Sleep $CheckEvery
}
