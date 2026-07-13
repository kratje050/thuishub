$ErrorActionPreference = 'Stop'
$project = Join-Path $PSScriptRoot '..\apps\samsung-tizen'
$output = Join-Path $PSScriptRoot '..\release\ThuisHub-Samsung-TV-1.2.2.wgt'
$tizen = Get-Command tizen.bat -ErrorAction SilentlyContinue
if (-not $tizen) { throw 'Tizen Studio CLI ontbreekt. Installeer Tizen Studio, TV Extensions en een Samsung-certificaatprofiel; de volledige broncode staat in apps\samsung-tizen.' }
& $tizen.Source build-web -- $project
if ($LASTEXITCODE -ne 0) { throw 'De Tizen-webbuild is mislukt.' }
& $tizen.Source package -t wgt -- $project
if ($LASTEXITCODE -ne 0) { throw 'WGT packaging is mislukt. Controleer het Samsung-certificaatprofiel.' }
$wgt = Get-ChildItem -LiteralPath $project -Recurse -Filter *.wgt | Sort-Object LastWriteTime -Descending | Select-Object -First 1
if (-not $wgt) { throw 'Er is geen WGT-bestand gevonden.' }
New-Item -ItemType Directory -Force (Split-Path $output) | Out-Null
Copy-Item -LiteralPath $wgt.FullName -Destination $output -Force
Write-Host "Samsung TV-build gemaakt: $output" -ForegroundColor Green
