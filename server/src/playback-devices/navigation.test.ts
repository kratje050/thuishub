import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'thuishub-playback-navigation-'));
process.env.THUIS_HUB_ROOT_DIR = root;
process.env.THUIS_HUB_DATA_DIR = path.join(root, 'data');
process.env.THUIS_HUB_BACKUP_DIR = path.join(root, 'backups');
process.env.THUIS_HUB_LOG_DIR = path.join(root, 'logs');
fs.writeFileSync(path.join(root, '.migration-from-huiskamer.json'), '{}');

const database = await import('../db.js');
const { adjacentEpisodeId } = await import('./navigation.js');

const firstSourceId = Number(database.db.prepare("INSERT INTO sources(name,path,kind) VALUES('Serie A','C:/Serie-A','series')").run().lastInsertRowid);
const secondSourceId = Number(database.db.prepare("INSERT INTO sources(name,path,kind) VALUES('Serie B','C:/Serie-B','series')").run().lastInsertRowid);
let fileSequence = 0;
function addMedia(sourceId: number, kind: 'movie' | 'episode', title: string, seriesTitle?: string, season?: number, episode?: number) {
  fileSequence += 1;
  return Number(database.db.prepare(`INSERT INTO media_items(source_id,kind,title,sort_title,series_title,season,episode,file_path)
    VALUES(?,?,?,?,?,?,?,?)`).run(sourceId, kind, title, title, seriesTitle || null, season ?? null, episode ?? null, `C:/Navigatie/${fileSequence}.mp4`).lastInsertRowid);
}

const special = addMedia(firstSourceId, 'episode', 'Special', 'Voorbeeldserie', 0, 1);
const first = addMedia(firstSourceId, 'episode', 'Eerste', 'Voorbeeldserie', 1, 1);
const duplicate = addMedia(firstSourceId, 'episode', 'Eerste alternatief', 'Voorbeeldserie', 1, 1);
const second = addMedia(firstSourceId, 'episode', 'Tweede', 'Voorbeeldserie', 1, 2);
const nextSeason = addMedia(firstSourceId, 'episode', 'Nieuw seizoen', 'Voorbeeldserie', 2, 1);
const otherSource = addMedia(secondSourceId, 'episode', 'Andere bron', 'Voorbeeldserie', 1, 3);
const movie = addMedia(firstSourceId, 'movie', 'Losse film');

afterAll(() => { database.db.close(); fs.rmSync(root, { recursive: true, force: true }); });

describe('afleveringsnavigatie', () => {
  it('ordent deterministisch op seizoen, aflevering en media-ID', () => {
    expect(adjacentEpisodeId(special, 'next')).toBe(first);
    expect(adjacentEpisodeId(first, 'next')).toBe(duplicate);
    expect(adjacentEpisodeId(duplicate, 'next')).toBe(second);
    expect(adjacentEpisodeId(nextSeason, 'previous')).toBe(second);
  });

  it('blijft binnen dezelfde bron als een serietitel in meerdere bibliotheken voorkomt', () => {
    expect(adjacentEpisodeId(second, 'next')).toBe(nextSeason);
    expect(adjacentEpisodeId(nextSeason, 'next')).toBeNull();
    expect(adjacentEpisodeId(otherSource, 'previous')).toBeNull();
  });

  it('geeft null voor films, onbekende media en grenzen van een serie', () => {
    expect(adjacentEpisodeId(movie, 'next')).toBeNull();
    expect(adjacentEpisodeId(999_999, 'previous')).toBeNull();
    expect(adjacentEpisodeId(special, 'previous')).toBeNull();
  });
});
