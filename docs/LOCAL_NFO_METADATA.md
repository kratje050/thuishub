# Lokale NFO-metadata

Gebruik `movie.nfo` of `<film>.nfo`, `tvshow.nfo` in de seriemap en `<aflevering>.nfo` naast een aflevering. ThuisHub begrijpt gangbare Kodi/Jellyfin-achtige velden voor titels, plot, jaar, speelduur, genres, personen, classificatie, ratings, IDs, seizoen/aflevering, tags, set/collectie, trailer en artwork.

Lokale bestanden blijven binnen de bibliotheekroot. Padtraversal, XML groter dan 2 MiB, uitvoerbare entities en beschadigde XML worden geweigerd zonder de hele scan te stoppen. Zie [METADATA_PROVIDERS.md](METADATA_PROVIDERS.md) voor de volledige veld- en artworklijst.
