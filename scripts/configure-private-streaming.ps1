param(
    [ValidateSet('enable','disable')]
    [string]$Action = 'enable',
    [string]$Address = '',
    [ValidateRange(1024, 65535)]
    [int]$Port = 8788
)

$ErrorActionPreference = 'Stop'
if ($Port -eq 8787) { throw 'Poort 8787 is gereserveerd voor de lokale ThuisHub-beheerinterface. Kies bijvoorbeeld 8788.' }
$ruleGroup = 'ThuisHub Private LAN'
$legacyRuleName = 'ThuisHub Private LAN Streaming'
$rules = @(
    @{ Name = 'ThuisHub Private LAN Streaming (TCP)'; Protocol = 'TCP'; LocalPort = $Port },
    @{ Name = 'ThuisHub Private LAN Discovery (SSDP)'; Protocol = 'UDP'; LocalPort = 1900 },
    @{ Name = 'ThuisHub Private LAN Discovery (mDNS)'; Protocol = 'UDP'; LocalPort = 5353 },
    @{ Name = 'ThuisHub Private LAN Discovery (Mobile)'; Protocol = 'UDP'; LocalPort = 8789 }
)

function Test-PrivateIpv4([string]$Value) {
    $parsed = $null
    if (-not [Net.IPAddress]::TryParse($Value, [ref]$parsed) -or $parsed.AddressFamily -ne [Net.Sockets.AddressFamily]::InterNetwork) { return $false }
    $bytes = $parsed.GetAddressBytes()
    return $bytes[0] -eq 10 -or
        ($bytes[0] -eq 172 -and $bytes[1] -ge 16 -and $bytes[1] -le 31) -or
        ($bytes[0] -eq 192 -and $bytes[1] -eq 168)
}

if (-not ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    throw 'Start PowerShell als administrator. ThuisHub verandert de firewall nooit zonder deze bewuste opdracht.'
}

if ($Action -eq 'disable') {
    Get-NetFirewallRule -Group $ruleGroup -ErrorAction SilentlyContinue | Remove-NetFirewallRule
    Remove-NetFirewallRule -DisplayName $legacyRuleName -ErrorAction SilentlyContinue
    Write-Host 'De beperkte ThuisHub LAN- en discoveryregels zijn verwijderd.' -ForegroundColor Green
    exit 0
}

if (-not (Test-PrivateIpv4 $Address)) {
    throw 'Geef met -Address exact het geselecteerde privé-LAN-adres op, bijvoorbeeld 192.168.1.10.'
}

$ip = Get-NetIPAddress -AddressFamily IPv4 -IPAddress $Address -ErrorAction SilentlyContinue |
    Where-Object { $_.AddressState -eq 'Preferred' } |
    Select-Object -First 1
if (-not $ip) { throw "Het adres $Address is niet als actief IPv4-adres aan deze computer toegewezen." }

$profile = Get-NetConnectionProfile -InterfaceIndex $ip.InterfaceIndex -ErrorAction SilentlyContinue | Select-Object -First 1
if (-not $profile -or $profile.NetworkCategory -ne 'Private') {
    throw "De netwerkadapter voor $Address gebruikt niet het Windows-profiel Privé. Pas dit profiel eerst bewust aan."
}

Get-NetFirewallRule -Group $ruleGroup -ErrorAction SilentlyContinue | Remove-NetFirewallRule
Remove-NetFirewallRule -DisplayName $legacyRuleName -ErrorAction SilentlyContinue

foreach ($rule in $rules) {
    New-NetFirewallRule `
        -DisplayName $rule.Name `
        -Group $ruleGroup `
        -Direction Inbound `
        -Action Allow `
        -Enabled True `
        -Protocol $rule.Protocol `
        -LocalPort $rule.LocalPort `
        -LocalAddress $Address `
        -RemoteAddress LocalSubnet `
        -Profile Private | Out-Null
}

Write-Host "ThuisHub is uitsluitend vrijgegeven op $Address voor TCP $Port en lokale detectie via UDP 1900, 5353 en 8789." -ForegroundColor Green
Write-Host 'De regels gelden alleen voor Windows-profiel Privé en RemoteAddress LocalSubnet. Er zijn geen router- of openbare regels gemaakt.' -ForegroundColor Green
