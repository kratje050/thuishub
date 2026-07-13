# Wijzigingen

## In ontwikkeling — nog niet gepubliceerd

- Windows-updates vervangen de oude programmaversie voortaan volledig automatisch en starten daarna de nieuwe versie.
- De stille upgrade gebruikt de bestaande veilige verwijderprocedure met behoud van bibliotheken, database, instellingen, voortgang en back-ups.

## 1.2.2 — 13 juli 2026

- Het update-dashboard toont na een gecontroleerde download de knop **Installeren en herstarten**.
- De installer wordt direct vóór uitvoering opnieuw op bestandsnaam, grootte en SHA-256 gecontroleerd.
- De Windows-app draagt de installer veilig over, sluit app en server af en opent daarna pas de installer.
- Ook de losse browserserver kan de gecontroleerde installer starten en zichzelf netjes afsluiten.

## 1.2.1 — 13 juli 2026

- Het volledige inlog- en eerste-installatiescherm is uit de Windows-app, browser en PWA verwijderd.
- ThuisHub gebruikt automatisch de bestaande beheerder of maakt bij een lege installatie één lokaal beheerdersprofiel aan.
- De uitlogknop is verwijderd en verbindingsproblemen tonen voortaan een herhaalbare verbindingsmelding.
- De PWA-cache is vernieuwd zodat telefoons niet op het oude inlogscherm blijven hangen.

## 1.2.0 — 13 juli 2026

- Centrale capability-gestuurde Direct Play/Direct Stream/transcode-beslislaag met 35 playbacktests.
- Uitgebreide FFprobe-opslag voor video, audio, HDR, Dolby Vision, Atmos, DTS:X, hoofdstukken en ondertitels.
- Google Cast sender, mini-controller, signed media- en WebVTT-URL's en branded custom Web Receiver.
- Veilig apparaatkoppelen, intrekbare device-sessies, remote-opdrachten en handmatige capability-overrides.
- Native Android TV/Google TV-client met Media3/ExoPlayer/MediaSession; Samsung Tizen-clientbron met AVPlay.
- Aparte privé-LAN-listener, LocalSubnet-firewallscript, HTTP Range/HEAD/OPTIONS en beperkte CORS.
- Kwaliteitsprofielen, netwerkstandaarden, technische afspeelinformatie en ondertitel-burn-in wanneer noodzakelijk.
- GitHub Releases-updater zonder token, exacte assetselectie, prereleasekanalen en gecontroleerde download naar LocalAppData.
- Veilige release-, manifest-, hash-, secretscan- en conceptpublicatiescripts.
- 70 geautomatiseerde tests en nieuwe installatie-, compatibiliteits-, beveiligings- en testdocumentatie.

## 1.1.0 — 13 juli 2026

- Hernoeming van Huiskamer naar ThuisHub en Windows installer/portable-app.
- Veilige gegevensmigratie, lokale beheerinterface, Tailscale Serve, back-ups, databasecontrole, logging en serverdashboard.
- Films, series, muziek, foto's, Live TV, DVR, gebruikers, voortgang en bestaande web/PWA-functies behouden.
