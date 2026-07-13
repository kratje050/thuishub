# GitHub Releases en updates

De updater benadert zonder token `https://api.github.com/repos/kratje050/thuishub/releases/latest` voor stabiel. Bèta/ontwikkeling gebruiken de releaselijst, filteren drafts en kiezen de hoogste geschikte SemVer. Ontwikkeling is standaard extra uitgeschakeld.

Een officiële release bevat exact:

- `ThuisHub-Setup-<versie>.exe`
- `ThuisHub-Portable-<versie>.exe`
- `ThuisHub-Android-TV-<versie>.apk`
- `SHA256SUMS.txt`, `latest.json`, `RELEASE_NOTES.md`
- optioneel `ThuisHub-Samsung-TV-<versie>.wgt`

De updater selecteert nooit het eerste willekeurige EXE-bestand. Downloads gaan via een willekeurig `.part`-bestand naar `%LOCALAPPDATA%\ThuisHub\updates`, waarna grootte, SHA-256 en eventueel de GitHub digest worden vergeleken. Beschadigde bestanden worden verwijderd. Na **Installeren en herstarten** wordt de installer nogmaals gecontroleerd, sluit ThuisHub netjes af en opent de Windows-installer pas nadat het oude proces verdwenen is.

## Eerste release voorbereiden

```powershell
npm run check
npm run dist:win
.\scripts\build-android-tv.ps1
.\scripts\generate-release-metadata.ps1 -Version 1.2.2
.\scripts\scan-release-secrets.ps1 -IncludeReleaseArtifacts
.\scripts\publish-github-release.ps1 -Version 1.2.2
```

Het laatste commando controleert `gh auth status`, maakt hashes/manifest opnieuw, scant, maakt zo nodig een lokale tag en creëert standaard alleen een **draft** in `kratje050/thuishub`. Gebruik `-Publish` uitsluitend wanneer u na inspectie interactief exact `PUBLICEREN` wilt typen. Het script pusht geen broncode.

De API-opzet volgt de officiële [GitHub Releases REST API](https://docs.github.com/en/rest/releases).
