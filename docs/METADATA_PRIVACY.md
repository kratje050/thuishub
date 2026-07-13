# Metadata en privacy

Alle providerverzoeken lopen via de lokale ThuisHub-server. Alleen noodzakelijke zoektitel, jaar of externe ID wordt verzonden. Mediabestanden, NFO-inhoud, gebruikersnamen, kijkgeschiedenis, lokale paden en Tailscale-adressen worden niet naar providers gestuurd.

OMDb-geheimen blijven lokaal en worden uit logs/URLs geredigeerd. Providerresponses hebben een maximale grootte en externe tekst wordt gesanitized. Afbeeldingen, inclusief miniaturen in handmatige zoekresultaten, worden niet rechtstreeks door de browser bij een provider geladen: de server valideert en cachet ze, waarna de browser een lokale `/api/metadata/images/...`-URL gebruikt. Zoekminiaturen worden niet automatisch als bibliotheekposter geselecteerd.

De cache kan bij **Instellingen > Metadata** worden gewist. Handmatig gekozen afbeeldingen worden daarbij behouden; verwijder die bewust in de metadata-editor.
