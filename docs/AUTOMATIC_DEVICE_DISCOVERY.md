# Automatische apparaatdetectie

ThuisHub verzamelt afspeeldoelen in één provider-onafhankelijke apparaatlaag. Een gewone gebruiker hoeft geen televisie-IP-adres te kennen. De gekozen privé-LAN-interface begrenst alle lokale discovery en mediastraming.

## Discoveryprotocollen

- Google Cast gebruikt in een ondersteunde Chromium-browser uitsluitend de officiële Google Cast Web Sender SDK. De officiële Cast-kiezer blijft verantwoordelijk voor het kiezen van een Cast-apparaat.
- DLNA/UPnP gebruikt server-side SSDP M-SEARCH voor `MediaRenderer`, `AVTransport` en `RenderingControl`.
- De server adverteert `_thuishub._tcp.local` uitsluitend terwijl de begrensde LAN-listener daadwerkelijk op het gekozen adres en de gekozen poort luistert; de eigen ThuisHub TV-app vindt en valideert die lokale server, meldt zichzelf daarna via de beperkte pairing-API aan en komt na de eerste zescijferige koppeling als vertrouwd apparaat terug.
- De huidige browser of Windows-app verschijnt als lokaal afspeeldoel zonder netwerkdiscovery.

Een Samsung-tv wordt alleen als Google Cast-apparaat getoond wanneer de officiële Cast SDK dat werkelijk meldt. Andere Samsung-tv's kunnen via DLNA of de ThuisHub Tizen-app verschijnen. ThuisHub gebruikt geen Samsung-cloudaccount.

## Netwerkgrenzen

SSDP- en mDNS-verkeer bindt aan het gekozen RFC1918-adres. Een SSDP-bron, `LOCATION`, apparaatbeschrijving en DLNA-control-URL moeten daarnaast binnen hetzelfde IPv4-subnet van die interface vallen. ThuisHub zoekt nooit UPnP Internet Gateway Devices en maakt geen router-portforwarding. Tailscale Serve blijft een afzonderlijke manier om de beheerinterface te bereiken en wordt niet gebruikt voor LAN-multicast. Gebruik geen Tailscale Funnel.

Discovery draait rustig op de achtergrond en kan actief worden gestart wanneer de apparaatkiezer opent. Bij een gewijzigde netwerkadapter en na hervatten uit slaap worden de lokale mDNS- en SSDP-diensten opnieuw aan de gekozen interface gebonden. Een gemist antwoord maakt een apparaat niet direct definitief offline. De registry onderscheidt online, mogelijk offline en offline en bewaart `lastSeen`.

Een geldig, veilig antwoord geldt als multicastbewijs. Als geen Cast- of DLNA-apparaat antwoordt, blijft de multicaststatus **onbekend**: afwezigheid van een apparaat bewijst niet dat het netwerk multicast blokkeert.

## Veilig verwerken

SSDP-antwoorden en apparaat-XML zijn onbetrouwbare invoer. ThuisHub:

- accepteert alleen antwoorden vanaf privé IPv4-adressen;
- eist dat `LOCATION` en control-URL naar het antwoordende apparaat verwijzen;
- weigert localhost, publieke adressen, credentials en redirects;
- begrenst tijd en responsegrootte;
- weigert XML met `DOCTYPE` of `ENTITY` en verwerkt geen XML-entities;
- slaat geen volledige MAC-adressen op en toont geen IP-adressen in de gewone apparaatkiezer.

Voer bij problemen `scripts\diagnose-tv-discovery.ps1 -Address <LAN-adres>` uit. Het script is alleen-lezen en toont geen playbacktokens.
