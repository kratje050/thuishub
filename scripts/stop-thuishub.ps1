$ErrorActionPreference = 'Stop'
$dataDir = Join-Path $env:APPDATA 'ThuisHub\data'
$pidFile = Join-Path $dataDir 'thuishub.pid'
$healthUrl = 'http://127.0.0.1:8787/api/health'

try {
    $health = Invoke-RestMethod -Uri $healthUrl -TimeoutSec 2
} catch {
    $health = $null
}

if (-not $health -or $health.app -ne 'thuishub') {
    Remove-Item -LiteralPath $pidFile -Force -ErrorAction SilentlyContinue
    Write-Host 'ThuisHub draait niet.'
    exit 0
}

$listener = Get-NetTCPConnection -LocalPort 8787 -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
$savedPid = if ($listener) { $listener.OwningProcess } elseif (Test-Path -LiteralPath $pidFile) { [int](Get-Content -LiteralPath $pidFile -Raw) } else { 0 }
$running = if ($savedPid) { Get-Process -Id $savedPid -ErrorAction SilentlyContinue } else { $null }
$listenerInfo = if ($savedPid) { Get-CimInstance Win32_Process -Filter "ProcessId=$savedPid" -ErrorAction SilentlyContinue } else { $null }
$parent = if ($listenerInfo) { Get-Process -Id $listenerInfo.ParentProcessId -ErrorAction SilentlyContinue } else { $null }
if ($parent -and $parent.ProcessName -like 'ThuisHub*') {
    Write-Host 'De ThuisHub-desktopapp is actief. Sluit die via het systeemvakicoon: ThuisHub afsluiten.'
    exit 0
}
if ($running -and $running.ProcessName -eq 'node') {
    Stop-Process -Id $savedPid
    $null = $running.WaitForExit(5000)
}
Remove-Item -LiteralPath $pidFile -Force -ErrorAction SilentlyContinue
Write-Host 'ThuisHub is gestopt.'
