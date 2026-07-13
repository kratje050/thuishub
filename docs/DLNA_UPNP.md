# DLNA en UPnP MediaRenderers

DLNA is de lokale fallback voor televisies en mediaspelers zonder Google Cast of eigen ThuisHub-app. ThuisHub gebruikt UPnP uitsluitend om een `MediaRenderer` op hetzelfde privénetwerk te vinden en te bedienen.

## Zoeken

De server verstuurt SSDP M-SEARCH via het in Instellingen gekozen privé-LAN-adres naar `239.255.255.250:1900` voor:

- `urn:schemas-upnp-org:device:MediaRenderer:1`;
- `urn:schemas-upnp-org:service:AVTransport:1`;
- `urn:schemas-upnp-org:service:RenderingControl:1`.

Een device-description wordt alleen geaccepteerd wanneer het werkelijk een MediaRenderer met een veilige AVTransport-control-URL bevat. UDN is de primaire stabiele DLNA-identiteit. Dubbele antwoorden voor hetzelfde UDN worden samengevoegd.

ThuisHub zoekt nooit `InternetGatewayDevice`, `WANIPConnection` of routerservices en vraagt nooit om portforwarding.

## Bediening

De DLNA-controller ondersteunt:

- `SetAVTransportURI` en `Play`;
- `Pause` en `Stop`;
- `Seek` met `REL_TIME`;
- `GetPositionInfo` en `GetTransportInfo`;
- `SetVolume` wanneer `RenderingControl` aanwezig is.

De tv haalt de media rechtstreeks op via een tijdelijke signed URL op de LAN-streamingpoort. Een publieke URL, localhost-URL of Windows-bestandspad wordt niet naar een renderer gestuurd. Container-, codec-, HDR-, audio- en ondertitelcapaciteiten verschillen sterk per fabrikant; onbekende renderers moeten daarom conservatieve Direct Play-profielen gebruiken.

Een succesvolle SOAP-reactie op `Play` betekent alleen dat de opdracht is aangenomen. ThuisHub pollt daarna maximaal kort en begrensd `GetTransportInfo`; pas de werkelijke status `PLAYING` bevestigt een overdracht. `STOPPED`, `NO_MEDIA_PRESENT`, een statusfout of timeout stopt uitsluitend de nieuwe bestemming en laat de bron actief.

## Beperkingen

DLNA-implementaties verschillen per model. Sommige apparaten melden `Seek` of `Pause` maar voeren dit niet betrouwbaar uit, ondersteunen alleen bepaalde MIME-types of vereisen specifieke DIDL-Lite-metadata. AVTransport-/RenderingControl-eventing via `SUBSCRIBE` is bewust nog niet geïmplementeerd; status en positie worden rustig gepolld. SSDP `NOTIFY` wordt uitsluitend gebruikt voor het online/offline volgen van apparaten en is geen afspeelstatus-eventing. Test Play, Pause, Stop, Seek, volume, voortgang en codecprofielen altijd op echte hardware.

Discovery werkt niet over internet of Tailscale-multicast. Televisie en server moeten op hetzelfde thuisnetwerk zitten en wifi-AP-isolatie moet uitstaan.
