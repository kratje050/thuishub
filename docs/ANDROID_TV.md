# Android, Android TV en Google TV

De universele native Kotlin-app staat in `apps/android-tv` en werkt op telefoons, tablets, Android TV en Google TV. Hij gebruikt AndroidX Media3 ExoPlayer plus MediaSession, detecteert aanwezige decoders, schermresolutie/refresh rate en Android HDR-types, koppelt met een zescijferige code en gebruikt tijdelijke, sessiegebonden playbacklinks.

## Bouwen

Installeer Android Studio met SDK Platform 35 en voer uit:

```powershell
.\scripts\build-android-tv.ps1
```

Uitvoer: `release\ThuisHub-Android-1.2.8.apk`, plus `release\ThuisHub-Android-TV-1.2.8.apk` als identieke compatibiliteitsnaam. Dit is een lokaal debug-ondertekende APK voor sideloadtests, geen Play Store-release. Open de universele APK op het Android-apparaat of installeer met `adb install -r <apk>` wanneer USB/netwerkdebugging bewust is ingeschakeld. De Android-app controleert bij iedere start rechtstreeks het stabiele manifest op GitHub Releases en vereist daarvoor geen gekoppelde ThuisHub-server.

## Gebruik

De app heeft op telefoon en tablet een normaal startpictogram en op tv de Leanback-tegel. Hij zoekt de server automatisch via `_thuishub._tcp.local`, controleert `/api/health`, toont daarna een koppelcode en laat die in het ThuisHub-dashboard goedkeuren. Handmatig een privé-LAN-adres invoeren zit alleen onder **Geavanceerd** als mDNS op het netwerk niet werkt.

MediaSession maakt platformbediening mogelijk; voortgang wordt iedere tien seconden aan de centrale sessie teruggeschreven. Opdrachten worden via de beperkte commandowachtrij opgehaald. De app claimt Dolby Vision-profielen, Atmos en audiopassthrough niet zonder betrouwbare platforminformatie. Onbekende mogelijkheden kunnen per gekoppeld apparaat als handmatige override worden ingesteld.

De huidige 1.2-testclient heeft bibliotheek en playback als kern. De server levert een eventuele externe ondertitel-URL mee, maar deze testclient koppelt die nog niet als selecteerbare Media3-track; ook audiotrackkeuze is nog niet aangesloten. Volwaardige native schermen voor zoeken, Mijn lijst, profielwisseling, Live TV/DVR-gids, intro/credits, trackkeuze en autoplay-wachtrijen zijn nog niet gelijkwaardig aan de webinterface. Zie de officiële [Media3 ExoPlayer](https://developer.android.com/media/media3/exoplayer/hello-world)- en [MediaSession](https://developer.android.com/media/media3/session/control-playback)-documentatie.
