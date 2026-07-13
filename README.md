# ThuisHub 1.1.0

ThuisHub is een lokale Windows-mediaserver voor films, series, muziek, foto's en Live TV/DVR. De app werkt als zelfstandig Windows-programma én via `http://localhost:8787`. Gegevens blijven lokaal en toegang buitenshuis kan privé via Tailscale Serve.

## Starten

- Geïnstalleerd: start **ThuisHub** via Start of de bureaubladsnelkoppeling.
- Portable: open `release\ThuisHub-Portable-1.1.0.exe`.
- Alleen browser/server: dubbelklik `ThuisHub starten.cmd`.
- Volledig afsluiten: kies **ThuisHub afsluiten** in het systeemvak. Het vensterkruis verbergt de app alleen.

De Windows-app en browser delen `%APPDATA%\ThuisHub\data\thuishub.db`. Bij de eerste start wordt `%APPDATA%\Huiskamer\data` veilig gekopieerd, gecontroleerd en behouden. Zie [docs/DATA_MIGRATION.md](docs/DATA_MIGRATION.md).

## Eerste gebruik

1. Maak het eerste beheerdersprofiel aan.
2. Voeg bibliotheekmappen toe bij Instellingen.
3. Start een scan en laat ThuisHub metadata, posters en technische media-informatie opbouwen.
4. Voeg optioneel een TMDB-token toe voor online metadata.
5. Voeg voor Live TV een eigen M3U- en optioneel XMLTV-bestand of URL toe. Gebruik alleen bronnen waarvoor je rechten hebt.

## Externe toegang

ThuisHub luistert uitsluitend op `127.0.0.1:8787`. Stel Tailscale Serve bewust in met:

```powershell
tailscale serve --bg 8787
```

Gebruik geen router-port-forwarding of Tailscale Funnel. Volledige instructies staan in [docs/TAILSCALE_REMOTE_ACCESS.md](docs/TAILSCALE_REMOTE_ACCESS.md). Het hulpscript is `scripts\tailscale-serve.ps1`.

## Beheer en opslag

- Dashboard: Overzicht, streams, bibliotheken, transcoding, Live TV/DVR, externe toegang, back-ups, databaseherstel, logs, updates, systeeminformatie en Over.
- Back-ups: `%APPDATA%\ThuisHub\backups`.
- Logs: `%APPDATA%\ThuisHub\logs`.
- Exports: `%APPDATA%\ThuisHub\exports`.
- Gedownloade, gecontroleerde updates: `%APPDATA%\ThuisHub\updates`.

Lees [docs/BACKUPS_AND_RECOVERY.md](docs/BACKUPS_AND_RECOVERY.md) en [docs/UPDATES.md](docs/UPDATES.md).

## Ontwikkelen en bouwen

Vereist: Node.js 22+ en Windows x64.

```powershell
npm install
npm run check
npm run dist:win
```

De build maakt `release\ThuisHub-Setup-1.1.0.exe` en `release\ThuisHub-Portable-1.1.0.exe`. Zonder certificaat blijft de build werken en meldt hij dat de bestanden niet ondertekend zijn. Zie [docs/CODE_SIGNING.md](docs/CODE_SIGNING.md).

## Veiligheid

API-routes blijven met bestaande profielauthenticatie en beheerdersrechten beveiligd. ThuisHub opent geen poorten, gebruikt geen Funnel, logt geen wachtwoorden/tokens en vervangt de login niet door Tailscale. Een database wordt nooit voor herstel overschreven zonder noodback-up.
