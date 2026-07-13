import { db } from '../db.js';

export type EpisodeNavigationDirection = 'next' | 'previous';

type CurrentEpisodeRow = {
  id: number;
  sourceId: number;
  kind: string;
  seriesTitle: string | null;
  season: number;
  episode: number;
};

/**
 * Finds the adjacent episode in deterministic library order. The source is
 * part of the series identity so two libraries containing the same title do
 * not unexpectedly navigate into each other.
 */
export function adjacentEpisodeId(mediaId: number, direction: EpisodeNavigationDirection) {
  const current = db.prepare(`SELECT id,source_id sourceId,kind,series_title seriesTitle,
    COALESCE(season,0) season,COALESCE(episode,0) episode
    FROM media_items WHERE id=?`).get(mediaId) as CurrentEpisodeRow | undefined;
  if (!current || current.kind !== 'episode' || !current.seriesTitle) return null;

  const forward = direction === 'next';
  const comparison = forward ? '>' : '<';
  const ordering = forward ? 'ASC' : 'DESC';
  const row = db.prepare(`SELECT id FROM media_items
    WHERE source_id=? AND kind='episode' AND series_title=? AND (
      COALESCE(season,0) ${comparison} ? OR
      (COALESCE(season,0)=? AND COALESCE(episode,0) ${comparison} ?) OR
      (COALESCE(season,0)=? AND COALESCE(episode,0)=? AND id ${comparison} ?)
    )
    ORDER BY COALESCE(season,0) ${ordering},COALESCE(episode,0) ${ordering},id ${ordering}
    LIMIT 1`).get(
      current.sourceId, current.seriesTitle,
      current.season, current.season, current.episode,
      current.season, current.episode, current.id,
    ) as { id: number } | undefined;
  return row?.id ?? null;
}
