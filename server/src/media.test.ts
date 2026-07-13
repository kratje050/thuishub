import { describe, expect, it } from 'vitest';
import path from 'node:path';
import { parseMediaName } from './media.js';
import { isDirectPlayable } from './transcode.js';

describe('bestandsherkenning', () => {
  it('herkent een filmtitel en jaar uit een releasenaam', () => {
    const root = path.join('C:', 'Media', 'Films');
    const parsed = parseMediaName(path.join(root, 'Dune.Part.Two.2024.1080p.BluRay.mkv'), root, 'movies');
    expect(parsed).toMatchObject({ kind: 'movie', title: 'Dune Part Two', year: 2024 });
  });

  it('herkent serie, seizoen, aflevering en titel', () => {
    const root = path.join('C:', 'Media', 'Series');
    const parsed = parseMediaName(path.join(root, 'The Bear', 'Season 02', 'The.Bear.S02E03.Sundae.1080p.mkv'), root, 'series');
    expect(parsed).toMatchObject({ kind: 'episode', seriesTitle: 'The Bear', season: 2, episode: 3, title: 'Sundae' });
  });

  it('ondersteunt de 1x01-notatie', () => {
    const root = path.join('C:', 'Series');
    const parsed = parseMediaName(path.join(root, 'Dark', 'Dark 1x04 Double Lives.mp4'), root, 'series');
    expect(parsed).toMatchObject({ seriesTitle: 'Dark', season: 1, episode: 4, title: 'Double Lives' });
  });
});

describe('afspeelstrategie', () => {
  it('speelt compatibele mp4 direct af', () => {
    expect(isDirectPlayable({ file_path: 'film.mp4', video_codec: 'h264', audio_codec: 'aac' })).toBe(true);
  });

  it('zet mkv automatisch om', () => {
    expect(isDirectPlayable({ file_path: 'film.mkv', video_codec: 'hevc', audio_codec: 'dts' })).toBe(false);
  });
});
