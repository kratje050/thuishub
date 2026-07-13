param(
    [ValidateSet('enable','disable')]
    [string]$Action = 'enable',
    [int]$Port = 8788
)

$ErrorActionPreference = 'Stop'
$ruleName = 'ThuisHub Private LAN Streaming'

if (-not ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    throw 'Start PowerShell als administrator. ThuisHub verandert de firewall nooit zonder deze bewuste opdracht.'
}

if ($Action -eq 'disable') {
    Remove-NetFirewallRule -DisplayName $ruleName -ErrorAction SilentlyContinue
    Write-Host 'De ThuisHub-firewallregel is verwijderd.' -ForegroundColor Green
    exit 0
}

if ($Port -lt 1024 -or $Port -gt 65535) { throw 'Kies een poort tussen 1024 en 65535.' }
Remove-NetFirewallRule -DisplayName $ruleName -ErrorAction SilentlyContinue
New-NetFirewallRule -DisplayName $ruleName -Direction Inbound -Action Allow -Protocol TCP -LocalPort $Port -Profile Private -RemoteAddress LocalSubnet | Out-Null
Write-Host "Privé-LAN-toegang voor TCP-poort $Port is ingeschakeld. Openbare netwerkprofielen blijven geblokkeerd." -ForegroundColor Green
