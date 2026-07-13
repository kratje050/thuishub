# Metadata in ThuisHub

ThuisHub gebruikt geen actieve TMDB-koppeling meer. Het metadatasysteem is provider-onafhankelijk en bewaart genormaliseerde gegevens in de lokale ThuisHub-database. Per veld worden de provider, ophaaldatum, handmatige status en overschrijfbeveiliging vastgelegd.

## Standaardvolgorde

De volgorde is aanpasbaar via **Instellingen > Metadata**.

- Films: handmatig, lokale NFO, OMDb, ingebedde bestandsmetadata.
- Series: handmatig, lokale NFO, TVmaze, ingebedde bestandsmetadata en optioneel OMDb.
- Handmatig gewijzigde velden worden vergrendeld.
- Lokale NFO-velden hebben voorrang op internetproviders en worden alleen door een nieuwere lokale NFO-waarde vervangen.
- Een internetresultaat wordt alleen automatisch toegepast bij een voldoende zekere, niet-dubbelzinnige match. Andere resultaten komen in **controle nodig**.

TVmaze werkt zonder API-key. OMDb is optioneel en vereist een eigen API-key. Zonder internet of OMDb-key blijven NFO, bestandsmetadata, lokale afbeeldingen en de handmatige editor volledig bruikbaar.

## OMDb-key en privacy

Voer de key in via **Instellingen > Metadata > OMDb API-key**. ThuisHub test de key vóór opslag. De key wordt opgeslagen in `%APPDATA%\ThuisHub\data\secrets.json`; op Windows beperkt ThuisHub de ACL tot de huidige gebruiker en SYSTEM. De API geeft alleen een gemaskeerde status terug. De key komt niet in `localStorage`, de database, broncode, URL-logs of foutmeldingen.

Ontwikkelaars kunnen in plaats daarvan `OMDB_API_KEY` gebruiken. Kopieer daarvoor `.env.example` naar een niet-gecommit lokaal configuratiebestand. Commit nooit echte sleutels.

Providerresponses worden lokaal gecachet met ETag/Last-Modified-ondersteuning. Externe afbeeldingen worden server-side opgehaald, gecontroleerd en vanuit de lokale afbeeldingscache aangeboden. Privé-, loopback-, link-local- en ongeldige netwerkadressen, redirects naar zulke adressen, te grote antwoorden en niet-ondersteunde formaten worden geweigerd.

## TVmaze

TVmaze levert serie-, seizoen-, aflevering-, cast-, crew-, rating- en afbeeldingsgegevens. ThuisHub gebruikt `ThuisHub/<versie>` als User-Agent, bewaart responses in de cache en respecteert HTTP 429 met begrensde back-off.

TVmaze vraagt zichtbare bronvermelding en stelt API-gegevens beschikbaar onder CC BY-SA. De beheerinterface toont **Metadata voor series geleverd door TVmaze** met een link naar de [officiële TVmaze API-documentatie](https://www.tvmaze.com/api). Controleer voor distributie altijd de actuele voorwaarden en attributie-eisen.

## OMDb

OMDb is de primaire internetprovider voor films en kan als fallback voor series worden gebruikt. ThuisHub leest titel, jaar, speelduur, plot, genres, classificatie, cast, regie, schrijvers, land, taal, awards, poster en bronratings uit.

De gratis OMDb-key heeft volgens OMDb een beperkte dagquota. ThuisHub toont lokaal gebruik en een instelbare lokale daglimiet. De beheerinterface vermeldt **Filmgegevens geleverd door OMDb** en linkt naar de [officiële OMDb-site](https://www.omdbapi.com/) en [key-aanvraag](https://www.omdbapi.com/apikey.aspx). OMDb vermeldt CC BY-NC voor API-inhoud; controleer de actuele voorwaarden voordat je ThuisHub of afgeleide metadata commercieel distribueert.

## Lokale NFO-bestanden

Ondersteunde bestanden:

- film: `<videonaam>.nfo` of `movie.nfo` naast de video;
- serie: `tvshow.nfo` in de hoofdmap van de serie;
- aflevering: `<videonaam>.nfo` naast de aflevering.

Ondersteunde Kodi-achtige velden omvatten `title`, `originaltitle`, `sorttitle`, `year`, `plot`, `outline`, `runtime`, `genre`, `country`, `studio`, `premiered`, `aired`, `mpaa`, `rating`, `ratings`, `uniqueid`, `imdbid`, `actor`, `director`, `credits`, `season`, `episode`, `displayseason`, `displayepisode`, `absolute_number`, `tag`, `set`, `trailer`, `thumb`, `fanart`, `poster`, `banner` en `clearlogo`.

XML wordt zonder uitvoerbare entities verwerkt. NFO-bestanden groter dan 2 MiB, beschadigde XML en lokale verwijzingen buiten de bibliotheekmap worden geweigerd. Een fout in één NFO stopt de bibliotheekscan niet.

Lokale artworknamen omvatten onder meer `poster`, `folder`, `fanart`, `background`, `banner`, `clearlogo`, `landscape`, `<film>-poster`, `<film>-fanart`, `<aflevering>-thumb`, `seasonXX-poster` en `season-specials-poster`, met `.jpg`, `.png` of `.webp`.

## Bestandsnamen en matching

De scanner herkent onder andere `S01E02`, `1x02`, datumafleveringen zoals `2026-07-13`, `E123`, `EP123`, `[123]` en ` - 123`. Releasewoorden, resoluties en codecs worden uit zoektitels verwijderd. Matching gebruikt genormaliseerde titel, jaar, seizoen/aflevering, uitzenddatum, absolute positie en bekende externe IDs. Dubbele titels met een gelijke score worden nooit stil automatisch gekozen.

## Migratie en herstel

Bij de eerste start van deze providerlaag maakt ThuisHub eerst een gecontroleerde noodback-up. Daarna worden bestaande beschrijvingen en oude provider-IDs behouden als legacy-herkomst, wordt de oude sleutel verwijderd en wordt een migratierapport in de database opgeslagen. Er worden tijdens deze migratie geen verzoeken naar de oude provider gestuurd.

De beheerder kan wijzigingen per veld bekijken, vergrendelen en vanuit de historie herstellen. Databaseback-ups bevatten metadata en provenance; mediabestanden en opnieuw op te bouwen provider-/afbeeldingscache blijven buiten de databaseback-up.

## Probleemoplossing

- **OMDb niet geconfigureerd:** vraag een key aan, voer hem lokaal in en kies **Testen en opslaan**.
- **Daglimiet bereikt:** wacht op de volgende quotaperiode, verhoog alleen de lokale limiet als jouw OMDb-plan dit toestaat, of gebruik NFO/handmatige metadata.
- **TVmaze 429:** ThuisHub wacht automatisch en gebruikt de cache; probeer later opnieuw.
- **Controle nodig:** open **Metadata bewerken > Zoeken en koppelen** en kies bewust het juiste resultaat.
- **Verkeerde waarde terug na verversen:** controleer onder **Herkomst en historie** of het veld vergrendeld is en herstel zo nodig een eerdere waarde.
- **Geen afbeelding:** controleer lokale artworknamen of voeg in de editor een HTTPS-URL/lokaal pad binnen de bibliotheek toe.
