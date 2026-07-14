# ThuisHub referentie-interface — validatierapport

## Veiligheid en uitgangspunt

- Branch: `feature/reference-ui-redesign`
- Checkpoint vóór het redesign: `bd955bb`
- Gecontroleerde databack-up: `C:\Users\stava\AppData\Roaming\ThuisHub\backups\pre-reference-ui-redesign-20260714-084237`
- De lokale browser- en Windows-tests gebruikten uitsluitend deze back-upomgeving.
- De zes bestanden in `%APPDATA%\ThuisHub\data` zijn na afloop opnieuw op lengte en SHA-256 gecontroleerd: 6 van 6 ongewijzigd.
- `PRAGMA quick_check` op de productiedatabase: `ok`.
- Er is geen GitHub-release gemaakt en er is niets gepusht.

## Gewijzigde bronbestanden

- `src/reference-ui.tsx`: herbruikbare UI-componenten en echte systeemstatus.
- `src/theme.css`: centrale design tokens.
- `src/reference-ui.css`: desktop-, tablet- en mobiele referentiestijl.
- `src/reference-ui.test.tsx`: navigatie-, zoek-, badge-, status-, thematische en promotieteksttests.
- `src/App.tsx`: nieuwe shell, Home, bibliotheektabs, verder-kijkenpagina, downloads, details en playerintegratie.
- `src/ServerDashboard.tsx`: routeerbare dashboardsecties en neutrale producttekst.
- `src/api.ts`: echte technische media-eigenschappen.
- `src/main.tsx`: centrale thema- en referentiestijlen.
- `server/src/routes/api.ts`: CPU, RAM, schijf, Windows-versie en uitgebreide kwaliteitsmetadata.
- `desktop/main.cjs`: shell-achtergrond sluit aan op het nieuwe thema.
- `public/manifest.webmanifest`: PWA-thema aangepast.
- `public/sw.js`: nieuwe cacheversie zodat geïnstalleerde PWA's het redesign ophalen.

## Nieuwe en hergebruikte componenten

- `AppShell`, `Sidebar`, `TopBar`, `SearchBar`
- `HeroBanner`, `MediaRow`, `ContinueWatchingCard`, `PosterCard`, `QualityBadge`
- `SystemStatusPanel`, `StatusCard`, `MiniMetricChart`, `BottomStatusBar`
- `PlayerControls`, `LoadingSkeleton`, `EmptyState`, `ErrorState`, `Modal`, `Toast`, `SettingsSection`
- De bestaande `DevicePicker`, castlaag, afstandsbediening, videoplayer en instellingenlogica blijven in gebruik.

## Centrale design tokens

- Achtergrond: `#020A11`, zijbalk `#06131D`, content `#03101A`.
- Primair accent: `#B8FF2C`; hover `#C9FF58`.
- Cyaan `#35D4D2`, blauw `#258DFF`, paars `#886BFF`, oranje `#FFB11A`.
- Succes `#72DF34`, fout `#FF5D69`.
- Subtiele randen, panelen en tekstkleuren zijn centraal gedefinieerd.
- Bewegingsduur ligt tussen 150 en 200 ms en `prefers-reduced-motion` wordt gerespecteerd.
- Kleine labels hebben een expliciete ondergrens van 11 px.

## Echte gegevenskoppelingen

- Hero, posters, backdrops, beschrijvingen, voortgang, cast en kwaliteitslabels komen uit de bibliotheek-API.
- 4K/HD, HDR10/HDR10+, Dolby Vision, Atmos en kanaallabels worden alleen getoond wanneer de mediaprobe die eigenschap heeft vastgesteld.
- Actieve streams, opslag, databasegezondheid, Tailscale, back-ups en uptime komen uit `/api/dashboard`.
- CPU, RAM, Windows-versie en schijfruimte worden op de server gemeten.
- Netwerksnelheid wordt als `Onbekend` getoond wanneer het besturingssysteem geen betrouwbare teller levert; er staan geen voorbeeldwaarden in de interface.
- Apparaten, Cast, DLNA en LAN-status gebruiken de bestaande afspeel- en discovery-API's.

## Behouden functies

Films, series, muziek, foto's, Live TV, DVR, downloads, gebruikers, profielen, leeftijdsbeperkingen, metadata-editor, back-ups, logs, updates, Tailscale, LAN-streaming, Google Cast, DLNA, Android TV, Tizen, pairing, hardwaretranscoding, HDR-tone-mapping, intro/aftiteling overslaan, autoplay, hervatten, afspeelsnelheid, systeemvak, Windows-app en PWA blijven gekoppeld aan hun bestaande implementatie.

## Testresultaten

- `npm run check`: 31 testbestanden, 249 tests geslaagd.
- TypeScript frontend: geslaagd.
- TypeScript server: geslaagd.
- `npm run build`: geslaagd.
- Browsertests: Ctrl+K, zoekresultaten, navigatie, downloads, apparaten, dashboardkoppelingen, detail, hero-afspelen, player sluiten, castkiezer, mobiele zijbalk en mobiele systeemstatus geslaagd.
- Na het sluiten van de player: 0 achtergebleven actieve streams.
- Verboden zichtbare tekst in instellingen en hoofdnavigatie: niet aangetroffen.
- Windows/Electron: vier processen gestart, venstertitel `ThuisHub`, serverstatus `ok`, single-instance-lock actief en desktopstartpad tot venster/systeemvak succesvol doorlopen. Alle testprocessen zijn daarna afgesloten.
- LAN-streaming: actief op de geselecteerde privé-interface en luisterend op poort 8788.
- Tailscale: verbonden; Serve actief.
- mDNS: Google Cast- en ThuisHub-services zichtbaar.
- DLNA-discovery: voltooid zonder fout; tijdens de test waren geen fysieke ontvangers online.
- Updatepagina: huidige versie 1.2.4 leesbaar; installatie en download zijn bewust niet gestart.

## Responsieve controle en screenshots

- Desktop: 1920×1080, 1600×900, 1440×900 en 1366×768 gecontroleerd.
- Mobiel: 390×844 gecontroleerd; schuifmenu, ondernavigatie, compacte hero en uitklapbare systeemstatus werken.
- Rechter statuskolom wordt onder 1180 px een uitklapbaar paneel.
- De zijbalk wordt op tablet compact en op mobiel een schuifmenu.
- De lege onderzijde van de desktopzijbalk bevat uitsluitend een decoratieve filmische gloed, zonder kaart of promotie.

Bestanden:

- `after-1920x1080.png`
- `after-1600x900.png`
- `after-1440x900.png`
- `after-1366x768.png`
- `after-mobile-390x844.png`
- De drie `before-*.png`-bestanden bewaren de nulmeting.

## Prestatiemetingen

Metingen zijn lokaal, op een warme browsercache en de gecontroleerde back-updatabase:

- HTML-respons mediaan: 13,2 ms (7 metingen).
- Bibliotheek-API mediaan: 273,1 ms bij 391 media-items (7 metingen).
- `DOMContentLoaded`: 195 ms.
- Hero met echte bibliotheekdata zichtbaar: 368 ms.
- Volledige systeemkolom met externe status zichtbaar: 1.551 ms.
- Productiebundle: JavaScript 884.747 bytes (269,07 kB gzip), CSS 87.654 bytes (18,23 kB gzip).
- Afbeeldingen gebruiken vaste verhoudingen en lazy loading; lange bibliotheekgrids gebruiken `content-visibility`.
- Systeemdata wordt iedere 6 seconden bijgewerkt zonder volledige paginarender.

## Bekende, bewuste afwijkingen

- De inhoud komt uit de echte bibliotheek; daarom kunnen titel en artwork afwijken van de voorbeeldfilm in de referentie.
- Er staat momenteel één echte, onvoltooide titel in “Verder kijken”; de rij wordt niet met fictieve kaarten gevuld.
- Actuele netwerksnelheid blijft `Onbekend` zolang Windows geen betrouwbare platformteller aan de server levert.
- De interface gebruikt één eigen consistente SVG-lijniconenset in plaats van een extra externe iconenbibliotheek.
- De bestaande frontendbundle geeft nog een Vite-waarschuwing boven 500 kB; functioneel laden en interacties zijn lokaal gecontroleerd.

## Nog handmatig te controleren met fysieke hardware

- Werkelijke Google Cast- en DLNA-weergave naar een ingeschakelde televisie.
- Dolby Vision-, HDR10+- en Atmos-passthrough met een compatibele tv/receiver.
- Tizen- en Android TV-focusbediening op de betreffende apparaten.
- Een echte installer-upgrade vanaf een volgende release. Er is voor deze taak bewust geen installer, release of update-installatie gestart.
