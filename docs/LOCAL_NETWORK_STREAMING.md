# Streamen binnen het thuisnetwerk

De beheerinterface blijft altijd op `127.0.0.1:8787`. Na expliciet inschakelen start dezelfde server een tweede listener op precies één gekozen RFC1918-adres en poort (standaard 8788). Middleware weigert daar alle routes behalve health, pairing, device-bibliotheek/-commands en signed playback/Cast-assets.

1. Kies in Instellingen > Netwerk een getoond privé-adres.
2. Schakel LAN-streaming in en sla op.
3. Herstart ThuisHub.
4. Open als administrator een PowerShell en voer `.\scripts\configure-private-streaming.ps1 enable -Port 8788` uit.

De firewallregel gebruikt alleen profiel **Private**, `LocalSubnet` en TCP op de gekozen poort. Met `disable` wordt uitsluitend de benoemde ThuisHub-regel verwijderd. Controleer vóór inschakelen dat Windows het thuisnetwerk als Privé ziet.

ThuisHub opent nooit routerpoorten en gebruikt geen UPnP-portforwarding. Externe toegang loopt alleen via Tailscale Serve op de lokale beheerpoort; gebruik geen Funnel. Tv's buiten het LAN moeten zelf veilig in hetzelfde Tailnet zitten of worden niet ondersteund.
