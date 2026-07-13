# Beveiliging van de openbare release-repository

Gebruik twee gescheiden doelen:

- Privébronrepository: bron, tests, workflows en ontwikkelbestanden.
- Openbare `kratje050/thuishub`: uitsluitend release-assets, hashes, release notes en geschoonde openbare documentatie.

Controleer vóór iedere conceptrelease:

1. `git status` en `git ls-files` bevatten geen data/back-ups/logs/databases/credentials/certificaten.
2. `.gitignore` blokkeert alle lokale en geheime categorieën.
3. `scripts\scan-release-secrets.ps1 -IncludeReleaseArtifacts` slaagt. Installeer bij voorkeur Gitleaks; de fallback zoekt token-/sleutelpatronen en persoonlijke host/paden.
4. `SHA256SUMS.txt` en `latest.json` zijn zojuist uit de definitieve binaries gegenereerd.
5. De GitHub-release is een draft en alle exacte namen, groottes, hashes en release notes zijn handmatig bekeken.

Nooit openbaar: gebruikers/e-mailadressen, lokale paden/IP's/Tailscale-hostnamen, M3U/XMLTV-gegevens, Sonarr/Radarr/Bazarr/Prowlarr/Overseerr-sleutels, databases, logs, back-ups, certificaten/privésleutels of signingwachtwoorden. GitHub Secrets zijn alleen voor een toekomstig privé-CI-project en mogen nooit naar logs worden geschreven.
