# ThuisHub TV-app koppelen

Een eigen Android TV-, Google TV- of Tizen-app wordt na lokale discovery zichtbaar als niet-gekoppeld ThuisHub-apparaat. De gewone gebruiker hoeft geen IP-adres in te voeren.

## Eerste koppeling

1. Open **Afspelen op apparaat** en kies de ThuisHub TV-app.
2. De televisie toont een willekeurige zescijferige code.
3. Voer de code in ThuisHub in.
4. De server koppelt het apparaat aan het lokale profiel en geeft een intrekbaar device-token uit.
5. Het token wordt alleen gehasht op de server opgeslagen; de code en pairing secret verlopen na tien minuten.

Een nog niet gekoppelde tv-app blijft zichtbaar in **Afspelen op apparaat** en toont daar een compact invoerveld voor de zescijferige code. Afspelen naar die app blijft geblokkeerd totdat de code is goedgekeurd. De server normaliseert het capability-profiel dat de app bij de aanvraag meestuurt en begrenst aantallen, tekstlengtes en numerieke bereiken voordat iets wordt opgeslagen.

Een device-token is geen beheerderstoken. Tv-routes mogen alleen bibliotheekinformatie binnen het gekoppelde profiel lezen, een playbackbeslissing en korte signed media-URL aanvragen, opdrachten ontvangen en voortgang terugschrijven. Het token mag geen serverinstellingen, gebruikers, bibliotheekbronnen, back-ups of updates aanpassen.

Wanneer de Android TV- of Tizen-app zelf een titel uit de bibliotheek start, maakt de server eerst een centrale sessie voor exact het gekoppelde apparaat en controleert hij opnieuw profiel en leeftijdsclassificatie. Playback-, ondertitel- en artworkgrants horen bij die sessie. De app meldt `playing`, voortgang, `stopped` en receiverfouten terug; stoppen of een terminale fout trekt de sessiegrants in. Bij overplaatsen blijft een bestaande bron spelen totdat het nieuwe apparaat `playing` heeft bevestigd.

## Vertrouwd apparaat

De tv-app bewaart een stabiele willekeurige device-ID, zodat dezelfde app na een herstart opnieuw wordt herkend. **Verbinding verbreken** stopt alleen de actieve afspeelsessie. **Apparaat vergeten** is de afzonderlijke bewuste handeling die alle device-sessies intrekt en opnieuw koppelen vereist.

Pairing request, claim en approval zijn rate-limited. Request en claim worden alleen op de werkelijk actieve, beperkte LAN-listener geaccepteerd en zijn dus niet beschikbaar via de lokale beheerpoort of Tailscale Serve. Verlopen, afgeronde en verweesde pairingrecords worden opgeruimd; foute en verlopen codes geven geen informatie over andere apparaten. Een onbetrouwbaar of publiek netwerk is geen ondersteunde pairingomgeving.

## Opnieuw koppelen

Verwijder het apparaat in Dashboard > TV en afspeelapparaten wanneer een tv is verkocht, opnieuw is geïnstalleerd of een token mogelijk is uitgelekt. Start daarna de tv-app opnieuw om een nieuwe code te krijgen. Bibliotheekgegevens en kijkvoortgang blijven op de server staan.
