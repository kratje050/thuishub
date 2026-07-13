$shortcutPath = Join-Path ([Environment]::GetFolderPath('Startup')) 'ThuisHub.lnk'
if (Test-Path -LiteralPath $shortcutPath) {
    Remove-Item -LiteralPath $shortcutPath -Force
    Write-Host 'Automatisch starten is uitgeschakeld.' -ForegroundColor Green
} else {
    Write-Host 'Automatisch starten was niet ingesteld.'
}
