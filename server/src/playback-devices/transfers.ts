import { queueDeviceCommand } from '../devices.js';
import { log } from '../logger.js';
import { DlnaController, type DlnaControllerTarget } from './providers/dlna.js';
import { playbackDeviceRegistry } from './registry.js';
import {
  finalizePlaybackHandoff,
  getActivePlaybackSession,
  getPlaybackSession,
  listPendingPlaybackTransfers,
  playbackTransferDeadline,
  playbackTransferSourceId,
  PlaybackSessionError,
  rollbackPlaybackHandoff,
  type PlaybackSession,
} from './sessions.js';

const timeoutTimers = new Map<string, NodeJS.Timeout>();
const rollbackListeners = new Set<(activeSession: PlaybackSession | null) => void>();

export function onPlaybackTransferRollback(listener: (activeSession: PlaybackSession | null) => void) {
  rollbackListeners.add(listener);
  return () => rollbackListeners.delete(listener);
}

export function isPendingPlaybackTransfer(session: PlaybackSession | null | undefined) {
  return Boolean(session && !session.endedAt && playbackTransferSourceId(session));
}

const actionsAllowedDuringHandoff = new Set(['stop', 'error', 'disconnect']);

/**
 * A controller may not confirm a receiver or replace its media while the
 * destination is still connecting. Only receiver status (or a successful
 * protocol-level start) is allowed to finalize the handoff.
 */
export function assertPlaybackTransferControllerActionAllowed(session: PlaybackSession, action: string) {
  if (isPendingPlaybackTransfer(session) && !actionsAllowedDuringHandoff.has(action)) {
    throw new PlaybackSessionError(
      'Wacht tot het nieuwe afspeelapparaat het afspelen heeft bevestigd voordat je deze opdracht uitvoert.',
      409,
      'PLAYBACK_TRANSFER_PENDING',
    );
  }
}

/**
 * Resolves the stable source for a new destination. If another destination is
 * already connecting, the original source is retained instead of turning the
 * pending destination into a fragile transfer chain.
 */
export function resolvePlaybackHandoffSource(userId: number, targetDeviceId: string) {
  const current = getActivePlaybackSession(userId);
  if (!current) return null;
  const existingSourceId = playbackTransferSourceId(current);
  if (existingSourceId) {
    const source = getPlaybackSession(existingSourceId, userId);
    if (source && !source.endedAt) return source.deviceId === targetDeviceId ? null : source;
    // A legacy/damaged pending row must never become the source of a new chain.
    try { rollbackPlaybackHandoff(current.id, userId, 'transfer-source-lost'); } catch { /* best effort recovery */ }
    const restored = getActivePlaybackSession(userId);
    return restored && restored.deviceId !== targetDeviceId ? restored : null;
  }
  return current.deviceId === targetDeviceId ? null : current;
}

/** Best-effort receiver shutdown; revoking its grants remains the hard stop. */
export async function stopPlaybackReceiver(session: PlaybackSession, reason: string) {
  if (session.protocol === 'google-cast' || session.protocol === 'local-browser') return true;
  try {
    const device = playbackDeviceRegistry.get(session.deviceId);
    if (!device) return true;
    if (session.protocol === 'dlna-upnp') {
      const services = device.metadata?.services as DlnaControllerTarget['services'] | undefined;
      if (!device.address || !services?.avTransport) throw new Error('DLNA-bedieningsgegevens ontbreken.');
      await new DlnaController({ address: device.address, services }).stop();
    } else {
      queueDeviceCommand(session.deviceId, 'stop', { sessionId: session.id, reason });
    }
    return true;
  } catch (error) {
    log('WARNING', 'streaming', 'Een afspeelapparaat kon niet op afstand worden gestopt; de sessiegrants zijn wel ingetrokken.', {
      deviceId: session.deviceId,
      protocol: session.protocol,
      reason,
      error: error instanceof Error ? error.message : String(error),
    });
    return false;
  }
}

function clearTransferTimer(sessionId: string) {
  const timer = timeoutTimers.get(sessionId);
  if (timer) clearTimeout(timer);
  timeoutTimers.delete(sessionId);
}

export function disarmPlaybackTransferTimeout(sessionId: string) {
  clearTransferTimer(sessionId);
}

/**
 * Rolls back only the unconfirmed destination. The source session and every
 * source grant remain untouched, so it becomes active again immediately.
 */
export async function abortPlaybackTransfer(session: PlaybackSession, reason = 'transfer-failed') {
  const current = getPlaybackSession(session.id, session.userId);
  if (!current || current.endedAt || !isPendingPlaybackTransfer(current)) {
    return { session: current || session, activeSession: getActivePlaybackSession(session.userId) };
  }
  clearTransferTimer(current.id);
  const stopped = rollbackPlaybackHandoff(current.id, current.userId, reason) || current;
  await stopPlaybackReceiver(current, reason);
  const activeSession = getActivePlaybackSession(current.userId);
  for (const listener of rollbackListeners) {
    try { listener(activeSession); } catch { /* observers may not break rollback */ }
  }
  return { session: stopped, activeSession };
}

/**
 * Arms a durable deadline stored in session metadata. Re-arming is idempotent,
 * and startup recovery below restores timers after a server restart.
 */
export function armPlaybackTransferTimeout(session: PlaybackSession) {
  if (!isPendingPlaybackTransfer(session)) return;
  clearTransferTimer(session.id);
  const delay = Math.max(0, playbackTransferDeadline(session) - Date.now());
  const timer = setTimeout(() => {
    timeoutTimers.delete(session.id);
    const current = getPlaybackSession(session.id, session.userId);
    if (current && isPendingPlaybackTransfer(current)) void abortPlaybackTransfer(current, 'transfer-timeout');
  }, delay);
  timer.unref?.();
  timeoutTimers.set(session.id, timer);
}

/**
 * Promotes a receiver only after it reports playing. The database transition
 * atomically retires/revokes the source and clears the pending marker before
 * the old receiver is stopped best-effort.
 */
export async function finalizePlaybackTransfer(session: PlaybackSession) {
  const current = getPlaybackSession(session.id, session.userId);
  const previousId = current ? playbackTransferSourceId(current) : null;
  if (!current || !previousId || current.endedAt) return current || session;
  if (current.state !== 'playing') return current;
  const previous = getPlaybackSession(previousId, current.userId);
  const finalized = finalizePlaybackHandoff(current.id, current.userId) || current;
  clearTransferTimer(current.id);
  if (previous && previous.deviceId !== current.deviceId) await stopPlaybackReceiver(previous, 'transferred');
  return finalized;
}

// Rebuild pending timers after a restart. Expired deadlines run on the next
// event-loop turn and roll back only their destination session.
for (const session of listPendingPlaybackTransfers()) armPlaybackTransferTimeout(session);

export const playbackTransferInternals = { timeoutTimers, rollbackListeners };
