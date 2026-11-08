'use strict';
const $ = id => document.getElementById(id);
const REDIRECT = location.origin + location.pathname;
const SCOPES = 'user-read-currently-playing user-read-playback-state';
const KEY = 'skc_client_id';
let timer = null;
let currentKey = null;
let accessToken = null;
let expiresAt = 0;
let refreshing = null;
let sessionVersion = 0;
let viewVersion = 0;
let loading = false;
let demo = false;
let rateLimitUntil = 0;
$('redirect').textContent = REDIRECT;
$('clientId').value = localStorage.getItem(KEY) || '';
function message(text) { $('message').textContent = text || ''; }
function status(text) { $('status').textContent = text; }
function bytesBase64Url(bytes) { return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); }
async function sha256(text) { return new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))); }
function randomVerifier() { return bytesBase64Url(crypto.getRandomValues(new Uint8Array(64))); }
async function request(url, options = {}) {
  try {
    return await fetch(url, { ...options, signal: AbortSignal.timeout(15000) });
  } catch (error) {
    throw Error(error.name === 'TimeoutError' ? 'De bron antwoordt niet op tijd. Probeer opnieuw.' : 'Geen verbinding met de bron. Controleer je internetverbinding.');
  }
}
function clearSession() {
  sessionVersion++;
  viewVersion++;
  accessToken = null;
  expiresAt = 0;
  refreshing = null;
  currentKey = null;
  ['skc_access', 'skc_exp', 'skc_refresh', 'skc_verifier', 'skc_state'].forEach(key => sessionStorage.removeItem(key));
  stopAuto();
  connected(false);
}
function saveTokens(data) {
  if (!data.access_token || !Number.isFinite(data.expires_in)) throw Error('Ongeldig antwoord van Spotify. Verbind opnieuw.');
  accessToken = data.access_token;
  expiresAt = Date.now() + Math.max(0, data.expires_in - 60) * 1000;
  sessionStorage.setItem('skc_access', accessToken);
  sessionStorage.setItem('skc_exp', String(expiresAt));
  if (data.refresh_token) sessionStorage.setItem('skc_refresh', data.refresh_token);
  connected(true);
}
function connected(yes) {
  $('login').hidden = yes;
  $('logout').hidden = !yes;
  $('refresh').disabled = !yes || loading;
  $('toggleAuto').disabled = !yes;
  status(yes ? 'Verbonden' : 'Niet verbonden');
  document.querySelector('.settings').open = !yes;
}
$('saveClient').onclick = () => {
  const id = $('clientId').value.trim();
  if (!/^[a-f0-9]{32}$/i.test(id)) return message('Controleer je Client ID: dit is normaal een code van 32 tekens.');
  if (id !== localStorage.getItem(KEY)) { clearSession(); $('result').hidden = true; }
  localStorage.setItem(KEY, id);
  message('Client ID opgeslagen op dit apparaat.');
};
$('copyRedirect').onclick = async () => {
  try { await navigator.clipboard.writeText(REDIRECT); message('Redirect URI gekopieerd.'); }
  catch { message('Selecteer en kopieer de Redirect URI handmatig.'); }
};
$('login').onclick = async () => {
  const id = $('clientId').value.trim();
  if (!/^[a-f0-9]{32}$/i.test(id)) return message('Vul eerst je Spotify Client ID in.');
  try {
    if (!window.isSecureContext || !crypto.subtle) throw Error('Open de website via HTTPS of een lokaal loopbackadres om veilig te verbinden.');
    clearSession();
    demo = false;
    $('result').hidden = true;
    localStorage.setItem(KEY, id);
    const verifier = randomVerifier(), state = randomVerifier();
    sessionStorage.setItem('skc_verifier', verifier);
    sessionStorage.setItem('skc_state', state);
    const challenge = bytesBase64Url(await sha256(verifier));
    const url = new URL('https://accounts.spotify.com/authorize');
    url.search = new URLSearchParams({ response_type: 'code', client_id: id, scope: SCOPES, redirect_uri: REDIRECT, code_challenge_method: 'S256', code_challenge: challenge, state });
    location.assign(url.toString());
  } catch (error) { message(error.message); }
};
async function tokenRequest(params) {
  const version = sessionVersion;
  const id = localStorage.getItem(KEY);
  if (!id) throw Error('Client ID ontbreekt.');
  const response = await request('https://accounts.spotify.com/api/token', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ ...params, client_id: id })
  });
  const data = await response.json();
  if (!response.ok) {
    if (data.error === 'invalid_grant' && version === sessionVersion) clearSession();
    throw Error(data.error === 'invalid_grant' ? 'Je Spotify-sessie is verlopen. Verbind opnieuw.' : data.error_description || 'Spotify-aanmelding mislukt.');
  }
  return data;
}
async function getToken() {
  if (accessToken && Date.now() < expiresAt) return accessToken;
  const refresh = sessionStorage.getItem('skc_refresh');
  if (!refresh) { clearSession(); throw Error('Verbind opnieuw met Spotify.'); }
  if (!refreshing) {
    const version = sessionVersion;
    const job = tokenRequest({ grant_type: 'refresh_token', refresh_token: refresh }).then(data => {
      if (version !== sessionVersion) throw Error('De verbinding is verbroken.');
      saveTokens(data);
      return accessToken;
    });
    refreshing = job;
    job.finally(() => { if (refreshing === job) refreshing = null; }).catch(() => {});
  }
  return refreshing;
}
async function spotify(path) {
  if (Date.now() < rateLimitUntil) throw Error('Spotify-limiet bereikt. Wacht even voor je opnieuw probeert.');
  const version = sessionVersion;
  const send = async () => request('https://api.spotify.com/v1/' + path, { headers: { Authorization: 'Bearer ' + await getToken() } });
  let response = await send();
  if (version !== sessionVersion) throw Error('De verbinding is verbroken.');
  if (response.status === 401 && sessionStorage.getItem('skc_refresh')) {
    expiresAt = 0;
    response = await send();
  }
  if (version !== sessionVersion) throw Error('De verbinding is verbroken.');
  if (response.status === 204) return null;
  if (response.status === 401) { clearSession(); throw Error('Je Spotify-sessie is verlopen. Verbind opnieuw.'); }
  if (response.status === 429) {
    rateLimitUntil = Date.now() + Math.max(1, Number(response.headers.get('Retry-After')) || 30) * 1000;
    throw Error('Spotify-limiet bereikt. Automatisch ophalen wacht tot je weer verzoeken mag doen.');
  }
  if (response.status === 403) throw Error('Geen Spotify-toegang. Controleer je appinstellingen en of je account is toegestaan.');
  if (!response.ok) throw Error('Spotify API-fout ' + response.status + '. Probeer later opnieuw.');
  return response.json();
}
function fact(label, value) {
  if (value === null || value === undefined || value === '') return null;
  const cell = document.createElement('div'); cell.className = 'fact';
  const dt = document.createElement('dt'); dt.textContent = label;
  const dd = document.createElement('dd'); dd.textContent = String(value);
  cell.append(dt, dd); return cell;
}
function addFacts(element, rows) { element.replaceChildren(...rows.map(([key, value]) => fact(key, value)).filter(Boolean)); }
function sourceLink(text, href) {
  const link = document.createElement('a'); link.textContent = text + ' ↗';
  link.href = href; link.target = '_blank'; link.rel = 'noopener noreferrer'; link.className = 'artist-source';
  return link;
}
function note(text, className = 'muted') { const p = document.createElement('p'); p.className = className; p.textContent = text; return p; }
function setImage(image, url, alt) {
  image.alt = alt;
  image.hidden = !url;
  image.onerror = () => { image.hidden = true; };
  if (url) image.src = url; else image.removeAttribute('src');
}

// Source-backed snapshots from the owner's Billboard and Ultratop projects.
// Load only after the user requests music information; no background refresh job.
let referenceCatalog = null;
async function loadReferenceCatalog() {
  if (!referenceCatalog) {
    const job = request('data/artist-references.json?v=1').then(async response => {
      if (!response.ok) throw Error('Referentieprofielen niet beschikbaar');
      const catalog = await response.json();
      return catalog.version === 1 && Array.isArray(catalog.artists) ? catalog.artists : [];
    }).catch(() => []);
    referenceCatalog = job;
    job.then(records => { if (!records.length && referenceCatalog === job) referenceCatalog = null; });
  }
  return referenceCatalog;
}
function findReference(records, artist, wd = null) {
  const direct = records.filter(record => record.spotifyIds?.includes(artist.id));
  if (direct.length === 1) return direct[0];
  if (!wd?.verifiedSpotify || !wd.musicBrainzId) return null;
  const verified = records.filter(record => record.musicBrainzId === wd.musicBrainzId);
  return verified.length === 1 ? verified[0] : null;
}
function referenceFact(profile, field) {
  const fact = profile?.[field];
  // Do not silently choose between disagreeing saved sources.
  return !profile?.conflicts?.[field] && fact?.value != null && /^https:\/\//.test(fact.url || '') ? fact : null;
}

const wdCache=new Map();
async function wikidataArtist(name,spotifyArtistId){
 const cacheKey=spotifyArtistId||name;
 if(wdCache.has(cacheKey))return wdCache.get(cacheKey);
 const task=(async()=>{
  const base='https://www.wikidata.org/w/api.php?origin=*&format=json&action=';
  const search=await request(base+'wbsearchentities&language=en&type=item&limit=8&search='+encodeURIComponent(name));
  if(!search.ok)throw Error('Wikidata niet beschikbaar');
  const results=(await search.json()).search||[];
  const normalize=x=>x.normalize('NFKD').replace(/[\u0300-\u036f]/g,'').replace(/[^\p{L}\p{N}]/gu,'').toLowerCase();
  const candidates=results; // A matching Spotify ID also verifies an alias or stage name.
  if(!candidates.length)return null;
  const res=await request(base+'wbgetentities&props=claims%7Clabels&languages=nl%7Cen&ids='+candidates.map(x=>encodeURIComponent(x.id)).join('%7C'));
  if(!res.ok)throw Error('Wikidata niet beschikbaar');
  const entities=(await res.json()).entities||{};
  const musicTypes=new Set(['Q5741069','Q215380','Q2088357','Q43229','Q483501','Q105756498','Q9212979','Q5']);
  const musicianOccupations=new Set(['Q177220','Q49757','Q488205','Q639669','Q2252262','Q753110','Q36834','Q765778','Q2405480','Q183945','Q130857','Q55960555']);
  const candidatesWithEvidence=candidates.map(c=>{
   const e=entities[c.id];if(!e)return null;
   const claims=e.claims||{};
   const values=p=>(claims[p]||[]).filter(x=>x.rank!=='deprecated').map(x=>x.mainsnak?.datavalue?.value).filter(Boolean);
   const spotifyIds=values('P1902').map(v=>typeof v==='string'?v:v.id);
   const types=values('P31').map(v=>v.id);
   const occupations=values('P106').map(v=>v.id);
   const description=(c.description||'').toLowerCase();
   const musical=types.some(t=>musicTypes.has(t)&&t!=='Q5')||occupations.some(o=>musicianOccupations.has(o))||/singer|rapper|musician|songwriter|record producer|disc jockey|dj|band|music group|musical group|duo|singer-songwriter|zanger|muzikant|artiest/.test(description);
   return {candidate:c,entity:e,spotifyIds,musical};
  }).filter(Boolean);
  const direct=candidatesWithEvidence.filter(x=>x.spotifyIds.includes(spotifyArtistId));
  const possible=candidatesWithEvidence.filter(x=>x.musical&&!x.spotifyIds.length&&normalize(x.candidate.label)===normalize(name));
  const selected=direct.length===1?direct[0]:direct.length>1?null:possible.length===1?possible[0]:null;
  if(!selected)return null;
  const match=selected.candidate;
  const entity=selected.entity;
  const claim=id=>(entity.claims?.[id]||[]).find(x=>x.rank!=='deprecated')?.mainsnak?.datavalue?.value;
  const item=id=>claim(id)?.id||null;
  const countryId=item('P27')||item('P17')||item('P495');
  const genderId=item('P21');
  const placeId=item('P19')||item('P740');
  const genreId=item('P136');
  const memberClaims=(entity.claims?.P527||[]).filter(c=>c.rank!=='deprecated'&&c.mainsnak?.datavalue?.value?.id);
  const currentMemberClaims=memberClaims.filter(c=>!c.qualifiers?.P582);
  const formerMemberClaims=memberClaims.filter(c=>!!c.qualifiers?.P582);
  const memberIds=[...new Set(memberClaims.map(c=>c.mainsnak.datavalue.value.id))];
  const ids=[countryId,genderId,placeId,genreId,...memberIds].filter(Boolean);
  let labels={};
  if(ids.length){const lr=await request(base+'wbgetentities&props=labels%7Cclaims&languages=nl%7Cen&ids='+ids.join('%7C'));if(lr.ok)labels=(await lr.json()).entities||{};}
  const instrumentIds=[...new Set(memberIds.flatMap(id=>['P1303','P19','P27'].flatMap(prop=>(labels[id]?.claims?.[prop]||[]).filter(c=>c.rank!=='deprecated').map(c=>c.mainsnak?.datavalue?.value?.id).filter(Boolean))))];
  if(instrumentIds.length){
   const instrumentLabels=await request(base+'wbgetentities&props=labels&languages=nl%7Cen&ids='+instrumentIds.join('%7C'));
   if(instrumentLabels.ok)Object.assign(labels,(await instrumentLabels.json()).entities||{});
  }
  const label=id=>id?(labels[id]?.labels?.nl?.value||labels[id]?.labels?.en?.value||null):null;
  const human=(entity.claims?.P31||[]).some(c=>c.mainsnak?.datavalue?.value?.id==='Q5');
  const birthValue=claim('P569');
  const rawDate=birthValue?.time;
  const died=claim('P570')?.time;
  const death=died?.match(/^\+(\d{4})/)?.[1]||null;
  let birth=null,age=null;
  if(rawDate){const m=rawDate.match(/^\+(\d{4})-(\d{2})-(\d{2})/);if(m){birth=birthValue.precision>=11&&m[3]!=='00'&&m[2]!=='00'?m[3]+'/'+m[2]+'/'+m[1]:m[1];if(!death&&birthValue.precision>=11&&m[2]!=='00'&&m[3]!=='00'){const now=new Date();age=now.getUTCFullYear()-Number(m[1])-(now.getUTCMonth()+1<Number(m[2])||(now.getUTCMonth()+1===Number(m[2])&&now.getUTCDate()<Number(m[3]))?1:0);}}}
  const started=claim('P2031')?.time||claim('P571')?.time;
  const year=started?.match(/^\+(\d{4})/)?.[1]||null;
  const gender=label(genderId);
  const memberGenders=memberIds.map(id=>{
   const genderClaim=(labels[id]?.claims?.P21||[]).find(c=>c.rank!=='deprecated')?.mainsnak?.datavalue?.value?.id;
   if(genderClaim==='Q6581097')return 'Male';
   if(genderClaim==='Q6581072')return 'Female';
   if(['Q48270','Q1097630'].includes(genderClaim))return 'Non-binair';
   return null;
  });
  const currentIds=[...new Set(currentMemberClaims.map(c=>c.mainsnak.datavalue.value.id))];
  const currentGenders=currentIds.map(id=>memberGenders[memberIds.indexOf(id)]);
  const groupGender=currentIds.length>0&&currentGenders.every(Boolean)?
   (new Set(currentGenders).size===1?currentGenders[0]:'Mixed'):null;
  const memberDetails=memberIds.map(id=>{
   const entityMember=labels[id];
   const instruments=(entityMember?.claims?.P1303||[]).filter(c=>c.rank!=='deprecated').map(c=>c.mainsnak?.datavalue?.value?.id).filter(Boolean);
   const birthValue=(entityMember?.claims?.P569||[]).find(c=>c.rank!=='deprecated')?.mainsnak?.datavalue?.value;
   const birthTime=birthValue?.time;
   const deceased=(entityMember?.claims?.P570||[]).some(c=>c.rank!=='deprecated'&&c.mainsnak?.datavalue?.value);
   const born=birthTime?.match(/^\+(\d{4})-(\d{2})-(\d{2})/);
   const birth=born?(birthValue?.precision>=11&&born[2]!=='00'&&born[3]!=='00'?born[3]+'/'+born[2]+'/'+born[1]:born[1]):null;
   const memberClaim=prop=>(entityMember?.claims?.[prop]||[]).find(c=>c.rank!=='deprecated')?.mainsnak?.datavalue?.value;
   const photo=memberClaim('P18');
   return {id,name:label(id)||id,deceased,current:currentIds.includes(id),instruments:instruments.map(label).filter(Boolean),birth,
    place:label(memberClaim('P19')?.id),country:label(memberClaim('P27')?.id),
    image:photo?'https://commons.wikimedia.org/wiki/Special:FilePath/'+encodeURIComponent(photo)+'?width=200':null};
  });
  return {id:match.id,human,birth,age,death,musicBrainzId:claim('P434'),verifiedSpotify:!!spotifyArtistId&&selected.spotifyIds.includes(spotifyArtistId),image:claim('P18')?'https://commons.wikimedia.org/wiki/Special:FilePath/'+encodeURIComponent(claim('P18'))+'?width=300':null,country:label(countryId),countryId,gender,genre:label(genreId),place:label(placeId),started:year,members:currentIds.map(label).filter(Boolean),formerMembers:[...new Set(formerMemberClaims.map(c=>c.mainsnak.datavalue.value.id))].filter(id=>!currentIds.includes(id)).map(label).filter(Boolean),memberDetails,groupGender};
 })().catch(()=>null);
 wdCache.set(cacheKey,task); task.then(value => { if (!value && wdCache.get(cacheKey) === task) wdCache.delete(cacheKey); }); return task;
}

// MusicBrainz permits roughly one request per second. Share lookups across artist cards.
let mbQueue = Promise.resolve();
function mbFetch(url) {
  const job = mbQueue.catch(() => {}).then(async () => {
    let response = await request(url, { headers: { Accept: 'application/json' } });
    if ([429, 503].includes(response.status)) {
      const retryAfter = Number(response.headers.get('Retry-After'));
      // Retry a temporary outage once, without blocking all sources for a long wait.
      if (!Number.isFinite(retryAfter) || retryAfter <= 10) {
        await new Promise(resolve => setTimeout(resolve, Math.max(1200, (retryAfter || 0) * 1000)));
        response = await request(url, { headers: { Accept: 'application/json' } });
      }
    }
    if (!response.ok) throw Error('MusicBrainz niet beschikbaar');
    return response.json();
  });
  mbQueue = job.then(() => new Promise(resolve => setTimeout(resolve, 1200)), () => new Promise(resolve => setTimeout(resolve, 1200)));
  return job;
}
const mbProfileCache = new Map();
async function musicBrainzProfile(artist) {
  if (mbProfileCache.has(artist.id)) return mbProfileCache.get(artist.id);
  const task = (async () => {
    const norm = value => value.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^\p{L}\p{N}]/gu, '').toLowerCase();
    const saved = findReference(await loadReferenceCatalog(), artist);
    const wd = saved ? null : await wikidataArtist(artist.name, artist.id);
    // A verified cross-reference avoids the separate, sometimes unavailable search service.
    const linkedId = saved?.musicBrainzId || (wd?.verifiedSpotify ? wd.musicBrainzId : null);
    let id = /^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i.test(linkedId || '') ? linkedId : null;
    if (!id) {
      const query = 'artist:"' + artist.name.replace(/["\\]/g, '') + '"';
      const result = await mbFetch('https://musicbrainz.org/ws/2/artist/?query=' + encodeURIComponent(query) + '&fmt=json&limit=25');
      const matches = (result.artists || []).filter(item => norm(item.name) === norm(artist.name) && Number(item.score) >= 95);
      // Never guess between artists with the same name.
      if (matches.length !== 1) return null;
      id = matches[0].id;
    }
    const detail = await mbFetch('https://musicbrainz.org/ws/2/artist/' + encodeURIComponent(id) + '?inc=genres+url-rels&fmt=json');
    const links = (detail.relations || []).map(item => item.url?.resource).filter(url => /^https:\/\/open\.spotify\.com\/artist\//.test(url || ''));
    if (links.length && !links.some(url => new URL(url).pathname === '/artist/' + artist.id)) return null;
    const genres = (detail.genres || []).filter(item => item.name && item.count > 0).sort((a, b) => b.count - a.count);
    return { id: detail.id || id, genre: genres[0]?.name, countryCode: detail.country, type: detail.type };
  })().catch(() => null);
  mbProfileCache.set(artist.id, task);
  task.then(value => { if (!value && mbProfileCache.get(artist.id) === task) mbProfileCache.delete(artist.id); });
  return task;
}
const debutCache = new Map();
function releasedYear(date) {
  const match = /^(\d{4})(?:-(\d{2})(?:-(\d{2}))?)?$/.exec(date || '');
  if (!match || Number(match[1]) < 1) return null;
  const month = Number(match[2] || 1), day = Number(match[3] || 1);
  const parsed = new Date(`${match[1]}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}T00:00:00Z`);
  if (!Number.isFinite(parsed.getTime()) || parsed.getUTCMonth() + 1 !== month || parsed.getUTCDate() !== day || parsed > new Date()) return null;
  return Number(match[1]);
}
async function musicBrainzDebut(artist) {
  if (debutCache.has(artist.id)) return debutCache.get(artist.id);
  const task = (async () => {
    const profile = await musicBrainzProfile(artist);
    if (!profile) return null;
    const all = [];
    let total = 0;
    for (let offset = 0; offset < 500; offset += 100) {
      const page = await mbFetch('https://musicbrainz.org/ws/2/release-group?artist=' + encodeURIComponent(profile.id) + '&fmt=json&limit=100&offset=' + offset);
      const groups = page['release-groups'] || [];
      all.push(...groups);
      total = page['release-group-count'] || all.length;
      if (!groups.length || all.length >= total) break;
    }
    const valid = all.filter(item => /^(Album|Single|EP)$/.test(item['primary-type'] || '') &&
      !(item['secondary-types'] || []).some(type => /^(Live|Compilation|Remix|DJ-mix|Mixtape\/Street|Demo)$/i.test(type)) &&
      releasedYear(item['first-release-date']) !== null);
    valid.sort((a, b) => a['first-release-date'].localeCompare(b['first-release-date']));
    const first = valid[0];
    return first ? { year: Number(first['first-release-date'].slice(0, 4)), title: first.title, partial: all.length < total,
      link: 'https://musicbrainz.org/release-group/' + first.id } : null;
  })().catch(() => null);
  debutCache.set(artist.id, task);
  task.then(value => { if (!value && debutCache.get(artist.id) === task) debutCache.delete(artist.id); });
  return task;
}
const spotifyDebutCache = new Map();
function catalogDebut(albums, artistId, partial = false) {
  const eligible = albums.filter(album => ['album', 'single'].includes(album.album_type) &&
    !['appears_on', 'compilation'].includes(album.album_group) &&
    album.artists?.some(artist => artist.id === artistId) && releasedYear(album.release_date) !== null);
  eligible.sort((a, b) => a.release_date.localeCompare(b.release_date));
  const first = eligible[0];
  return first ? { year: releasedYear(first.release_date), title: first.name,
    link: first.id ? 'https://open.spotify.com/album/' + encodeURIComponent(first.id) : null,
    approximate: true, partial, source: 'Spotify' } : null;
}
async function spotifyDebut(artist) {
  if (spotifyDebutCache.has(artist.id)) return spotifyDebutCache.get(artist.id);
  const task = (async () => {
    const albums = [];
    let offset = 0, partial = false;
    try {
      while (offset < 500) {
        const page = await spotify('artists/' + encodeURIComponent(artist.id) + '/albums?include_groups=album,single&limit=50&offset=' + offset);
        if (!page?.items?.length) break;
        albums.push(...page.items);
        offset += page.items.length;
        partial = Boolean(page.next);
        if (!page.next) break;
      }
    } catch { partial = true; }
    return catalogDebut(albums, artist.id, partial);
  })();
  spotifyDebutCache.set(artist.id, task);
  task.then(value => { if ((!value || value.partial) && spotifyDebutCache.get(artist.id) === task) spotifyDebutCache.delete(artist.id); });
  return task;
}
const trackReleaseCache = new Map();
async function earliestRecordingRelease(isrc) {
  if (!/^[A-Z]{2}[A-Z0-9]{3}\d{7}$/i.test(isrc || '')) return null;
  const key = isrc.toUpperCase();
  if (trackReleaseCache.has(key)) return trackReleaseCache.get(key);
  const task = (async () => {
    const result = await mbFetch('https://musicbrainz.org/ws/2/isrc/' + key + '?fmt=json');
    const candidates = [];
    for (const recording of (result.recordings || []).slice(0, 5)) {
      const detail = await mbFetch('https://musicbrainz.org/ws/2/recording/' + encodeURIComponent(recording.id) + '?inc=releases&fmt=json');
      for (const release of detail.releases || []) {
        if (release.status === 'Official' && /^\d{4}(?:-\d{2}(?:-\d{2})?)?$/.test(release.date || '')) {
          candidates.push({ date: release.date, title: release.title, recordingId: recording.id });
        }
      }
    }
    candidates.sort((a, b) => a.date.localeCompare(b.date));
    return candidates[0] || null;
  })().catch(() => null);
  trackReleaseCache.set(key, task);
  task.then(value => { if (!value && trackReleaseCache.get(key) === task) trackReleaseCache.delete(key); });
  return task;
}
function dateNL(value) {
  if (!value) return null;
  const parts = value.split('-');
  return parts.reverse().join('/');
}
function duration(ms) { return Number.isFinite(ms) ? `${Math.floor(ms / 60000)}:${String(Math.floor(ms / 1000) % 60).padStart(2, '0')}` : null; }
function countryName(code) {
  if (!/^[A-Z]{2}$/.test(code || '')) return null;
  const flag = String.fromCodePoint(...[...code].map(char => 127397 + char.charCodeAt(0)));
  return flag + ' ' + new Intl.DisplayNames(['nl'], { type: 'region' }).of(code);
}
function debutExplanation(debut) {
  if (!debut) return 'Geen betrouwbare debuutbron gevonden. Probeer later opnieuw.';
  if (debut.reference) return 'Opgeslagen debuutjaar uit je Billboard-/Ultratop-project. Dit kan afwijken van de eerste single of EP.';
  if (debut.upperBound) return 'Alleen deze Spotify-uitgave is bekend: het debuut was uiterlijk in ' + debut.year + '. Het exacte debuutjaar is niet bevestigd.';
  if (debut.approximate) return 'Schatting op basis van de vroegste gevonden Spotify-uitgave. Het historische debuut kan vroeger liggen.' + (debut.partial ? ' De discografie is niet volledig opgehaald.' : '');
  return (debut.partial ? 'Gedeeltelijke discografie. ' : '') + 'Vroegste gevonden studio-uitgave in MusicBrainz; geen garantie op het historische debuut.';
}
function spotleGrid(info, wd, debut, mb, debutPending = false, reference = null) {
  const grid = document.createElement('dl'); grid.className = 'spotle-grid';
  const popularity = Number.isFinite(info?.popularity) ? info.popularity + '/100' : 'Onbekend';
  const gender = referenceFact(reference, 'gender')?.value || (wd?.human ? wd.gender : wd?.groupGender);
  const savedType = referenceFact(reference, 'type')?.value;
  const values = [
    ['Debut', debut ? (debut.upperBound ? '≤ ' : '') + debut.year + (!debut.upperBound && (debut.partial || debut.approximate) ? ' ≈' : '') : debutPending ? 'Zoeken…' : 'Onbekend', debutExplanation(debut)],
    ['Members', savedType === 'Person' ? 'Solo' : referenceFact(reference, 'members')?.value || (wd?.human || mb?.type === 'Person' ? 'Solo' : wd?.members?.length || 'Onbekend'), 'Opgeslagen aantal uit je chartproject indien beschikbaar, anders Wikidata. Bezettingen kunnen veranderen.'],
    ['Popularity', popularity, 'Spotify-populariteit van 0 tot 100, geen Spotle-rangschikking. Niet voor elke app beschikbaar.'],
    ['Gender', gender || 'Onbekend', 'Opgeslagen waarde uit je chartproject indien beschikbaar, anders Wikidata.'],
    ['Genre', referenceFact(reference, 'genre')?.value || info?.genres?.[0] || wd?.genre || mb?.genre || 'Onbekend', 'Opgeslagen genre uit je chartproject indien beschikbaar, anders Spotify, Wikidata of MusicBrainz.'],
    ['Country', referenceFact(reference, 'country')?.value || wd?.country || countryName(mb?.countryCode) || 'Onbekend', 'Opgeslagen herkomst uit je chartproject indien beschikbaar, anders Wikidata of MusicBrainz.']
  ];
  for (const [label, value, explanation] of values) {
    const tile = document.createElement('div'); tile.className = 'spotle-tile'; tile.title = explanation;
    const dt = document.createElement('dt'); dt.className = 'spotle-label'; dt.textContent = label;
    const dd = document.createElement('dd'); dd.className = 'spotle-value'; dd.textContent = value;
    tile.classList.toggle('unknown', value === 'Onbekend'); tile.append(dt, dd); grid.append(tile);
  }
  return grid;
}
function renderMembers(members) {
  const section = document.createElement('section'); section.className = 'member-section';
  const title = document.createElement('h5'); title.textContent = 'Bandleden · volgens Wikidata'; section.append(title);
  const list = document.createElement('div'); list.className = 'member-list';
  for (const member of members) {
    const article = document.createElement('article'); article.className = 'member';
    const image = document.createElement('img'); image.loading = 'lazy';
    setImage(image, member.image, 'Foto van ' + member.name);
    const heading = document.createElement('h6'); heading.textContent = member.name;
    const facts = document.createElement('dl'); facts.className = 'facts';
    let age = null;
    if (/^\d{2}\/\d{2}\/\d{4}$/.test(member.birth || '') && !member.deceased) {
      const [day, month, year] = member.birth.split('/').map(Number), now = new Date();
      age = now.getUTCFullYear() - year - (now.getUTCMonth() + 1 < month || (now.getUTCMonth() + 1 === month && now.getUTCDate() < day) ? 1 : 0);
      if (age < 0 || age > 125) age = null;
    }
    addFacts(facts, [['Lidmaatschap', member.current ? 'Huidig volgens bron' : 'Voormalig volgens bron'], ['Instrumenten', member.instruments?.join(', ') || 'Onbekend'],
      ['Geboren', member.birth || 'Onbekend'], ['Leeftijd', member.deceased ? 'Overleden' : age !== null ? age + ' jaar' : 'Onbekend'],
      ['Geboorteplaats', member.place || 'Onbekend'], ['Land', member.country || 'Onbekend']]);
    article.append(image, heading, facts);
    if (member.id) article.append(sourceLink('Wikidata', 'https://www.wikidata.org/wiki/' + member.id));
    list.append(article);
  }
  section.append(list); return section;
}
function renderArtist(artist, version, example = null, album = null) {
  const card = document.createElement('article'); card.className = 'artist';
  const head = document.createElement('div'); head.className = 'artisthead';
  const image = document.createElement('img'); image.loading = 'lazy'; image.hidden = true;
  const name = document.createElement('h4'); name.textContent = artist.name;
  head.append(image, name);
  let grid = spotleGrid(null, null, null, null, true);
  const debutStatus = note('Debuutjaar zoeken…', 'hint debut-status');
  const sourceStatus = note('Aanvullende bronnen laden…', 'source-status'); sourceStatus.setAttribute('role', 'status');
  const details = document.createElement('details');
  const summary = document.createElement('summary'); summary.textContent = 'Artiestgegevens & bandleden';
  const facts = document.createElement('dl'); facts.className = 'facts';
  const sources = document.createElement('div'); sources.className = 'sources';
  if (!example) sources.append(sourceLink('Spotify-profiel', 'https://open.spotify.com/artist/' + encodeURIComponent(artist.id)));
  const members = document.createElement('div');
  details.append(summary, facts, members, sources);
  card.append(head, grid, debutStatus, sourceStatus, details); $('artists').append(card);
  let info = null, wd = null, mb = null, debut = null, spotifyEstimate = null, references = [], pending = 6, debutPending = 2;
  const albumBound = album ? catalogDebut([album], artist.id) : null;
  if (albumBound) albumBound.upperBound = true;
  const alive = () => version === viewVersion && card.isConnected;
  const update = () => {
    if (!alive()) return;
    const reference = example ? null : findReference(references, artist, wd);
    const savedYear = referenceFact(reference, 'debut');
    const savedDebut = savedYear && releasedYear(String(savedYear.value)) ? { year: savedYear.value, link: savedYear.url, title: 'opgeslagen debuutjaar', reference: true } : null;
    const firstRelease = [debut, spotifyEstimate, albumBound].filter(Boolean).sort((a, b) => a.year - b.year)[0] || null;
    // User preference: their saved chart-project values take precedence over live inferences.
    const chosenDebut = savedDebut || firstRelease;
    const next = spotleGrid(info, wd, chosenDebut, mb, debutPending > 0, reference); grid.replaceWith(next); grid = next;
    debutStatus.textContent = example ? 'Fictief debuutjaar, alleen ter illustratie.' : chosenDebut ? debutExplanation(chosenDebut) : debutPending ? 'Debuutjaar wordt gezocht in MusicBrainz en Spotify…' : debutExplanation(null);
    if (chosenDebut?.link && !example) debutStatus.append(' ', sourceLink('Debuutbron', chosenDebut.link));
    setImage(image, info?.images?.[0]?.url || wd?.image, 'Foto van ' + artist.name);
    addFacts(facts, [['Naam', artist.name], ['Genres', referenceFact(reference, 'genre')?.value || info?.genres?.join(', ') || wd?.genre || mb?.genre || 'Onbekend'],
      ['Land', referenceFact(reference, 'country')?.value || wd?.country || countryName(mb?.countryCode) || 'Onbekend'], ['Geboorteplaats / opgericht in', wd?.place || 'Onbekend'],
      ['Geboortedatum', wd?.birth], ['Leeftijd', wd?.death ? 'Overleden in ' + wd.death : wd?.age != null ? wd.age + ' jaar' : null],
      ['Actief / opgericht sinds', wd?.started], ['Vroegste automatisch gevonden uitgave', savedDebut && firstRelease ? (firstRelease.upperBound ? 'Uiterlijk ' : '') + firstRelease.year + (firstRelease.approximate && !firstRelease.upperBound ? ' (schatting)' : '') : null], ['Spotify-volgers', Number.isFinite(info?.followers?.total) ? info.followers.total.toLocaleString('nl-BE') : null]]);
    members.replaceChildren(...(wd?.memberDetails?.length ? [renderMembers(wd.memberDetails)] : []));
    sources.replaceChildren();
    if (!example) sources.append(sourceLink('Spotify-profiel', 'https://open.spotify.com/artist/' + encodeURIComponent(artist.id)));
    if (wd?.id && !example) sources.append(sourceLink('Biografie: Wikidata', 'https://www.wikidata.org/wiki/' + wd.id));
    if (mb?.id && !example) sources.append(sourceLink('Genre / identiteit: MusicBrainz', 'https://musicbrainz.org/artist/' + mb.id));
    if (chosenDebut?.link && !example) sources.append(sourceLink('Debuut: ' + chosenDebut.title, chosenDebut.link));
    if (referenceFact(reference, 'genre')) sources.append(sourceLink('Bron opgeslagen genre', reference.genre.url));
    if (reference?.references?.[0]) sources.append(sourceLink('Profiel uit je chartproject', reference.references[0]));
    if (example) sourceStatus.textContent = 'Fictief voorbeeld · geen echte Spotify- of Spotle-gegevens.';
    else if (pending) sourceStatus.textContent = 'Bronnen laden… De beschikbare gegevens verschijnen meteen.';
    else sourceStatus.textContent = [reference ? 'Opgeslagen Billboard-/Ultratop-profiel' : null, info || spotifyEstimate || albumBound ? 'Spotify' : null, wd ? 'Wikidata' : null, mb ? 'MusicBrainz' : null].filter(Boolean).join(' · ') || 'Geen betrouwbare aanvullende match gevonden. Probeer later opnieuw.';
    if (!pending && !example) sourceStatus.append(document.createTextNode(' · Onbekend betekent: niet beschikbaar of niet eenduidig gevonden.'));
    if (chosenDebut && !example) sources.append(note(debutExplanation(chosenDebut)));
  };
  if (example) { ({ info, wd, mb, debut } = example); pending = 0; update(); return; }
  update();
  const load = (promise, assign, isDebut = false) => promise.then(value => { if (alive()) assign(value); }).catch(() => {}).finally(() => { pending--; if (isDebut) debutPending--; update(); });
  load(loadReferenceCatalog(), value => { references = value; });
  load(spotify('artists/' + encodeURIComponent(artist.id)), value => { info = value; });
  load(wikidataArtist(artist.name, artist.id), value => { wd = value; });
  load(musicBrainzProfile(artist), value => { mb = value; });
  load(musicBrainzDebut(artist), value => { debut = value; }, true);
  load(spotifyDebut(artist), value => { spotifyEstimate = value; }, true);
}
function renderTrack(track, playing, version) {
  $('emptyState').hidden = true; $('result').hidden = false;
  $('trackTitle').textContent = track.name;
  $('artistNames').textContent = (track.artists || []).map(artist => artist.name).join(', ');
  $('playbackState').textContent = demo ? 'VOORBEELD · FICTIEVE GEGEVENS' : playing.is_playing ? 'NU OP SPOTIFY' : 'GEPAUZEERD OP SPOTIFY';
  $('spotifyLink').hidden = demo;
  $('spotifyLink').href = track.external_urls?.spotify || 'https://open.spotify.com/';
  setImage($('cover'), track.album?.images?.[0]?.url, 'Albumhoes van ' + (track.album?.name || track.name));
  addFacts($('trackFacts'), [['Titel', track.name], ['Artiest(en)', (track.artists || []).map(artist => artist.name).join(', ')],
    ['Spotify-uitgave', dateNL(track.album?.release_date)], ['Album', track.album?.name], ['Speelduur', duration(track.duration_ms)], ['Tracknummer', track.track_number]]);
  $('releaseStatus').textContent = demo ? 'Voorbeeld van een Spotify-uitgave, geen echte releasedatum.' : 'De Spotify-uitgave kan een heruitgave zijn. De vroegste bekende opname-uitgave wordt apart opgezocht.';
  $('releaseSource').replaceChildren();
  $('sampleSearch').hidden = demo;
  $('sampleSearch').href = 'https://www.google.com/search?q=' + encodeURIComponent('site:whosampled.com ' + (track.artists || []).map(artist => artist.name).join(' ') + ' ' + track.name);
  $('artists').replaceChildren();
  for (const artist of track.artists || []) renderArtist(artist, version, demo ? exampleArtist : null, track.album);
  addFacts($('extras'), [['Spotify-albumtype', track.album?.album_type], ['ISRC', track.external_ids?.isrc], ['Expliciete inhoud', track.explicit ? 'Ja' : 'Nee']]);
  if (demo) return;
  if (!track.external_ids?.isrc) { $('releaseStatus').textContent = 'Geen ISRC beschikbaar om de oorspronkelijke opname betrouwbaar op te zoeken.'; return; }
  earliestRecordingRelease(track.external_ids.isrc).then(first => {
    if (version !== viewVersion) return;
    $('releaseStatus').textContent = first ? 'Vroegste gevonden officiële uitgave van deze opname: ' + dateNL(first.date) + ' · ' + first.title + '. Dit is niet noodzakelijk de eerste uitgave van de compositie.' : 'Geen eerdere opname-uitgave gevonden of MusicBrainz niet bereikbaar. De Spotify-datum hierboven blijft de datum van die specifieke uitgave.';
    if (first) $('releaseSource').append(sourceLink('Opnamebron: MusicBrainz', 'https://musicbrainz.org/recording/' + first.recordingId));
  });
}
async function loadTrack(force = false) {
  if (loading || Date.now() < rateLimitUntil) return;
  const session = sessionVersion;
  loading = true; $('refresh').disabled = true; $('refresh').textContent = 'Ophalen…';
  $('result').setAttribute('aria-busy', 'true');
  message('Huidig nummer ophalen…');
  try {
    const playing = await spotify('me/player/currently-playing?additional_types=track');
    if (session !== sessionVersion) return;
    demo = false;
    if (!playing?.item || playing.item.type !== 'track') {
      viewVersion++; currentKey = null; $('result').hidden = true; $('emptyState').hidden = false;
      message(playing?.item?.type === 'episode' ? 'Er speelt een podcast. Speel een muzieknummer af voor artiestenkennis.' : 'Er speelt geen beschikbaar Spotify-nummer. Start muziek in Spotify en probeer opnieuw.'); return;
    }
    const track = playing.item;
    const key = track.id || track.uri;
    if (!force && currentKey === key) {
      $('playbackState').textContent = playing.is_playing ? 'NU OP SPOTIFY' : 'GEPAUZEERD OP SPOTIFY';
      message('Gecontroleerd om ' + new Date().toLocaleTimeString('nl-BE') + '.'); return;
    }
    currentKey = key; const version = ++viewVersion;
    renderTrack(track, playing, version);
    message('Nummer opgehaald. Het artiestenkader wordt aangevuld vanuit de bronnen.');
  } catch (error) {
    if (session === sessionVersion || !accessToken) message(error.message);
  } finally {
    loading = false; $('refresh').disabled = !accessToken && !sessionStorage.getItem('skc_refresh'); $('refresh').textContent = 'Huidig nummer ophalen';
    $('result').setAttribute('aria-busy', 'false');
  }
}
function stopAuto() {
  if (timer !== null) clearInterval(timer);
  timer = null; $('toggleAuto').textContent = 'Kennismodus starten'; $('toggleAuto').setAttribute('aria-pressed', 'false');
  $('modeStatus').textContent = 'Uit · er wordt niets automatisch opgehaald.';
}
$('refresh').onclick = () => loadTrack(true);
$('toggleAuto').onclick = () => {
  if (timer !== null) { stopAuto(); message('Kennismodus gestopt. Je kunt gewoon verder luisteren.'); return; }
  loadTrack(true);
  timer = setInterval(() => { if (!document.hidden) loadTrack(false); }, 12000);
  $('toggleAuto').textContent = 'Kennismodus stoppen'; $('toggleAuto').setAttribute('aria-pressed', 'true');
  $('modeStatus').textContent = 'Aan · controle om de 12 seconden, alleen zolang dit tabblad zichtbaar is.';
};
$('logout').onclick = () => { clearSession(); demo = false; $('result').hidden = true; $('emptyState').hidden = false; message('Verbinding verbroken. Er wordt niets meer opgehaald.'); };
window.addEventListener('pagehide', stopAuto);
const exampleArtist = {
  info: { genres: ['Indierock'], popularity: 64, followers: { total: 123456 } },
  wd: { human: false, country: 'België', place: 'Gent', started: '2012', groupGender: 'Gemengd',
    members: ['Alex Voorbeeld', 'Sam Voorbeeld'], memberDetails: [
      { id: '', name: 'Alex Voorbeeld', current: true, birth: '14/03/1992', place: 'Gent', country: 'België', instruments: ['Zang', 'Gitaar'] },
      { id: '', name: 'Sam Voorbeeld', current: true, birth: '22/09/1991', place: 'Antwerpen', country: 'België', instruments: ['Drums'] }
    ] },
  debut: { year: 2014, title: 'Eerste licht' }, mb: { type: 'Group' }
};
$('showExample').onclick = () => {
  if (loading) return;
  stopAuto(); demo = true; document.querySelector('.settings').open = false; currentKey = null; const version = ++viewVersion;
  renderTrack({ name: 'Nacht in de stad', artists: [{ id: 'example', name: 'De Voorbeeldband' }], album: { name: 'Eerste licht', release_date: '2014-05-16', album_type: 'album' }, duration_ms: 213000, track_number: 3 }, { is_playing: false }, version);
  message('Je bekijkt fictieve voorbeeldgegevens. Verbind met Spotify en haal je eigen nummer op.');
};
async function init() {
  accessToken = sessionStorage.getItem('skc_access'); expiresAt = Number(sessionStorage.getItem('skc_exp') || 0);
  connected(Boolean(sessionStorage.getItem('skc_refresh') || accessToken));
  const url = new URL(location.href), code = url.searchParams.get('code'), error = url.searchParams.get('error');
  if (!code && !error) return;
  history.replaceState({}, '', REDIRECT);
  const state = url.searchParams.get('state'), expected = sessionStorage.getItem('skc_state'), verifier = sessionStorage.getItem('skc_verifier');
  sessionStorage.removeItem('skc_state'); sessionStorage.removeItem('skc_verifier');
  if (error) return message('Spotify-aanmelding geweigerd. Je kunt opnieuw verbinden.');
  if (!expected || state !== expected || !verifier) return message('Aanmelding afgebroken: ongeldige beveiligingscontrole. Probeer opnieuw.');
  const version = sessionVersion;
  try {
    const data = await tokenRequest({ grant_type: 'authorization_code', code, redirect_uri: REDIRECT, code_verifier: verifier });
    if (version !== sessionVersion) return;
    saveTokens(data); message('Spotify verbonden. Start de kennismodus wanneer jij wilt, of haal één nummer op.');
  } catch (error) { message(error.message); }
}
init();
