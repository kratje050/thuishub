param([string]$Version = '1.2.3', [ValidateSet('stable','beta','development')][string]$Channel = 'stable', [switch]$Publish)
$ErrorActionPreference = 'Stop'
$root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$release = Join-Path $root 'release'
$repo = 'kratje050/thuishub'
Push-Location $root
try {
  $gh = Get-Command gh -ErrorAction SilentlyContinue
  if (-not $gh) { throw 'GitHub CLI ontbreekt. Installeer gh en voer daarna gh auth login uit.' }
  & $gh.Source auth status
  if ($LASTEXITCODE -ne 0) { throw 'GitHub CLI is niet aangemeld. Voer zelf gh auth login uit; dit script slaat geen token op.' }
  $packageVersion = (Get-Content package.json -Raw | ConvertFrom-Json).version
  if ($Version -ne $packageVersion -or $Version -notmatch '^\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?$') { throw "Versie $Version komt niet overeen met package.json ($packageVersion)." }
  & (Join-Path $PSScriptRoot 'generate-release-metadata.ps1') -Version $Version -Channel $Channel
  & (Join-Path $PSScriptRoot 'scan-release-secrets.ps1') -IncludeReleaseArtifacts

  $assets = @(
    (Join-Path $release "ThuisHub-Setup-$Version.exe"), (Join-Path $release "ThuisHub-Portable-$Version.exe"),
    (Join-Path $release "ThuisHub-Android-TV-$Version.apk"), (Join-Path $release 'SHA256SUMS.txt'),
    (Join-Path $release 'latest.json'), (Join-Path $release 'RELEASE_NOTES.md')
  )
  $wgt = Join-Path $release "ThuisHub-Samsung-TV-$Version.wgt"; if (Test-Path $wgt) { $assets += $wgt }
  foreach ($file in $assets) { if (-not (Test-Path $file)) { throw "Publicatiebestand ontbreekt: $file" } }
  if (-not (git tag --list "v$Version")) { git tag -a "v$Version" -m "ThuisHub $Version" }
  $previousErrorPreference = $ErrorActionPreference
  $ErrorActionPreference = 'SilentlyContinue'
  $existingState = & $gh.Source release view "v$Version" --repo $repo --json isDraft --jq .isDraft 2>$null
  $releaseViewExitCode = $LASTEXITCODE
  $ErrorActionPreference = $previousErrorPreference
  $releaseExists = $releaseViewExitCode -eq 0
  if ($releaseExists) {
    if ("$existingState".Trim().ToLowerInvariant() -ne 'true') { throw "Release v$Version is al gepubliceerd; gepubliceerde releases worden nooit overschreven." }
    Write-Host "Conceptrelease v$Version bestaat al; assets worden niet automatisch overschreven." -ForegroundColor Yellow
  } else {
    & $gh.Source release create "v$Version" @assets --repo $repo --title "ThuisHub $Version" --notes-file (Join-Path $release 'RELEASE_NOTES.md') --draft
    if ($LASTEXITCODE -ne 0) { throw 'De conceptrelease kon niet worden gemaakt.' }
    Write-Host "Conceptrelease v$Version is aangemaakt. Er is nog niets gepubliceerd." -ForegroundColor Green
  }
  if ($Publish) {
    $answer = Read-Host "Typ exact PUBLICEREN om v$Version openbaar te maken"
    if ($answer -ne 'PUBLICEREN') { Write-Host 'Publicatie geannuleerd; de release blijft een concept.' -ForegroundColor Yellow; return }
    & $gh.Source release edit "v$Version" --repo $repo --draft=false
    if ($LASTEXITCODE -ne 0) { throw 'Publiceren is mislukt; controleer de conceptrelease handmatig.' }
    Write-Host "Release v$Version is gepubliceerd." -ForegroundColor Green
  }
} finally { Pop-Location }
