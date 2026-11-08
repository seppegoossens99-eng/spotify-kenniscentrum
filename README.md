# Spotify Kenniscentrum

Leer de artiest achter het nummer kennen, alleen wanneer je daar zin in hebt. Een statische Nederlandstalige website voor GitHub Pages, met Spotify OAuth PKCE en aanvullende gegevens uit Wikidata en MusicBrainz. Geen backend, Client Secret of voortdurend draaiende taak nodig.

## Gebruik

1. Publiceer `index.html`, `style.css`, `app.js` en de map `data/` samen via GitHub Pages of een andere HTTPS-host.
2. Maak een app in het [Spotify Developer Dashboard](https://developer.spotify.com/dashboard). Registreer de **exacte Redirect URI** die de website toont.
3. Vul de **Client ID** in op de website en verbind met Spotify. Gebruik nooit de Client Secret. Je account moet toegang hebben tot de app; Spotify stelt aanvullende eisen en beperkingen aan apps in Development Mode.
4. Speel een muzieknummer af in Spotify. Kies **Huidig nummer ophalen** voor één nummer, of **Kennismodus starten** om nummerwissels te volgen.
5. Kies **Kennismodus stoppen** om weer gewoon te luisteren. Een verbinding alleen start geen controles. Elke nieuwe paginalading begint met de modus uit.

Met **Bekijk een fictief voorbeeld** kun je het kader en de bandleden zonder account bekijken. Alle voorbeeldgegevens zijn verzonnen en worden duidelijk zo aangeduid.

## Het artiestenkader

De zes vakken zijn direct zichtbaar per artiest; biografieën en bandleden staan in het uitklapbare gedeelte eronder. Beschikbare foto's komen uit Spotify of Wikimedia Commons via Wikidata. De bronlinks verwijzen naar aanvullende gegevens en fotolicenties.

| Vak | Betekenis en bron |
| --- | --- |
| Debut | Het opgeslagen debuutjaar uit de Billboard-/Ultratop-projecten heeft voorrang, ook als een oudere single bekend is. Voor overige artiesten: vroegste gevonden studioalbum, single of EP in MusicBrainz. Live-uitgaven, compilaties en remixes tellen daar niet mee. Daarnaast wordt de eigen Spotify-discografie opgehaald (albums/singles, geen compilaties of uitgaven van andere artiesten). De vroegste bronuitgave bepaalt het getoonde jaar. Een Spotify-schatting of gedeeltelijke inventarisatie is gemarkeerd met ≈. Als alleen de huidige eigen albumuitgave bekend is, betekent ≤ dat het debuut uiterlijk in dat jaar plaatsvond, niet dat het exacte debuut bevestigd is. Maximaal 500 releasegroepen of Spotify-uitgaven per artiest; geen garantie op het historische debuut. |
| Members | Opgeslagen type/aantal leden uit het chartprofiel; anders solo of het aantal bekende huidige leden volgens Wikidata. Ontbrekende einddatums betekenen niet dat een bron actueel is. |
| Popularity | Spotify-score tussen 0 en 100, als die beschikbaar is voor jouw app. **Geen Spotle-rangschikking.** |
| Gender | Opgeslagen chartwaarde, anders Wikidata. Bij bands alleen weergegeven als de bron voor alle bekende huidige leden een waarde bevat. |
| Genre | Het opgeslagen chartgenre; anders het eerste Spotify-genre; anders Wikidata of het meest gestemde MusicBrainz-genre. |
| Country | Opgeslagen chartherkomst, anders Wikidata-nationaliteit of herkomst, anders MusicBrainz. |

Dit zijn **geen officiële Spotle-antwoorden**. Het spel kan andere definities en eigen gegevens gebruiken. Onbekende of niet eenduidig gevonden gegevens blijven onbekend; er zijn geen verzonnen populariteitscijfers. Bronprofielen uit de eigen chartprojecten worden met hun oorspronkelijke bronlinks hergebruikt. Naamgenoten worden niet willekeurig samengevoegd; Spotify-identificaties in de bron worden gecontroleerd waar beschikbaar. Een via Spotify geverifieerde Wikidata-koppeling naar MusicBrainz wordt rechtstreeks gebruikt, zodat uitval van de naamzoekdienst het debuut niet onnodig blokkeert. Tijdelijke MusicBrainz-fouten (429/503) worden één keer opnieuw geprobeerd als de opgegeven wachttijd maximaal tien seconden is.

Per bandlid worden naam, lidmaatschap, instrumenten, geboortedatum, leeftijd, geboorteplaats, land en foto getoond waar de bron die bevat. Voor overleden personen wordt geen huidige leeftijd berekend. De Spotify-releasedatum is die van de specifieke albumuitgave. Een ISRC-zoekopdracht zoekt daarnaast naar de vroegste gevonden officiële uitgave van dezelfde opname, niet van de oorspronkelijke compositie. De WhoSampled-link is een zoeklink; samples worden niet automatisch bevestigd.

## Gedeelde artiestenprofielen uit de chartprojecten

`data/artist-references.json` bevat 123 profielen uit `billboard-hot-100-reversed` en `ultratop-50-reversed`. Per profiel zijn de oorspronkelijke bronlinks en de exacte Git-commits bewaard. Het bestand hoort bij de website en moet dus samen met HTML/CSS/JavaScript worden gepubliceerd. Er zijn geen externe credentials of processen nodig om deze opgeslagen gegevens te tonen.

De keuze van de eigenaar is leidend: **hetzelfde opgeslagen debuutjaar als in de andere projecten**. Zach Top toont daarom 2024 (bron: *Cold Beer & Country Music*). Een automatisch gevonden oudere uitgave, zoals de single uit 2019, wordt apart bij de artiestdetails getoond en overschrijft dit jaar niet. De opgeslagen jaren zijn niet bij alle artiesten volgens dezelfde debuutdefinitie vastgesteld; de bronlinks maken de invulling controleerbaar.

Koppeling gebeurt uitsluitend via een unieke Spotify-ID of een door Wikidata bevestigde Spotify-/MusicBrainz-identiteit. Er is geen naamvergelijking om opgeslagen gegevens toe te kennen. Profielen met meerdere Spotify-pagina's vereisen een live bevestiging, zodat een naamgenoot niet zomaar het profiel krijgt. Verschillen tussen opgeslagen bronnen worden bewaard; conflicterende velden worden niet automatisch gekozen. Bezettingen blijven momentopnamen.

De snapshots worden niet tijdens het luisteren uit de andere repositories gedownload of bijgewerkt. Vernieuwen kan expliciet vanuit gecontroleerde checkouts:

```sh
python3 scripts/import-artist-references.py /pad/naar/billboard-hot-100-reversed /pad/naar/ultratop-50-reversed
```

De importer leest CSV/JSON en letterlijke Python-constanten zonder code uit die repositories uit te voeren. Hij wijzigt de bronprojecten niet. Bekijk het gegenereerde verschil en voer de browsertests uit voordat je een vernieuwde snapshot publiceert. Nieuwe/onbekende artiesten blijven de automatische bronketen gebruiken.

## Lokaal ontwikkelen en testen

De website zelf heeft geen npm-afhankelijkheden en geen buildstap. Python 3 is voldoende om te serveren:

```sh
cd /workspace/spotify-kenniscentrum
python3 -m http.server 8000 --bind 127.0.0.1
```

Gebruik voor lokale Spotify OAuth het expliciete loopbackadres `http://127.0.0.1:8000/` en registreer die URI bij Spotify; gebruik voor hosting HTTPS. De app past de URI automatisch aan het huidige pad aan, inclusief een submap op GitHub Pages.

Voor de ontwikkelchecks: Node.js 22 of nieuwer en de vastgelegde Playwright-versie:

```sh
npm ci
npx playwright install chromium
npm run check
npm test
```

In de Codex-cloudomgeving is Chromium al aanwezig. Gebruik daar indien nodig een schrijfbare npm-cache en de systeembrowser:

```sh
npm ci --cache /tmp/spotify-npm-cache
CHROMIUM_PATH=/usr/bin/chromium npm test
```

De browsertests starten zelf een tijdelijke lokale server en gebruiken gesimuleerde API-antwoorden. Ze controleren de zes vakken, bandleden, onbekende bronnen, Spotify 403/401/429, tokenvernieuwing, OAuth-state, debuut-terugval en bovengrenzen, de rechtstreekse Zach Top-identiteitskoppeling, stoppen, verborgen tabbladen, afmelden tijdens een verzoek, late antwoorden na een nummerwissel en mobiele overloop. Ze bewijzen geen toegang tot een echt Spotify-account. Controleer na een release ook handmatig met Spotify: verbinden, nummer ophalen, wisselen, pauzeren, stoppen, afmelden en opnieuw openen.

## Privacy en werking

- De Client ID blijft lokaal in `localStorage`; access- en refresh-tokens alleen in `sessionStorage` van het tabblad. De afmeldknop wist die tokens; dit trekt geen toestemming in bij Spotify zelf.
- Alleen een klik op ophalen of starten haalt muziek op. Automatische controles gebeuren om de 12 seconden in een zichtbaar tabblad. Geen serviceworker, geplande workflow of achtergrondservice.
- Stoppen voorkomt nieuwe automatische controles. Reeds gestarte bronverzoeken kunnen nog afronden. Sluiten van het tabblad beëindigt de modus.
- MusicBrainz-verzoeken worden gespreid met minimaal 1,2 seconde tussen afgehandelde verzoeken. Succesvolle bronresultaten worden in het geheugen van dit tabblad hergebruikt. Een handmatige nieuwe poging kan ontbrekende resultaten opnieuw opvragen.
- Verzoeken hebben een timeout. Een Spotify `Retry-After` wordt gerespecteerd. Verlopen of ingetrokken sessies vragen opnieuw te verbinden.
- Artiestennamen en ISRC's gaan bij gebruik naar Wikidata/MusicBrainz; Spotify-tokens worden uitsluitend naar Spotify gestuurd. Foto's laden vanaf Spotify/Wikimedia. Externe zoeklinks openen pas wanneer je erop klikt.

De oude vijfminutenworkflow blijft verwijderd. Er is geen automatische geplande controle toegevoegd.
