# ThuisHub functiepariteit 1.2.0

| Onderdeel | Status | Opmerking |
|---|---|---|
| Windows-app, browser en PWA | Beschikbaar | Zelfde lokale server en database. |
| Films, series, muziek, foto's, Live TV en DVR | Beschikbaar | Bestaande 1.1-functies behouden. |
| Direct Play / Direct Stream / Transcode | Beschikbaar | Eén centrale beslisengine; FFmpeg voor remux/transcode. |
| HDR10, HDR10+, HLG, Dolby Vision-detectie | Beschikbaar | Behoud bij stream-copy; geldige fallback of SDR-tone-map. |
| Atmos, TrueHD, E-AC-3, DTS-passthroughbeslissing | Beschikbaar | Alleen wanneer capabilityketen dit toestaat. |
| Google Cast | Beschikbaar, hardwaretest vereist | Standaardreceiver direct; eigen receiver vereist geregistreerd App ID/HTTPS. |
| Android TV / Google TV | Test-APK beschikbaar | Koppelen, bibliotheek, afspelen, MediaSession, tracks, voortgang en remote-opdrachten. Uitgebreide native zoek/Live TV-schermen zijn nog vervolgwerk. |
| Samsung Tizen | Bron beschikbaar | WGT vereist lokale Tizen SDK en Samsung-certificaat; hardwaretest vereist. |
| DLNA/UPnP-afspelen | Niet ingebouwd | Er wordt bewust geen UPnP-portforwarding gebruikt. Externe DLNA-speler kan signed HTTP-bronnen niet automatisch ontdekken. |
| Apple TV-client | Uitbreidingspunt | Nog geen tvOS-client. Browser/AirPlay-schermspiegeling is geen primaire afspeelmethode. |
| Multi-variant adaptive bitrate | Beperkt | HLS-profiel wordt centraal gekozen; wisselen van kwaliteit start een passend profiel. Geen gelijktijdige masterplaylist met alle varianten. |
| GitHub Releases-updates | Beschikbaar | Download/controle wel; installatie blijft bewust handmatig en vereist toestemming. |

ThuisHub bevat geen Plex-code of -merken en ontgrendelt geen betaalde diensten. Internet-tv, huurfilms en partnercontent vereisen eigen legale bronnen en rechten.
