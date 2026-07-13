export type PlaybackActivity = {
  sessionId: string; userId: number; username: string; mediaId: number; title: string;
  state: 'playing' | 'paused' | 'buffering'; position: number; duration: number;
  transcoding: boolean; address: string; startedAt: string; updatedAt: string;
};

const sessions = new Map<string, PlaybackActivity>();

export function updateActivity(activity: PlaybackActivity) {
  sessions.set(activity.sessionId, activity);
}

export function patchActivity(sessionId: string, patch: Partial<PlaybackActivity>) {
  const current = sessions.get(sessionId);
  if (current) sessions.set(sessionId, { ...current, ...patch, updatedAt: new Date().toISOString() });
}

export function removeActivity(sessionId: string) { sessions.delete(sessionId); }

export function listActivity() {
  const stale = Date.now() - 2 * 60 * 1000;
  for (const [id, session] of sessions) if (new Date(session.updatedAt).getTime() < stale) sessions.delete(id);
  return [...sessions.values()].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}
