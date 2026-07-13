# Google Cast

ThuisHub laadt de officiële Cast Web Sender SDK in Chrome/Edge. **Afspelen op tv** opent de apparaatkiezer, vraagt de centrale playbackbeslissing aan en stuurt een kortlevende signed URL naar de ontvanger. De Cast-sessie leest dus rechtstreeks van ThuisHub.

## Standaardreceiver

Laat **Google Cast Receiver App ID** leeg om Google's Default Media Receiver te gebruiken. Dit werkt zonder eigen receiverregistratie, maar toont geen volledige ThuisHub-layout.

## Eigen Web Receiver

De bron staat in `public/cast/receiver.html`, `receiver.js` en `receiver.css`. Registreer de gehoste HTTPS-URL in de [Google Cast Developer Console](https://cast.google.com/publish/), voeg testapparaten toe en vul het verkregen hexadecimale App ID bij Instellingen in. De receiver controleert `customData.source`, toont ThuisHub-branding en gebruikt de Cast Media Player Library.

De streaminglistener ondersteunt Range, HEAD, OPTIONS en beperkte CORS. Toegestaan zijn dezelfde host, expliciet ingestelde receiver-origins en Google-hosting voor Cast receivers. Er wordt nooit `Access-Control-Allow-Origin: *` op authenticated beheer-API's gezet.

Zie de officiële [Web Receiver-documentatie](https://developers.google.com/cast/docs/web_receiver) en [Web Sender-documentatie](https://developers.google.com/cast/docs/web_sender/advanced). Werkelijke codec/HDR/Atmos-ondersteuning verschilt per Chromecast/Google TV-model en moet op hardware worden gecontroleerd.
