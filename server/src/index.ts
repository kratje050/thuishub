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
import { APP_NAME, APP_PORT, APP_VERSION } from './constants.js';
import { getSetting, markCleanShutdown } from './db.js';
import { log, setMaxLogStorageMb } from './logger.js';
import { checkForUpdates } from './updates.js';
import { playbackRouter } from './routes/playback.js';
import { restrictLanListener, startLanStreamingServer } from './network.js';

const app = express();
const port = Number(process.env.PORT || APP_PORT);
const host = process.env.HOST || '127.0.0.1';

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
  res.status(err.status || 500).json({ error: err.message || 'Er ging iets mis.' });
});

const server = app.listen(port, host, () => {
  startDvrScheduler();
  startBackupScheduler();
  console.log(`\n${APP_NAME} ${APP_VERSION} draait op http://localhost:${port}\n`);
  log('INFO', 'server', 'Server gestart.', { host, port });
  if (getSetting('automaticUpdateCheck', 'false') === 'true') void checkForUpdates();
});
const lanServer = startLanStreamingServer(app);

function shutdown() {
  markCleanShutdown();
  log('INFO', 'server', 'Server wordt netjes afgesloten.');
  clearTranscodes();
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
