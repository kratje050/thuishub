# Samsung Tizen

`apps/samsung-tizen` bevat een Tizen Web App met automatische DNS-SD-serverdetectie waar de firmware dit aanbiedt, pairing, conservatieve capabilitydetectie, bibliotheek, sessiegebonden playbacklinks, Samsung AVPlay, voortgang en remote-opdrachten. Handmatige serverinvoer blijft een geavanceerde terugvaloptie.

Dolby Vision wordt nooit geclaimd. Samsung-modellen melden alleen via de beschikbare platform-API gedetecteerde HDR10/HDR10+/HLG-eigenschappen; onbekende codec-, Atmos- en passthroughmogelijkheden blijven conservatief totdat ze handmatig zijn getest en ingesteld.

## Vereisten en sideloading

1. Installeer Tizen Studio plus **TV Extensions**.
2. Maak in Certificate Manager een Samsung author/distributor-certificaatprofiel.
3. Zet Developer Mode op de tv aan en koppel de tv in Device Manager.
4. Bouw met `.\scripts\build-samsung-tv.ps1`.
5. Installeer de WGT via Tizen Studio/Device Manager op het gekoppelde testtoestel.

Uitvoer, wanneer SDK en certificaat aanwezig zijn: `release\ThuisHub-Samsung-TV-1.2.5.wgt`. Zonder deze lokale vereisten stopt het script veilig en blijft de volledige bron beschikbaar. Samsung's officiële [Web App Guide](https://developer.samsung.com/smarttv/develop/tools/webapp/webapp-guide.html) beschrijft packaging en testen.

Bediening gebruikt een lokale, met het apparaattoken beveiligde WebSocket en valt terug op rustig pollen. Live TV/DVR heeft in deze 1.2-testclient nog geen afzonderlijke native gids. De meegeleverde externe ondertitel-URL en audiotrackkeuze zijn nog niet als selecteerbare AVPlay-tracks aangesloten. HDR10+, DNS-SD en werkelijk audio-/ondertitelgedrag moeten per tv-model met echte hardware worden getest.
