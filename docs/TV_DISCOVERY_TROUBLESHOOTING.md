# Problemen met tv-detectie oplossen

## Geen apparaten gevonden

Controleer eerst:

1. Server, telefoon en televisie gebruiken hetzelfde thuisnetwerk.
2. Wifi staat aan en gastnetwerk/AP-isolatie is uitgeschakeld.
3. Het gekozen Windows-netwerkprofiel is **Privé**.
4. **Streamen binnen thuisnetwerk** gebruikt het actieve privé-LAN-adres.
5. De tv of mediaspeler is ingeschakeld en niet in diepe slaap.
6. Windows Firewall bevat uitsluitend de begrensde ThuisHub-regels voor TCP 8788, UDP 1900 en UDP 5353.

Maak de firewallregels bewust als administrator:

```powershell
.\scripts\configure-private-streaming.ps1 enable -Address 192.168.1.10 -Port 8788
```

Gebruik het adres dat ThuisHub in Instellingen toont. Het script weigert publieke adressen en een Windows-profiel dat niet Privé is.

## Automatische diagnose

De alleen-lezen diagnose wijzigt geen firewall, adapter of router:

```powershell
.\scripts\diagnose-tv-discovery.ps1 -Address 192.168.1.10 -Port 8788
```

Voor machineleesbare uitvoer gebruikt u `-Json`. Het rapport controleert adapter/profiel, TCP-listener, playback-health, exacte firewallscopes, `_googlecast._tcp.local` en SSDP MediaRenderer-antwoorden. Er worden geen signed playback-URL's of tokens opgenomen.

Geen SSDP-antwoord bewijst op zichzelf niet dat multicast wordt geblokkeerd: er kan eenvoudig geen DLNA-renderer online zijn.

## Google Cast

Google Cast vereist een browser waarin `window.chrome`, `chrome.cast` en `cast.framework` werkelijk beschikbaar zijn. Gebruik op Windows of Android bij voorkeur Google Chrome. Chrome op iPhone/iPad biedt geen Web Sender-casting. Localhost is geschikt voor ontwikkeling; een andere browserorigin moet een geldige beveiligde context zijn. De officiële Cast-kiezer bepaalt welke Cast-apparaten beschikbaar zijn.

## Samsung-tv

Een Samsung-tv zonder officiële Google Cast-ondersteuning verschijnt niet als Chromecast. Zoek hem als DLNA MediaRenderer of installeer de ThuisHub Tizen-app. Gebruik geen Samsung-cloudcredentials.

## Veiligheidsgrenzen

Open geen routerpoorten, schakel geen UPnP-portforwarding in en gebruik geen Tailscale Funnel. Externe toegang via Tailscale Serve staat los van lokale tv-discovery.
