# Back-ups en herstel

ThuisHub maakt standaard dagelijks een back-up in `%APPDATA%\ThuisHub\backups`. Dit is een ZIP met een consistente SQLite-snapshot en manifest; mediabestanden worden niet opgenomen. In het dashboard kun je dagelijks, wekelijks of uit kiezen, retentie en locatie instellen, handmatig maken, controleren en downloaden.

Bij terugzetten wordt de ZIP en database eerst gecontroleerd en een extra noodback-up gemaakt. De gekozen database wordt bij de volgende start toegepast, zodat geen geopende database wordt overschreven. Ook vóór herstelpogingen en bibliotheekherbouw wordt een veiligheidskopie gemaakt.

Bij een onverwachte afsluiting voert ThuisHub bij de volgende start automatisch een integriteitscontrole uit. Gebruik **Database en herstel** voor handmatige controle, export of het gecontroleerd terugzetten van de laatste werkende back-up. Bewaar belangrijke ZIP's ook op een ander fysiek station.
