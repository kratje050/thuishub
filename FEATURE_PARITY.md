# ThuisHub functiepariteit 1.2.4

Deze tabel beschrijft ThuisHub 1.2.4.

| Onderdeel | Status | Opmerking |
|---|---|---|
| Windows-app, browser en PWA | Beschikbaar | Dezelfde lokale server en database; de browserfunctie blijft behouden. |
| Films, series, muziek, foto's, Live TV en DVR | Beschikbaar | Bestaande bibliotheken, gebruikers en kijkvoortgang blijven behouden. |
| Direct Play / Direct Stream / Transcode | Beschikbaar | Eén centrale beslisengine; FFmpeg verzorgt remux en transcode. |
| HDR10, HDR10+, HLG en Dolby Vision-detectie | Beschikbaar | Alleen direct wanneer het gekozen apparaat dit meldt; anders veilige fallback of SDR-tone-map. |
| Atmos, TrueHD, E-AC-3 en DTS-beslissing | Beschikbaar | Geen brede apparaataannames; passthrough alleen wanneer het capabilityprofiel dit toestaat. |
| Centrale apparaatkiezer | Beschikbaar in ontwikkelcode | Permanente knop, gegroepeerde lijst, online-status, opnieuw zoeken, overplaatsen en verbreken. IP-adressen worden niet in de gewone kiezer getoond. |
| Google Cast | Beschikbaar via officiële Web Sender SDK | Gebruikt de officiële Google-kiezer en standaard Default Media Receiver. Een custom receiver-App-ID staat alleen bij ontwikkelaarsopties. Echte hardwaretest blijft vereist. |
| Automatische DLNA/UPnP-detectie | Beschikbaar | Zoekt uitsluitend lokale MediaRenderers en ondersteunt SetURI, Play, Pause, Stop, Seek, positie/status en optioneel volume. Geen router-UPnP of portforwarding. |
| Android, Android TV / Google TV | Test-app beschikbaar | Eén APK voor telefoon, tablet en tv; vindt `_thuishub._tcp.local`, koppelt met zes cijfers en gebruikt centrale sessielinks met Media3/ExoPlayer. Hardware-eindtest blijft vereist. |
| Samsung Tizen | Appbron beschikbaar | DNS-SD waar de firmware dit ondersteunt, lokale pairing, AVPlay en WebSocket met pollingfallback. WGT en hardwaretest vereisen Tizen Studio en een certificaat. |
| Centrale afspeelsessies | Beschikbaar | Eén server-side bron van waarheid met revisiebeveiliging, voortgang, hervatten, verplaatsen en onmiddellijke grant-intrekking bij stoppen. |
| Tijdelijke tv-playbacklinks | Beschikbaar | Media-, ondertitel- en artworkgrants zijn media-, apparaat- en sessiegebonden, kort geldig en glijdend verlengbaar zolang de sessie actief is. |
| Afstandsbediening | Beschikbaar per capability | Play/pause, stop, seek, volume en verbreken waar ondersteund. Volgende/vorige en kwaliteit starten gecontroleerd een nieuwe sessie; externe Cast-ondertiteling is selecteerbaar. Audiotrackkeuze en externe ondertitels in de Android/Tizen-testapps zijn nog niet aangesloten. |
| Netwerk- en firewallbeveiliging | Beschikbaar | De beheerinterface blijft op localhost; de tv-listener bindt aan één RFC1918-adres en heeft een exacte route-allowlist. Scripts beperken regels tot profiel Privé en `LocalSubnet`. |
| Diagnostiek | Beschikbaar | Dashboard en alleen-lezen PowerShell-script controleren listener, interface, profiel, firewall, mDNS, SSDP en MediaRenderers zonder tokens te tonen. |
| GitHub Releases-updates | Beschikbaar | De bestaande gecontroleerde download- en installerhandoff blijft behouden. |
| Metadata zonder TMDB | Beschikbaar | TVmaze, OMDb optioneel, lokale NFO, embedded tags en handmatige correctie met bronvermelding. |

Niet ieder Plex-onderdeel is één-op-één aanwezig. ThuisHub bevat geen Plex-code of -merken en ontgrendelt geen betaalde diensten. Internet-tv, huurfilms en partnercontent vereisen eigen legale bronnen en rechten.

Zie voor de gedetailleerde tv-status [docs/FEATURE_PARITY.md](docs/FEATURE_PARITY.md) en voor vrijgave [docs/MANUAL_TEST_MATRIX.md](docs/MANUAL_TEST_MATRIX.md).
