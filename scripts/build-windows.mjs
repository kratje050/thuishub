import { spawn } from 'node:child_process';
import path from 'node:path';
const environment = { ...process.env };
const builderCli = path.join(process.cwd(), 'node_modules', 'electron-builder', 'out', 'cli', 'cli.js');
const argumentsList = [builderCli, '--win', 'nsis', 'portable'];

if (environment.WINDOWS_CERTIFICATE_FILE) environment.CSC_LINK = environment.WINDOWS_CERTIFICATE_FILE;
if (environment.WINDOWS_CERTIFICATE_PASSWORD) environment.CSC_KEY_PASSWORD = environment.WINDOWS_CERTIFICATE_PASSWORD;
if (environment.WINDOWS_CERTIFICATE_THUMBPRINT) argumentsList.push(`--config.win.certificateSha1=${environment.WINDOWS_CERTIFICATE_THUMBPRINT}`);

const signed = Boolean(environment.CSC_LINK || environment.WINDOWS_CERTIFICATE_THUMBPRINT);
console.log(signed ? 'Code signing is ingeschakeld via veilige omgevingsvariabelen.' : 'LET OP: er is geen code-signingcertificaat ingesteld; de build wordt niet digitaal ondertekend.');

const child = spawn(process.execPath, argumentsList, { stdio: 'inherit', env: environment, shell: false });
process.exitCode = await new Promise(resolve => {
  child.on('exit', code => resolve(code ?? 1));
  child.on('error', error => { console.error(error); resolve(1); });
});

for (const name of ['WINDOWS_CERTIFICATE_FILE', 'WINDOWS_CERTIFICATE_PASSWORD', 'WINDOWS_CERTIFICATE_THUMBPRINT']) {
  if (process.env[name]) process.env[name] = '';
}
