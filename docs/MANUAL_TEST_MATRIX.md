# Handmatige testmatrix 1.2.15

Geautomatiseerde tests kunnen protocolparsing, API-contracten, sessielogica en netwerkgrenzen bewijzen, maar niet de fysieke tv-, HDMI-, display-, audio- en firmware-uitvoer. De atomaire overdrachtslogica is automatisch getest; de volledige React-apparaatkiezer/spelerinteractie en browserspecifieke Google Cast SDK-flow hebben geen volledige componentautomatisering en blijven daarom handmatige UI- en hardwaretests. Er is nog geen volledige test op echte Chromecast-, Google TV-, Android TV-, Android-telefoon-, Samsung Tizen- of DLNA-hardware uitgevoerd.

Noteer per test minimaal: datum, ThuisHub-commit/build, Windows-versie, netwerkinterface en -profiel, tv/receiver/model, firmware, browser/appversie, mediafixture, verwachte uitkomst, werkelijke uitkomst en relevante logcategorie. Gebruik alleen tijdelijke testmedia en nooit productiegegevens voor muterende scenario's.

## Apparaten, discovery en koppelen

| Doel | Test | Verwacht | Status op dit ontwikkelmoment |
|---|---|---|---|
| Permanente apparaatknop | Open bibliotheek, detail, speler en mobiel formaat | knop blijft bereikbaar; status/actief doel verandert zonder paginafout | Nog visueel testen |
| Apparaatkiezer | Open zonder media en vanaf een film/aflevering | groepen **Mijn apparaten**, **Andere apparaten**, **Dit apparaat**; titel en juiste actie zichtbaar | Nog visueel testen |
| Vernieuwen | Schakel tv na openen in en kies **Apparaten opnieuw zoeken** | actieve scan zonder dubbele apparaten; UI blijft responsief | Nog op echt LAN testen |
| Lokale browser | Kies **Dit apparaat** in browser A, open een tweede tab/browser/telefoon B en laad daarna opnieuw | eigen receiver-ID per browservenster; centrale revisiegestuurde sessie, voortgang en hervatten; geen LAN-listener nodig | ID/API-/sessielogica gedekt; spelercomponent handmatig testen |
| Google Cast-kiezer | Kies **Google Cast**, selecteer en annuleer afzonderlijk | uitsluitend officiële Google-kiezer; annuleren start geen sessie | Geen Cast-hardwaretest uitgevoerd |
| Cast niet beschikbaar | Test onveilige origin, ontbrekende SDK, iPhone/iPad en netwerk zonder receiver | duidelijke afzonderlijke diagnose; geen nagebootste apparaatlijst | Nog per browser testen |
| ThuisHub Android TV-app | Start met werkende mDNS en zonder handmatig adres | `_thuishub._tcp.local` vindt en valideert juiste privé-server | APK gebouwd; echte hardware nog testen |
| Android geavanceerde fallback | Blokkeer DNS-SD en voer bewust correct/onjuist adres in | handmatig adres alleen in geavanceerde route; publieke/onbereikbare server geweigerd | Nog testen |
| ThuisHub Tizen-app | Start op ondersteunde en niet-ondersteunde DNS-SD-firmware | automatische detectie waar API bestaat; veilige geavanceerde fallback elders | SDK/certificaat/hardware vereist |
| Eerste koppeling | Vraag code aan en voer de code inline in de apparaatkiezer juist, fout en verlopen in | juiste code koppelt één apparaat; afspelen blijft tot dan geblokkeerd; foute/verlopen code lekt geen andere apparaten | Handmatig naast securitytests uitvoeren |
| Pairing rate limit | Herhaal request/claim snel vanaf één client | begrensde fout zonder serverinstabiliteit | Handmatig controleren |
| Pairing-capabilities | Stuur onbekende velden, zeer lange arrays/teksten en extreme getallen | alleen genormaliseerde bekende velden binnen vaste grenzen worden opgeslagen | Securitytests aanwezig; gekoppeld profiel visueel controleren |
| Stabiele identiteit | Herstart tv-app en server | hetzelfde vertrouwde apparaat komt terug; geen nieuw duplicaat | Nog op beide tv-apps testen |
| Apparaat vergeten | Vergeet een gekoppelde tv en probeer oud token/sessie opnieuw | token en sessies ingetrokken; opnieuw koppelen verplicht | Nog end-to-end testen |
| Verbinding verbreken | Verbreek alleen actieve playback | sessie stopt; gekoppelde apparaatregistratie blijft bewaard | Nog end-to-end testen |
| DLNA SSDP | Test één renderer, dubbele SSDP-responses en renderer in diepe slaap | één stabiele rij per UDN; status online/mogelijk offline/offline zonder direct verwijderen | Geen DLNA-hardwaretest uitgevoerd |
| Protocolduplicaat | Dezelfde fysieke tv via eigen app en DLNA | eigen gekoppelde app krijgt voorkeur; geen misleidende dubbele primaire rij | Nog op echte multimechanisme-tv testen |
| Netwerkverandering | Wissel gekozen adapter, slaap/hervat pc en herstart router | nieuwe scan, correcte interface, geen publieke/verdwenen interface gebruikt | Nog handmatig testen |

## Afspeelsessie en afstandsbediening

| Doel | Test | Verwacht | Status op dit ontwikkelmoment |
|---|---|---|---|
| Cast playback en bevestiging | Direct Play en HLS, hervatten vanaf positie, poster en WebVTT; laat `LOAD` slagen maar vertraag/weiger werkelijk afspelen | receiver haalt sessie-URL rechtstreeks op; juiste metadata en beginpositie; bron stopt pas nadat officiële SDK media geladen én `PLAYING` meldt | Geen Cast-hardwaretest uitgevoerd |
| Cast-controller | play/pause, ±30 s, absolute seek, volume, stop, verbreken | Google `RemotePlayer` blijft gelijk met centrale sessie | Geen Cast-hardwaretest uitgevoerd |
| Cast sessieherstel | Browser herladen en receiver tijdelijk verliezen | SDK herstelt waar ondersteund; geen tweede conflicterende sessie | Geen Cast-hardwaretest uitgevoerd |
| Android TV playback | laadopdracht, Media3/ExoPlayer, MediaSession, voortgang en reconnect | centrale sessie-URL/startpositie gebruikt; voortgang blijft oplopend | APK gebouwd; emulator/hardware nog testen |
| Tizen playback | laadopdracht, AVPlay, voortgang, WebSocket en pollingfallback | veilige sessie-URL; alleen werkelijk uitgevoerde opdracht geacknowledged | SDK/certificaat/hardware vereist |
| Native bibliotheekstart | Start een titel vanuit Android TV en Tizen en forceer daarna een receiverfout | server maakt een profiel- en devicegebonden centrale sessie; `playing` wordt bevestigd; fout stopt sessie en grants | Route- en sessielogica automatisch gedekt; hardware nog testen |
| DLNA bediening | Play, Pause, Stop, `REL_TIME` Seek, positie/status en volume | alleen ondersteunde SOAP-acties; duidelijke fout/fallback bij onbetrouwbare renderer | Geen DLNA-hardwaretest uitgevoerd |
| Overplaatsen | Verplaats actieve sessie lokaal → tv, tv → lokale browser en tussen twee netwerkdoelen | nieuwe sessie start bij actuele positie; bronsessie en grants vervallen pas na werkelijk `playing`; verifieer bij Cast→Cast afzonderlijk dat Chrome de oude fysieke receiver beëindigt | Serversessielogica automatisch gedekt; Cast→Cast fysiek gedrag nog testen |
| Overdracht terugrollen | Laat het nieuwe doel weigeren, verbreken of 45 seconden niet bevestigen | alleen mislukte bestemming en grants stoppen; oorspronkelijke serversessie blijft actief en verschijnt opnieuw; controleer bij dezelfde Cast-receiver ook fysiek bufferherstel na een al geaccepteerde `LOAD` | Timeout/fout/herhaalde overdracht automatisch gedekt; fysiek Cast-bufferherstel nog testen |
| Receiverstatus | Meld met actuele/verouderde revisie `playing` en `error` voor Cast/lokale browser en probeer hetzelfde endpoint voor een native tv | actuele webreceiverstatus finaliseert of rolt terug; stale revisie wordt geweigerd; native tv gebruikt zijn devicekanaal | API-contract automatisch gedekt; browserinteractie handmatig testen |
| Gelijktijdige bediening | Bedien dezelfde sessie snel vanuit twee browservensters/tv-statusupdates | verouderde revisie schrijft niet over nieuwere status; UI herlaadt actuele sessie | Nog handmatig testen |
| Telefoon als afstandsbediening | Start lokaal of Cast in browser A; stuur play/pause, seek, volume en stop vanuit browser/telefoon B | centraal commando bereikt via controller-WebSocket alleen de browser met de bijbehorende receiver; polling neemt over na socketverlies | Servercontract en origincontrole gedekt; echte twee-apparatentest uitvoeren |
| Kortlevende grants | Laat signed link verlopen tijdens actieve en daarna gestopte sessie | actief gebruik kan begrensd glijden; stop/intrekking maakt link direct onbruikbaar | Handmatig naast tokentests uitvoeren |
| Grantvernieuwing | Probeer een geldig token te vernieuwen voor dezelfde en voor een andere sessie/gebruiker | alleen exact dezelfde actieve sessie en gebruiker krijgt een vervangend token | Tokentests aanwezig; handmatige netwerkcontrole optioneel |
| Commandovolgorde | Lever opdrachten vertraagd/dubbel/verlopen aan tv-app | alleen actuele opdracht uitgevoerd; oude sequence/expiry geweigerd | Nog met netwerkvertraging testen |
| Volgende/vorige | Speel een aflevering en kies volgende/vorige op ieder doel dat de actie aanbiedt | juiste aangrenzende aflevering start met nieuwe actuele sessiestatus; ontbrekend/ongeschikt doel toont geen misleidende actie | Sessieroutes gedekt; echte receiver en UI nog testen |
| Kwaliteit wisselen | Wissel tijdens afspelen tussen Automatisch en vaste kwaliteit op ieder doel dat dit ondersteunt | dezelfde titel en positie blijven behouden; nieuwe decision wordt atomair actief; unsupported doel biedt de actie niet | Beslis-/sessielogica gedekt; receiverbuffering nog testen |
| Audiotrack | Gebruik een bestand met meerdere audiotracks op Cast, Android TV, Tizen en DLNA | huidige ontwikkelcode claimt geen werkende trackkeuze waar deze nog niet is aangesloten; geen stille verkeerde-trackclaim | Niet end-to-end aangesloten; hardwaretest na implementatie vereist |
| Ondertitels | Schakel externe WebVTT op Cast aan/uit en probeer dezelfde bron op Android TV, Tizen en DLNA | Cast volgt de gekozen WebVTT-track; native testapps tonen eerlijk dat externe trackselectie nog niet is aangesloten; DLNA blijft fabrikantafhankelijk | Cast en alle echte receivers nog handmatig testen |

## Netwerk- en beveiligingsgrenzen

| Doel | Test | Verwacht | Status op dit ontwikkelmoment |
|---|---|---|---|
| Gekozen LAN-interface | bind op actief privé-adres en daarna op verdwenen/publiek adres | alleen exact actief RFC1918-adres luistert; anders fail-closed | Softwarematig gedekt; na herstart handmatig controleren |
| Zelfde subnet | roep LAN-poort aan vanaf zelfde subnet, ander lokaal subnet en vervalste `Host`/forwarded headers | alleen echt remote socketadres op geselecteerd subnet toegestaan | Softwarematig gedekt; netwerksegmenttest nodig |
| Route-allowlist | probeer health/playback/pairing én instellingen/users/back-ups/updates op 8788 | alleen exact toegestane methode/routes; beheer geeft 403 | Softwarematig gedekt; handmatig smoke-testen |
| WebSocket-origin | Open controller-WebSocket met juiste localhost/Tailscale Serve-origin, ontbrekende origin en vreemde website-origin; test tv-kanaal zonder token | alleen passende beheerorigin opent controllerkanaal; tv-kanaal vereist geldig device-token | Origin- en authenticatietests aanwezig; proxytest handmatig uitvoeren |
| Range/HEAD/OPTIONS | vraag delen, suffixrange, ongeldige range, HEAD en preflight op | correcte 206/416/headers; geen body bij HEAD; beperkte CORS | Automatische playbacktests; echte receiver nog testen |
| Firewallscript | enable/disable op Private en Public profiel, juist en verkeerd adres | alleen benoemde Private/LocalSubnet-regels voor exact adres en poorten; onveilige invoer geweigerd | Administrator-test op wegwerpomgeving nodig |
| Alleen-lezen diagnose | voer dashboarddiagnose en script met/zonder `-Json` uit | interface/listener/firewall/mDNS/SSDP gerapporteerd; geen wijziging en geen tokens | Nog op Windows-installatie uitvoeren |
| SSDP/XML-beveiliging | test renderer met publieke/localhost/redirect-URL, te grote response en `DOCTYPE`/`ENTITY` | renderer geweigerd; geen uitgaand verzoek naar onveilige bestemming | Automatisch gedekt; gecontroleerde labtest optioneel |
| DLNA-statuspolling | Observeer verkeer tijdens afspelen en slaap/hervat van renderer | begrensde `GetPositionInfo`/`GetTransportInfo`-polling; geen `SUBSCRIBE`-claim voor AVTransport/RenderingControl; `NOTIFY` alleen voor device-lifecycle | Implementatie gedekt; netwerkcapture op echte renderer nodig |
| Geen routeropening | inspecteer router, firewall en logs na discovery | geen IGD/WANIPConnection, portforwarding of Funnel | Handmatig netwerkcontrole uitvoeren |

## Media-, display- en audiomatrix

| Doel | Test | Verwacht | Status op dit ontwikkelmoment |
|---|---|---|---|
| Android-telefoon/PWA | direct openen, afspelen, Cast-controller | geen inlogscherm, signed stream, voortgang, bediening | Nog handmatig testen |
| Chromecast | kiezen, Direct Play/HLS, Range/CORS, hervatten | tv haalt URL rechtstreeks op | Geen Cast-hardwaretest uitgevoerd |
| Google TV | H.264/HEVC, tracks, HDR | juiste decision/badge | Geen hardwaretest uitgevoerd |
| Samsung-tv | WGT pairing/AVPlay/remote | HDR-capabilities correct, geen Dolby Vision-claim | SDK/certificaat/hardware vereist |
| Mobiele verbinding | automatisch/2–8 Mbps | passend profiel, stabiele buffer | Nog handmatig testen |
| 1080p H.264/AAC | Direct Play | geen transcode | Beslisengine automatisch gedekt; doelfixture nodig |
| 4K HEVC Main10 HDR10/HLG | Direct/fallback | correcte 10-bit/HDR-indicatie | Logica gedekt; displaytest nodig |
| HDR10+ | basislaag/fallback | geen nep-HDR | Logica gedekt; displaytest nodig |
| Dolby Vision P5/P7/P8 | ondersteund/basislaag/SDR | correcte profiel/fallback | Logica gedekt; gelicenseerde hardwarefixture nodig |
| E-AC-3 Atmos | passthroughketen | Atmos behouden of waarschuwing | Logica gedekt; receiverdisplay nodig |
| TrueHD 7.1/Atmos | eARC versus ARC | alleen eARC passthrough | Logica gedekt; HDMI-test nodig |
| DTS/DTS-HD/DTS:X | capability aan/uit | passthrough of audiotranscode | Logica gedekt; receivertest nodig |
| SRT/WebVTT/ASS/PGS/forced | direct of burn-in | waarschuwing bij video-transcode | Logica gedekt; fixturetest nodig |
| 80+ Mbps | LAN Direct Play | geen onnodige transcode/buffer | Snelle gigabit-LAN-test nodig |

## Metadata- en migratieregressie

| Doel | Test | Verwacht | Status op dit ontwikkelmoment |
|---|---|---|---|
| TVmaze serie | exacte serie, seizoenen, specials en aflevering | unieke match toegepast, dubbelzinnige match naar controle | Softwaretests; visueel controleren |
| OMDb film | geldige/ongeldige key, geen key en lokale daglimiet | key nooit zichtbaar; duidelijke fout/fallback | Softwaretests aanwezig |
| Lokale NFO | movie/tvshow/episode, beschadigde XML, padtraversal | geldige velden toegepast; fout beperkt tot bestand | Softwaretests aanwezig |
| Metadata offline | netwerk uit, cache gevuld/leeg | cache of lokale fallback; bibliotheek blijft bruikbaar | Handmatig netwerk uitschakelen |
| Afbeeldingscache | JPEG/PNG/WebP, SVG, privé-IP en redirect | alleen veilige rasterafbeelding lokaal aangeboden | Softwaretests aanwezig |
| Handmatige veldlock | handmatig aanpassen en provider verversen | waarde blijft behouden; historie kan herstellen | Softwaretests aanwezig |
| Leeftijd onbekend | beperkt profiel en ontbrekende classificatie | niet automatisch als AL tonen | Softwarelogica aanwezig |
| Legacy-migratie | kopie van oudere database met provider-ID/key | back-up eerst, data behouden, sleutel weg, nul oude requests | Softwaretests aanwezig |

Controleer vóór en na een volledige installatieproef `PRAGMA quick_check`, `PRAGMA integrity_check`, aantallen gebruikers/media/voortgang/Live TV/DVR en de meest recente back-up. Markeer een rij pas als geslaagd wanneer de verwachte uitkomst op het genoemde echte apparaat en de genoemde firmware aantoonbaar is behaald.
