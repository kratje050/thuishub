param([string]$Version = '1.2.10', [ValidateSet('stable','beta','development')][string]$Channel = 'stable')
$ErrorActionPreference = 'Stop'
$root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$release = Join-Path $root 'release'
$required = @(
  "ThuisHub-Setup-$Version.exe",
  "ThuisHub-Portable-$Version.exe",
  "ThuisHub-Android-$Version.apk",
  "ThuisHub-Android-TV-$Version.apk",
  'RELEASE_NOTES.md'
)
foreach ($name in $required) { if (-not (Test-Path (Join-Path $release $name))) { throw "Vereiste release-asset ontbreekt: $name" } }

$assetNames = @("ThuisHub-Setup-$Version.exe", "ThuisHub-Portable-$Version.exe", "ThuisHub-Android-$Version.apk", "ThuisHub-Android-TV-$Version.apk")
$wgt = "ThuisHub-Samsung-TV-$Version.wgt"
if (Test-Path (Join-Path $release $wgt)) { $assetNames += $wgt }
$hashes = [ordered]@{}
foreach ($name in $assetNames) { $hashes[$name] = (Get-FileHash -Algorithm SHA256 -LiteralPath (Join-Path $release $name)).Hash.ToLowerInvariant() }

$sumLines = $assetNames | ForEach-Object { "$($hashes[$_])  $_" }
$utf8NoBom = New-Object System.Text.UTF8Encoding($false)
[System.IO.File]::WriteAllText((Join-Path $release 'SHA256SUMS.txt'), ($sumLines -join "`r`n") + "`r`n", $utf8NoBom)
$assets = [ordered]@{
  setup = [ordered]@{ name = "ThuisHub-Setup-$Version.exe"; sha256 = $hashes["ThuisHub-Setup-$Version.exe"] }
  portable = [ordered]@{ name = "ThuisHub-Portable-$Version.exe"; sha256 = $hashes["ThuisHub-Portable-$Version.exe"] }
  android = [ordered]@{ name = "ThuisHub-Android-$Version.apk"; sha256 = $hashes["ThuisHub-Android-$Version.apk"] }
  androidTv = [ordered]@{ name = "ThuisHub-Android-TV-$Version.apk"; sha256 = $hashes["ThuisHub-Android-TV-$Version.apk"] }
}
if ($hashes.Contains($wgt)) { $assets.samsungTv = [ordered]@{ name = $wgt; sha256 = $hashes[$wgt] } }
$manifest = [ordered]@{
  product = 'ThuisHub'; version = $Version; channel = $Channel; tag = "v$Version"; minimumSupportedVersion = '1.1.0'
  publishedAt = (Get-Date).ToUniversalTime().ToString('o'); assets = $assets
}
[System.IO.File]::WriteAllText((Join-Path $release 'latest.json'), ($manifest | ConvertTo-Json -Depth 8) + "`r`n", $utf8NoBom)
Write-Host "SHA256SUMS.txt en latest.json zijn gegenereerd voor ThuisHub $Version." -ForegroundColor Green
