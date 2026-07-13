# ThuisHub 1.2.2

ThuisHub is een lokale Windows-mediaserver voor eigen films, series, muziek, foto's en Live TV/DVR. De beheerinterface blijft op `http://127.0.0.1:8787`; de Windows-app en browser gebruiken dezelfde lokale gegevens in `%APPDATA%\ThuisHub\data`.

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
- Portable: open `release\ThuisHub-Portable-1.2.2.exe`.
- Browser/server: dubbelklik `ThuisHub starten.cmd`.
- Volledig afsluiten: kies **ThuisHub afsluiten** in het systeemvak.

Bij een upgrade blijven database, media, gebruikers, voortgang, Live TV, DVR, back-ups en instellingen behouden. Maak desondanks altijd een actuele back-up via het serverdashboard.

## Tv koppelen

1. Schakel bij Instellingen > Netwerk **Streamen binnen thuisnetwerk** in, kies één privé-adres en poort en herstart ThuisHub.
2. Maak de optionele Windows Firewall-regel als administrator met `scripts\configure-private-streaming.ps1 enable`.
3. Open de Android TV- of Samsung-app en vul het getoonde LAN-adres in.
4. Voer de zescijferige code in bij Dashboard > TV en afspeelapparaten.

Cast gebruikt in Chrome/Edge de Cast-apparaatkiezer. Voor de eigen receiver is registratie in de Google Cast Developer Console en een HTTPS-host nodig; zonder App ID wordt de standaardreceiver gebruikt. Zie [docs/TV_STREAMING.md](docs/TV_STREAMING.md).

## Privétoegang

Toegang buitenshuis blijft uitsluitend via Tailscale Serve lopen. Gebruik geen router-port-forwarding en geen Tailscale Funnel. Zie [docs/TAILSCALE_REMOTE_ACCESS.md](docs/TAILSCALE_REMOTE_ACCESS.md).

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
.\scripts\generate-release-metadata.ps1 -Version 1.2.2
.\scripts\scan-release-secrets.ps1 -IncludeReleaseArtifacts
```

Publicatie gebeurt nooit automatisch. Zie [docs/GITHUB_RELEASES.md](docs/GITHUB_RELEASES.md) en [SECURITY.md](SECURITY.md).

## Documentatie

- [Tv-streaming](docs/TV_STREAMING.md), [Google Cast](docs/GOOGLE_CAST.md), [Android TV](docs/ANDROID_TV.md), [Samsung Tizen](docs/SAMSUNG_TV.md)
- [HDR en Dolby Vision](docs/HDR_AND_DOLBY_VISION.md), [audio-passthrough](docs/AUDIO_PASSTHROUGH.md), [kwaliteit](docs/QUALITY_PROFILES.md)
- [Privé-LAN-streaming](docs/LOCAL_NETWORK_STREAMING.md), [apparaatcompatibiliteit](docs/DEVICE_COMPATIBILITY.md)
- [GitHub Releases](docs/GITHUB_RELEASES.md), [openbare repositorybeveiliging](docs/PUBLIC_REPOSITORY_SECURITY.md)
- [Handmatige testmatrix](docs/MANUAL_TEST_MATRIX.md)
