import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import mime from 'mime-types';
import { authRouter } from './routes/auth.js';
import { apiRouter } from './routes/api.js';
import { optionalAuth } from './auth.js';
import { clearTranscodes } from './transcode.js';
import { startDvrScheduler } from './live-tv.js';
import { startBackupScheduler } from './backup.js';
import { migrateLegacyTmdbMetadata, startMetadataQueueWorker } from './metadata/index.js';
import { APP_NAME, APP_PORT, APP_VERSION } from './constants.js';
import { getSetting, markCleanShutdown } from './db.js';
import { log, setMaxLogStorageMb } from './logger.js';
import { checkForUpdates } from './updates.js';
import { playbackRouter } from './routes/playback.js';
import { assignedPrivateAddresses, restrictLanListener, startLanStreamingServer } from './network.js';
import { discoverPlaybackDevices, registerPlaybackDiscoveryProvider, startPlaybackDeviceDiscovery, stopPlaybackDeviceDiscovery } from './playback-devices/discovery-service.js';
import { createDlnaDiscoveryProvider, DlnaSsdpMonitor } from './playback-devices/providers/dlna.js';
import { startThuisHubMdnsAdvertisement, stopThuisHubMdnsAdvertisement } from './playback-devices/mdns-advertiser.js';
import { attachPlaybackWebSockets, closePlaybackWebSockets } from './playback-devices/websocket.js';
import { httpErrorPayload, httpErrorStatus } from './http-errors.js';

const app = express();
const port = Number(process.env.PORT || APP_PORT);
const host = process.env.HOST || '127.0.0.1';
let dlnaMonitor: DlnaSsdpMonitor | null = null;

async function rebindLanDiscoveryServices(address: string) {
  await stopThuisHubMdnsAdvertisement();
  await dlnaMonitor?.stop();
  dlnaMonitor = null;
  if (getSetting('automaticDeviceDiscovery', 'true') !== 'true' || !assignedPrivateAddresses().includes(address)) return;
  startThuisHubMdnsAdvertisement();
  if (getSetting('dlnaDiscoveryEnabled', 'true') !== 'true') return;
  const monitor = new DlnaSsdpMonitor({
    address,
    onAlive: () => { void discoverPlaybackDevices('background'); },
    onByebye: () => { void discoverPlaybackDevices('background'); },
    onError: error => log('WARNING', 'tv-discovery', 'SSDP NOTIFY kon niet worden verwerkt.', { error: error.message }),
  });
  dlnaMonitor = monitor;
  try { await monitor.start(); }
  catch (error) {
    if (dlnaMonitor === monitor) dlnaMonitor = null;
    await monitor.stop();
    throw error;
  }
}

registerPlaybackDiscoveryProvider({
  ...createDlnaDiscoveryProvider(),
  async discover(address) {
    if (getSetting('dlnaDiscoveryEnabled', 'true') !== 'true') return { provider: 'dlna-upnp', devices: [], startedAt: new Date().toISOString(), finishedAt: new Date().toISOString() };
    return createDlnaDiscoveryProvider().discover(address);
  },
});

app.disable('x-powered-by');
app.use(restrictLanListener);
app.use(express.json({ limit: '1mb' }));
app.get('/api/health', (_req, res) => res.json({ app: 'thuishub', name: APP_NAME, status: 'ok', version: APP_VERSION }));
app.use('/api/playback', playbackRouter);
app.use(optionalAuth);
app.use('/api/auth', authRouter);
app.use('/api', apiRouter);

const webDir = path.resolve(process.env.THUIS_HUB_WEB_DIR || process.env.HUISKAMER_WEB_DIR || 'dist');
setMaxLogStorageMb(Number(getSetting('maxLogStorageMb', '100')));
if (fs.existsSync(webDir)) {
  app.use(express.static(webDir, { setHeaders(res, file) {
    if (mime.lookup(file) === 'text/html') res.setHeader('Cache-Control', 'no-store');
  }}));
  app.use((req, res, next) => req.method === 'GET' ? res.sendFile(path.join(webDir, 'index.html')) : next());
}

app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error(err);
  log('ERROR', 'server', err.message || 'Onbekende serverfout.', { stack: err.stack, path: _req.path, method: _req.method });
  res.status(httpErrorStatus(err)).json(httpErrorPayload(err));
});

const server = app.listen(port, host, () => {
  startDvrScheduler();
  startBackupScheduler();
  startPlaybackDeviceDiscovery(async ({ address }) => {
    await rebindLanDiscoveryServices(address);
  });
  void migrateLegacyTmdbMetadata().catch(error => console.error('Metadata-migratie mislukt:',error instanceof Error?error.message:String(error))).finally(()=>startMetadataQueueWorker());
  console.log(`\n${APP_NAME} ${APP_VERSION} draait op http://localhost:${port}\n`);
  log('INFO', 'server', 'Server gestart.', { host, port });
  if (getSetting('automaticUpdateCheck', 'false') === 'true') void checkForUpdates();
});
const lanServer = startLanStreamingServer(app);
attachPlaybackWebSockets(server, { lan: false });
if (lanServer) {
  attachPlaybackWebSockets(lanServer, { lan: true });
  lanServer.on('listening', () => startThuisHubMdnsAdvertisement());
  lanServer.on('error', () => { void stopThuisHubMdnsAdvertisement(); });
  lanServer.on('close', () => { void stopThuisHubMdnsAdvertisement(); });
}

function shutdown() {
  markCleanShutdown();
  log('INFO', 'server', 'Server wordt netjes afgesloten.');
  clearTranscodes();
  void stopThuisHubMdnsAdvertisement();
  void dlnaMonitor?.stop();
  dlnaMonitor = null;
  void stopPlaybackDeviceDiscovery();
  closePlaybackWebSockets();
  server.close(() => process.exit(0));
  lanServer?.close();
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
process.on('uncaughtException', error => {
  log('CRITICAL', 'crash', 'Onverwachte serverfout.', { error: error.message, stack: error.stack });
  shutdown();
});
process.on('unhandledRejection', error => log('CRITICAL', 'crash', 'Niet-afgehandelde promise.', { error: error instanceof Error ? error.message : String(error) }));

export { app };
