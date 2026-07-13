param([switch]$IncludeReleaseArtifacts)
$ErrorActionPreference = 'Stop'
$root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
Push-Location $root
try {
  $forbidden = git ls-files | Where-Object { $_ -match '(^|/)(data|backups|logs|exports|release|temp|tmp)/|\.(db|sqlite3?|pfx|p12|pem|key|keystore|jks|m3u8?|xmltv|log|dmp|backup)$|(^|/)(\.env($|\.)|credentials\.|secrets\.|config\.local\.|settings\.local\.)' }
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

  $privacyPatterns = @('roy\.tail5d685a\.ts\.net','C:\\Users\\stava','[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}')
  $textTargets = @('README.md','CHANGELOG.md','FEATURE_PARITY.md','SECURITY.md','docs','release\latest.json','release\SHA256SUMS.txt','release\RELEASE_NOTES.md') | Where-Object { Test-Path $_ }
  foreach ($pattern in $privacyPatterns) {
    $matches = if ($textTargets) { rg -n -I -e $pattern -- $textTargets 2>$null } else { @() }
    if ($LASTEXITCODE -eq 0 -and $matches) { throw "Privacycontrole vond persoonlijke gegevens (waarden niet weergegeven). Patroon: $pattern" }
  }
  if ($IncludeReleaseArtifacts -and (Test-Path 'release')) {
    foreach ($pattern in $privacyPatterns[0..1]) {
      $matches = rg -a -l -e $pattern -- release 2>$null
      if ($LASTEXITCODE -eq 0 -and $matches) { throw "Een release-asset bevat een privéhostname of lokaal gebruikerspad: $($matches -join ', ')" }
    }
  }
  Write-Host 'Secrets- en privacycontrole geslaagd.' -ForegroundColor Green
} finally { Pop-Location }
