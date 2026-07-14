const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

function sha256(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function validateInstallRequest(request, updatesDir) {
  if (!request || !/^\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?$/.test(String(request.version || ''))) throw new Error('Ongeldige updateversie in installatieverzoek.');
  if (!/^[a-f0-9]{64}$/i.test(String(request.sha256 || ''))) throw new Error('Ongeldige updatehash in installatieverzoek.');
  const fileName = `ThuisHub-Setup-${request.version}.exe`;
  if (request.fileName !== fileName) throw new Error('Onverwachte installernaam in installatieverzoek.');
  const expected = path.resolve(updatesDir, fileName);
  if (path.resolve(String(request.file || '')) !== expected || !fs.existsSync(expected)) throw new Error('De gecontroleerde update-installer ontbreekt.');
  const bytes = fs.statSync(expected).size;
  if (bytes !== Number(request.bytes)) throw new Error('De grootte van de update-installer is gewijzigd.');
  if (sha256(expected).toLowerCase() !== String(request.sha256).toLowerCase()) throw new Error('De update-installer is na downloaden gewijzigd.');
  return { version: request.version, fileName, file: expected, bytes, sha256: String(request.sha256).toLowerCase() };
}

function consumeInstallRequest(requestFile, updatesDir) {
  if (!fs.existsSync(requestFile)) return null;
  try {
    const update = validateInstallRequest(JSON.parse(fs.readFileSync(requestFile, 'utf8')), updatesDir);
    fs.rmSync(requestFile, { force: true });
    return update;
  } catch (error) {
    fs.rmSync(requestFile, { force: true });
    throw error;
  }
}

function psLiteral(value) {
  return `'${String(value || '').replaceAll("'", "''")}'`;
}

function encodedPowerShell(script) {
  return Buffer.from(script, 'utf16le').toString('base64');
}

function installerScript(installerPath, waitPid, restartExecutable = '') {
  const logFile = path.join(path.dirname(installerPath), 'install-helper.log');
  const expectedVersion = /^ThuisHub-Setup-(\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?)\.exe$/i.exec(path.basename(installerPath))?.[1] || '';
  const defaultExecutable = path.join(process.env.LOCALAPPDATA || path.join(require('node:os').homedir(), 'AppData', 'Local'), 'Programs', 'ThuisHub', 'ThuisHub.exe');
  const restartCandidates = [...new Set([restartExecutable, defaultExecutable].filter(Boolean))].map(psLiteral).join(',');
  return `$ErrorActionPreference = 'Stop'\r\n$logFile = ${psLiteral(logFile)}\r\nfunction Write-InstallLog([string]$Message) { Add-Content -LiteralPath $logFile -Value (('[{0}] {1}' -f (Get-Date).ToString('o'), $Message)) -Encoding UTF8 }\r\ntry {\r\n  Write-InstallLog 'Wachten tot ThuisHub volledig is afgesloten.'\r\n  Wait-Process -Id ${Number(waitPid)} -ErrorAction SilentlyContinue\r\n  Start-Sleep -Milliseconds 700\r\n  Write-InstallLog 'Gecontroleerde installer wordt gestart.'\r\n  $setupProcess = Start-Process -FilePath ${psLiteral(installerPath)} -ArgumentList '/S','--force-run' -PassThru\r\n  Wait-Process -Id $setupProcess.Id -ErrorAction SilentlyContinue\r\n  $setupProcess.Refresh()\r\n  $exitCode = if ($null -eq $setupProcess.ExitCode) { 0 } else { $setupProcess.ExitCode }\r\n  Write-InstallLog (('Installerproces afgesloten met code {0}.' -f $exitCode))\r\n  Start-Sleep -Seconds 3\r\n  $installedExecutable = $null\r\n  foreach ($candidate in @(${restartCandidates})) {\r\n    if ($candidate -and (Test-Path -LiteralPath $candidate -PathType Leaf)) {\r\n      $candidateVersion = (Get-Item -LiteralPath $candidate).VersionInfo.FileVersion\r\n      if (-not ${psLiteral(expectedVersion)} -or $candidateVersion -like (${psLiteral(expectedVersion)} + '*')) { $installedExecutable = $candidate; break }\r\n    }\r\n  }\r\n  if (-not $installedExecutable) { throw ('De geïnstalleerde ThuisHub-versie ${expectedVersion} kon na de setup niet worden bevestigd. Installercode: {0}.' -f $exitCode) }\r\n  if ($exitCode -ne 0) { Write-InstallLog (('De setupstarter gaf code {0}, maar de nieuwe programmaversie is wel bevestigd.' -f $exitCode)) }\r\n  if (-not (Get-Process -Name 'ThuisHub' -ErrorAction SilentlyContinue)) {\r\n    Write-InstallLog (('ThuisHub handmatig herstarten via {0}.' -f $installedExecutable))\r\n    Start-Process -FilePath $installedExecutable -ArgumentList '--updated'\r\n  }\r\n  Write-InstallLog 'Update-installatie en herstart zijn voltooid.'\r\n} catch {\r\n  Write-InstallLog (('Installatiefout: {0}' -f $_.Exception.Message))\r\n  exit 1\r\n}\r\n`;
}

function launchInstallerAfterExit(installerPath, waitPid, options = {}) {
  const script = installerScript(installerPath, waitPid, options.restartExecutable);
  const encoded = encodedPowerShell(script);
  const helperCommandLine = `powershell.exe -NoProfile -NonInteractive -WindowStyle Hidden -EncodedCommand ${encoded}`;
  const brokerScript = `$ErrorActionPreference = 'Stop'\r\n$commandLine = ${psLiteral(helperCommandLine)}\r\n$result = Invoke-CimMethod -ClassName Win32_Process -MethodName Create -Arguments @{ CommandLine = $commandLine }\r\nif ($null -eq $result -or $result.ReturnValue -ne 0 -or -not $result.ProcessId) { throw ('Windows kon de updatehelper niet starten. Code: {0}' -f $result.ReturnValue) }\r\nWrite-Output $result.ProcessId\r\n`;
  const brokerEncoded = encodedPowerShell(brokerScript);
  const execProcess = options.execProcess || execFileSync;
  const output = execProcess('powershell.exe', ['-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-EncodedCommand', brokerEncoded], { encoding: 'utf8', windowsHide: true, timeout: 15000 });
  return { encoded, script, brokerScript, helperPid: Number(String(output).trim()) || undefined };
}

module.exports = { consumeInstallRequest, installerScript, launchInstallerAfterExit, sha256, validateInstallRequest };
