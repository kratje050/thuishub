# ThuisHub 1.2.4

ThuisHub is een lokale Windows-mediaserver voor eigen films, series, muziek, foto's en Live TV/DVR. De beheerinterface blijft op `http://127.0.0.1:8787`; de Windows-app en browser gebruiken dezelfde lokale gegevens in `%APPDATA%\ThuisHub\data`.

## Metadata

De ontwikkelversie gebruikt een modulaire metadata-laag: TVmaze voor series, optioneel OMDb voor films, lokale Kodi-NFO-bestanden, ingebedde bestandstags en een handmatige editor met veldlocks en herstelhistorie. API-keys blijven lokaal; externe afbeeldingen worden gecontroleerd en gecachet voordat de browser ze toont. Zie [Metadata en providers](docs/METADATA_PROVIDERS.md).

## Nieuw in 1.2.4

- De native Android-client werkt nu op telefoons, tablets, Android TV en Google TV vanuit dezelfde APK.
- Telefoons en tablets krijgen een normaal ThuisHub-startpictogram, een portretvriendelijke koppeling en een responsieve bibliotheek met aanraakbediening.
- De bestaande Android TV-installatie wordt door versie 1.2.4 bijgewerkt; opnieuw installeren of eerst verwijderen is niet nodig.
- De mediaserver, database en bestanden blijven veilig op de Windows-pc. De Android-app ontdekt de beperkte lokale streamingpoort en koppelt met de bestaande zescijferige code.

## Nieuw in 1.2.3

- De permanente knop **Afspelen op apparaat** toont de lokale speler, gekoppelde ThuisHub TV-apps, gevonden DLNA-renderers en Google Cast in één gegroepeerde kiezer.
- Google Cast gebruikt uitsluitend de officiële Google Cast Web Sender SDK en de officiële Cast-apparaatkiezer in de browser. ThuisHub scant geen Chromecast-IP-adressen en doet zich niet voor als Cast-ontvanger.
- DLNA/UPnP-renderers worden op het gekozen privé-LAN via begrensde SSDP-discovery gevonden. De server adverteert zichzelf pas via lokale mDNS/DNS-SD wanneer de beperkte LAN-listener werkelijk luistert, zodat Android TV/Google TV- en Tizen-apps geen onbereikbaar adres krijgen.
- Gekoppelde ThuisHub TV-apps gebruiken een stabiele apparaatidentiteit, een zescijferige koppelcode en een intrekbaar apparaat-token. Een niet-gekoppelde app kan direct vanuit de apparaatkiezer worden gekoppeld; handmatig een serveradres invoeren blijft alleen als geavanceerde terugvaloptie beschikbaar.
- Afspeelsessies houden apparaat, voortgang, kwaliteit en revisie centraal bij, ook in de lokale browser. Overplaatsen wacht op een werkelijke `playing`-bevestiging van het nieuwe doel voordat de bron stopt: bij Cast pas na `LOAD` én de officiële `PLAYING`-status, bij lokaal afspelen pas na het `playing`-event van de video. Bij een fout blijft de bron beschikbaar. Media- en artwork-URL's zijn sessiegebonden, kortlevend, alleen voor dezelfde gebruiker en sessie verlengbaar en direct intrekbaar bij stoppen of vergeten.
- Het dashboard toont tv-detectie, de gekozen netwerkinterface, Cast-beschikbaarheid, mDNS/SSDP, DLNA, de lokale streaminglistener en strikt begrensde Windows Firewall-regels.
- `scripts\configure-private-streaming.ps1` maakt uitsluitend Private/LocalSubnet-regels voor het gekozen adres; `scripts\diagnose-tv-discovery.ps1` controleert de configuratie zonder iets te wijzigen of tokens te tonen.

De softwarelogica en builds worden geautomatiseerd gecontroleerd, maar er is voor deze versie nog geen volledige test op echte Chromecast-, Android TV-, Google TV-, Samsung Tizen- en DLNA-hardware uitgevoerd.

## Nieuw in 1.2.2

- Gedownloade updates kunnen vanuit het dashboard met **Installeren en herstarten** worden uitgevoerd.
- De installer wordt vlak vóór installatie opnieuw gecontroleerd op exacte naam, grootte en SHA-256.
- De Windows-app sluit netjes af voordat de installer opent, zodat bestanden niet door de oude versie vergrendeld blijven.

## Nieuw in 1.2.1

- De app en browser openen direct zonder inlog- of installatiescherm.
- Een nieuwe installatie maakt automatisch één lokaal beheerdersprofiel aan; bestaande bibliotheken behouden hun beheerder.
- Bij een onbereikbare server verschijnt alleen een verbindingsmelding met **Opnieuw proberen**.

## Nieuw in 1.2.0

- Centrale playback decision engine: Direct Play, daarna Direct Stream en alleen indien nodig Transcode.
- Technische detectie van container, codecs, resolutie, framerate, bitdiepte, HDR, Dolby Vision, Atmos, DTS:X en ondertitels.
- Google Cast-knop, apparaatkiezer, controller en optionele eigen branded Web Receiver.
- Gekoppelde tv-apparaten met zescijferige code, kortlevende signed playback-URL's en capability-overrides.
- Android TV/Google TV-app in `apps/android-tv` en Samsung Tizen-clientbron in `apps/samsung-tizen`.
- Optionele streaminglistener op één gekozen privé-LAN-adres en aparte poort; geen routerpoorten, UPnP-portforwarding of Funnel.
- Kwaliteitsprofielen van Origineel/80 Mbps tot Databesparing/2 Mbps.
- Tokenloze updatecontrole via exacte assets uit GitHub Releases, met grootte-, SHA-256- en waar beschikbaar GitHub-digestcontrole.

## Starten

- Geïnstalleerd: open **ThuisHub** via Start of de bureaubladsnelkoppeling.
- Portable: open `release\ThuisHub-Portable-1.2.4.exe`.
- Browser/server: dubbelklik `ThuisHub starten.cmd`.
- Volledig afsluiten: kies **ThuisHub afsluiten** in het systeemvak.

Bij een upgrade blijven database, media, gebruikers, voortgang, Live TV, DVR, back-ups en instellingen behouden. Maak desondanks altijd een actuele back-up via het serverdashboard.

## Afspelen op een tv

1. Schakel bij Instellingen > Netwerk **Streamen binnen thuisnetwerk** en **Automatisch apparaten zoeken** in, kies exact één actief privé-LAN-adres en herstart ThuisHub.
2. Maak als administrator de begrensde Windows Firewall-regels met `scripts\configure-private-streaming.ps1 enable -Address <gekozen-adres> -Port 8788`.
3. Open **Afspelen op apparaat**. DLNA-renderers en eerder gekoppelde ThuisHub-apps verschijnen automatisch; vernieuw de lijst wanneer een tv net is ingeschakeld.
4. Kies **Google Cast** om de officiële Google-kiezer te openen. Cast-selectie blijft volledig client-side en is alleen beschikbaar in een ondersteunde browser en beveiligde context.
5. Een nieuwe Android TV/Google TV- of Tizen-app toont bij de eerste verbinding een zescijferige code. Rond de koppeling af in ThuisHub; daarna wordt de app als vertrouwd apparaat onthouden.

DLNA vereist geen ThuisHub-koppelcode. Een handmatig serveradres in de eigen tv-apps is alleen bedoeld als geavanceerde terugvaloptie wanneer multicast op het thuisnetwerk niet werkt. Voor een eigen Cast-receiver is registratie in de Google Cast Developer Console en een HTTPS-host nodig; zonder App ID wordt de standaardreceiver gebruikt. Zie [tv-streaming](docs/TV_STREAMING.md) en [automatische apparaatdetectie](docs/AUTOMATIC_DEVICE_DISCOVERY.md).

De lokale webspeler gebruikt per browservenster een eigen receiver-ID, zodat twee tabs nooit als dezelfde speler gelden. De centrale sessie stuurt play/pause, seek, volume, stop en bevestigde overdrachten via een beveiligde live verbinding naar de browser met de werkelijke lokale speler of Cast-context; een tweede browser of telefoon kan daardoor als afstandsbediening dienen. Bij netwerkverlies neemt rustige polling dit over.

## Privétoegang

Toegang buitenshuis blijft uitsluitend via Tailscale Serve lopen. Gebruik geen router-port-forwarding en geen Tailscale Funnel. Lokale mDNS/SSDP-detectie werkt niet via internet. Zie [Tailscale-toegang](docs/TAILSCALE_REMOTE_ACCESS.md).

## Ontwikkelen en bouwen

Vereist: Windows x64, Node.js 22+, Android Studio/SDK 35 voor de APK, en optioneel Tizen Studio met TV Extensions en Samsung-certificaat voor een WGT.

```powershell
npm install
npm run check
npm run dist:win
.\scripts\build-android-tv.ps1
.\scripts\build-samsung-tv.ps1
```

Releasegegevens maakt u na de builds met:

```powershell
.\scripts\generate-release-metadata.ps1 -Version 1.2.4
.\scripts\scan-release-secrets.ps1 -IncludeReleaseArtifacts
```

Publicatie gebeurt nooit automatisch. Zie [GitHub Releases](docs/GITHUB_RELEASES.md) en [SECURITY.md](SECURITY.md).

## Documentatie

- [Tv-streaming](docs/TV_STREAMING.md), [automatische apparaatdetectie](docs/AUTOMATIC_DEVICE_DISCOVERY.md), [functie- en teststatus](docs/FEATURE_PARITY.md)
- [Google Cast](docs/GOOGLE_CAST.md), [DLNA/UPnP](docs/DLNA_UPNP.md), [tv-app koppelen](docs/TV_PAIRING.md), [problemen met tv-detectie](docs/TV_DISCOVERY_TROUBLESHOOTING.md)
- [Android TV](docs/ANDROID_TV.md), [Samsung Tizen](docs/SAMSUNG_TV.md), [apparaatcompatibiliteit](docs/DEVICE_COMPATIBILITY.md)
- [HDR en Dolby Vision](docs/HDR_AND_DOLBY_VISION.md), [audio-passthrough](docs/AUDIO_PASSTHROUGH.md), [kwaliteit](docs/QUALITY_PROFILES.md)
- [Privé-LAN-streaming](docs/LOCAL_NETWORK_STREAMING.md), [handmatige testmatrix](docs/MANUAL_TEST_MATRIX.md)
- [GitHub Releases](docs/GITHUB_RELEASES.md), [openbare repositorybeveiliging](docs/PUBLIC_REPOSITORY_SECURITY.md)
- [Metadata en providers](docs/METADATA_PROVIDERS.md), [TVmaze](docs/TVMAZE.md), [OMDb](docs/OMDB.md), [lokale NFO](docs/LOCAL_NFO_METADATA.md)
- [Metadata-migratie](docs/METADATA_MIGRATION.md), [metadata en privacy](docs/METADATA_PRIVACY.md)
