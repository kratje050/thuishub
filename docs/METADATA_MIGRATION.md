# Metadata-migratie

De provider-migratie begint met een SQLite-back-up en integriteitscontrole. Bestaande beschrijvingen, IDs en afbeeldingsverwijzingen worden als legacy-herkomst bewaard; gebruikers, voortgang, favorieten, playlists, collecties en markers blijven in dezelfde database. Er wordt geen verzoek naar de oude provider gedaan.

Het rapport in `metadata_migration_runs` bevat de back-upnaam, behouden items/velden/IDs, nul oude requests en de basis voor gefaseerde nieuwe matching. Online aanvulling loopt daarna begrensd via de metadatawachtrij. Zie [DATA_MIGRATION.md](DATA_MIGRATION.md) voor herstel en [METADATA_PROVIDERS.md](METADATA_PROVIDERS.md) voor locks.
