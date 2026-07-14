# Wijzigingen

## 1.2.7 — 14 juli 2026

- Automatisch zoeken en verbinden staat op nieuwe Android-installaties standaard aan, zonder Home, Instellingen of Updates te blokkeren.
- Een eerder bewust uitgeschakelde instelling blijft uitgeschakeld.
- De lokale Windows-netwerkdiagnose en begrensde privé-LAN-firewallregels zijn gecontroleerd met telefoon- en DLNA-detectie.

## 1.2.6 — 14 juli 2026

- De Windows-app en browserserver controleren bij iedere start automatisch en niet-blokkerend op de nieuwste GitHub-release.
- Een oude opgeslagen instelling die automatische updatecontrole uitschakelde kan deze startcontrole niet meer tegenhouden.
- De Android-app controleert kort na iedere start zelfstandig op updates, ook zonder gekoppelde ThuisHub-server.
- Alleen wanneer een nieuwere Android-versie beschikbaar is verschijnt een melding; downloaden en installeren vereisen nog steeds een bewuste bevestiging.

## 1.2.5 — 14 juli 2026

- De Android-app opent voortaan op een bruikbaar Home-scherm in plaats van direct in een blokkerende automatische zoekweergave.
- Automatisch zoeken en verbinden is een opgeslagen instelling die standaard uitstaat; handmatig zoeken en een lokaal serveradres blijven altijd beschikbaar.
- Home, verbindingsinstellingen en app-updates blijven bereikbaar vóór, tijdens en na het koppelen.
- De Android-app kan zonder gekoppelde ThuisHub-server rechtstreeks op GitHub Releases controleren op updates.
- Android-updates worden alleen van de eigen ThuisHub-release gedownload, op bestandstype en grootte begrensd en vóór installatie met de gepubliceerde SHA-256 gecontroleerd.
- Het volledige Home-, bibliotheek-, dashboard- en instellingenontwerp gebruikt de nieuwe donkere filmische ThuisHub-interface zonder Premium-kaart of verkooppromotie.

## 1.2.4 — 14 juli 2026

- De Android-client is universeel gemaakt voor telefoon, tablet, Android TV en Google TV.
- Het APK-manifest bevat nu zowel de normale Android-launcher als de Leanback-launcher; het ThuisHub-pictogram verschijnt daardoor ook op telefoons en tablets.
- Leanback is optioneel en de app dwingt geen liggende schermstand meer af.
- Koppelen en de bibliotheek schalen responsief van twee kolommen op een telefoon tot vijf kolommen op een televisie.
- Gekoppelde mobiele apparaten worden als display geregistreerd en blijven beperkt tot de bestaande apparaat- en playbackroutes.
- De release bevat naast de compatibele Android TV-asset een duidelijk benoemde universele `ThuisHub-Android`-APK.

## 1.2.3 — 14 juli 2026

- **Afspelen op apparaat** is een permanente, gegroepeerde kiezer voor de lokale browser, gekoppelde ThuisHub TV-apps, DLNA-renderers en Google Cast.
- Google Cast gebruikt de officiële Web Sender SDK, het officiële `<google-cast-launcher>`-element en de client-side Cast-kiezer. De server scant geen Chromecast-IP-adressen en claimt geen server-side Cast-discovery.
- De server vindt DLNA MediaRenderers via begrensde SSDP M-SEARCH en verzamelt apparaten provider-onafhankelijk op stabiele identiteit, protocolprioriteit en `lastSeen`, zonder een apparaat na één gemiste scan direct te verwijderen.
- De server adverteert `_thuishub._tcp.local` alleen wanneer de begrensde LAN-listener werkelijk luistert, zodat Android TV/Google TV- en Samsung Tizen-apps geen onbereikbare server ontdekken. Handmatig een serveradres invoeren blijft uitsluitend als geavanceerde terugvaloptie beschikbaar.
- Nieuwe ThuisHub TV-apps gebruiken een zescijferige koppeling met een afzonderlijke pairing secret, rate limiting, een stabiele apparaat-ID en een intrekbaar, beperkt apparaat-token. Request en claim zijn alleen bereikbaar via de werkelijk actieve, beperkte LAN-listener; niet-gekoppelde apps kunnen de code direct in de apparaatkiezer laten invoeren. Identiteits- en capabilityvelden worden vóór sleutelvorming en opslag genormaliseerd en begrensd.
- Centrale afspeelsessies bewaren doelapparaat, status, positie, kwaliteit en revisie. Bediening en voortgang gebruiken oplopende sessie-/opdrachtvolgorde om verouderde updates niet over nieuwere status heen te schrijven.
- Ieder browservenster heeft gedurende zijn levensduur een eigen lokale receiver-ID; tabs delen dus bewust geen receiver-identiteit. Afstandsbedieningsopdrachten voor de lokale speler en Google Cast lopen via de centrale sessie en een origin-beveiligd live controllerkanaal naar de browser die de receiver werkelijk bezit; polling blijft terugval. Daardoor kan ook een telefoon of tweede browser bedienen en wordt alleen de juiste bron na een bevestigde overdracht gesloten.
- Overplaatsen is server-side atomair: de bronsessie en grants blijven actief totdat de nieuwe ontvanger `playing` bevestigt. Een fout of timeout rolt alleen de mislukte bestemming terug. Bij Cast-naar-Cast bepaalt de officiële Chrome Cast-sessiewissel wanneer de oude fysieke receiver stopt; dit blijft daarom een expliciete hardwaretest.
- Een geslaagde Google Cast `LOAD` is nog geen voltooide overdracht: ThuisHub wacht op de werkelijke `PLAYING`-status van de officiële Cast SDK voordat de bron stopt. Ook de lokale browser gebruikt nu een centrale, revisiegestuurde afspeelsessie en rondt tv-naar-browser-overdracht pas af wanneer het video-element werkelijk afspeelt.
- Android TV- en Tizen-apps starten bibliotheekmedia voortaan via een centrale, profielgebonden sessie en melden `playing`, `stopped` en receiverfouten terug; hun playbackgrants zijn aan die sessie en het gekoppelde apparaat gebonden.
- Voor Google Cast en de lokale browser accepteert het afzonderlijke receiver-statuskanaal alleen `playing` of `error` met de actuele sessierevisie. Native tv-apps melden status via hun gekoppelde apparaatverbinding; een fout rolt een wachtende overdracht terug of beëindigt anders de sessie en trekt grants in.
- Media-, ondertitel- en artworklinks zijn sessiegebonden en kortlevend. Actief gebruikte grants kunnen begrensd glijdend worden verlengd, maar alleen voor exact dezelfde sessie en gebruiker, en worden ingetrokken wanneer de sessie stopt of een apparaat wordt vergeten. Controller-WebSockets accepteren alleen een passende lokale beheerorigin of geldige Tailscale Serve-origin.
- De DLNA-controller ondersteunt afspelen, pauzeren, stoppen, zoeken, status/positie en waar beschikbaar volume. Een geaccepteerde SOAP `Play` rondt een overdracht nog niet af: begrensde `GetTransportInfo`-polling moet eerst werkelijk `PLAYING` zien; fout, `STOPPED` of timeout rolt alleen de bestemming terug. Onbetrouwbare apparaatbeschrijvingen worden begrensd en gecontroleerd op redirects, SSRF en onveilige XML.
- Het dashboard toont Cast-, mDNS-, SSDP-, DLNA-, streaminglistener- en firewallstatus en kan een alleen-lezen diagnose uitvoeren.
- Het firewallscript maakt uitsluitend inkomende Private/LocalSubnet-regels op het gekozen lokale adres voor de streamingpoort, SSDP UDP 1900 en mDNS UDP 5353; de diagnose wijzigt geen firewall-, adapter- of routerinstellingen.
- De LAN-listener weigert standaard alle routes en clients buiten hetzelfde gekozen privé-subnet. Alleen expliciet toegestane health-, pairing-, device- en signed playbackroutes zijn bereikbaar; een ontbrekende of ongeldige listener levert geen afspeel-URL op.
- SSDP-bron, apparaatbeschrijving en DLNA-control-URL moeten allemaal binnen exact het subnet van de gekozen interface vallen. mDNS/SSDP worden bij een netwerkadapterwissel of hervatten uit slaap opnieuw aan die interface gebonden; zonder geldig antwoord blijft multicaststatus onbekend in plaats van ten onrechte geslaagd.
- Hardwareafhankelijke interoperabiliteit met Chromecast/Google TV, Android TV, Samsung Tizen en verschillende DLNA-fabrikanten moet vóór publicatie nog op echte apparaten worden getest.
- Windows-updates vervangen de oude programmaversie voortaan volledig automatisch en starten daarna de nieuwe versie.
- De stille upgrade gebruikt de bestaande veilige verwijderprocedure met behoud van bibliotheken, database, instellingen, voortgang en back-ups.
- De actieve TMDB-koppeling is vervangen door een modulaire providerlaag met TVmaze, optionele OMDb, lokale NFO, ingebedde metadata en handmatige metadata.
- Metadata heeft nu per-veldherkomst, locks, historie/herstel, confidence matching, een begrensde achtergrondwachtrij en een providerdashboard.
- Externe afbeeldingen worden gecontroleerd op formaat, grootte, redirects, SSRF en corruptie en daarna alleen vanuit een lokale cache aangeboden.
- Een eerste migratie maakt vooraf een databaseback-up, behoudt legacy-data en verwijdert de oude sleutel zonder oude providerrequests te doen.

## 1.2.2 — 13 juli 2026

- Het update-dashboard toont na een gecontroleerde download de knop **Installeren en herstarten**.
- De installer wordt direct vóór uitvoering opnieuw op bestandsnaam, grootte en SHA-256 gecontroleerd.
- De Windows-app draagt de installer veilig over, sluit app en server af en opent daarna pas de installer.
- Ook de losse browserserver kan de gecontroleerde installer starten en zichzelf netjes afsluiten.

## 1.2.1 — 13 juli 2026

- Het volledige inlog- en eerste-installatiescherm is uit de Windows-app, browser en PWA verwijderd.
- ThuisHub gebruikt automatisch de bestaande beheerder of maakt bij een lege installatie één lokaal beheerdersprofiel aan.
- De uitlogknop is verwijderd en verbindingsproblemen tonen voortaan een herhaalbare verbindingsmelding.
- De PWA-cache is vernieuwd zodat telefoons niet op het oude inlogscherm blijven hangen.

## 1.2.0 — 13 juli 2026

- Centrale capability-gestuurde Direct Play/Direct Stream/transcode-beslislaag met 35 playbacktests.
- Uitgebreide FFprobe-opslag voor video, audio, HDR, Dolby Vision, Atmos, DTS:X, hoofdstukken en ondertitels.
- Google Cast sender, mini-controller, signed media- en WebVTT-URL's en branded custom Web Receiver.
- Veilig apparaatkoppelen, intrekbare device-sessies, remote-opdrachten en handmatige capability-overrides.
- Native Android TV/Google TV-client met Media3/ExoPlayer/MediaSession; Samsung Tizen-clientbron met AVPlay.
- Aparte privé-LAN-listener, LocalSubnet-firewallscript, HTTP Range/HEAD/OPTIONS en beperkte CORS.
- Kwaliteitsprofielen, netwerkstandaarden, technische afspeelinformatie en ondertitel-burn-in wanneer noodzakelijk.
- GitHub Releases-updater zonder token, exacte assetselectie, prereleasekanalen en gecontroleerde download naar LocalAppData.
- Veilige release-, manifest-, hash-, secretscan- en conceptpublicatiescripts.
- 70 geautomatiseerde tests en nieuwe installatie-, compatibiliteits-, beveiligings- en testdocumentatie.

## 1.1.0 — 13 juli 2026

- Hernoeming van Huiskamer naar ThuisHub en Windows installer/portable-app.
- Veilige gegevensmigratie, lokale beheerinterface, Tailscale Serve, back-ups, databasecontrole, logging en serverdashboard.
- Films, series, muziek, foto's, Live TV, DVR, gebruikers, voortgang en bestaande web/PWA-functies behouden.
