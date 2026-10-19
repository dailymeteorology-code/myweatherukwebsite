# MyWeatherUK keep-alive: checks the site every 30 s and (re)starts it if it is not answering.
# Started hidden at logon by the "MyWeatherUK Server" scheduled task (scripts/install-keepalive.ps1).
$ErrorActionPreference = 'SilentlyContinue'
$root = Split-Path -Parent $PSScriptRoot
$log = Join-Path $root 'server-run.log'
$port = 8787

# one watchdog only
$me = [System.Threading.Mutex]::new($false, 'Global\MyWeatherUK-KeepAlive')
if (-not $me.WaitOne(0)) { exit }

function Up {
  try { (Invoke-WebRequest "http://localhost:$port/" -UseBasicParsing -TimeoutSec 10).StatusCode -lt 500 } catch { $false }
}

$fails = 0
while ($true) {
  if (Up) { $fails = 0 }
  else {
    $fails++
    # one miss can be a slow response; two in a row means it is down
    if ($fails -ge 2) {
      Get-NetTCPConnection -LocalPort $port -State Listen | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force }
      Add-Content $log "[$(Get-Date -Format s)] keepalive: site not answering, starting server"
      Start-Process -FilePath 'cmd.exe' -ArgumentList '/c', "npm start >> `"$log`" 2>&1" -WorkingDirectory $root -WindowStyle Hidden
      $fails = 0
      Start-Sleep 60          # give it time to boot before checking again
    }
  }
  Start-Sleep 30
}
