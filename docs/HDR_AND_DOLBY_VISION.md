# HDR en Dolby Vision

FFprobe legt bitdiepte, pixel format, primaries, transfer, colorspace, mastering side data en Dolby Vision-configuratie vast. De technische pagina toont HDR-type, DV-profiel en fallback.

- Direct Play/Direct Stream gebruiken stream-copy en voeren geen kunstmatige HDR- of Dolby Vision-conversie uit.
- Dolby Vision wordt alleen behouden als apparaat, profiel en bitdiepte compatibel zijn.
- Bij incompatibele Dolby Vision wordt eerst een werkelijk gedetecteerde HDR10-compatibiliteitslaag gebruikt.
- HDR10+ mag als aanwezige HDR10-basislaag spelen wanneer het apparaat geen dynamische HDR10+ ondersteunt.
- Anders gebruikt transcoding BT.2020/PQ of HLG naar BT.709/SDR tone-mapping.
- `forceSdr` activeert altijd tone-mapping voor HDR-bronnen.

ThuisHub maakt nooit nep-Dolby Vision en toont geen DV/Atmos-badge zonder probe-indicatie. FFmpeg/driverondersteuning en displaygedrag moeten met echte testbestanden worden gecontroleerd; vooral Profile 7 dual-layer/FEL is niet op ieder afspeelpad bruikbaar.
