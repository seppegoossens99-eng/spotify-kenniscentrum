# Spotify Kenniscentrum

Statische Spotify-website met OAuth PKCE, handmatig ophalen en optioneel automatisch volgen.

## Installatie

1. Upload `index.html`, `style.css` en `app.js` naar de hoofdmap van je GitHub-repository.
2. Publiceer via **Settings → Pages → Deploy from a branch → main → / (root)**. GitHub Pages is afhankelijk van je repositorytype en abonnement; maak de repository indien nodig openbaar (zonder secrets) of gebruik een andere HTTPS static host.
3. Open de gepubliceerde site. Kopieer de getoonde Redirect URI exact naar **Spotify Developer Dashboard → jouw app → Edit settings → Redirect URIs** en sla op.
4. Kopieer in het Spotify Dashboard de **Client ID** (nooit de Client Secret) naar het invoerveld op de website.
5. Klik op **Verbinden met Spotify**. In Development Mode moet je Spotify-account mogelijk als toegestane gebruiker in de app staan en kunnen API- en accountbeperkingen gelden.
6. Speel muziek af in Spotify en klik op **Huidig nummer ophalen** of **Automatisch starten**.

## Privacy en beperkingen

- OAuth gebruikt Authorization Code met PKCE, zonder Client Secret.
- Client ID staat lokaal in `localStorage`; Spotify access/refresh tokens alleen in tabgebonden `sessionStorage`.
- Automatische polling loopt alleen wanneer je die activeert, elke 12 seconden zolang het tabblad zichtbaar is. Stoppen of tabblad sluiten stopt de polling.
- Spotify `release_date` is de datum van de Spotify-albumuitgave, niet gegarandeerd de eerste release van de compositie.
- Geboortedata, geboortesteden, leeftijden, bandleden en originele releasedata zijn **nog niet geïmplementeerd**. Hiervoor volgen aanvullende bronnen zoals MusicBrainz en Wikidata.
- De browser kan Spotify niet uitlezen als de accounttoegang, API-toestemming of actieve weergave ontbreekt.
