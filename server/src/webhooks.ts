import { db } from './db.js';

export function emitWebhook(event: string, payload: Record<string, unknown>) {
  const hooks = db.prepare('SELECT url, events FROM webhooks WHERE enabled=1').all() as { url: string; events: string }[];
  const body = JSON.stringify({ event, timestamp: new Date().toISOString(), ...payload });
  for (const hook of hooks) {
    if (!hook.events.split(',').map(x => x.trim()).includes(event)) continue;
    void fetch(hook.url, { method: 'POST', headers: { 'content-type': 'application/json', 'user-agent': 'ThuisHub/1.1.0' }, body, signal: AbortSignal.timeout(5000) }).catch(() => {});
  }
}

export function audit(userId: number | null, event: string, details: Record<string, unknown> = {}) {
  db.prepare('INSERT INTO audit_log(user_id,event,details) VALUES(?,?,?)').run(userId, event, JSON.stringify(details));
}
