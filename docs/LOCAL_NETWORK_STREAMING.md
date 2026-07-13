# Streamen binnen het thuisnetwerk

De volledige beheerinterface blijft op `127.0.0.1:8787`. Na expliciet inschakelen start ThuisHub een tweede, beperkte listener op exact één gekozen RFC1918-adres en poort (standaard 8788). Dit adres levert media aan Cast-, DLNA- en eigen ThuisHub TV-apps en wordt ook via `_thuishub._tcp.local` aan de eigen apps bekendgemaakt.

## Instellen

1. Kies bij Instellingen > Netwerk een actief privé-LAN-adres dat bij het gewenste thuisnetwerk hoort.
2. Schakel **Streamen binnen thuisnetwerk** en desgewenst **Automatisch apparaten zoeken** en **DLNA en smart-tv's zoeken** in.
3. Sla op en herstart ThuisHub, zodat de listener en mDNS-advertentie aan het gekozen adres kunnen binden.
4. Open PowerShell als administrator en maak de strikt begrensde firewallregels:

```powershell
.\scripts\configure-private-streaming.ps1 -Action enable -Address 192.168.1.10 -Port 8788
```

Gebruik exact het adres en de poort die in ThuisHub zijn ingesteld. Het script weigert een publiek/niet-toegewezen adres en een adapter waarvan het Windows-netwerkprofiel niet **Privé** is.

## Wat de firewallopdracht doet

De opdracht vervangt uitsluitend de benoemde regelgroep **ThuisHub Private LAN** en maakt drie inkomende regels:

| Protocol | Lokale poort | Lokale scope | Externe scope | Windows-profiel |
|---|---:|---|---|---|
| TCP | gekozen streamingpoort | exact gekozen adres | `LocalSubnet` | `Private` |
| UDP/SSDP | 1900 | exact gekozen adres | `LocalSubnet` | `Private` |
| UDP/mDNS | 5353 | exact gekozen adres | `LocalSubnet` | `Private` |

Regels verwijderen zonder andere firewallinstellingen te wijzigen:

```powershell
.\scripts\configure-private-streaming.ps1 -Action disable
```

ThuisHub wijzigt de Windows Firewall nooit automatisch. Het script maakt geen routerregel, geen UPnP-portforwarding, geen publieke scope en geen Tailscale Funnel.

## Fail-closed toegangsmodel

De LAN-listener controleert zowel de lokale doelpoort als het echte remote socketadres. Alleen een privé-IPv4-client in hetzelfde subnet als de gekozen interface wordt toegelaten. De `Host`-header kan deze controle niet verruimen.

Daarna geldt een exacte combinatie van methode en route. Toegestaan zijn alleen:

- health en de beperkte discoverybeschrijving;
- het aanvragen/claimen van een tv-koppeling;
- bibliotheek-, playbackdecision-, voortgangs- en commandroutes met een geldig beperkt device-token;
- sessiegebonden signed media-, HLS-, ondertitel-, download- en artworkroutes;
- de benodigde Cast-/brandassets en het webmanifest.

Beheerinstellingen, gebruikers, bibliotheekbronnen, back-ups, logs, updates en pairing-goedkeuring zijn niet bereikbaar via de LAN-poort. Zonder actief gekozen adres en luisterende server geeft de playbacklaag geen LAN-basis-URL uit; Cast/DLNA/tv-app-playback faalt dan gesloten in plaats van een localhost-, bestandspad- of publieke URL te lekken.

Signed playbacklinks zijn gebonden aan media, resource, gebruiker, apparaat en waar van toepassing de centrale sessie. Ze zijn kortlevend; vernieuwing accepteert alleen een token voor exact dezelfde actieve sessie én gebruiker. Ze worden ongeldig bij sessiebeëindiging of intrekking. Playbackresponses gebruiken `no-store`, beperkte CORS en ondersteuning voor Range/HEAD/OPTIONS waar de ontvanger die nodig heeft.

De browsercontroller-WebSocket is alleen beschikbaar op de beheerlistener en controleert dat `Origin` en `Host` overeenkomen met de lokale beheerorigin of een geldige HTTPS-origin van Tailscale Serve. De tv-app-WebSocket is een afzonderlijk LAN-kanaal en vereist het beperkte device-token.

## Discovery op dezelfde interface

- De server adverteert zichzelf voor de eigen Android TV/Google TV- en Tizen-apps als `_thuishub._tcp.local` op het gekozen adres, maar alleen zolang de begrensde LAN-listener daar werkelijk luistert. Bij een listenerfout of sluiting stopt de advertentie.
- DLNA gebruikt SSDP M-SEARCH en NOTIFY uitsluitend voor lokale `MediaRenderer`-, `AVTransport`- en `RenderingControl`-diensten.
- Een technische `_googlecast._tcp.local`-probe controleert hooguit multicastzichtbaarheid. De officiële Google Cast Web Sender SDK en apparaatkiezer blijven verantwoordelijk voor echte Cast-selectie.
- Automatische discovery start bij serverstart, netwerkverandering, hervatten en openen/vernieuwen van de apparaatkiezer. Eén gemist antwoord markeert een eerder gezien apparaat niet direct als definitief offline.

Multicast werkt doorgaans niet over routed netwerken, internet, Tailscale Serve of wifi-gastnetwerken met AP-isolatie. Een handmatig serveradres in de eigen tv-app is alleen een geavanceerde terugvaloptie wanneer DNS-SD op het tv-platform ontbreekt.

## Diagnose zonder wijzigingen

Controleer listener, Windows-profiel, firewallscopes, mDNS en SSDP met:

```powershell
.\scripts\diagnose-tv-discovery.ps1 -Address 192.168.1.10 -Port 8788
```

Gebruik `-Json` voor machineleesbare uitvoer. Het diagnosescript is alleen-lezen: het maakt of verwijdert geen firewallregels, wijzigt geen netwerkadapter of router en toont geen playbacktokens. Het dashboard biedt dezelfde diagnose via **TV en afspeelapparaten**.

Zie [automatische apparaatdetectie](AUTOMATIC_DEVICE_DISCOVERY.md), [DLNA/UPnP](DLNA_UPNP.md), [tv-app koppelen](TV_PAIRING.md) en [problemen met tv-detectie](TV_DISCOVERY_TROUBLESHOOTING.md).

## Externe toegang

Externe toegang tot de beheerinterface loopt afzonderlijk via Tailscale Serve op de lokale beheerpoort. Gebruik geen router-port-forwarding en geen Tailscale Funnel. Tv-discovery via mDNS/SSDP is uitsluitend bedoeld voor hetzelfde lokale thuisnetwerk.
