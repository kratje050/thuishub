param(
    [string]$Address = '',
    [ValidateRange(1024, 65535)]
    [int]$Port = 8788,
    [ValidateRange(250, 10000)]
    [int]$TimeoutMs = 2000,
    [switch]$Json
)

$ErrorActionPreference = 'Stop'
$ruleGroup = 'ThuisHub Private LAN'

function Test-PrivateIpv4([string]$Value) {
    $parsed = $null
    if (-not [Net.IPAddress]::TryParse($Value, [ref]$parsed) -or $parsed.AddressFamily -ne [Net.Sockets.AddressFamily]::InterNetwork) { return $false }
    $bytes = $parsed.GetAddressBytes()
    return $bytes[0] -eq 10 -or
        ($bytes[0] -eq 172 -and $bytes[1] -ge 16 -and $bytes[1] -le 31) -or
        ($bytes[0] -eq 192 -and $bytes[1] -eq 168)
}

function Test-SameIpv4Subnet([string]$Left, [string]$Right, [int]$PrefixLength) {
    if ($PrefixLength -lt 1 -or $PrefixLength -gt 32) { return $false }
    $leftAddress = $null
    $rightAddress = $null
    if (-not [Net.IPAddress]::TryParse($Left, [ref]$leftAddress) -or
        -not [Net.IPAddress]::TryParse($Right, [ref]$rightAddress) -or
        $leftAddress.AddressFamily -ne [Net.Sockets.AddressFamily]::InterNetwork -or
        $rightAddress.AddressFamily -ne [Net.Sockets.AddressFamily]::InterNetwork) { return $false }
    $leftBytes = $leftAddress.GetAddressBytes()
    $rightBytes = $rightAddress.GetAddressBytes()
    $wholeBytes = [Math]::Floor($PrefixLength / 8)
    for ($index = 0; $index -lt $wholeBytes; $index++) {
        if ($leftBytes[$index] -ne $rightBytes[$index]) { return $false }
    }
    $remainingBits = $PrefixLength % 8
    if ($remainingBits -eq 0) { return $true }
    $mask = [byte](256 - [Math]::Pow(2, 8 - $remainingBits))
    return ($leftBytes[$wholeBytes] -band $mask) -eq ($rightBytes[$wholeBytes] -band $mask)
}

function Find-PrivateInterfaces {
    $items = @()
    foreach ($ip in @(Get-NetIPAddress -AddressFamily IPv4 -AddressState Preferred -ErrorAction SilentlyContinue)) {
        if (-not (Test-PrivateIpv4 $ip.IPAddress)) { continue }
        $profile = Get-NetConnectionProfile -InterfaceIndex $ip.InterfaceIndex -ErrorAction SilentlyContinue | Select-Object -First 1
        $items += [pscustomobject]@{
            Address = $ip.IPAddress
            InterfaceAlias = $ip.InterfaceAlias
            InterfaceIndex = $ip.InterfaceIndex
            PrefixLength = [int]$ip.PrefixLength
            Profile = if ($profile) { [string]$profile.NetworkCategory } else { 'Onbekend' }
        }
    }
    return $items
}

function Invoke-SsdpProbe([string]$LocalAddress, [int]$PrefixLength, [int]$WaitMs) {
    $client = [Net.Sockets.UdpClient]::new([Net.Sockets.AddressFamily]::InterNetwork)
    $responses = @{}
    try {
        $client.Client.Bind([Net.IPEndPoint]::new([Net.IPAddress]::Parse($LocalAddress), 0))
        $client.Client.ReceiveTimeout = 250
        $destination = [Net.IPEndPoint]::new([Net.IPAddress]::Parse('239.255.255.250'), 1900)
        $targets = @(
            'urn:schemas-upnp-org:device:MediaRenderer:1',
            'urn:schemas-upnp-org:service:AVTransport:1',
            'urn:schemas-upnp-org:service:RenderingControl:1'
        )
        foreach ($target in $targets) {
            $request = "M-SEARCH * HTTP/1.1`r`nHOST: 239.255.255.250:1900`r`nMAN: `"ssdp:discover`"`r`nMX: 1`r`nST: $target`r`n`r`n"
            $payload = [Text.Encoding]::ASCII.GetBytes($request)
            [void]$client.Send($payload, $payload.Length, $destination)
        }

        $deadline = [DateTime]::UtcNow.AddMilliseconds($WaitMs)
        while ([DateTime]::UtcNow -lt $deadline) {
            try {
                $remote = [Net.IPEndPoint]::new([Net.IPAddress]::Any, 0)
                $bytes = $client.Receive([ref]$remote)
                if (-not (Test-SameIpv4Subnet $LocalAddress $remote.Address.ToString() $PrefixLength)) { continue }
                $text = [Text.Encoding]::UTF8.GetString($bytes)
                if ($text -notmatch '(?im)^ST:\s*(.+)$' -or $Matches[1] -notmatch 'MediaRenderer|AVTransport|RenderingControl') { continue }
                if ($text -notmatch '(?im)^LOCATION:\s*(.+)$') { continue }
                $location = $Matches[1].Trim()
                $safeLocation = ''
                try {
                    $uri = [Uri]$location
                    if ($uri.Scheme -in @('http','https') -and (Test-PrivateIpv4 $uri.Host) -and $uri.Host -eq $remote.Address.ToString()) {
                        $safeLocation = $uri.GetLeftPart([UriPartial]::Path)
                    }
                } catch {}
                if (-not $safeLocation) { continue }
                $responses["$($remote.Address)|$safeLocation"] = [pscustomobject]@{
                    Address = $remote.Address.ToString()
                    Location = $safeLocation
                }
            } catch [Net.Sockets.SocketException] {
                if ($_.Exception.SocketErrorCode -notin @([Net.Sockets.SocketError]::TimedOut, [Net.Sockets.SocketError]::WouldBlock)) { throw }
            }
        }
    } finally { $client.Dispose() }
    return @($responses.Values)
}

$interfaces = @(Find-PrivateInterfaces)
if (-not $Address) {
    $privateProfiles = @($interfaces | Where-Object Profile -eq 'Private')
    if ($privateProfiles.Count -ne 1) {
        throw 'Geef -Address op. Automatisch kiezen kan alleen wanneer exact één actieve privé-interface beschikbaar is.'
    }
    $Address = $privateProfiles[0].Address
}
if (-not (Test-PrivateIpv4 $Address)) { throw 'Het diagnoseadres moet een privé IPv4-adres zijn.' }
$selected = $interfaces | Where-Object Address -eq $Address | Select-Object -First 1
if (-not $selected) { throw 'Het gekozen diagnoseadres is niet aan een actieve lokale interface toegewezen.' }

$listener = @(Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue |
    Where-Object { $_.LocalAddress -eq $Address }).Count -gt 0

$firewall = @()
foreach ($rule in @(Get-NetFirewallRule -Group $ruleGroup -ErrorAction SilentlyContinue)) {
    $portFilter = $rule | Get-NetFirewallPortFilter
    $addressFilter = $rule | Get-NetFirewallAddressFilter
    $expectedProtocol = if ($rule.DisplayName -eq 'ThuisHub Private LAN Streaming (TCP)') { 'TCP' } else { 'UDP' }
    $expectedPort = if ($rule.DisplayName -eq 'ThuisHub Private LAN Streaming (TCP)') { [string]$Port } elseif ($rule.DisplayName -eq 'ThuisHub Private LAN Discovery (SSDP)') { '1900' } elseif ($rule.DisplayName -eq 'ThuisHub Private LAN Discovery (mDNS)') { '5353' } else { '' }
    $firewall += [pscustomobject]@{
        Name = $rule.DisplayName
        Enabled = [string]$rule.Enabled
        Profile = [string]$rule.Profile
        Direction = [string]$rule.Direction
        Protocol = [string]$portFilter.Protocol
        LocalPort = [string]$portFilter.LocalPort
        LocalAddress = [string]$addressFilter.LocalAddress
        RemoteAddress = [string]$addressFilter.RemoteAddress
        Strict = $rule.Enabled -eq 'True' -and $rule.Profile -eq 'Private' -and $rule.Direction -eq 'Inbound' -and
            [string]$addressFilter.LocalAddress -eq $Address -and [string]$addressFilter.RemoteAddress -eq 'LocalSubnet' -and
            [string]$portFilter.Protocol -eq $expectedProtocol -and [string]$portFilter.LocalPort -eq $expectedPort
    }
}

$playbackReachable = $false
try {
    $health = Invoke-WebRequest -UseBasicParsing -Uri "http://${Address}:$Port/api/health" -Method Get -TimeoutSec ([Math]::Max(1, [Math]::Ceiling($TimeoutMs / 1000)))
    $playbackReachable = $health.StatusCode -eq 200
} catch {}

$castRecords = @()
try {
    $castRecords = @(Resolve-DnsName -Name '_googlecast._tcp.local' -Type PTR -QuickTimeout -ErrorAction Stop |
        Where-Object Type -eq 'PTR' |
        Select-Object -ExpandProperty NameHost -Unique)
} catch {}

$ssdpResponses = @()
$ssdpError = ''
try { $ssdpResponses = @(Invoke-SsdpProbe -LocalAddress $Address -PrefixLength $selected.PrefixLength -WaitMs $TimeoutMs) }
catch { $ssdpError = $_.Exception.Message }

$result = [pscustomobject]@{
    CheckedAt = [DateTime]::UtcNow.ToString('o')
    SelectedInterface = if ($selected) { $selected } else { [pscustomobject]@{ Address = $Address; InterfaceAlias = ''; InterfaceIndex = 0; Profile = 'Niet gevonden' } }
    NetworkProfilePrivate = [bool]($selected -and $selected.Profile -eq 'Private')
    StreamingPort = $Port
    StreamingListenerActive = $listener
    PlaybackHealthReachable = $playbackReachable
    FirewallRulesStrict = $firewall.Count -eq 3 -and @($firewall | Where-Object { -not $_.Strict }).Count -eq 0
    FirewallRules = $firewall
    MdnsGoogleCastRecordCount = $castRecords.Count
    MdnsGoogleCastRecords = $castRecords
    MdnsGoogleCastInterfaceBound = $false
    MdnsGoogleCastScope = 'Windows DNS-resolver; de uitkomst is niet aan één interface te koppelen.'
    SsdpMediaRendererResponseCount = $ssdpResponses.Count
    SsdpMediaRendererResponses = $ssdpResponses
    SsdpError = $ssdpError
    Explanation = if ($ssdpResponses.Count) {
        'Eén of meer veilige DLNA-antwoorden zijn vanaf hetzelfde subnet als de gekozen interface ontvangen.'
    } elseif ($castRecords.Count) {
        'De Windows DNS-resolver ziet Google Cast-records. Dit bewijst niet via welke interface ze zijn gevonden.'
    } else {
        'Geen apparaten gevonden. Dit kan ook betekenen dat geen compatibel apparaat online is; controleer hetzelfde netwerk, wifi en AP-isolatie.'
    }
}

if ($Json) { $result | ConvertTo-Json -Depth 8 }
else {
    Write-Host 'ThuisHub TV-detectiediagnose (alleen-lezen)' -ForegroundColor Cyan
    Write-Host "Interface: $Address ($($result.SelectedInterface.InterfaceAlias)) - profiel $($result.SelectedInterface.Profile)"
    Write-Host "Streamingserver: listener=$listener, health=$playbackReachable, poort=$Port"
    Write-Host "Firewall: strikt=$($result.FirewallRulesStrict), regels=$($firewall.Count)"
    Write-Host "mDNS Google Cast-records: $($castRecords.Count)"
    Write-Host "SSDP MediaRenderer-antwoorden: $($ssdpResponses.Count)"
    if ($ssdpError) { Write-Warning $ssdpError }
    Write-Host $result.Explanation
    $result
}
