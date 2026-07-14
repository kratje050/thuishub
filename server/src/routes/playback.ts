import { Router, type Request, type Response } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import mime from 'mime-types';
import { db, getSetting } from '../db.js';
import { createDlnaMpegTsStream, ensureHls, hlsFile } from '../transcode.js';
import { verifyPlaybackToken, type PlaybackResource } from '../playback-tokens.js';

export const playbackRouter = Router();

function cors(req: Request, res: Response) {
  const origin = String(req.headers.origin || '');
  const configured = getSetting('castReceiverOrigins', '').split(',').map(item => item.trim()).filter(Boolean);
  let allowed = !origin;
  try {
    const parsed = new URL(origin);
    const localAddress = String(req.socket.localAddress || '').replace(/^::ffff:/, '');
    const localHosts = new Set(['localhost','127.0.0.1','::1',localAddress,getSetting('localStreamingAddress','')].filter(Boolean));
    allowed = localHosts.has(parsed.hostname) || parsed.hostname.endsWith('.googleusercontent.com') || origin === 'https://www.gstatic.com' || configured.includes(origin);
  } catch {}
  if (origin && allowed) { res.setHeader('Access-Control-Allow-Origin', origin); res.setHeader('Vary', 'Origin'); }
  res.setHeader('Access-Control-Allow-Methods', 'GET,HEAD,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Accept-Encoding,Range,If-Range');
  res.setHeader('Access-Control-Expose-Headers', 'Content-Length,Content-Range,Accept-Ranges,Content-Type');
  if (allowed && String(req.headers['access-control-request-private-network'] || '').toLowerCase() === 'true') res.setHeader('Access-Control-Allow-Private-Network', 'true');
  res.setHeader('Cache-Control', 'private,no-store');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
  return allowed;
}

playbackRouter.options('/:id/*resource', (req, res) => cors(req, res) ? res.status(204).setHeader('Content-Length', '0').end() : res.status(403).end());

function grant(req: Request, resource: PlaybackResource) {
  return verifyPlaybackToken(String(req.query.token || ''), Number(req.params.id), resource);
}

function dlnaTimeSeekSeconds(value: unknown) {
  const raw = String(value || '').trim();
  const match = raw.match(/(?:^|\s)npt=(?:(\d+):(\d{2}):(\d{2}(?:\.\d+)?)|(\d+(?:\.\d+)?))-/i);
  if (!match) return 0;
  const seconds = match[4] !== undefined ? Number(match[4]) : Number(match[1]) * 3_600 + Number(match[2]) * 60 + Number(match[3]);
  return Number.isFinite(seconds) ? Math.min(7 * 24 * 3_600, Math.max(0, seconds)) : 0;
}

function serveRange(req: Request, res: Response, file: string, download = false) {
  const stat = fs.statSync(file);
  const type = mime.lookup(file) || 'application/octet-stream';
  res.setHeader('Accept-Ranges', 'bytes'); res.setHeader('Content-Type', type);
  if (download) res.setHeader('Content-Disposition', `attachment; filename="${path.basename(file).replaceAll('"', '')}"`);
  const range = String(req.headers.range || '');
  if (range) {
    const match = range.match(/^bytes=(\d*)-(\d*)$/);
    if (!match) return res.status(416).setHeader('Content-Range', `bytes */${stat.size}`).end();
    const start = match[1] ? Number(match[1]) : Math.max(0, stat.size - Number(match[2] || 0));
    const end = match[2] && match[1] ? Math.min(Number(match[2]), stat.size - 1) : stat.size - 1;
    if (!Number.isFinite(start) || !Number.isFinite(end) || start > end || start >= stat.size) return res.status(416).setHeader('Content-Range', `bytes */${stat.size}`).end();
    res.status(206).set({ 'Content-Range': `bytes ${start}-${end}/${stat.size}`, 'Content-Length': String(end - start + 1) });
    if (req.method === 'HEAD') return res.end();
    return fs.createReadStream(file, { start, end }).pipe(res);
  }
  res.setHeader('Content-Length', String(stat.size));
  if (req.method === 'HEAD') return res.end();
  return fs.createReadStream(file).pipe(res);
}

playbackRouter.all('/:id/file', (req, res) => {
  if (!['GET', 'HEAD'].includes(req.method)) return res.status(405).end();
  if (!cors(req, res)) return res.status(403).json({ error: 'Deze afspeel-origin is niet toegestaan.' });
  if (!grant(req, 'file')) return res.status(401).json({ error: 'De tijdelijke afspeellink is ongeldig of verlopen.' });
  const item = db.prepare('SELECT file_path FROM media_items WHERE id=?').get(Number(req.params.id)) as any;
  if (!item || !fs.existsSync(item.file_path)) return res.status(404).end();
  serveRange(req, res, item.file_path);
});

playbackRouter.all('/:id/download', (req, res) => {
  if (!['GET', 'HEAD'].includes(req.method)) return res.status(405).end();
  if (!cors(req, res)) return res.status(403).end();
  if (!grant(req, 'download')) return res.status(401).json({ error: 'De tijdelijke downloadlink is ongeldig of verlopen.' });
  const item = db.prepare('SELECT file_path FROM media_items WHERE id=?').get(Number(req.params.id)) as any;
  if (!item || !fs.existsSync(item.file_path)) return res.status(404).end();
  serveRange(req, res, item.file_path, true);
});

playbackRouter.all('/:id/subtitle', (req, res) => {
  if (!['GET', 'HEAD'].includes(req.method)) return res.status(405).end();
  if (!cors(req, res)) return res.status(403).end();
  if (!grant(req, 'subtitle')) return res.status(401).json({ error: 'De tijdelijke ondertitellink is ongeldig of verlopen.' });
  const item = db.prepare('SELECT subtitle_path FROM media_items WHERE id=?').get(Number(req.params.id)) as any;
  if (!item?.subtitle_path || !fs.existsSync(item.subtitle_path)) return res.status(404).end();
  let text = fs.readFileSync(item.subtitle_path, 'utf8').replace(/^\uFEFF/, '');
  if (path.extname(item.subtitle_path).toLowerCase() === '.srt') text = `WEBVTT\n\n${text.replace(/(\d{2}:\d{2}:\d{2}),(\d{3})/g, '$1.$2')}`;
  res.type('text/vtt; charset=utf-8');
  res.setHeader('Content-Length', String(Buffer.byteLength(text)));
  if (req.method === 'HEAD') return res.end();
  res.send(text);
});

playbackRouter.all('/:id/artwork', (req, res) => {
  if (!['GET', 'HEAD'].includes(req.method)) return res.status(405).end();
  if (!cors(req, res)) return res.status(403).end();
  if (!grant(req, 'artwork')) return res.status(401).json({ error: 'De tijdelijke afbeeldingslink is ongeldig of verlopen.' });
  const item = db.prepare(`SELECT COALESCE((SELECT local_path FROM metadata_images
    WHERE media_id=m.id AND image_type='poster' AND selected=1 AND local_path IS NOT NULL ORDER BY id DESC LIMIT 1),m.poster_path) file
    FROM media_items m WHERE m.id=?`).get(Number(req.params.id)) as { file?: string } | undefined;
  if (!item?.file || !path.isAbsolute(item.file) || !fs.existsSync(item.file)) return res.status(404).end();
  serveRange(req, res, item.file);
});

playbackRouter.all('/:id/dlna', (req, res, next) => {
  try {
    if (!['GET', 'HEAD'].includes(req.method)) return res.status(405).end();
    if (!cors(req, res)) return res.status(403).end();
    const verified = grant(req, 'dlna');
    if (!verified) return res.status(401).json({ error: 'De tijdelijke DLNA-afspeellink is ongeldig of verlopen.' });
    const item = db.prepare('SELECT file_path,color_transfer,subtitle_path,duration FROM media_items WHERE id=?').get(Number(req.params.id)) as any;
    if (!item || !fs.existsSync(item.file_path)) return res.status(404).end();

    const contentFeatures = 'DLNA.ORG_OP=10;DLNA.ORG_CI=1;DLNA.ORG_FLAGS=01700000000000000000000000000000';
    res.status(200);
    res.setHeader('Content-Type', 'video/mpeg');
    res.setHeader('transferMode.dlna.org', 'Streaming');
    res.setHeader('contentFeatures.dlna.org', contentFeatures);
    const startSeconds = dlnaTimeSeekSeconds(req.headers['timeseekrange.dlna.org']);
    const duration = Math.max(0, Number(item.duration) || 0);
    if (duration > 0) res.setHeader('TimeSeekRange.dlna.org', `npt=${startSeconds.toFixed(3)}-${duration.toFixed(3)}/${duration.toFixed(3)}`);
    if (req.method === 'HEAD') return res.end();

    const process = createDlnaMpegTsStream(item.file_path, item.color_transfer, {
      ...verified.options,
      subtitlePath: item.subtitle_path,
    }, startSeconds);
    let finished = false;
    const stop = () => {
      if (!finished && process.exitCode === null && !process.killed) process.kill();
    };
    req.once('aborted', stop);
    res.once('close', stop);
    process.once('error', error => {
      finished = true;
      if (!res.headersSent) next(error);
      else res.destroy(error);
    });
    process.once('close', code => {
      finished = true;
      if (code && !res.writableEnded) res.destroy(new Error(process.stderrLog || 'FFmpeg kon de DLNA-stream niet maken.'));
    });
    res.flushHeaders();
    process.stdout.pipe(res);
  } catch (error) { next(error); }
});

playbackRouter.all('/:id/hls/:file', async (req, res, next) => {
  try {
    if (!['GET', 'HEAD'].includes(req.method)) return res.status(405).end();
    if (!cors(req, res)) return res.status(403).end();
    const verified=grant(req, 'hls');
    if (!verified) return res.status(401).json({ error: 'De tijdelijke afspeellink is ongeldig of verlopen.' });
    const id = Number(req.params.id);
    const item = db.prepare('SELECT file_path,color_transfer,subtitle_path FROM media_items WHERE id=?').get(id) as any;
    if (!item || !fs.existsSync(item.file_path)) return res.status(404).end();
    if (String(req.params.file) === 'index.m3u8') await ensureHls(id, item.file_path, item.color_transfer,{...verified.options,subtitlePath:item.subtitle_path});
    const file = hlsFile(id, String(req.params.file));
    if (!file) return res.status(404).end();
    if (String(req.params.file).endsWith('.m3u8')) {
      const token = encodeURIComponent(String(req.query.token));
      const manifest = fs.readFileSync(file, 'utf8').split(/\r?\n/).map(line => line && !line.startsWith('#') ? `${line}?token=${token}` : line).join('\n');
      res.type('application/vnd.apple.mpegurl').setHeader('Cache-Control', 'no-store');
      res.setHeader('Content-Length', String(Buffer.byteLength(manifest)));
      if (req.method === 'HEAD') return res.end();
      return res.send(manifest);
    }
    return serveRange(req, res, file);
  } catch (error) { next(error); }
});

export const playbackRouteInternals = { cors, serveRange, dlnaTimeSeekSeconds };
