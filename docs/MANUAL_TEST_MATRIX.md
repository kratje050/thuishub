# Handmatige testmatrix 1.2.1

Automatische tests bewijzen beslislogica en updatebeveiliging, maar niet de fysieke HDMI/display/audio-uitvoer. Noteer per combinatie resultaat, mediafixture, apparaatfirmware en waargenomen tv/receiver-info.

| Doel | Test | Verwacht | Status op buildmoment |
|---|---|---|---|
| Android-telefoon/PWA | direct openen, afspelen, Cast-controller | geen inlogscherm, signed stream, voortgang, bediening | Nog handmatig testen |
| Chromecast | kiezen, Direct Play/HLS, Range/CORS, hervatten | tv haalt URL rechtstreeks op | Geen Cast-hardwaretest uitgevoerd |
| Google TV | H.264/HEVC, tracks, HDR | juiste decision/badge | Geen hardwaretest uitgevoerd |
| Android TV-emulator | pairing, bibliotheek, ExoPlayer, MediaSession | code + playback + voortgang | APK gebouwd; emulator nog testen |
| Samsung-tv | WGT pairing/AVPlay/remote | HDR-capabilities correct, geen DV-claim | SDK/certificaat/hardware vereist |
| Thuisnetwerk | aparte gekozen LAN-interface | beheer-API geblokkeerd, playback werkt | Softwarematig controleren na herstart |
| Tailscale | browser via Serve | beheer blijft privé bereikbaar | Controleren op eigen Tailnet na installatie |
| Mobiele verbinding | automatisch/2–8 Mbps | passend profiel, stabiele buffer | Nog handmatig testen |
| 1080p H.264/AAC | Direct Play | geen transcode | Beslisengine automatisch geslaagd |
| 4K HEVC Main10 HDR10/HLG | Direct/fallback | correcte 10-bit/HDR-indicatie | Logica geslaagd; displaytest nodig |
| HDR10+ | basislaag/fallback | geen nep-HDR | Logica geslaagd; displaytest nodig |
| Dolby Vision P5/P7/P8 | ondersteund/basislaag/SDR | correcte profiel/fallback | Logica geslaagd; gelicenseerde hardwarefixture nodig |
| E-AC-3 Atmos | passthroughketen | Atmos behouden of waarschuwing | Logica geslaagd; receiverdisplay nodig |
| TrueHD 7.1/Atmos | eARC versus ARC | alleen eARC passthrough | Logica geslaagd; HDMI-test nodig |
| DTS/DTS-HD/DTS:X | capability aan/uit | passthrough of audiotranscode | Logica geslaagd; receivertest nodig |
| SRT/WebVTT/ASS/PGS/forced | direct of burn-in | waarschuwing bij video-transcode | Logica geslaagd; fixturetest nodig |
| 80+ Mbps | LAN Direct Play | geen onnodige transcode/buffer | Snelle gigabit-LAN-test nodig |

Test productiegegevens nooit door ze te wijzigen. Gebruik tijdelijke mediakopieën en controleer vóór/na `PRAGMA integrity_check`, aantallen gebruikers/media/progress/Live TV/DVR en de meest recente back-up.
