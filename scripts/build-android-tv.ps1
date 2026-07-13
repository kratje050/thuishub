$ErrorActionPreference = 'Stop'
$project = (Resolve-Path (Join-Path $PSScriptRoot '..\apps\android-tv')).Path
$sdk = if ($env:ANDROID_HOME) { $env:ANDROID_HOME } elseif ($env:ANDROID_SDK_ROOT) { $env:ANDROID_SDK_ROOT } else { Join-Path $env:LOCALAPPDATA 'Android\Sdk' }
$studioJava = 'C:\Program Files\Android\Android Studio\jbr'
if (-not (Test-Path $sdk)) { throw 'Android SDK ontbreekt. Installeer Android Studio met Android SDK Platform 35.' }
if (Test-Path $studioJava) { $env:JAVA_HOME = $studioJava }
$env:ANDROID_HOME = $sdk
$env:ANDROID_SDK_ROOT = $sdk

$wrapper = Join-Path $project 'gradlew.bat'
if (-not (Test-Path $wrapper)) { throw 'Gradle Wrapper ontbreekt. Genereer hem één keer met Gradle 8.13 in apps\android-tv.' }
Push-Location $project
try { & $wrapper --no-daemon --stacktrace assembleDebug; if ($LASTEXITCODE -ne 0) { throw 'De Android TV-build is mislukt.' } }
finally { Pop-Location }

$source = Join-Path $project 'app\build\outputs\apk\debug\app-debug.apk'
if (-not (Test-Path $source)) { throw 'Het gebouwde APK-bestand is niet gevonden.' }
$release = (New-Item -ItemType Directory -Force (Join-Path $PSScriptRoot '..\release')).FullName
$target = Join-Path $release 'ThuisHub-Android-TV-1.2.1.apk'
Copy-Item -LiteralPath $source -Destination $target -Force
Write-Host "Android TV-ontwikkel-APK gemaakt: $target" -ForegroundColor Green
Write-Host 'Deze APK is met de lokale Android-debugkey ondertekend en bedoeld voor sideloadtests, niet voor een publieke appstore-release.' -ForegroundColor Yellow
