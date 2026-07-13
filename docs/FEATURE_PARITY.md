# Functie- en teststatus voor afspeelapparaten

Dit overzicht beschrijft de huidige ontwikkelstatus van tv-detectie en casting. Het is geen claim dat ieder apparaat of iedere functie van Plex één-op-één wordt ondersteund. Alle wijzigingen hieronder zijn nog niet als nieuwe ThuisHub-versie gepubliceerd.

## Beschikbaar in de ontwikkelcode

| Onderdeel | Status | Gedrag |
|---|---|---|
| Permanente apparaatknop | Geïmplementeerd | **Afspelen op apparaat** blijft zichtbaar en toont status, actief doel en het aantal beschikbare doelen. |
| Gegroepeerde kiezer | Geïmplementeerd | Toont **Mijn apparaten**, **Andere apparaten** en **Dit apparaat**; offline doelen kunnen niet worden gekozen en een ontdekte, nog niet gekoppelde eigen tv-app kan inline met haar zescijferige code worden gekoppeld. |
| Lokale browser/Windows-app | Geïmplementeerd | Blijft altijd beschikbaar als lokaal afspeeldoel en gebruikt dezelfde centrale sessie, revisiecontrole en atomaire overdracht als netwerkdoelen. |
| Google Cast | Geïmplementeerd via officiële SDK | De browser opent de officiële Google Cast-kiezer. Na `LOAD` wacht de overdracht op een werkelijke `PLAYING`-status; de server inventariseert of bestuurt geen Chromecast-IP-adressen. |
| ThuisHub Android TV/Google TV-app | Geïmplementeerd als client | Vindt de ThuisHub-server via `_thuishub._tcp.local`, valideert de lokale server, koppelt met een zescijferige code en gebruikt Media3/ExoPlayer. Polling blijft beschikbaar wanneer een realtime verbinding ontbreekt. |
| ThuisHub Samsung Tizen-app | Geïmplementeerd als clientbron | Probeert DNS-SD waar de Tizen-firmware dit aanbiedt, koppelt lokaal en gebruikt AVPlay. WebSocket-bediening heeft een pollingfallback. |
| Handmatig serveradres | Geavanceerde terugvaloptie | Alleen bedoeld wanneer mDNS/DNS-SD door netwerk of tv-platform niet beschikbaar is; niet de normale gebruikersroute. |
| DLNA/UPnP | Geïmplementeerd als best-effort fallback | Vindt lokale `MediaRenderer`-apparaten met SSDP en ondersteunt Play, Pause, Stop, Seek, status/positie en optioneel volume. |
| Stabiele apparaatregistratie | Geïmplementeerd | Combineert protocolidentiteit en fysieke identiteit, geeft voorkeur aan de eigen app boven Cast/DLNA en bewaart `lastSeen` zonder na één gemiste scan direct te verwijderen. |
| Koppelen en vergeten | Geïmplementeerd | Een eigen tv-app gebruikt een tijdelijke code en pairing secret. **Apparaat vergeten** trekt het apparaat-token en actieve sessies in; **Verbinding verbreken** beëindigt alleen de huidige sessie. |
| Centrale afspeelsessie | Geïmplementeerd | Houdt media, doel, positie, status, kwaliteit en revisie centraal bij en ondersteunt overplaatsen naar een ander geschikt doel. |
| Sessiegebonden playbacklinks | Geïmplementeerd | Media, ondertitel en artwork krijgen beperkte signed grants. Verlenging vereist exact dezelfde actieve sessie en gebruiker; stoppen of intrekken maakt ze onbruikbaar. |
| Afstandsbediening | Geïmplementeerd per protocol/capability | Play/pause, stop, seek, volume en verbreken zijn beschikbaar waar het doel ze ondersteunt; uitgebreidere track- en kwaliteitscommando's blijven capability-afhankelijk. |
| Diagnose | Geïmplementeerd | Dashboard en alleen-lezen script rapporteren interface, listener, firewallscopes, mDNS en SSDP zonder playbacktokens te tonen. |

## Bewuste veiligheidsgrenzen

- De beheerinterface luistert alleen op `127.0.0.1:8787`.
- De optionele tv-listener bindt aan exact één gekozen RFC1918-adres en weigert clients buiten hetzelfde subnet.
- Op de tv-listener zijn alleen expliciet toegestane health-, pairing-, device- en signed playbackroutes bereikbaar. Beheer, updates, gebruikers, back-ups en algemene instellingen blijven geblokkeerd.
- Wanneer de gekozen interface of listener niet actief is, maakt ThuisHub geen LAN-playback-URL: dit is fail-closed gedrag.
- mDNS-advertentie voor de eigen tv-apps start alleen wanneer die LAN-listener werkelijk luistert en stopt bij een listenerfout of sluiting.
- SSDP-description- en control-URL's worden behandeld als onbetrouwbare invoer en gecontroleerd op privé-adres, herkomst, redirects, grootte en onveilige XML.
- Capabilitygegevens uit een pairingaanvraag worden op bekende typen genormaliseerd en in omvang en bereik begrensd. De controller-WebSocket weigert ontbrekende of afwijkende origins; de apparaat-WebSocket blijft afzonderlijk met het beperkte device-token beveiligd.
- ThuisHub zoekt geen routerservices, maakt geen UPnP-portforwarding en opent geen Tailscale Funnel.

## Nog te bewijzen of platformafhankelijk

- Er is voor deze ontwikkelwijziging nog geen volledige end-to-endtest op echte Chromecast-, Google TV-, Android TV-, Samsung Tizen- en DLNA-hardware uitgevoerd.
- De officiële Cast-kiezer en het Cast-apparaatbereik zijn eigendom van de browser/Google SDK. ThuisHub kan die lijst niet server-side afdwingen of namaken.
- DLNA ondersteunt geen uniform capabilitymodel. Werkelijke codecs, ondertitels, `Seek`, `Pause`, volume en statusrapportage verschillen per fabrikant en firmware. AVTransport-/RenderingControl-eventing met `SUBSCRIBE` is niet geïmplementeerd; ThuisHub gebruikt begrensde polling voor status en positie.
- HDR, Dolby Vision, Atmos, DTS:X, passthrough en maximale resolutie moeten met geschikte media, televisie, receiver en HDMI-keten worden getest.
- Een Tizen WGT vereist Tizen Studio, TV Extensions en een passend Samsung-certificaat. Een APK-build bewijst nog geen correcte uitvoer op elk Android TV-model.
- mDNS/SSDP werkt normaal alleen binnen hetzelfde lokale multicastdomein en niet via internet of Tailscale Serve.
- Audiotrackkeuze is nog niet aan de streaminventaris en receivers gekoppeld. Externe WebVTT-ondertiteling kan in deze ontwikkelcode via Google Cast worden in- en uitgeschakeld; de Android TV- en Tizen-testapps gebruiken de meegeleverde externe ondertitel-URL nog niet.
- Cast-audio voor een muziekbibliotheek heeft nog geen eigen centrale senderflow. De huidige apparaatlaag en afstandsbediening zijn gericht op films en afleveringen.
- De custom CAF-receiver bevat presentatie- en interceptiehooks voor wachtrijen, Live TV, tracks en technische informatie, maar de huidige websender vult nog geen volledige queue-, Live TV-, audiotrack- of HDR-capabilitypayload. Deze onderdelen zijn dus ontwikkelbasis en geen afgeronde functieclaim.

Gebruik voor vrijgave de [handmatige testmatrix](MANUAL_TEST_MATRIX.md), naast de geautomatiseerde tests. Zie ook [automatische apparaatdetectie](AUTOMATIC_DEVICE_DISCOVERY.md), [Google Cast](GOOGLE_CAST.md), [DLNA/UPnP](DLNA_UPNP.md), [tv-app koppelen](TV_PAIRING.md) en [privé-LAN-streaming](LOCAL_NETWORK_STREAMING.md).
