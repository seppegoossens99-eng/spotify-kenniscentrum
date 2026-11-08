# Spotify Kenniscentrum

Leer de artiest achter het nummer kennen, alleen wanneer je daar zin in hebt. Een statische Nederlandstalige website voor GitHub Pages, met Spotify OAuth PKCE en aanvullende gegevens uit Wikidata en MusicBrainz. Geen backend, Client Secret of voortdurend draaiende taak nodig.

## Gebruik

1. Publiceer `index.html`, `style.css` en `app.js` samen via GitHub Pages of een andere HTTPS-host.
2. Maak een app in het [Spotify Developer Dashboard](https://developer.spotify.com/dashboard). Registreer de **exacte Redirect URI** die de website toont.
3. Vul de **Client ID** in op de website en verbind met Spotify. Gebruik nooit de Client Secret. Je account moet toegang hebben tot de app; Spotify stelt aanvullende eisen en beperkingen aan apps in Development Mode.
4. Speel een muzieknummer af in Spotify. Kies **Huidig nummer ophalen** voor één nummer, of **Kennismodus starten** om nummerwissels te volgen.
5. Kies **Kennismodus stoppen** om weer gewoon te luisteren. Een verbinding alleen start geen controles. Elke nieuwe paginalading begint met de modus uit.

Met **Bekijk een fictief voorbeeld** kun je het kader en de bandleden zonder account bekijken. Alle voorbeeldgegevens zijn verzonnen en worden duidelijk zo aangeduid.

## Het artiestenkader

De zes vakken zijn direct zichtbaar per artiest; biografieën en bandleden staan in het uitklapbare gedeelte eronder. Beschikbare foto's komen uit Spotify of Wikimedia Commons via Wikidata. De bronlinks verwijzen naar aanvullende gegevens en fotolicenties.

| Vak | Betekenis en bron |
| --- | --- |
| Debut | Vroegste gevonden studioalbum, single of EP in MusicBrainz. Live-uitgaven, compilaties en remixes tellen niet mee. Maximaal 500 releasegroepen per artiest; een gedeeltelijke inventarisatie is gemarkeerd met ≈. Niet gegarandeerd het historische debuut. |
| Members | Solo, of het aantal bekende huidige leden volgens Wikidata. Ontbrekende einddatums betekenen niet dat een bron actueel is. |
| Popularity | Spotify-score tussen 0 en 100, als die beschikbaar is voor jouw app. **Geen Spotle-rangschikking.** |
| Gender | Wikidata. Bij bands alleen weergegeven als de bron voor alle bekende huidige leden een waarde bevat. |
| Genre | Eerste Spotify-genre; anders Wikidata of het meest gestemde MusicBrainz-genre. |
| Country | Wikidata-nationaliteit of herkomst, anders MusicBrainz. |

Dit zijn **geen officiële Spotle-antwoorden**. Het spel kan andere definities en eigen gegevens gebruiken. Onbekende of niet eenduidig gevonden gegevens blijven onbekend; er zijn geen handmatig ingevulde populariteitscijfers of uitzonderingen per bekende artiest. Naamgenoten worden niet willekeurig samengevoegd; Spotify-identificaties in de bron worden gecontroleerd waar beschikbaar.

Per bandlid worden naam, lidmaatschap, instrumenten, geboortedatum, leeftijd, geboorteplaats, land en foto getoond waar de bron die bevat. Voor overleden personen wordt geen huidige leeftijd berekend. De Spotify-releasedatum is die van de specifieke albumuitgave. Een ISRC-zoekopdracht zoekt daarnaast naar de vroegste gevonden officiële uitgave van dezelfde opname, niet van de oorspronkelijke compositie. De WhoSampled-link is een zoeklink; samples worden niet automatisch bevestigd.

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

De browsertests starten zelf een tijdelijke lokale server en gebruiken gesimuleerde API-antwoorden. Ze controleren de zes vakken, bandleden, onbekende bronnen, Spotify 403/401/429, tokenvernieuwing, OAuth-state, stoppen, verborgen tabbladen, afmelden tijdens een verzoek, late antwoorden na een nummerwissel en mobiele overloop. Ze bewijzen geen toegang tot een echt Spotify-account. Controleer na een release ook handmatig met Spotify: verbinden, nummer ophalen, wisselen, pauzeren, stoppen, afmelden en opnieuw openen.

## Privacy en werking

- De Client ID blijft lokaal in `localStorage`; access- en refresh-tokens alleen in `sessionStorage` van het tabblad. De afmeldknop wist die tokens; dit trekt geen toestemming in bij Spotify zelf.
- Alleen een klik op ophalen of starten haalt muziek op. Automatische controles gebeuren om de 12 seconden in een zichtbaar tabblad. Geen serviceworker, geplande workflow of achtergrondservice.
- Stoppen voorkomt nieuwe automatische controles. Reeds gestarte bronverzoeken kunnen nog afronden. Sluiten van het tabblad beëindigt de modus.
- MusicBrainz-verzoeken worden gespreid met minimaal 1,2 seconde tussen afgehandelde verzoeken. Succesvolle bronresultaten worden in het geheugen van dit tabblad hergebruikt. Een handmatige nieuwe poging kan ontbrekende resultaten opnieuw opvragen.
- Verzoeken hebben een timeout. Een Spotify `Retry-After` wordt gerespecteerd. Verlopen of ingetrokken sessies vragen opnieuw te verbinden.
- Artiestennamen en ISRC's gaan bij gebruik naar Wikidata/MusicBrainz; Spotify-tokens worden uitsluitend naar Spotify gestuurd. Foto's laden vanaf Spotify/Wikimedia. Externe zoeklinks openen pas wanneer je erop klikt.

De oude vijfminutenworkflow blijft verwijderd. Er is geen automatische geplande controle toegevoegd.
