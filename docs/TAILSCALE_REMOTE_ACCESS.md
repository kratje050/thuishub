# Privétoegang met Tailscale Serve

ThuisHub luistert alleen op `127.0.0.1:8787`. Tailscale Serve publiceert dit uitsluitend binnen je eigen tailnet. ThuisHub past deze beveiligingsinstelling nooit automatisch aan.

## Windows-server

1. Installeer Tailscale en meld je aan.
2. Start ThuisHub en controleer `http://localhost:8787`.
3. Open PowerShell en voer `tailscale serve --bg 8787` uit, of `scripts\tailscale-serve.ps1 enable`.
4. Bekijk de HTTPS-URL in **Dashboard → Externe toegang** of met het script `url`.
5. Uitschakelen: `scripts\tailscale-serve.ps1 disable` (dit voert `tailscale serve reset` uit).

Gebruik nooit `tailscale funnel` en stel geen router-port-forwarding in.

## Android, iPhone en iPad

Installeer de officiële Tailscale-app, meld je aan bij hetzelfde tailnet, schakel de VPN-verbinding in en open de getoonde `https://...ts.net`-URL in de browser. Je kunt ThuisHub daarna als PWA aan het startscherm toevoegen.

## Android TV en Apple TV

Installeer Tailscale uit de appstore van het apparaat, meld aan bij hetzelfde tailnet en gebruik een browser of geschikte webview/client voor de ThuisHub-URL. Apple TV ondersteunt Tailscale op tvOS. Beschikbaarheid van een volledige browser verschilt per televisietoestel.

## Controle

Controleer na inrichting dat ThuisHub direct opent en test film/muziek, ondertitels, downloads, hervatten en Live TV. ThuisHub gebruikt dezelfde HTTP-routes, byte ranges en HLS-transcodes via de HTTPS-proxy. WebSocket-upgrades worden door Tailscale Serve ondersteund; ThuisHub gebruikt voor status en voortgang hoofdzakelijk gewone HTTP-aanvragen. DVR-opnames blijven op de server-pc draaien.

Bij problemen controleer je achtereenvolgens: ThuisHub lokaal, Tailscale **Running**, beide apparaten in hetzelfde tailnet en `tailscale serve status --json` met een proxy naar `http://127.0.0.1:8787`.
