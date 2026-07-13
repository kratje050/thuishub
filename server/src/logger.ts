import fs from 'node:fs';
import path from 'node:path';
import { APP_NAME, APP_VERSION } from './constants.js';
import { appPaths } from './paths.js';

export type LogLevel = 'DEBUG' | 'INFO' | 'WARNING' | 'ERROR' | 'CRITICAL';
export type LogCategory = 'server' | 'application' | 'database' | 'updater' | 'transcoding' | 'streaming' | 'live-tv' | 'tailscale' | 'backups' | 'migration' | 'crash';

const sensitive = /password|wachtwoord|token|secret|authorization|cookie|api[-_]?key/i;
const defaultMaxFileBytes = 5 * 1024 * 1024;
let maxTotalBytes = 100 * 1024 * 1024;

function redact(value: unknown, key = ''): unknown {
  if (sensitive.test(key)) return '[VERBORGEN]';
  if (Array.isArray(value)) return value.map(item => redact(item));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([childKey, child]) => [childKey, redact(child, childKey)]));
  if (typeof value === 'string') return value.replace(/(Bearer\s+)[A-Za-z0-9._~-]+/gi, '$1[VERBORGEN]');
  return value;
}

function rotate(file: string, maxBytes = defaultMaxFileBytes) {
  try {
    if (fs.statSync(file).size < maxBytes) return;
    for (let index = 4; index >= 1; index -= 1) {
      const source = `${file}.${index}`;
      const destination = `${file}.${index + 1}`;
      if (fs.existsSync(source)) index === 4 ? fs.rmSync(source, { force: true }) : fs.renameSync(source, destination);
    }
    fs.renameSync(file, `${file}.1`);
  } catch {}
}

function enforceTotalStorage() {
  if (!fs.existsSync(appPaths.logsDir)) return;
  const files = fs.readdirSync(appPaths.logsDir).filter(name => /\.log(?:\.\d+)?$/.test(name)).map(name => {
    const file = path.join(appPaths.logsDir, name);
    const stat = fs.statSync(file);
    return { file, bytes: stat.size, modified: stat.mtimeMs };
  }).sort((left, right) => left.modified - right.modified);
  let total = files.reduce((sum, item) => sum + item.bytes, 0);
  while (total > maxTotalBytes && files.length > 1) {
    const oldest = files.shift()!;
    fs.rmSync(oldest.file, { force: true });
    total -= oldest.bytes;
  }
}

export function setMaxLogStorageMb(value: number) {
  maxTotalBytes = Math.min(2048, Math.max(10, Number(value) || 100)) * 1024 * 1024;
  enforceTotalStorage();
}

export function log(level: LogLevel, category: LogCategory, message: string, details: Record<string, unknown> = {}) {
  try {
    fs.mkdirSync(appPaths.logsDir, { recursive: true });
    const file = path.join(appPaths.logsDir, `${category}.log`);
    rotate(file, Number(process.env.THUIS_HUB_LOG_MAX_FILE_BYTES) || defaultMaxFileBytes);
    const entry = { timestamp: new Date().toISOString(), level, category, app: APP_NAME, version: APP_VERSION, message, details: redact(details) };
    fs.appendFileSync(file, `${JSON.stringify(entry)}\n`, 'utf8');
    enforceTotalStorage();
  } catch {}
}

export function readLogs(options: { category?: string; level?: string; search?: string; date?: string; limit?: number } = {}) {
  fs.mkdirSync(appPaths.logsDir, { recursive: true });
  const files = fs.readdirSync(appPaths.logsDir).filter(name => name.endsWith('.log') && (!options.category || name === `${options.category}.log`));
  const entries: any[] = [];
  for (const file of files) {
    const lines = fs.readFileSync(path.join(appPaths.logsDir, file), 'utf8').split(/\r?\n/).filter(Boolean).slice(-2000);
    for (const line of lines) {
      try {
        const entry = JSON.parse(line);
        if (options.level && entry.level !== options.level) continue;
        if (options.date && !String(entry.timestamp).startsWith(options.date)) continue;
        if (options.search && !line.toLowerCase().includes(options.search.toLowerCase())) continue;
        entries.push(entry);
      } catch {}
    }
  }
  return entries.sort((a, b) => String(b.timestamp).localeCompare(String(a.timestamp))).slice(0, Math.min(1000, Math.max(1, options.limit || 250)));
}

export function logStorageBytes() {
  if (!fs.existsSync(appPaths.logsDir)) return 0;
  return fs.readdirSync(appPaths.logsDir).reduce((total, name) => total + (fs.statSync(path.join(appPaths.logsDir, name)).isFile() ? fs.statSync(path.join(appPaths.logsDir, name)).size : 0), 0);
}

export function clearLogs() {
  if (!fs.existsSync(appPaths.logsDir)) return;
  for (const name of fs.readdirSync(appPaths.logsDir)) if (/\.log(?:\.\d+)?$/.test(name)) fs.rmSync(path.join(appPaths.logsDir, name), { force: true });
  log('INFO', 'application', 'Logboeken zijn door een beheerder opgeschoond.');
}

export const loggerInternals = { redact, rotate, enforceTotalStorage };
