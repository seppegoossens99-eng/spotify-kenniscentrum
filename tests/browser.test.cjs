const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const { createServer } = require('node:http');
const { readFile } = require('node:fs/promises');
const { join } = require('node:path');
let browser, server, origin;
const root = join(__dirname, '..');
before(async () => {
  server = createServer(async (req, res) => {
    const path = new URL(req.url, 'http://test').pathname;
    if (!['/', '/index.html', '/app.js', '/style.css'].includes(path)) { res.writeHead(404).end(); return; }
    res.setHeader('Content-Type', path.endsWith('.js') ? 'text/javascript' : path.endsWith('.css') ? 'text/css' : 'text/html');
    res.end(await readFile(join(root, path === '/' ? 'index.html' : path.slice(1))));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  origin = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch({ headless: true, ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}), args: ['--no-sandbox'] });
});
after(async () => { await browser?.close(); await new Promise(resolve => server.close(resolve)); });
const claim = value => ({ mainsnak: { datavalue: { value } } });
const item = id => claim({ id });
const track = { id: 'track1', type: 'track', name: 'Een testnummer', duration_ms: 210000, track_number: 2,
  artists: [{ id: 'artist1', name: 'Testband' }], album: { name: 'Testalbum', release_date: '2020-05-10', images: [] }, external_ids: {} };
async function setup(t, options = {}) {
  const context = await browser.newContext({ viewport: options.mobile ? { width: 360, height: 780 } : { width: 1100, height: 900 } });
  t.after(() => context.close());
  const page = await context.newPage(); const errors = []; page.on('pageerror', error => errors.push(error.message));
  t.after(() => assert.deepEqual(errors, [], 'no unhandled browser errors'));
  if (options.connected !== false) await context.addInitScript(() => {
    sessionStorage.setItem('skc_access', 'test-access'); sessionStorage.setItem('skc_exp', String(Date.now() + 3600000));
    sessionStorage.setItem('skc_refresh', 'test-refresh'); localStorage.setItem('skc_client_id', 'a'.repeat(32));
  });
  const calls = [];
  await page.route('https://**/*', async route => {
    const url = new URL(route.request().url()); calls.push(url.toString());
    const json = data => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(data) });
    if (options.route && await options.route(route, url, json)) return;
    if (url.hostname === 'api.spotify.com') {
      if (url.pathname.endsWith('/currently-playing')) return json({ is_playing: true, item: track });
      if (options.artistForbidden) return route.fulfill({ status: 403, body: '{}' });
      return json({ name: 'Testband', popularity: 0, genres: ['rock'], images: [], followers: { total: 42 } });
    }
    if (url.hostname === 'accounts.spotify.com') return json({ access_token: 'new-access', refresh_token: 'new-refresh', expires_in: 3600 });
    if (url.hostname === 'www.wikidata.org') {
      if (options.noSources) return json({ search: [] });
      if (url.searchParams.get('action') === 'wbsearchentities') return json({ search: [{ id: 'Q100', label: 'Testband', description: 'music group' }] });
      const entities = {
        Q100: { claims: { P31: [item('Q215380')], P1902: [claim('artist1')], P17: [item('Q31')], P740: [item('Q72')], P527: [item('Q101')], P136: [item('Q9')] } },
        Q101: { labels: { nl: { value: 'Testlid' } }, claims: { P21: [item('Q6581097')], P569: [claim({ time: '+1990-03-04T00:00:00Z', precision: 11 })], P19: [item('Q72')], P27: [item('Q31')], P1303: [item('Q8')] } },
        Q31: { labels: { nl: { value: 'België' } } }, Q72: { labels: { nl: { value: 'Gent' } } },
        Q8: { labels: { nl: { value: 'gitaar' } } }, Q9: { labels: { nl: { value: 'rock' } } }
      };
      return json({ entities: Object.fromEntries(url.searchParams.get('ids').split('|').map(id => [id, entities[id] || {}])) });
    }
    if (url.hostname === 'musicbrainz.org') {
      if (url.pathname === '/ws/2/artist/') return json({ artists: options.noSources ? [] : [{ id: 'mb1', name: 'Testband', score: 100 }] });
      if (url.pathname === '/ws/2/artist/mb1') return json({ id: 'mb1', type: 'Group', country: 'BE', genres: [{ name: 'rock', count: 10 }], relations: [] });
      if (url.pathname === '/ws/2/release-group') return json({ 'release-group-count': 1, 'release-groups': [{ id: 'rg1', title: 'Eerste single', 'primary-type': 'Single', 'first-release-date': '2008-01-01' }] });
    }
    return route.fulfill({ status: 404, body: '{}' });
  });
  await page.goto(origin);
  return { context, page, calls };
}
async function waitSources(page) { await page.waitForFunction(() => document.querySelector('#refresh').textContent === 'Huidig nummer ophalen' && document.querySelector('.source-status') && !document.querySelector('.source-status').textContent.includes('laden')); }
const values = page => page.locator('.spotle-value').allTextContents();

test('voorbeeld is volledig lokaal, mobiel bruikbaar en start geen polling', async t => {
  const { page, calls } = await setup(t, { connected: false, mobile: true });
  await page.locator('#showExample').click();
  assert.deepEqual(await values(page), ['2014', '2', '64/100', 'Gemengd', 'Indierock', 'België']);
  await page.locator('.artist details summary').click();
  assert.equal(await page.locator('.member').count(), 2);
  assert.equal(await page.locator('#toggleAuto').getAttribute('aria-pressed'), 'false');
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  assert.deepEqual(calls, []);
});
test('Spotle-kader en bandleden worden uit onafhankelijke bronnen aangevuld', async t => {
  const { page, calls } = await setup(t);
  assert.equal(calls.length, 0, 'no fetch until user activation');
  await page.locator('#refresh').click(); await waitSources(page);
  assert.deepEqual(await values(page), ['2008', '1', '0/100', 'Male', 'rock', 'België']);
  await page.locator('.artist details summary').click();
  assert.match(await page.locator('.member').textContent(), /Testlid.*gitaar.*04\/03\/1990.*Gent.*België/s);
  assert.match(await page.locator('.sources').textContent(), /Debuut: Eerste single/);
  assert.equal(await page.locator('#toggleAuto').getAttribute('aria-pressed'), 'false');
});
test('Spotify-artist 403 blokkeert Wikidata en MusicBrainz niet', async t => {
  const { page } = await setup(t, { artistForbidden: true });
  await page.locator('#refresh').click(); await waitSources(page);
  assert.deepEqual(await values(page), ['2008', '1', 'Onbekend', 'Male', 'rock', 'België']);
});
test('onbekende bronnen blijven onbekend, geen verzonnen artiestencijfers', async t => {
  const { page } = await setup(t, { artistForbidden: true, noSources: true });
  await page.locator('#refresh').click(); await waitSources(page);
  assert.deepEqual(await values(page), Array(6).fill('Onbekend'));
  assert.match(await page.locator('.source-status').textContent(), /Geen betrouwbare/);
});
test('stop voorkomt nieuwe automatische verzoeken; verborgen tabblad wordt overgeslagen', async t => {
  const { page, calls } = await setup(t, { noSources: true });
  await page.clock.install();
  await page.locator('#toggleAuto').click(); await page.locator('#refresh').waitFor({ state: 'visible' });
  await page.waitForFunction(() => document.querySelector('#refresh').textContent === 'Huidig nummer ophalen');
  const count = () => calls.filter(url => url.includes('currently-playing')).length;
  const first = count();
  await page.evaluate(() => Object.defineProperty(document, 'hidden', { configurable: true, get: () => true }));
  await page.clock.fastForward(12001); assert.equal(count(), first);
  await page.evaluate(() => Object.defineProperty(document, 'hidden', { configurable: true, get: () => false }));
  await page.clock.fastForward(12001); await page.waitForTimeout(50); assert.equal(count(), first + 1);
  await page.locator('#toggleAuto').click(); const stopped = count();
  await page.clock.fastForward(36001); assert.equal(count(), stopped);
  assert.equal(await page.locator('#toggleAuto').getAttribute('aria-pressed'), 'false');
});
test('logout tijdens een Spotify-verzoek laat het resultaat niet terugkomen', async t => {
  let release; const blocked = new Promise(resolve => { release = resolve; }); let entered;
  const started = new Promise(resolve => { entered = resolve; });
  const { page } = await setup(t, { route: async (route, url, json) => {
    if (!url.pathname.endsWith('/currently-playing')) return false;
    entered(); await blocked; await json({ is_playing: true, item: track }); return true;
  } });
  await page.locator('#refresh').click(); await started;
  await page.locator('#logout').click(); release();
  await page.waitForFunction(() => document.querySelector('#refresh').textContent === 'Huidig nummer ophalen');
  assert.equal(await page.locator('#result').isHidden(), true);
  assert.equal(await page.locator('#status').textContent(), 'Niet verbonden');
  assert.equal(await page.evaluate(() => sessionStorage.getItem('skc_access')), null);
});
test('geen nummer wist oude gegevens en weigert podcast als muziek', async t => {
  let empty = false;
  const { page } = await setup(t, { noSources: true, route: async (route, url, json) => {
    if (!empty || !url.pathname.endsWith('/currently-playing')) return false;
    await json({ item: { type: 'episode' } }); return true;
  } });
  await page.locator('#refresh').click(); await page.waitForFunction(() => !document.querySelector('#refresh').disabled);
  empty = true; await page.locator('#refresh').click();
  await page.waitForFunction(() => document.querySelector('#message').textContent.includes('podcast'));
  assert.equal(await page.locator('#result').isHidden(), true);
});
test('401 vernieuwt token eenmaal en gebruikt het nieuwe token', async t => {
  let attempts = 0, tokens = 0;
  const { page } = await setup(t, { noSources: true, route: async (route, url, json) => {
    if (url.hostname === 'accounts.spotify.com') { tokens++; await json({ access_token: 'renewed', expires_in: 3600 }); return true; }
    if (url.pathname.endsWith('/currently-playing')) {
      attempts++;
      if (attempts === 1) await route.fulfill({ status: 401, body: '{}' });
      else { assert.equal(route.request().headers().authorization, 'Bearer renewed'); await json({ item: track, is_playing: true }); }
      return true;
    }
    return false;
  } });
  await page.locator('#refresh').click(); await page.waitForFunction(() => !document.querySelector('#refresh').disabled);
  assert.equal(tokens, 1); assert.equal(attempts, 2); assert.equal(await page.locator('#trackTitle').textContent(), track.name);
});
test('429 respecteert Retry-After en doet geen directe herhaalde verzoeken', async t => {
  const { page, calls } = await setup(t, { route: async (route, url) => {
    if (!url.pathname.endsWith('/currently-playing')) return false;
    await route.fulfill({ status: 429, headers: { 'Retry-After': '60' }, body: '{}' }); return true;
  } });
  await page.locator('#refresh').click(); await page.waitForFunction(() => !document.querySelector('#refresh').disabled);
  await page.locator('#refresh').click();
  assert.equal(calls.filter(url => url.includes('currently-playing')).length, 1);
  assert.match(await page.locator('#message').textContent(), /Spotify-limiet/);
});
test('OAuth weigert verkeerde state en ruimt callbackparameters op', async t => {
  const { page, calls } = await setup(t, { connected: false });
  await page.goto(origin + '/?code=untrusted&state=wrong');
  assert.match(await page.locator('#message').textContent(), /ongeldige beveiligingscontrole/);
  assert.equal(page.url(), origin + '/'); assert.equal(calls.length, 0);
});
test('late artiestgegevens van een vorig nummer wijzigen het huidige kader niet', async t => {
  let next = false, release; const blocked = new Promise(resolve => { release = resolve; });
  const { page } = await setup(t, { noSources: true, route: async (route, url, json) => {
    if (url.pathname.endsWith('/currently-playing') && next) { await json({ is_playing: true, item: { ...track, id: 'track2', name: 'Tweede nummer', artists: [{ id: 'artist2', name: 'Tweede artiest' }] } }); return true; }
    if (url.pathname === '/v1/artists/artist1') { await blocked; await json({ popularity: 99, genres: ['verouderd'] }); return true; }
    if (url.pathname === '/v1/artists/artist2') { await json({ popularity: 12, genres: ['jazz'] }); return true; }
    return false;
  } });
  await page.locator('#refresh').click(); await page.waitForFunction(() => !document.querySelector('#refresh').disabled);
  next = true; await page.locator('#refresh').click();
  await page.waitForFunction(() => document.querySelector('#trackTitle').textContent === 'Tweede nummer');
  release(); await waitSources(page);
  assert.equal(await page.locator('.artist h4').textContent(), 'Tweede artiest');
  assert.equal((await values(page))[2], '12/100'); assert.equal((await values(page))[4], 'jazz');
});
test('verlopen refresh-token verbreekt de sessie en stopt de kennismodus', async t => {
  const { page } = await setup(t, { route: async (route, url) => {
    if (url.hostname === 'accounts.spotify.com') { await route.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ error: 'invalid_grant' }) }); return true; }
    if (url.pathname.endsWith('/currently-playing')) { await route.fulfill({ status: 401, body: '{}' }); return true; }
    return false;
  } });
  await page.locator('#toggleAuto').click();
  await page.waitForFunction(() => document.querySelector('#message').textContent.includes('sessie is verlopen'));
  assert.equal(await page.locator('#status').textContent(), 'Niet verbonden');
  assert.equal(await page.locator('#toggleAuto').getAttribute('aria-pressed'), 'false');
  assert.equal(await page.evaluate(() => sessionStorage.getItem('skc_refresh')), null);
});
test('debuut leest volgende paginas en telt livealbums niet als studio-debuut', async t => {
  const { page } = await setup(t, { route: async (route, url, json) => {
    if (url.pathname !== '/ws/2/release-group') return false;
    const groups = url.searchParams.get('offset') === '0' ? [{ id: 'later', title: 'Later album', 'primary-type': 'Album', 'first-release-date': '2015' }, { id: 'live', title: 'Live', 'primary-type': 'Album', 'secondary-types': ['Live'], 'first-release-date': '1990' }] : [{ id: 'earliest', title: 'Debuutsingle', 'primary-type': 'Single', 'first-release-date': '2001' }];
    await json({ 'release-group-count': 3, 'release-groups': groups }); return true;
  } });
  await page.locator('#refresh').click(); await waitSources(page);
  assert.equal((await values(page))[0], '2001');
});
test('gedeeltelijke geboortedatum geeft geen verzonnen dag of leeftijd', async t => {
  const { page } = await setup(t, { route: async (route, url, json) => {
    if (url.hostname !== 'www.wikidata.org') return false;
    if (url.searchParams.get('action') === 'wbsearchentities') { await json({ search: [{ id: 'Q100', label: 'Testband', description: 'music group' }] }); return true; }
    await json({ entities: { Q100: { claims: { P1902: [claim('artist1')], P31: [item('Q215380')], P527: [item('Q101')] } }, Q101: { labels: { nl: { value: 'Jaarlid' } }, claims: { P569: [claim({ time: '+1990-01-01T00:00:00Z', precision: 9 })] } } } }); return true;
  } });
  await page.locator('#refresh').click(); await waitSources(page); await page.locator('.artist details summary').click();
  const member = await page.locator('.member').textContent();
  assert.match(member, /Geboren1990/); assert.match(member, /LeeftijdOnbekend/); assert.doesNotMatch(member, /01\/01/);
});
test('opname-uitgave gebruikt exact ISRC en behoudt een gedeeltelijke releasedatum', async t => {
  const { page } = await setup(t, { noSources: true, route: async (route, url, json) => {
    if (url.pathname.endsWith('/currently-playing')) { await json({ is_playing: true, item: { ...track, external_ids: { isrc: 'GBABC1234567' } } }); return true; }
    if (url.pathname === '/ws/2/isrc/GBABC1234567') {
      assert.equal(url.searchParams.has('inc'), false, 'ISRC lookup has recordings by default, inc=recordings is invalid');
      await json({ recordings: [{ id: 'recording1' }] }); return true;
    }
    if (url.pathname === '/ws/2/recording/recording1') {
      await json({ releases: [{ status: 'Official', date: '1998', title: 'Oorspronkelijke uitgave' }, { status: 'Bootleg', date: '1980', title: 'Geen officiële uitgave' }] }); return true;
    }
    return false;
  } });
  await page.locator('#refresh').click();
  await page.waitForFunction(() => document.querySelector('#releaseStatus').textContent.includes('1998'));
  assert.match(await page.locator('#releaseStatus').textContent(), /1998 · Oorspronkelijke uitgave/);
  assert.equal(await page.locator('#releaseSource a').getAttribute('href'), 'https://musicbrainz.org/recording/recording1');
});
test('Wikidata gebruikt de Spotify-identiteit ook als de artiest een andere schrijfwijze heeft', async t => {
  const { page } = await setup(t, { route: async (route, url, json) => {
    if (url.hostname !== 'www.wikidata.org') return false;
    if (url.searchParams.get('action') === 'wbsearchentities') { await json({ search: [{ id: 'Q100', label: 'Andere artiestennaam', description: 'musician' }] }); return true; }
    await json({ entities: { Q100: { claims: { P31: [item('Q5')], P1902: [claim('artist1')] } } } }); return true;
  } });
  await page.locator('#refresh').click(); await waitSources(page);
  assert.equal((await values(page))[1], 'Solo');
});

// Regression: Zach Top's MusicBrainz search returned 503, while the verified
// Wikidata P434 lookup and his 2019 single remained available (2026-11-08).
test('Zach Top: directe identiteit vult 2019 in wanneer de zoekdienst uitvalt', async t => {
  const artistId = '4FGPzWzgjURDNT7JQ8pYgH', mbId = '9939a762-5ca9-4c12-a735-0d62e21df4e3';
  const { page, calls } = await setup(t, { route: async (route, url, json) => {
    if (url.pathname.endsWith('/currently-playing')) {
      await json({ is_playing: true, item: { ...track, name: 'South of Sanity', artists: [{ id: artistId, name: 'Zach Top' }] } }); return true;
    }
    if (url.hostname === 'www.wikidata.org') {
      if (url.searchParams.get('action') === 'wbsearchentities') await json({ search: [{ id: 'Q126414316', label: 'Zach Top', description: 'American singer/songwriter' }] });
      else await json({ entities: { Q126414316: { claims: { P31: [item('Q5')], P1902: [claim(artistId)], P434: [claim(mbId)] } } } });
      return true;
    }
    if (url.hostname === 'musicbrainz.org') {
      if (url.pathname === '/ws/2/artist/') { await route.fulfill({ status: 503, body: '{}' }); return true; }
      if (url.pathname === '/ws/2/artist/' + mbId) { await json({ id: mbId, name: 'Zach Top', type: 'Person', relations: [{ url: { resource: 'https://open.spotify.com/artist/' + artistId } }] }); return true; }
      if (url.pathname === '/ws/2/release-group') {
        await json({ 'release-group-count': 2, 'release-groups': [
          { id: 'b93d4d9f-38e4-47a5-830d-9bc84a2187f2', title: 'In a World Gone Wrong', 'primary-type': 'Single', 'first-release-date': '2019-09-25' },
          { id: 'd41e8f05-3a1c-4a87-baa5-1ebd9cc29472', title: 'Zach Top', 'primary-type': 'Album', 'first-release-date': '2022-05-13' }
        ] }); return true;
      }
    }
    return false;
  } });
  await page.locator('#refresh').click(); await waitSources(page);
  assert.equal((await values(page))[0], '2019');
  assert.equal(calls.some(url => new URL(url).pathname === '/ws/2/artist/'), false, 'broken name search was bypassed');
  assert.match(await page.locator('.debut-status a').getAttribute('href'), /b93d4d9f-38e4-47a5-830d-9bc84a2187f2/);
});
const catalogAlbum = (id, date, artists = [{ id: 'artist1' }]) => ({ id, name: id, release_date: date, album_type: 'single', album_group: 'single', artists });
test('Spotify-terugval leest alle paginas en sluit andere artiesten, compilaties en toekomstige uitgaven uit', async t => {
  const { page, calls } = await setup(t, { noSources: true, route: async (route, url, json) => {
    if (!url.pathname.endsWith('/albums')) return false;
    await json(url.searchParams.get('offset') === '0' ? { items: [catalogAlbum('new', '2021'), catalogAlbum('other', '1990', [{ id: 'different' }])], next: 'next-page' } : {
      items: [catalogAlbum('old', '2017-04-03'), catalogAlbum('future', '2999'), { ...catalogAlbum('compilation', '1991'), album_type: 'compilation' }], next: null }); return true;
  } });
  await page.locator('#refresh').click(); await waitSources(page);
  assert.equal((await values(page))[0], '2017 ≈');
  assert.match(await page.locator('.debut-status').textContent(), /Schatting.*Spotify/);
  assert.equal(await page.locator('.debut-status a').getAttribute('href'), 'https://open.spotify.com/album/old');
  await page.locator('#refresh').click(); await waitSources(page);
  assert.equal(calls.filter(url => new URL(url).pathname.endsWith('/albums')).length, 2, 'successful catalog is cached');
});
test('onvolledige Spotify-discografie blijft als schatting herkenbaar en kan opnieuw worden geprobeerd', async t => {
  let pages = 0;
  const { page } = await setup(t, { noSources: true, route: async (route, url, json) => {
    if (!url.pathname.endsWith('/albums')) return false;
    pages++;
    if (url.searchParams.get('offset') === '0') await json({ items: [catalogAlbum('known', '2020')], next: 'next-page' });
    else await route.fulfill({ status: 503, body: '{}' });
    return true;
  } });
  await page.locator('#refresh').click(); await waitSources(page);
  assert.equal((await values(page))[0], '2020 ≈');
  assert.match(await page.locator('.debut-status').textContent(), /niet volledig/);
  await page.locator('#refresh').click(); await waitSources(page);
  assert.equal(pages, 4, 'partial result is not permanently cached');
});
test('bij bronuitval toont de huidige eigen uitgave alleen een bovengrens voor het debuut', async t => {
  const { page } = await setup(t, { noSources: true, artistForbidden: true, route: async (route, url, json) => {
    if (!url.pathname.endsWith('/currently-playing')) return false;
    await json({ is_playing: true, item: { ...track, album: { ...track.album, id: 'current', album_type: 'album', artists: [{ id: 'artist1' }] } } }); return true;
  } });
  await page.locator('#refresh').click(); await waitSources(page);
  assert.equal((await values(page))[0], '≤ 2020');
  assert.match(await page.locator('.debut-status').textContent(), /uiterlijk in 2020.*niet bevestigd/);
});
test('de huidige uitgave wordt niet ten onrechte het debuut van een gastartiest', async t => {
  const { page } = await setup(t, { noSources: true, artistForbidden: true, route: async (route, url, json) => {
    if (!url.pathname.endsWith('/currently-playing')) return false;
    await json({ is_playing: true, item: { ...track, album: { ...track.album, album_type: 'album', artists: [{ id: 'someone-else' }] } } }); return true;
  } });
  await page.locator('#refresh').click(); await waitSources(page);
  assert.equal((await values(page))[0], 'Onbekend');
});
test('tijdelijk MusicBrainz-probleem wordt eenmaal opnieuw geprobeerd', async t => {
  let searches = 0;
  const { page } = await setup(t, { route: async (route, url) => {
    if (url.hostname !== 'musicbrainz.org' || url.pathname !== '/ws/2/artist/') return false;
    searches++;
    if (searches === 1) { await route.fulfill({ status: 503, headers: { 'Retry-After': '0' }, body: '{}' }); return true; }
    return false;
  } });
  await page.locator('#refresh').click(); await waitSources(page);
  assert.equal(searches, 2); assert.equal((await values(page))[0], '2008');
});
test('vroegere Spotify-uitgave wordt niet vervangen door een latere MusicBrainz-uitgave', async t => {
  const { page } = await setup(t, { route: async (route, url, json) => {
    if (!url.pathname.endsWith('/albums')) return false;
    await json({ items: [catalogAlbum('early', '2001')], next: null }); return true;
  } });
  await page.locator('#refresh').click(); await waitSources(page);
  assert.equal((await values(page))[0], '2001 ≈');
});
