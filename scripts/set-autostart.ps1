$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$launcher = Join-Path $root 'ThuisHub starten.cmd'
$startup = [Environment]::GetFolderPath('Startup')
$shortcutPath = Join-Path $startup 'ThuisHub.lnk'
$shell = New-Object -ComObject WScript.Shell
$shortcut = $shell.CreateShortcut($shortcutPath)
$shortcut.TargetPath = $launcher
$shortcut.WorkingDirectory = $root
$shortcut.Description = 'Start ThuisHub mediaserver'
$shortcut.Save()
Write-Host 'ThuisHub start voortaan automatisch wanneer je je aanmeldt bij Windows.' -ForegroundColor Green
