# Audio-passthrough, ARC en eARC

De beslisengine beoordeelt codec, kanalen, Atmos/JOC/TrueHD-indicatie, DTS, passthrough en de gemelde HDMI-keten.

- E-AC-3 Atmos kan alleen behouden blijven wanneer Atmos, E-AC-3 en passthrough voor de volledige keten zijn toegestaan.
- TrueHD/TrueHD Atmos vereist passthrough en eARC. Gewone ARC leidt tot audiotranscoding.
- DTS/DTS-HD/DTS:X vereist expliciete DTS-capability én passthrough.
- Als alleen audio incompatibel is, blijft video via stream-copy behouden en wordt audio gekozen als E-AC-3, AC-3 of AAC op basis van het profiel.

De server claimt Atmos alleen wanneer JOC/Atmos-metadata is geprobed. Een tv kan de capabilities van een aangesloten soundbar/receiver niet altijd betrouwbaar melden; corrigeer daarom in Dashboard > TV en afspeelapparaten de override voor `arc`, `passthrough`, `atmos`, `trueHd`, `eac3`, `dts` en `maxAudioChannels`.

Voorbeeld: tv-speler > HDMI ARC > soundbar is doorgaans geschikt voor AC-3/E-AC-3, maar niet voor lossless TrueHD. eARC kan TrueHD 7.1/Atmos dragen als alle apparaten en instellingen dit toelaten. Lipsync/audiovertraging is platformafhankelijk en nog geen server-side DSP-functie.
