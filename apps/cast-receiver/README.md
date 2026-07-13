# ThuisHub Custom Cast Receiver

Deze map bevat de optionele, zelfstandige ThuisHub Web Receiver op basis van het officiële Google Cast Application Framework (CAF). De normale ThuisHub-gebruiker hoeft deze receiver niet te registreren: zonder ontwikkelaarsconfiguratie gebruikt de sender automatisch Google’s Default Media Receiver.

## Registreren voor ontwikkeling

1. Publiceer `index.html`, `receiver.js` en `receiver.css` via een publiek bereikbare HTTPS-host. Publiceer ook de bestaande map `public/brand` op `/brand`.
2. Open de Google Cast SDK Developer Console en registreer een **Custom Receiver** met de HTTPS-URL van `index.html`.
3. Voeg de test-Chromecast toe als testapparaat en wacht totdat de registratie is verwerkt.
4. Plaats de verkregen Receiver Application ID uitsluitend in ThuisHub onder de geavanceerde ontwikkelaarsinstellingen of in de ontwikkelaarsbuild.
5. Laat de instelling leeg voor normale gebruikers en voor tests met de Default Media Receiver.

De receiver accepteert alleen LOAD/QUEUE_LOAD-media met `customData.source === "ThuisHub"` en een privé-LAN-playback-URL. De receiver-ID is geen geheim, maar hoort niet als verplichte gebruikersinstelling te worden gevraagd.

## Aanwezige receiverbasis

- branded laad- en afspeelscherm;
- titel, aflevering, poster en achtergrond;
- voortgang en afspeelstatus;
- audio- en ondertiteltrackinformatie;
- wachtrij/autoplay-indicatie;
- Live TV-aanduiding;
- technische Direct Play/HDR/audio-informatie;
- CAF-sessieherstel en duidelijke receiverfouten.

De huidige websender stuurt nog geen volledige wachtrij-, Live TV-, audiotrack- of HDR-capabilitypayload. De regels hierboven beschrijven de aanwezige receiverweergave en interceptiehooks, niet dat iedere functie end-to-end af is. Echte codec-, HDR-, track- en sessiehersteltests moeten op geregistreerde Cast-hardware worden uitgevoerd.
