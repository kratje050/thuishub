# Android TV en Google TV

De native Kotlin-app staat in `apps/android-tv` en gebruikt AndroidX Media3 ExoPlayer plus MediaSession. De app detecteert codecs, schermresolutie/refresh rate en Android HDR-types, koppelt met een zescijferige code, haalt de profielgefilterde bibliotheek op en vraagt voor ieder item een signed playbackbeslissing aan.

## Bouwen

Installeer Android Studio met SDK Platform 35 en voer uit:

```powershell
.\scripts\build-android-tv.ps1
```

Uitvoer: `release\ThuisHub-Android-TV-1.2.1.apk`. Dit is een lokaal debug-ondertekende APK voor sideloadtests, geen Play Store-release. Installeer bijvoorbeeld met `adb install -r <apk>` op een apparaat waarvoor USB/netwerkdebugging bewust is ingeschakeld.

## Gebruik

Vul het privé-LAN-adres met poort in, maak een code en keur die goed in het ThuisHub-dashboard. PlayerView biedt D-padbediening en de Media3 track-selector voor beschikbare audio/ondertitels. MediaSession maakt platformbediening mogelijk; voortgang wordt iedere tien seconden opgeslagen. Remote-opdrachten worden op de achtergrond opgehaald.

De huidige 1.2-testclient heeft bibliotheek en playback als stabiele kern. Volwaardige native schermen voor zoeken, Mijn lijst, profielwisseling, Live TV/DVR-gids, intro/credits en autoplay-wachtrijen zijn nog niet gelijkwaardig aan de webinterface; gebruik daarvoor voorlopig de PWA/webinterface. Zie de officiële [Media3 ExoPlayer](https://developer.android.com/media/media3/exoplayer/hello-world)- en [MediaSession](https://developer.android.com/media/media3/session/control-playback)-documentatie.
