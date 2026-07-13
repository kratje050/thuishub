param([switch]$IncludeReleaseArtifacts)
$ErrorActionPreference = 'Stop'
$root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path

function Find-TextPattern([string]$Pattern, [string[]]$Targets) {
  $files = foreach ($target in $Targets) {
    if (Test-Path -LiteralPath $target -PathType Leaf) { Get-Item -LiteralPath $target }
    elseif (Test-Path -LiteralPath $target -PathType Container) { Get-ChildItem -LiteralPath $target -Recurse -File }
  }
  if (-not $files) { return @() }
  return @($files | Select-String -Pattern $Pattern -ErrorAction SilentlyContinue)
}

function Find-PrivateLiteralInBinary([string]$Path, [string[]]$Needles) {
  $stream = [System.IO.File]::OpenRead($Path)
  $buffer = New-Object byte[] (1024 * 1024)
  $utf8Tail = ''; $unicodeTail = ''
  $hits = New-Object 'System.Collections.Generic.HashSet[string]'
  try {
    while (($read = $stream.Read($buffer, 0, $buffer.Length)) -gt 0) {
      $utf8Text = $utf8Tail + [System.Text.Encoding]::UTF8.GetString($buffer, 0, $read)
      $unicodeText = $unicodeTail + [System.Text.Encoding]::Unicode.GetString($buffer, 0, $read)
      foreach ($needle in $Needles) {
        if ($utf8Text.IndexOf($needle, [System.StringComparison]::OrdinalIgnoreCase) -ge 0 -or $unicodeText.IndexOf($needle, [System.StringComparison]::OrdinalIgnoreCase) -ge 0) { [void]$hits.Add($needle) }
      }
      $utf8Tail = if ($utf8Text.Length -gt 256) { $utf8Text.Substring($utf8Text.Length - 256) } else { $utf8Text }
      $unicodeTail = if ($unicodeText.Length -gt 256) { $unicodeText.Substring($unicodeText.Length - 256) } else { $unicodeText }
    }
  } finally { $stream.Dispose() }
  return @($hits)
}

Push-Location $root
try {
  $forbidden = git ls-files | Where-Object {
    $_ -match '(^|/)(data|backups|logs|exports|release|temp|tmp)/|\.(db|sqlite3?|pfx|p12|pem|key|keystore|jks|m3u8?|xmltv|log|dmp|backup)$|(^|/)(\.env($|\.)|credentials\.|secrets\.|config\.local\.|settings\.local\.)' -and
    $_ -notmatch '(^|/)\.env\.(example|sample|template)$'
  }
  if ($forbidden) { throw "Gevoelige of gegenereerde bestanden worden door Git gevolgd:`n$($forbidden -join "`n")" }

  $gitleaks = Get-Command gitleaks -ErrorAction SilentlyContinue
  if ($gitleaks) {
    & $gitleaks.Source git --no-banner --redact --exit-code 1
    if ($LASTEXITCODE -ne 0) { throw 'Gitleaks heeft een mogelijk geheim gevonden.' }
  } else {
    $patterns = @('ghp_[A-Za-z0-9]{20,}','github_pat_[A-Za-z0-9_]{20,}','tskey-[A-Za-z0-9_-]{12,}','-----BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY-----','(password|passwd|api[_-]?key|auth[_-]?token)\s*[:=]\s*["''][^"'']{8,}["'']')
    foreach ($pattern in $patterns) {
      $matches = git grep -n -I -E -- $pattern -- . ':(exclude)scripts/scan-release-secrets.ps1' 2>$null
      if ($LASTEXITCODE -eq 0 -and $matches) { throw "Fallback-secretscan vond een mogelijk geheim (waarden niet weergegeven). Patroon: $pattern" }
    }
    Write-Warning 'Gitleaks is niet geïnstalleerd; de ingebouwde strikte fallbackscan is gebruikt.'
  }

  $privacyPatterns = @('https://[A-Za-z0-9-]+\.[A-Za-z0-9-]+\.ts\.net','C:\\Users\\[^\\/\s]+','[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}')
  $textTargets = @('README.md','CHANGELOG.md','FEATURE_PARITY.md','SECURITY.md','docs','release\latest.json','release\SHA256SUMS.txt','release\RELEASE_NOTES.md') | Where-Object { Test-Path $_ }
  foreach ($pattern in $privacyPatterns) {
    $matches = Find-TextPattern -Pattern $pattern -Targets $textTargets
    if ($matches) { throw "Privacycontrole vond persoonlijke gegevens (waarden niet weergegeven). Patroon: $pattern" }
  }
  if ($IncludeReleaseArtifacts -and (Test-Path 'release')) {
    $privateLiterals = @('.ts.net','C:\Users\')
    $binaryAssets = Get-ChildItem -LiteralPath 'release' -File | Where-Object { $_.Extension -in '.exe','.apk','.wgt' }
    foreach ($asset in $binaryAssets) {
      $matches = Find-PrivateLiteralInBinary -Path $asset.FullName -Needles $privateLiterals
      if ($matches) { throw "Release-asset $($asset.Name) bevat een privéhostname of lokaal gebruikerspad." }
    }
  }
  Write-Host 'Secrets- en privacycontrole geslaagd.' -ForegroundColor Green
} finally { Pop-Location }
