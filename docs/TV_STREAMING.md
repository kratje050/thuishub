# Tv-streaming

## Afspeelvolgorde

Voor ieder bestand combineert de server de FFprobe-eigenschappen met het opgeslagen apparaatprofiel, de verbinding en de gekozen kwaliteit.

1. **Direct Play**: container, video, audio, resolutie, framerate, bitdiepte, HDR en ondertitel zijn compatibel. Het originele bestand wordt met HTTP Range en zonder hercodering geleverd.
2. **Direct Stream**: codecs zijn compatibel maar de container niet. Video en audio worden met FFmpeg `copy` geremuxt naar HLS; er vindt geen kwaliteitsverlies door encodering plaats.
3. **Transcode**: alleen de incompatibele video- en/of audiolaag wordt omgezet. Inbranden van beeldondertitels vereist videotranscoding.

De speler toont de methode, de oorspronkelijke en uitgaande eigenschappen en alle beslisredenen. Direct Stream/HLS kan containerfuncties zoals interactieve hoofdstukken niet op elk doelplatform tonen, ook al blijven de elementaire audio/video-streams ongewijzigd.

## Koppelen

Een tv vraagt een willekeurige zescijferige code en een niet-getoonde pairing secret aan. Alleen een beheerder kan de code binnen tien minuten goedkeuren. Daarna ontvangt de tv één intrekbaar device-token; dit is geen gebruikers- of beheerderstoken. Kies **Apparaat vergeten** om alle sessies in te trekken.

## Afstandsbediening

Google Cast ondersteunt play/pause, stoppen, ±30 seconden, volume en verbreken vanuit de web/PWA-interface. Android TV en Tizen pollen de beveiligde commandowachtrij voor play, pause, stop, seek, volume, load en disconnect. De server ondersteunt daarnaast volgende/vorige, audio-, ondertitel- en kwaliteitsopdrachten als uitbreidingspunt.

De tv haalt media rechtstreeks bij de LAN-streaminglistener op; er wordt geen schermspiegeling gebruikt.
