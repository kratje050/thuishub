# TVmaze

TVmaze is de primaire online provider voor series en afleveringen. ThuisHub gebruikt uitsluitend de [officiële publieke API](https://www.tvmaze.com/api), zonder account of API-key. Zoeken, seriegegevens, seizoenen, afleveringen, cast, crew en afbeeldingen lopen server-side met `ThuisHub/<versie>`, lokale cache, timeout, maximale responsegrootte en begrensde 429-back-off.

Bij gelijknamige resultaten kiest ThuisHub niet stil. Open **Metadata bewerken > Zoeken en koppelen** en controleer titel, jaar, taal, netwerk/streamingdienst en samenvatting. HTML uit samenvattingen wordt verwijderd.

De interface toont **Metadata voor series geleverd door TVmaze** en linkt resultaten naar hun TVmaze-pagina. TVmaze vermeldt CC BY-SA voor API-data; controleer de actuele voorwaarden via de officiële API-pagina bij distributie.
