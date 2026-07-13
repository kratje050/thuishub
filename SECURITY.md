# Beveiligingsbeleid

ThuisHub is lokaal-eerst. De beheerinterface bindt aan `127.0.0.1:8787`. Optionele tv-streaming bindt uitsluitend aan één door de beheerder gekozen RFC1918-adres en biedt alleen health-, pairing-, device- en signed playbackroutes aan.

## Netwerkregels

- Geen automatische routerpoorten, UPnP-portforwarding of Tailscale Funnel.
- Externe toegang uitsluitend via een privé Tailscale Serve-configuratie.
- De firewallhelper beperkt de regel tot Windows-profiel **Privé** en `LocalSubnet`.
- Playback-URL's zijn HMAC-ondertekend, resourcegebonden en verlopen na 5–60 minuten.
- Tv-device-tokens hebben alleen bibliotheek-, playback-, voortgang- en commandorechten; geen beheerrechten.
- Een vergeten apparaat verliest door cascade direct alle device-sessies.

## Geheimen en productiegegevens

Nooit committen of publiceren: `.env`, tokens, wachtwoorden, M3U/XMLTV-credentials, databases, logs, back-ups, gebruikersgegevens, lokale paden/IP's/hostnamen, certificaten, privésleutels of signingwachtwoorden. De uitgebreide `.gitignore` blokkeert deze categorieën. `scripts\scan-release-secrets.ps1` gebruikt Gitleaks wanneer geïnstalleerd en anders een strikte lokale fallback.

De openbare repository `kratje050/thuishub` is uitsluitend voor release-assets, hashes, release notes en openbare documentatie. De volledige broncode blijft in een afzonderlijke privérepository. Publicatiescripts slaan geen GitHub-token op en maken standaard een conceptrelease.

## Updates

De updater gebruikt geen GitHub-token. Alleen de exact benoemde installer van de vast ingestelde repository wordt geaccepteerd. Grootte, SHA-256, SHA256SUMS/latest.json-consistentie en waar beschikbaar de GitHub asset digest worden gecontroleerd. Een fout bestand wordt verwijderd en nooit gestart. De app installeert niet zonder toestemming.

## Kwetsbaarheid melden

Deel een kwetsbaarheid privé met de beheerder van de repository. Plaats geen tokens, databases, mediapaden of persoonsgegevens in een openbaar issue. Trek bij mogelijke lekkage eerst de betreffende sleutel of devicesessie in.
