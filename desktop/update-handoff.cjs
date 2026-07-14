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

function installLogPath(installerPath) {
  return path.join(path.dirname(installerPath), 'install-helper.log');
}

function appendInstallLog(installerPath, message) {
  try {
    fs.appendFileSync(installLogPath(installerPath), `[${new Date().toISOString()}] ${message}\r\n`, 'utf8');
  } catch {
    // Diagnostics must never be able to cancel a verified update handoff.
  }
}

function installerScript(installerPath, waitPid, restartExecutable = '') {
  const logFile = installLogPath(installerPath);
  const expectedVersion = /^ThuisHub-Setup-(\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?)\.exe$/i.exec(path.basename(installerPath))?.[1] || '';
  const defaultExecutable = path.join(process.env.LOCALAPPDATA || path.join(require('node:os').homedir(), 'AppData', 'Local'), 'Programs', 'ThuisHub', 'ThuisHub.exe');
  const executableCandidates = [...new Set([restartExecutable, defaultExecutable].filter(Boolean))];
  const restartCandidates = executableCandidates.map(psLiteral).join(',');
  const runtimeNodeCandidates = executableCandidates.map(executable => psLiteral(path.join(path.dirname(executable), 'resources', 'runtime', 'node.exe'))).join(',');
  return [
    "$ErrorActionPreference = 'Stop'",
    `$logFile = ${psLiteral(logFile)}`,
    "function Write-InstallLog([string]$Message) { try { [System.IO.File]::AppendAllText($logFile, (('[{0}] {1}' -f (Get-Date).ToString('o'), $Message) + [Environment]::NewLine), [System.Text.UTF8Encoding]::new($false)) } catch {} }",
    'try {',
    "  Write-InstallLog 'Wachten tot ThuisHub volledig is afgesloten.'",
    `  Wait-Process -Id ${Number(waitPid)} -ErrorAction SilentlyContinue`,
    '  $closeDeadline = (Get-Date).AddSeconds(20)',
    "  while ((Get-Process -Name 'ThuisHub' -ErrorAction SilentlyContinue) -and (Get-Date) -lt $closeDeadline) { Start-Sleep -Milliseconds 250 }",
    "  if (Get-Process -Name 'ThuisHub' -ErrorAction SilentlyContinue) { throw 'Niet alle ThuisHub-processen zijn op tijd afgesloten; de installatie is uit veiligheid niet gestart.' }",
    `  $runtimeNodePaths = @(${runtimeNodeCandidates})`,
    "  $staleServers = @(Get-CimInstance Win32_Process -Filter \"Name='node.exe'\" -ErrorAction SilentlyContinue | Where-Object { $_.ExecutablePath -and $runtimeNodePaths -contains $_.ExecutablePath })",
    "  foreach ($staleServer in $staleServers) { Write-InstallLog (('Achtergebleven ThuisHub-server afsluiten: {0}.' -f $staleServer.ProcessId)); Stop-Process -Id $staleServer.ProcessId -Force -ErrorAction SilentlyContinue }",
    '  foreach ($staleServer in $staleServers) { Wait-Process -Id $staleServer.ProcessId -Timeout 10 -ErrorAction SilentlyContinue }',
    "  $remainingServer = $staleServers | Where-Object { Get-Process -Id $_.ProcessId -ErrorAction SilentlyContinue }",
    "  if ($remainingServer) { throw 'De oude ThuisHub-server kon niet worden afgesloten; de installatie is niet gestart.' }",
    "  Write-InstallLog 'Gecontroleerde installer wordt gestart.'",
    `  $setupProcess = Start-Process -FilePath ${psLiteral(installerPath)} -ArgumentList '/S' -PassThru -Wait`,
    '  $setupProcess.Refresh()',
    '  $exitCode = if ($null -eq $setupProcess.ExitCode) { 0 } else { $setupProcess.ExitCode }',
    "  Write-InstallLog (('Installerproces afgesloten met code {0}.' -f $exitCode))",
    '  $installedExecutable = $null',
    '  $installReadyDeadline = (Get-Date).AddSeconds(5)',
    '  do {',
    `    foreach ($candidate in @(${restartCandidates})) {`,
    '      if ($candidate -and (Test-Path -LiteralPath $candidate -PathType Leaf)) {',
    '        $candidateVersion = (Get-Item -LiteralPath $candidate).VersionInfo.FileVersion',
    `        if (-not ${psLiteral(expectedVersion)} -or $candidateVersion -like (${psLiteral(expectedVersion)} + '*')) { $installedExecutable = $candidate; break }`,
    '      }',
    '    }',
    '    if (-not $installedExecutable) { Start-Sleep -Milliseconds 100 }',
    '  } while (-not $installedExecutable -and (Get-Date) -lt $installReadyDeadline)',
    `  if (-not $installedExecutable) { throw ('De geïnstalleerde ThuisHub-versie ${expectedVersion} kon na de setup niet worden bevestigd. Installercode: {0}.' -f $exitCode) }`,
    "  if ($exitCode -ne 0) { Write-InstallLog (('De setupstarter gaf code {0}, maar de nieuwe programmaversie is wel bevestigd.' -f $exitCode)) }",
    "  Write-InstallLog (('ThuisHub opnieuw starten via {0}.' -f $installedExecutable))",
    "  $restartProcess = Start-Process -FilePath $installedExecutable -ArgumentList '--updated' -WorkingDirectory (Split-Path -Parent $installedExecutable) -PassThru",
    '  $restartDeadline = (Get-Date).AddSeconds(15)',
    '  $running = $null',
    '  do {',
    '    Start-Sleep -Milliseconds 250',
    "    $running = Get-Process -Name 'ThuisHub' -ErrorAction SilentlyContinue | Where-Object { $_.Path -eq $installedExecutable } | Select-Object -First 1",
    '  } while (-not $running -and (Get-Date) -lt $restartDeadline)',
    "  if (-not $running) { throw 'De nieuwe versie is geïnstalleerd, maar Windows kon ThuisHub niet opnieuw starten.' }",
    "  Write-InstallLog (('Update-installatie en herstart zijn voltooid. Actief proces: {0}.' -f $running.Id))",
    '} catch {',
    "  Write-InstallLog (('Installatiefout: {0}' -f $_.Exception.Message))",
    '  exit 1',
    '}',
    '',
  ].join('\r\n');
}

function launchInstallerAfterExit(installerPath, waitPid, options = {}) {
  const script = installerScript(installerPath, waitPid, options.restartExecutable);
  const version = /^ThuisHub-Setup-(\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?)\.exe$/i.exec(path.basename(installerPath))?.[1] || 'update';
  const helperFile = path.join(path.dirname(installerPath), `install-helper-${version}-${process.pid}.ps1`);
  // Windows PowerShell 5.1 needs a BOM to read non-ASCII diagnostics reliably.
  fs.writeFileSync(helperFile, `\uFEFF${script}`, 'utf8');
  appendInstallLog(installerPath, `Updatehelperbestand gemaakt: ${helperFile}`);
  const helperCommandLine = `powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -WindowStyle Hidden -File "${helperFile.replaceAll('"', '\\"')}"`;
  const brokerScript = [
    "$ErrorActionPreference = 'Stop'",
    `$commandLine = ${psLiteral(helperCommandLine)}`,
    '$result = Invoke-CimMethod -ClassName Win32_Process -MethodName Create -Arguments @{ CommandLine = $commandLine }',
    "if ($null -eq $result -or $result.ReturnValue -ne 0 -or -not $result.ProcessId) { throw ('Windows kon de updatehelper niet starten. Code: {0}' -f $result.ReturnValue) }",
    'Start-Sleep -Milliseconds 150',
    "if (-not (Get-Process -Id $result.ProcessId -ErrorAction SilentlyContinue)) { throw 'De updatehelper stopte direct na het starten.' }",
    'Write-Output $result.ProcessId',
    '',
  ].join('\r\n');
  const brokerEncoded = encodedPowerShell(brokerScript);
  const execProcess = options.execProcess || execFileSync;
  try {
    const output = execProcess('powershell.exe', ['-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-EncodedCommand', brokerEncoded], { encoding: 'utf8', windowsHide: true, timeout: 15000 });
    const helperPid = Number(String(output).trim()) || undefined;
    if (!helperPid) throw new Error('Windows gaf geen proces-ID voor de updatehelper terug.');
    appendInstallLog(installerPath, `Updatehelper actief met proces-ID ${helperPid}.`);
    return { script, brokerScript, helperFile, helperPid };
  } catch (error) {
    appendInstallLog(installerPath, `Updatehelper kon niet worden gestart: ${error instanceof Error ? error.message : String(error)}`);
    throw error;
  }
}

module.exports = { consumeInstallRequest, installerScript, launchInstallerAfterExit, sha256, validateInstallRequest };
