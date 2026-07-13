# Samsung Tizen

`apps/samsung-tizen` bevat een Tizen Web App met pairing, capabilitydetectie, bibliotheek, signed playbackbeslissing, Samsung AVPlay, voortgang en afstandsbedienings-/remote-opdrachten. Dolby Vision wordt nooit geclaimd: Samsung-modellen melden in het profiel alleen werkelijk gedetecteerde HDR10/HDR10+/HLG-eigenschappen.

## Vereisten en sideloading

1. Installeer Tizen Studio plus **TV Extensions**.
2. Maak in Certificate Manager een Samsung author/distributor-certificaatprofiel.
3. Zet Developer Mode op de tv aan en koppel de tv in Device Manager.
4. Bouw met `.\scripts\build-samsung-tv.ps1`.
5. Installeer de WGT via Tizen Studio/Device Manager op het gekoppelde testtoestel.

Uitvoer, wanneer SDK en certificaat aanwezig zijn: `release\ThuisHub-Samsung-TV-1.2.0.wgt`. Zonder deze lokale vereisten stopt het script veilig en blijft de volledige bron beschikbaar. Samsung's officiële [Web App Guide](https://developer.samsung.com/smarttv/develop/tools/webapp/webapp-guide.html) beschrijft packaging en testen.

Live TV/DVR gebruikt dezelfde serverroutes maar heeft in deze 1.2-testclient nog geen afzonderlijke native gids. Audio-/ondertitelgedrag en HDR10+ moeten per tv-model met echte media worden getest.
