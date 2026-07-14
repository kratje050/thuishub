const { app, BrowserWindow, Menu, Tray, dialog, nativeImage, shell } = require('electron');
const TRAY_LABELS = require('./tray-labels.cjs');
const { consumeInstallRequest, launchInstallerAfterExit } = require('./update-handoff.cjs');
const http = require('node:http');
const net = require('node:net');
const fs = require('node:fs');
const os = require('node:os');
const { execFileSync, spawn } = require('node:child_process');
const path = require('node:path');

const APP_URL = 'http://localhost:8787';
const HEALTH_URL = 'http://127.0.0.1:8787/api/health';
const APP_ID = 'nl.thuishub.media';
const APP_NAME = 'ThuisHub';
const launchedAfterUpdate = process.argv.includes('--updated');
const desktopStartedAt = Date.now();

let mainWindow;
let tray;
let quitting = false;
let serverProcess;
let updateRequestTimer;

const appRoot = path.join(process.env.APPDATA || app.getPath('userData'), APP_NAME);
const updatesDir = path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'), APP_NAME, 'updates');
const updateRequestFile = path.join(updatesDir, 'install-request.json');
const logFile = path.join(appRoot, 'logs', 'application.log');
function log(message) {
  try {
    fs.mkdirSync(path.dirname(logFile), { recursive: true });
    fs.appendFileSync(logFile, `${JSON.stringify({ timestamp: new Date().toISOString(), level: 'INFO', category: 'application', app: APP_NAME, version: app.getVersion(), message })}\n`);
  } catch {}
}

process.on('uncaughtException', (error) => log(`Onverwachte fout: ${error.stack || error}`));
process.on('unhandledRejection', (error) => log(`Afgewezen promise: ${error?.stack || error}`));
log(`Desktopproces gestart, packaged=${app.isPackaged}`);

app.setName(APP_NAME);
app.setAppUserModelId(APP_ID);

const hasLock = app.requestSingleInstanceLock();
log(`Single-instance-lock=${hasLock}`);
if (!hasLock) {
  app.quit();
} else {
  app.on('second-instance', () => showWindow());
}

function getIconPath() {
  return app.isPackaged
    ? path.join(process.resourcesPath, 'icon.png')
    : path.join(__dirname, '..', 'build', 'icon.png');
}

function healthCheck(timeout = 1500) {
  return new Promise((resolve) => {
    const request = http.get(HEALTH_URL, { timeout }, (response) => {
      let body = '';
      response.setEncoding('utf8');
      response.on('data', (chunk) => { body += chunk; });
      response.on('end', () => {
        try {
          const result = JSON.parse(body);
          resolve(result.app === 'thuishub' && result.status === 'ok');
        } catch {
          resolve(false);
        }
      });
    });
    request.on('timeout', () => request.destroy());
    request.on('error', () => resolve(false));
  });
}

function isPortOpen() {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host: '127.0.0.1', port: 8787 });
    socket.setTimeout(750);
    socket.once('connect', () => { socket.destroy(); resolve(true); });
    socket.once('timeout', () => { socket.destroy(); resolve(false); });
    socket.once('error', () => resolve(false));
  });
}

async function ensureServer() {
  log('Server controleren');
  if (await healthCheck()) return;
  if (await isPortOpen()) {
    throw new Error('Poort 8787 wordt al door een ander programma of de oude Huiskamer-versie gebruikt. Sluit dat programma en start ThuisHub opnieuw.');
  }

  const serverEnvironment = {
    ...process.env,
    HOST: '127.0.0.1',
    PORT: '8787',
    THUIS_HUB_ROOT_DIR: appRoot,
    THUIS_HUB_DATA_DIR: path.join(appRoot, 'data'),
    THUIS_HUB_WEB_DIR: path.join(app.getAppPath(), 'dist'),
    THUIS_HUB_DESKTOP: 'true',
  };
  const serverEntry = path.join(app.getAppPath(), 'server', 'dist', 'index.js');
  const nodeExecutable = app.isPackaged
    ? path.join(process.resourcesPath, 'runtime', 'node.exe')
    : execFileSync('where.exe', ['node'], { encoding: 'utf8', windowsHide: true }).split(/\r?\n/).find(Boolean);
  if (!nodeExecutable || !fs.existsSync(nodeExecutable)) throw new Error('De meegeleverde server-runtime ontbreekt.');
  log(`Server starten met ${nodeExecutable}: ${serverEntry}`);
  serverProcess = spawn(nodeExecutable, [serverEntry], {
    cwd: app.getAppPath(),
    env: serverEnvironment,
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  serverProcess.stdout.on('data', (data) => log(`Server: ${data.toString().trim()}`));
  serverProcess.stderr.on('data', (data) => log(`Serverfout: ${data.toString().trim()}`));
  serverProcess.on('exit', (code) => log(`Server gestopt met code ${code}`));

  for (let attempt = 0; attempt < 80; attempt += 1) {
    if (await healthCheck(500)) return;
    await new Promise((resolve) => setTimeout(resolve, 125));
  }
  throw new Error('De ThuisHub-server reageerde niet op tijd.');
}

function watchForUpdateInstall() {
  if (updateRequestTimer) return;
  updateRequestTimer = setInterval(() => {
    if (quitting) return;
    try {
      const update = consumeInstallRequest(updateRequestFile, updatesDir);
      if (!update) return;
      log(`Gecontroleerde installer overgenomen voor versie ${update.version}`);
      clearInterval(updateRequestTimer);
      updateRequestTimer = undefined;
      const helper = launchInstallerAfterExit(update.file, process.pid, { restartExecutable: process.execPath });
      log(`Updatehelper buiten de app gestart met proces-ID ${helper.helperPid || 'onbekend'}`);
      quitting = true;
      app.quit();
    } catch (error) {
      log(`Installatieverzoek geweigerd: ${error?.stack || error}`);
      dialog.showErrorBox('Update kon niet worden gestart', error instanceof Error ? error.message : String(error));
    }
  }, 200);
  updateRequestTimer.unref?.();
}

function isInternalUrl(rawUrl) {
  try {
    const url = new URL(rawUrl);
    return ['localhost', '127.0.0.1'].includes(url.hostname) && url.port === '8787';
  } catch {
    return false;
  }
}

function showWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

function revealWindowAfterStart() {
  showWindow();
  log(`Opstartvenster zichtbaar na ${Date.now() - desktopStartedAt} ms`);
  if (!launchedAfterUpdate || !mainWindow || mainWindow.isDestroyed()) return;
  // Installers can restart an app behind the previous window. Briefly raising
  // the updated window makes the successful restart unambiguous to the user.
  mainWindow.setAlwaysOnTop(true);
  mainWindow.moveTop();
  mainWindow.focus();
  const releaseTopmost = setTimeout(() => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    mainWindow.setAlwaysOnTop(false);
    mainWindow.moveTop();
    mainWindow.focus();
  }, 900);
  releaseTopmost.unref?.();
  log('Update voltooid; het vernieuwde venster is zichtbaar en actief gemaakt');
}

function createWindow() {
  mainWindow = new BrowserWindow({
    title: APP_NAME,
    width: 1360,
    height: 860,
    minWidth: 960,
    minHeight: 640,
    show: false,
    backgroundColor: '#020a11',
    icon: getIconPath(),
    autoHideMenuBar: true,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
    },
  });

  mainWindow.once('ready-to-show', revealWindowAfterStart);
  const revealFallback = setTimeout(() => {
    if (mainWindow && !mainWindow.isDestroyed() && !mainWindow.isVisible()) revealWindowAfterStart();
  }, 1500);
  revealFallback.unref?.();
  mainWindow.on('close', (event) => {
    if (!quitting) {
      event.preventDefault();
      mainWindow.hide();
    }
  });
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (isInternalUrl(url)) mainWindow.loadURL(url);
    else shell.openExternal(url);
    return { action: 'deny' };
  });
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (!isInternalUrl(url)) {
      event.preventDefault();
      shell.openExternal(url);
    }
  });
  mainWindow.loadFile(path.join(__dirname, 'startup.html'), {
    query: {
      version: app.getVersion(),
      updated: launchedAfterUpdate ? '1' : '0',
    },
  });
}

async function loadApplication() {
  if (!mainWindow || mainWindow.isDestroyed()) createWindow();
  log('Webinterface laden');
  await mainWindow.loadURL(APP_URL);
  showWindow();
  log(`Webinterface is zichtbaar na ${Date.now() - desktopStartedAt} ms`);
}

function createTray() {
  const icon = nativeImage.createFromPath(getIconPath()).resize({ width: 24, height: 24 });
  tray = new Tray(icon);
  tray.setToolTip(`${APP_NAME} ${app.getVersion()}`);
  const openSection = (section) => {
    showWindow();
    mainWindow.loadURL(`${APP_URL}/?view=dashboard&section=${encodeURIComponent(section)}`);
  };
  const updateMenu = () => tray.setContextMenu(Menu.buildFromTemplate([
    { label: TRAY_LABELS[0], click: showWindow },
    { label: TRAY_LABELS[1], click: () => shell.openExternal(APP_URL) },
    { label: TRAY_LABELS[2], click: () => openSection('overview') },
    { label: TRAY_LABELS[3], click: () => openSection('remote') },
    { label: TRAY_LABELS[4], click: () => openSection('updates') },
    { label: TRAY_LABELS[5], click: () => openSection('backups') },
    { label: TRAY_LABELS[6], click: () => shell.openPath(path.join(appRoot, 'logs')) },
    { label: TRAY_LABELS[7], type: 'checkbox', checked: app.getLoginItemSettings().openAtLogin, click: (item) => { app.setLoginItemSettings({ openAtLogin: item.checked, path: process.execPath }); updateMenu(); } },
    { type: 'separator' },
    { label: `${TRAY_LABELS[8]} · versie ${app.getVersion()}`, click: () => dialog.showMessageBox({ type: 'info', title: TRAY_LABELS[8], message: `ThuisHub ${app.getVersion()}`, detail: 'Je persoonlijke mediaserver voor Windows, browser en Tailscale.' }) },
    { label: TRAY_LABELS[9], click: () => { quitting = true; app.quit(); } },
  ]));
  updateMenu();
  tray.on('double-click', showWindow);
}

if (hasLock) {
  app.whenReady().then(async () => {
    log('Electron is gereed');
    Menu.setApplicationMenu(null);
    createWindow();
    try {
      await ensureServer();
      log('Server is gereed; webinterface openen');
      await loadApplication();
      createTray();
      watchForUpdateInstall();
    } catch (error) {
      log(`Startfout: ${error?.stack || error}`);
      dialog.showErrorBox('ThuisHub kon niet starten', error instanceof Error ? error.message : String(error));
      quitting = true;
      app.quit();
    }
  });

  app.on('activate', showWindow);
  app.on('before-quit', () => {
    quitting = true;
    if (updateRequestTimer) clearInterval(updateRequestTimer);
    if (serverProcess && !serverProcess.killed) serverProcess.kill('SIGTERM');
  });
  app.on('window-all-closed', () => {});
}
