param([switch]$NoBrowser)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$appRoot = Join-Path $env:APPDATA 'ThuisHub'
$dataDir = Join-Path $appRoot 'data'
$pidFile = Join-Path $dataDir 'thuishub.pid'
$url = 'http://localhost:8787'
$healthUrl = 'http://127.0.0.1:8787/api/health'

New-Item -ItemType Directory -Force -Path $dataDir | Out-Null
$env:THUIS_HUB_ROOT_DIR = $appRoot
$env:THUIS_HUB_DATA_DIR = $dataDir

function Test-ThuisHubReady {
    try {
        $health = Invoke-RestMethod -Uri $healthUrl -TimeoutSec 2
        return $health.app -eq 'thuishub' -and $health.status -eq 'ok'
    } catch {
        return $false
    }
}

function Save-ListenerPid {
    $listener = Get-NetTCPConnection -LocalPort 8787 -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($listener) {
        $owner = Get-Process -Id $listener.OwningProcess -ErrorAction SilentlyContinue
        if ($owner -and $owner.ProcessName -eq 'node') {
            Set-Content -LiteralPath $pidFile -Value $listener.OwningProcess -Encoding ascii
        }
    }
}

# Een tweede klik opent gewoon de al draaiende app, ook als het PID-bestand ontbrak.
if (Test-ThuisHubReady) {
    Save-ListenerPid
    if (-not $NoBrowser) { Start-Process $url }
    exit 0
}

if (Test-Path -LiteralPath $pidFile) {
    $savedPid = [int](Get-Content -LiteralPath $pidFile -Raw)
    $running = Get-Process -Id $savedPid -ErrorAction SilentlyContinue
    # Zonder geldige healthcheck is dit bestand verouderd; laat het proces ongemoeid.
    Remove-Item -LiteralPath $pidFile -Force
}

if (-not (Test-Path -LiteralPath (Join-Path $root 'node_modules'))) {
    Write-Host 'ThuisHub is nog niet geïnstalleerd. Start eerst Installeren.cmd.' -ForegroundColor Yellow
    exit 1
}
if (-not (Test-Path -LiteralPath (Join-Path $root 'dist\index.html'))) {
    Write-Host 'De productieversie ontbreekt. Start eerst Installeren.cmd.' -ForegroundColor Yellow
    exit 1
}

$occupied = Get-NetTCPConnection -LocalPort 8787 -State Listen -ErrorAction SilentlyContinue
if ($occupied) {
    Write-Host 'Poort 8787 wordt al door een ander programma gebruikt.' -ForegroundColor Red
    Write-Host 'Sluit dat programma en probeer ThuisHub opnieuw te starten.'
    exit 1
}

$node = (Get-Command node -ErrorAction Stop).Source
$stdout = Join-Path $dataDir 'server.log'
$stderr = Join-Path $dataDir 'server-error.log'
$null = Remove-Item -LiteralPath $stdout, $stderr -Force -ErrorAction SilentlyContinue
$process = Start-Process -FilePath $node -ArgumentList 'server/dist/index.js' -WorkingDirectory $root -WindowStyle Hidden -RedirectStandardOutput $stdout -RedirectStandardError $stderr -PassThru
Set-Content -LiteralPath $pidFile -Value $process.Id -Encoding ascii

$ready = $false
for ($attempt = 0; $attempt -lt 60; $attempt++) {
    Start-Sleep -Milliseconds 250
    if (Test-ThuisHubReady) {
        $ready = $true
        break
    }
    if ($process.HasExited) { break }
}

if (-not $ready) {
    if (-not $process.HasExited) { Stop-Process -Id $process.Id -Force }
    Remove-Item -LiteralPath $pidFile -Force -ErrorAction SilentlyContinue
    Write-Host 'ThuisHub kon niet starten.' -ForegroundColor Red
    if (Test-Path -LiteralPath $stderr) {
        $details = Get-Content -LiteralPath $stderr -Raw
        if ($details) {
            Write-Host ''
            Write-Host $details
        }
    }
    Write-Host "Logbestand: $stderr"
    exit 1
}

Save-ListenerPid
if (-not $NoBrowser) { Start-Process $url }
