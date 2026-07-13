# Gegevensmigratie

Bij de eerste start controleert ThuisHub of `%APPDATA%\ThuisHub\data\thuishub.db` bestaat. Zo niet, dan zoekt het `%APPDATA%\Huiskamer\data\huiskamer.db`.

ThuisHub maakt eerst met SQLite `VACUUM INTO` een consistente veiligheidskopie in `%APPDATA%\ThuisHub\backups`, voert `quick_check` uit, kopieert ondersteunende data en controleert de nieuwe database opnieuw. De oude map wordt nooit verwijderd of gewijzigd. Een marker in `%APPDATA%\ThuisHub\.migration-from-huiskamer.json` voorkomt herhaling. Het resultaat staat in `logs\migration.log`.

Ontbreekt de oude map, dan start ThuisHub normaal met een lege database. Bij een mislukte controle wordt de onvolledige nieuwe database verwijderd, blijft het origineel intact en verschijnt een begrijpelijke startmelding.

## Migratie naar modulaire metadata

De eerste start met de modulaire metadata-providerlaag maakt opnieuw eerst een gecontroleerde noodback-up. Bestaande beschrijvingen en externe IDs blijven behouden met `legacy_tmdb` als historische herkomst; ze worden niet gebruikt om de oude dienst te benaderen. De oude API-sleutel wordt na de succesvolle database-transactie verwijderd. Het rapport staat in `metadata_migration_runs` en vermeldt aantallen, back-upnaam en `tmdbRequests: 0`.

Een migratie overschrijft geen handmatig gewijzigde velden en verwijdert geen media, voortgang, gebruikers, playlists, collecties, Live TV/DVR of bibliotheekbronnen. Zie [METADATA_PROVIDERS.md](METADATA_PROVIDERS.md) voor veldherkomst, locks en herstel.
