# ThuisHub nulmeting voor referentie-redesign

- Vastgelegd op: 14 juli 2026
- Werkbranch: `feature/reference-ui-redesign`
- Checkpoint-commit: `bd955bb` (`Checkpoint before reference UI redesign`)
- Productiedata: niet gewijzigd
- Gecontroleerde back-up: `C:\Users\stava\AppData\Roaming\ThuisHub\backups\pre-reference-ui-redesign-20260714-084237`
- Back-upcontrole: 6 bronbestanden, 6 back-upbestanden, 0 verschillen in lengte of SHA-256
- Lokale nulmeting: een tijdelijke server op `127.0.0.1:8787` gebruikt uitsluitend de back-upkopie

## Bestaande schermen en navigatie

- Start/Home met hero, verder kijken, films en series
- Films, series en Mijn lijst
- Film- en seriedetails, seizoenen en afleveringen
- Video- en audioplayer
- Muziekbibliotheek en downloads
- Fotobibliotheek en viewer
- Live TV, programmagids en DVR-opnames
- Metadata-editor, artwork, handmatige koppeling en historie
- Apparaatkiezer, Google Cast, DLNA en gekoppelde afspeelapparaten
- Dashboard: overzicht, streams, bibliotheken, transcoding, Live TV/DVR, externe toegang, apparaten, back-ups, database/herstel, logs, updates en systeeminformatie
- Instellingen: server, bronnen, metadata, afspelen, transcoding, netwerk, gebruikers, back-ups, updates en logbeheer

## Bestaande API-functies

- Gezondheid, bootstrap, authenticatiestatus, initiële configuratie, inloggen en uitloggen
- Bibliotheken, bronnen, mapkiezer, scans en scanstatus
- Media zoeken, filteren, details, bewerken, verwijderen, streamen, HLS, ondertitels, thumbnails en downloads
- Voortgang, bekekenstatus, favorieten, Mijn lijst, waardering, intro- en aftitelingmarkers
- Collecties en afspeellijsten
- Muziek, albums, covers, audiostreams en downloads
- Foto's, thumbnails en originele bestanden
- Live TV-kanalen, gids, HLS, opnames en DVR-status
- Metadata zoeken, koppelen, vernieuwen, artwork, veldvergrendeling en historie
- Afspeelprofielen, directe weergave, direct stream en transcoding
- Apparaatdetectie, pairing, claims, opdrachten, sessies, status, bediening en diagnostiek
- Google Cast, DLNA, LAN-streaming en privé-afspeeltokens
- Actieve streams, optimalisaties, dashboard- en systeemstatus
- Opslag, databasecontrole/herstel, back-ups en retentie
- Logboeken, externe toegang/Tailscale en updatecontrole/download/installatie
- Gebruikers, profielen, rollen, downloadrechten en leeftijdsbeperkingen

## LAN-beveiligingsgrens

De afzonderlijke LAN-listener blijft beperkt tot gezondheid, apparaatpairing, apparaatopdrachten en beveiligde afspeelroutes. Beheer-, database- en updatefuncties blijven buiten die listener.

## Nulmetingsscreenshots

- `before-1920x1080.png`
- `before-1366x768.png`
- `before-mobile-390x844.png`

Dit redesign verwijdert geen route of functie. Visuele componenten worden opnieuw opgebouwd bovenop de bestaande API's en gegevens.
