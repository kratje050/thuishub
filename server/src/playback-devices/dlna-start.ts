import {
  DlnaPlaybackConfirmationError,
  waitForDlnaPlaying,
  type DlnaController,
  type DlnaPlaybackConfirmationOptions,
} from './providers/dlna.js';
import {
  getPlaybackSession,
  PlaybackSessionError,
  stopPlaybackSession,
  updatePlaybackSession,
  type PlaybackSession,
} from './sessions.js';
import { abortPlaybackTransfer, finalizePlaybackTransfer, isPendingPlaybackTransfer } from './transfers.js';

export type DlnaStartController = Pick<DlnaController, 'play' | 'seek' | 'stop' | 'getTransportInfo'>;

export type StartConfirmedDlnaPlaybackInput = {
  controller: DlnaStartController;
  session: PlaybackSession;
  uri: string;
  metadata?: string;
  confirmation?: DlnaPlaybackConfirmationOptions;
};

function failureReason(error: unknown) {
  if (!(error instanceof DlnaPlaybackConfirmationError)) return 'receiver-error';
  if (error.code === 'DLNA_PLAYBACK_CONFIRMATION_TIMEOUT') return 'receiver-timeout';
  if (error.code === 'DLNA_PLAYBACK_STOPPED') return 'receiver-stopped';
  return 'receiver-error';
}

/**
 * Starts a DLNA receiver and owns the matching central-session transition.
 * The destination remains connecting until GetTransportInfo reports PLAYING.
 * Any failure retires only that destination; an atomic-handoff source and its
 * grants remain active through abortPlaybackTransfer.
 */
export async function startConfirmedDlnaPlayback(input: StartConfirmedDlnaPlaybackInput) {
  try {
    await input.controller.play({ uri: input.uri, metadata: input.metadata || '' });
    if (input.session.position > 0) await input.controller.seek(input.session.position);
    const transport = await waitForDlnaPlaying(input.controller, input.confirmation);

    const current = getPlaybackSession(input.session.id, input.session.userId);
    if (!current || current.endedAt) {
      throw new PlaybackSessionError('De DLNA-afspeelsessie is tijdens het starten beëindigd.', 409, 'PLAYBACK_SESSION_ENDED');
    }
    let session = updatePlaybackSession({
      id: current.id,
      userId: current.userId,
      revision: current.revision,
      state: 'playing',
    });
    session = await finalizePlaybackTransfer(session);
    return { session, transport };
  } catch (error) {
    const current = getPlaybackSession(input.session.id, input.session.userId);
    if (current && !current.endedAt) {
      const reason = failureReason(error);
      if (isPendingPlaybackTransfer(current)) {
        await abortPlaybackTransfer(current, reason);
      } else {
        await input.controller.stop().catch(() => undefined);
        const latest = getPlaybackSession(current.id, current.userId);
        if (latest && !latest.endedAt) {
          stopPlaybackSession({ id: latest.id, userId: latest.userId, revision: latest.revision, reason });
        }
      }
    }
    throw error;
  }
}

export const dlnaStartInternals = { failureReason };
