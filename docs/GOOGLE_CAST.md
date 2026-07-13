# Google Cast

ThuisHub gebruikt in een ondersteunde Chromium-browser uitsluitend de officiële Google Cast Web Sender SDK. De permanente knop **Afspelen op apparaat** toont een rij **Google Cast** met het officiële `<google-cast-launcher>`-element. Daardoor blijven apparaatdetectie, toestemming en selectie eigendom van de Google SDK en de browser.

ThuisHub voert geen server-side scan van Chromecast-IP-adressen uit, maakt geen eigen Cast-kiezer na en doet zich niet voor als Chromecast. Een mDNS-controle van `_googlecast._tcp.local` in het technische diagnoserapport is alleen een lokale bereikbaarheidsindicatie; de uitkomst wordt niet gebruikt om een Cast-apparaat te inventariseren of te besturen.

## Afspeelstroom

1. De gebruiker opent **Afspelen op apparaat** in een ondersteunde browser en kiest **Google Cast**.
2. De officiële Cast-kiezer opent binnen de directe gebruikersactie.
3. Nadat Google een receiver heeft geselecteerd, registreert de browser alleen de actieve receivernaam/-identiteit bij de lokale ThuisHub-sessie.
4. De server maakt een centrale playbackbeslissing en sessiegebonden, kortlevende URL's voor media, ondertitels en artwork.
5. De sender verstuurt de officiële `LOAD`; acceptatie daarvan geldt nog niet als bewijs dat de video afspeelt. De Cast-receiver haalt de media rechtstreeks op via de begrensde LAN-streaminglistener; dit is geen schermspiegeling.
6. De browser wacht totdat de officiële SDK meldt dat media geladen zijn en `RemotePlayer` werkelijk `PLAYING` is. Pas dan meldt hij `playing` aan de centrale sessie en mag een bronapparaat bij een overdracht stoppen. Een fout vóór die bevestiging rolt alleen de nieuwe bestemming terug.
7. Daarna gebruikt de browser `RemotePlayer` en `RemotePlayerController` voor status, play/pause, stop, seek, volume en verbreken. De centrale sessiestatus wordt periodiek bijgewerkt.
8. Bij verbreken eindigt de centrale sessie en zijn de bijbehorende grants niet meer bruikbaar.

Wanneer de lokale streaminglistener niet actief is op het gekozen privé-adres, geeft ThuisHub geen LAN-playback-URL uit en start Cast niet. De listener ondersteunt de benodigde Range-, HEAD- en OPTIONS-verzoeken en beperkte CORS. De Google Default Media Receiver krijgt uitsluitend zijn exacte `https://www.gstatic.com`-origin; de eigen receiver gebruikt alleen expliciet ingestelde origins. Algemene beheer-API's krijgen nooit een brede `Access-Control-Allow-Origin: *`-toegang. Direct Play meldt bovendien het werkelijke ondersteunde containertype, waaronder `video/webm` voor WebM/VP8.

## Receiverstatus en sessierevisie

De ingelogde webcontroller gebruikt `POST /api/playback-sessions/:id/receiver-status` uitsluitend voor sessies met protocol `google-cast` of `local-browser`. Het endpoint accepteert alleen `playing` of `error` met de actuele sessierevisie. `playing` rondt een wachtende atomaire overdracht af; `error` rolt een wachtende bestemming terug, of stopt een niet-wachtende sessie en trekt haar grants in. Android TV- en Tizen-apps gebruiken dit webendpoint niet: zij melden hun status via de afzonderlijke, met het apparaattoken beveiligde verbinding.

## Vereisten en zichtbare diagnose

- Gebruik een browser waarin `chrome.cast` en `cast.framework` werkelijk beschikbaar zijn.
- Gebruik `localhost`/`127.0.0.1` of een geldige beveiligde HTTPS-context. Chrome op iPhone/iPad biedt geen Web Sender-casting.
- Pc en receiver moeten de lokale streamingpoort via hetzelfde privé-thuisnetwerk kunnen bereiken.
- De permanente apparaatkiezer meldt afzonderlijk of de beveiligde context, Cast API en Cast-apparaatbeschikbaarheid ontbreken.
- Een netwerkdiagnose kan mDNS-zichtbaarheid tonen, maar alleen de officiële Cast-kiezer bepaalt welke receivers selecteerbaar zijn.

## Standaardreceiver

Laat **Google Cast Receiver App ID** in de geavanceerde ontwikkelaarsinstellingen leeg om Google's Default Media Receiver te gebruiken. Dit vereist geen eigen receiverregistratie, maar toont geen volledige ThuisHub-layout. De sender gebruikt origin-scoped auto-join en vraagt de SDK om een opgeslagen sessie te hervatten waar Google dit ondersteunt.

## Optionele eigen Web Receiver

De zelfstandige CAF-receiverbron staat in `apps/cast-receiver`; de meegebouwde receiverassets staan daarnaast onder `public/cast`. Registreer voor ontwikkeling een publiek bereikbare HTTPS-versie van de zelfstandige receiver in de Google Cast SDK Developer Console, voeg uitsluitend eigen testapparaten toe en vul het verkregen Receiver Application ID in bij de geavanceerde ontwikkelaarsinstellingen.

De receiver controleert dat inkomende media door ThuisHub zijn gemarkeerd en een privé-LAN-playback-URL gebruiken. Het Receiver Application ID is geen geheim, maar is geen instelling die een gewone gebruiker nodig heeft.

Volg voor integratie de officiële documentatie voor [Web Sender-integratie](https://developers.google.com/cast/docs/web_sender/integrate), de [Web Sender API](https://developers.google.com/cast/docs/reference/web_sender) en de [Web Receiver](https://developers.google.com/cast/docs/web_receiver).

## Beperkingen en hardwaretest

Werkelijke codec-, container-, resolutie-, HDR-, ondertitel- en sessieherstelondersteuning verschilt per Chromecast/Google TV-model en receiverfirmware. De server gebruikt daarom een conservatief Cast-profiel. De huidige sender ondersteunt één externe WebVTT-ondertiteltrack; audiotrackkeuze, muziekbibliotheek-casting, volledige queue/autoplay, Live TV-payloads en receivergestuurde HDR-capabilityuitwisseling zijn nog niet end-to-end aangesloten. Bij een kwaliteitswissel op dezelfde Cast-receiver blijft de oude serversessie veilig actief totdat `PLAYING` is bevestigd; sommige receiverfirmware vervangt de fysieke buffer echter al na een geaccepteerde `LOAD`, zodat herstel na een daaropvolgende hardwaretimeout nog op echte apparaten moet worden gevalideerd. Voor deze ontwikkelwijziging is nog geen volledige test op echte Cast-hardware uitgevoerd; controleer vóór publicatie de scenario's in de [handmatige testmatrix](MANUAL_TEST_MATRIX.md).
