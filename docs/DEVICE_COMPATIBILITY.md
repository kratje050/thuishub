# Apparaatcompatibiliteit

Een capability-profiel bevat fabrikant, model, platform, appversie, maximale resolutie/framerate/bitrate, containers, videocodecs/-profielen/-levels, bitdiepte, HDR/Dolby Vision, audioformaten/kanalen/passthrough, Atmos/TrueHD/E-AC-3/DTS, ondertitels en ARC/eARC.

Android rapporteert wat Android MediaCodec en het display bieden. Tizen gebruikt Samsung ProductInfo en claimt geen Dolby Vision. Cast gebruikt een conservatief basisprofiel; verschillende generaties moeten op echte hardware worden getest. Browserprofielen zijn bewust conservatief voor HDR en lossless audio.

Dashboard > TV en afspeelapparaten toont de gedetecteerde waarden. **Handmatige instellingen** accepteert een JSON-object dat alleen de foutieve velden overschrijft, bijvoorbeeld:

```json
{
  "arc": "earc",
  "passthrough": true,
  "trueHd": true,
  "atmos": true,
  "maxAudioChannels": 8
}
```

Gebruik alleen waarden die de volledige speler-tv-HDMI-soundbarketen werkelijk aankan. **Compatibiliteit opnieuw testen** verwijdert overrides; **Apparaat vergeten** trekt toegang in.
