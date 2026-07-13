# Updates publiceren

ThuisHub gebruikt een uitbreidbaar HTTPS `latest.json`-manifest. Stel de URL in het dashboard of met `THUIS_HUB_UPDATE_MANIFEST` in.

```json
{
  "version": "1.2.0",
  "channel": "stable",
  "downloadUrl": "https://example.invalid/ThuisHub-Setup-1.2.0.exe",
  "sha256": "64-hex-tekens",
  "releaseNotes": "Beschrijving",
  "size": 123456789
}
```

Publiceer de EXE en het manifest bij voorkeur als GitHub Release-assets. Bereken de hash met `Get-FileHash -Algorithm SHA256`. ThuisHub vergelijkt de versie en het gekozen kanaal. Downloaden vereist toestemming; een bestand wordt pas bewaard na een exacte SHA-256-match. Installatie wordt niet automatisch gestart, zodat de huidige versie bij netwerk- of integriteitsfouten actief blijft.
