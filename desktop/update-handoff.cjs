const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');

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

function launchInstallerAfterExit(installerPath, waitPid, spawnProcess = spawn) {
  const escaped = installerPath.replaceAll("'", "''");
  const script = `$ErrorActionPreference = 'Stop'\r\nWait-Process -Id ${waitPid} -ErrorAction SilentlyContinue\r\nStart-Sleep -Milliseconds 500\r\n$installer = Start-Process -FilePath '${escaped}' -ArgumentList '/S','--force-run' -Wait -PassThru\r\nif ($installer.ExitCode -ne 0) { exit $installer.ExitCode }\r\n`;
  const encoded = Buffer.from(script, 'utf16le').toString('base64');
  const helper = spawnProcess('powershell.exe', ['-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-EncodedCommand', encoded], { detached: true, stdio: 'ignore', windowsHide: true });
  helper.unref();
  return { encoded, script };
}

module.exports = { consumeInstallRequest, launchInstallerAfterExit, sha256, validateInstallRequest };
