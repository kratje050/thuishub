# Gegevensmigratie

Bij de eerste start controleert ThuisHub of `%APPDATA%\ThuisHub\data\thuishub.db` bestaat. Zo niet, dan zoekt het `%APPDATA%\Huiskamer\data\huiskamer.db`.

ThuisHub maakt eerst met SQLite `VACUUM INTO` een consistente veiligheidskopie in `%APPDATA%\ThuisHub\backups`, voert `quick_check` uit, kopieert ondersteunende data en controleert de nieuwe database opnieuw. De oude map wordt nooit verwijderd of gewijzigd. Een marker in `%APPDATA%\ThuisHub\.migration-from-huiskamer.json` voorkomt herhaling. Het resultaat staat in `logs\migration.log`.

Ontbreekt de oude map, dan start ThuisHub normaal met een lege database. Bij een mislukte controle wordt de onvolledige nieuwe database verwijderd, blijft het origineel intact en verschijnt een begrijpelijke startmelding.
