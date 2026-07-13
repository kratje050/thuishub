param(
    [ValidateSet('status', 'enable', 'disable', 'url')]
    [string]$Action = 'status'
)

$ErrorActionPreference = 'Stop'

function Get-TailscaleCommand {
    $command = Get-Command tailscale.exe -ErrorAction SilentlyContinue
    if (-not $command) {
        throw 'Tailscale is niet geïnstalleerd of tailscale.exe staat niet in PATH. Installeer Tailscale en meld je eerst aan.'
    }
    $command.Source
}

function Get-ThuisHubStatus([string]$Tailscale) {
    $status = (& $Tailscale status --json 2>&1 | Out-String)
    if ($LASTEXITCODE -ne 0) { throw "Tailscale is niet verbonden. Meld je aan in de Tailscale-app.`n$status" }
    $json = $status | ConvertFrom-Json
    $serve = (& $Tailscale serve status --json 2>&1 | Out-String)
    [pscustomobject]@{
        Name = $json.Self.DNSName.TrimEnd('.')
        Connected = $json.BackendState -eq 'Running'
        Serve = $serve
        Url = if ($json.Self.DNSName) { 'https://' + $json.Self.DNSName.TrimEnd('.') } else { $null }
    }
}

try {
    $tailscale = Get-TailscaleCommand
    switch ($Action) {
        'enable' {
            & $tailscale serve --bg 8787
            if ($LASTEXITCODE -ne 0) { throw 'Tailscale Serve kon niet worden ingeschakeld.' }
            Write-Host 'Tailscale Serve is ingeschakeld voor ThuisHub op 127.0.0.1:8787.' -ForegroundColor Green
        }
        'disable' {
            & $tailscale serve reset
            if ($LASTEXITCODE -ne 0) { throw 'Tailscale Serve kon niet worden uitgeschakeld.' }
            Write-Host 'Tailscale Serve is uitgeschakeld.' -ForegroundColor Green
        }
    }

    $result = Get-ThuisHubStatus $tailscale
    Write-Host "Verbonden: $($result.Connected)"
    Write-Host "Computernaam: $($result.Name)"
    if ($result.Url) { Write-Host "ThuisHub-URL: $($result.Url)" -ForegroundColor Cyan }
    if ($Action -eq 'status') { Write-Host $result.Serve }
}
catch {
    Write-Host "ThuisHub externe toegang: $($_.Exception.Message)" -ForegroundColor Red
    exit 1
}
