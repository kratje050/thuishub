# Windows code signing

Gebruik een publiek vertrouwd Authenticode code-signingcertificaat (OV of EV) dat voor de uitgever is uitgegeven. Sla een PFX en wachtwoord nooit in de repository op.

Het buildscript leest optioneel:

```text
WINDOWS_CERTIFICATE_FILE
WINDOWS_CERTIFICATE_PASSWORD
WINDOWS_CERTIFICATE_THUMBPRINT
```

Lokaal stel je de variabelen alleen voor het buildproces in en voer je `npm run dist:win` uit. In GitHub Actions bewaar je PFX (Base64), wachtwoord en/of thumbprint als versleutelde secrets, schrijft de workflow het certificaat tijdelijk naar de runner en verwijdert het na de build. Electron Builder ondertekent de appbestanden, portable EXE en NSIS-installer en gebruikt een vertrouwde timestampserver, zodat een handtekening na certificaatverloop controleerbaar blijft.

Zonder certificaat bouwt ThuisHub bewust unsigned en toont het script een waarschuwing. Gebruik geen zelfondertekend certificaat als vertrouwen voor eindgebruikers. SmartScreen-reputatie ontstaat geleidelijk door consistente, geldig ondertekende releases; een eerste getekende release kan daarom nog een waarschuwing tonen.
