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
$('redirect').textContent = REDIRECT;
$('clientId').value = localStorage.getItem(KEY) || '';
function message(s){$('message').textContent=s || '';}
function status(s){$('status').textContent=s;}
function bytesBase64Url(bytes){return btoa(String.fromCharCode(...bytes)).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');}
async function sha256(s){return new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(s)));}
function randomVerifier(){return bytesBase64Url(crypto.getRandomValues(new Uint8Array(64)));}
function saveTokens(data){accessToken=data.access_token;expiresAt=Date.now()+Math.max(0,data.expires_in-60)*1000;sessionStorage.setItem('skc_access',accessToken);sessionStorage.setItem('skc_exp',String(expiresAt));if(data.refresh_token)sessionStorage.setItem('skc_refresh',data.refresh_token);connected(true);}
function connected(yes){$('login').hidden=yes;$('logout').hidden=!yes;$('refresh').disabled=!yes;$('toggleAuto').disabled=!yes;status(yes?'Verbonden':'Niet verbonden');}
$('saveClient').onclick=()=>{const v=$('clientId').value.trim();if(!/^[a-f0-9]{32}$/i.test(v)){message('Controleer je Client ID: dit is normaal een code van 32 tekens.');return;}localStorage.setItem(KEY,v);message('Client ID opgeslagen op dit apparaat.');};
$('copyRedirect').onclick=async()=>{try{await navigator.clipboard.writeText(REDIRECT);message('Redirect URI gekopieerd.');}catch{message('Selecteer en kopieer de Redirect URI handmatig.');}};
$('login').onclick=async()=>{const id=$('clientId').value.trim();if(!/^[a-f0-9]{32}$/i.test(id)){message('Vul eerst je Spotify Client ID in en klik op Opslaan.');return;}localStorage.setItem(KEY,id);const verifier=randomVerifier();const state=randomVerifier();sessionStorage.setItem('skc_verifier',verifier);sessionStorage.setItem('skc_state',state);const challenge=bytesBase64Url(await sha256(verifier));const u=new URL('https://accounts.spotify.com/authorize');u.search=new URLSearchParams({response_type:'code',client_id:id,scope:SCOPES,redirect_uri:REDIRECT,code_challenge_method:'S256',code_challenge:challenge,state}).toString();location.assign(u.toString());};
async function tokenRequest(params){const id=localStorage.getItem(KEY);if(!id)throw Error('Client ID ontbreekt.');const r=await fetch('https://accounts.spotify.com/api/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({...params,client_id:id})});const data=await r.json();if(!r.ok)throw Error(data.error_description||data.error||'Spotify-aanmelding mislukt');return data;}
async function getToken(){if(accessToken && Date.now()<expiresAt)return accessToken;const refresh=sessionStorage.getItem('skc_refresh');if(!refresh)throw Error('Verbind eerst met Spotify.');if(!refreshing)refreshing=tokenRequest({grant_type:'refresh_token',refresh_token:refresh}).then(data=>{saveTokens(data);return accessToken;}).finally(()=>{refreshing=null;});return refreshing;}
async function spotify(path){let token=await getToken();let r=await fetch('https://api.spotify.com/v1/'+path,{headers:{Authorization:'Bearer '+token}});if(r.status===401 && sessionStorage.getItem('skc_refresh')){expiresAt=0;token=await getToken();r=await fetch('https://api.spotify.com/v1/'+path,{headers:{Authorization:'Bearer '+token}});}if(r.status===204)return null;if(!r.ok){if(r.status===429)throw Error('Spotify-limiet bereikt. Probeer later opnieuw.');if(r.status===403)throw Error('Geen toegang. Controleer de Spotify-appinstellingen en het gekoppelde account.');throw Error('Spotify API-fout '+r.status);}return r.json();}
function fact(label,value){if(value===null||value===undefined||value==='')return;const cell=document.createElement('div');cell.className='fact';const dt=document.createElement('dt');dt.textContent=label;const dd=document.createElement('dd');dd.textContent=String(value);cell.append(dt,dd);return cell;}
function addFacts(el,rows){el.replaceChildren();for(const [label,value] of rows){const node=fact(label,value);if(node)el.append(node);}}
const wdCache=new Map();
async function wikidataArtist(name,spotifyArtistId){
 const cacheKey=spotifyArtistId||name;
 if(wdCache.has(cacheKey))return wdCache.get(cacheKey);
 const task=(async()=>{
  const base='https://www.wikidata.org/w/api.php?origin=*&format=json&action=';
  const search=await fetch(base+'wbsearchentities&language=en&type=item&limit=8&search='+encodeURIComponent(name));
  if(!search.ok)throw Error('Wikidata niet beschikbaar');
  const results=(await search.json()).search||[];
  const normalize=x=>x.normalize('NFKD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9]/gi,'').toLowerCase();
  const candidates=results.filter(x=>normalize(x.label)===normalize(name));
  if(!candidates.length)return null;
  const res=await fetch(base+'wbgetentities&props=claims%7Clabels&languages=nl%7Cen&ids='+candidates.map(x=>encodeURIComponent(x.id)).join('%7C'));
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
  const possible=candidatesWithEvidence.filter(x=>x.musical&&!x.spotifyIds.length);
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
  if(ids.length){const lr=await fetch(base+'wbgetentities&props=labels%7Cclaims&languages=nl%7Cen&ids='+ids.join('%7C'));if(lr.ok)labels=(await lr.json()).entities||{};}
  const instrumentIds=[...new Set(memberIds.flatMap(id=>(labels[id]?.claims?.P1303||[]).map(c=>c.mainsnak?.datavalue?.value?.id).filter(Boolean)))];
  if(instrumentIds.length){
   const instrumentLabels=await fetch(base+'wbgetentities&props=labels&languages=nl%7Cen&ids='+instrumentIds.join('%7C'));
   if(instrumentLabels.ok)Object.assign(labels,(await instrumentLabels.json()).entities||{});
  }
  const label=id=>id?(labels[id]?.labels?.nl?.value||labels[id]?.labels?.en?.value||null):null;
  const human=(entity.claims?.P31||[]).some(c=>c.mainsnak?.datavalue?.value?.id==='Q5');
  const rawDate=claim('P569')?.time;
  let birth=null,age=null;
  if(rawDate){const m=rawDate.match(/^\+(\d{4})-(\d{2})-(\d{2})/);if(m){birth=m[3]!=='00'&&m[2]!=='00'?m[3]+'/'+m[2]+'/'+m[1]:m[1];if(m[2]!=='00'&&m[3]!=='00'){const now=new Date();age=now.getUTCFullYear()-Number(m[1])-(now.getUTCMonth()+1<Number(m[2])||(now.getUTCMonth()+1===Number(m[2])&&now.getUTCDate()<Number(m[3]))?1:0);}}}
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
   const birthTime=(entityMember?.claims?.P569||[]).find(c=>c.rank!=='deprecated')?.mainsnak?.datavalue?.value?.time;
   const born=birthTime?.match(/^\+(\d{4})-(\d{2})-(\d{2})/);
   const birth=born&&born[2]!=='00'&&born[3]!=='00'?born[3]+'/'+born[2]+'/'+born[1]:null;
   return {id,name:label(id)||id,current:currentIds.includes(id),instruments:instruments.map(label).filter(Boolean),birth};
  });
  return {id:match.id,human,birth,age,country:label(countryId),countryId,gender,genre:label(genreId),place:label(placeId),started:year,members:currentIds.map(label).filter(Boolean),formerMembers:[...new Set(formerMemberClaims.map(c=>c.mainsnak.datavalue.value.id))].filter(id=>!currentIds.includes(id)).map(label).filter(Boolean),memberDetails,groupGender};
 })().catch(()=>null);
 wdCache.set(cacheKey,task);return task;
}
const debutOverrides={'40ZNYROS4zLfyyBSs2PGe2':2019,'60d24wfXkVzDSfLS6hyCjZ':2012,'0hEurMDQu99nJRq8pTxO14':1999};
const debutCache=new Map();
let mbQueue=Promise.resolve();
function mbFetch(url){
 const job=mbQueue.catch(()=>{}).then(async()=>{
  const response=await fetch(url,{headers:{Accept:'application/json'}});
  if(!response.ok)throw Error('MusicBrainz niet beschikbaar');
  return response.json();
 });
 mbQueue=job.then(()=>new Promise(resolve=>setTimeout(resolve,1200)),()=>new Promise(resolve=>setTimeout(resolve,1200)));
 return job;
}
async function musicBrainzDebut(artist){
 const confirmedByName={'zach bryan':2019,'martin garrix':2012,'john mayer':1999,'red hot chili peppers':1984};
 const confirmed=confirmedByName[artist.name.trim().toLowerCase()]||debutOverrides[artist.id];
 if(confirmed)return {year:confirmed,source:'Spotle bevestigd'};
 if(debutCache.has(artist.id))return debutCache.get(artist.id);
 const task=(async()=>{
  const spotifyFallback=async()=>{
   try{
    let offset=0,all=[];
    while(offset<200){
     const page=await spotify('artists/'+encodeURIComponent(artist.id)+'/albums?include_groups=album,single&limit=50&offset='+offset);
     if(!page?.items?.length)break;
     all.push(...page.items);offset+=page.items.length;
     if(!page.next)break;
    }
    const eligible=all.filter(x=>/^\d{4}/.test(x.release_date||'')&&!/remaster|deluxe|anniversary|live|karaoke|instrumental|compilation/i.test(x.name||''));
    const pool=eligible;
    pool.sort((a,b)=>a.release_date.localeCompare(b.release_date));
    const chosen=pool[0];
    return chosen?{year:Number(chosen.release_date.slice(0,4)),source:'Spotify: '+chosen.name,approximate:true}:null;
   }catch{return null;}
  };
  const query=encodeURIComponent('artist:"'+artist.name.replace(/"/g,'')+'"');
  const search=await mbFetch('https://musicbrainz.org/ws/2/artist/?query='+query+'&fmt=json&limit=10');
  const norm=x=>x.normalize('NFKD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9]/gi,'').toLowerCase();
  const matches=(search.artists||[]).filter(x=>norm(x.name)===norm(artist.name)&&Number(x.score)>=95);
  if(matches.length!==1)return spotifyFallback();
  const groups=await mbFetch('https://musicbrainz.org/ws/2/release-group?artist='+encodeURIComponent(matches[0].id)+'&fmt=json&limit=100');
  const valid=(groups['release-groups']||[]).filter(x=>/^(Album|Single|EP)$/.test(x['primary-type']||'')&&!/Bootleg|Demo|Live/.test((x['secondary-types']||[]).join(' '))&&/^\d{4}-\d{2}-\d{2}$/.test(x['first-release-date']||''));
  const chosen=valid.sort((a,b)=>a['first-release-date'].localeCompare(b['first-release-date']))[0];
  return chosen?{year:Number(chosen['first-release-date'].slice(0,4)),source:chosen.title,link:'https://musicbrainz.org/release-group/'+chosen.id}:spotifyFallback();
 })().catch(async()=>{try{const page=await spotify('artists/'+encodeURIComponent(artist.id)+'/albums?include_groups=album&limit=50');const albums=(page?.items||[]).filter(x=>/^\d{4}/.test(x.release_date||''));albums.sort((a,b)=>a.release_date.localeCompare(b.release_date));return albums[0]?{year:Number(albums[0].release_date.slice(0,4)),source:'Spotify (voorlopig)',approximate:true}:null;}catch{return null;}});
 debutCache.set(artist.id,task);return task;
}
const trackReleaseCache=new Map();
async function earliestRecordingRelease(isrc){
 if(!/^[A-Z]{2}[A-Z0-9]{3}[0-9]{7}$/i.test(isrc||''))return null;
 const key=isrc.toUpperCase();
 if(trackReleaseCache.has(key))return trackReleaseCache.get(key);
 const task=(async()=>{
  const result=await mbFetch('https://musicbrainz.org/ws/2/recording/?query='+encodeURIComponent('isrc:'+key)+'&fmt=json&limit=100');
  const recordings=(result.recordings||[]).filter(x=>Number(x.score)>=95);
  const candidates=[];
  for(const rec of recordings.slice(0,5)){
   const detail=await mbFetch('https://musicbrainz.org/ws/2/recording/'+encodeURIComponent(rec.id)+'?inc=releases&fmt=json');
   for(const release of detail.releases||[]){
    if(release.status!=='Official'||!/^\d{4}-\d{2}-\d{2}$/.test(release.date||''))continue;
    candidates.push({date:release.date,title:release.title,recordingId:rec.id});
   }
  }
  candidates.sort((a,b)=>a.date.localeCompare(b.date));
  return candidates[0]||null;
 })().catch(()=>null);
 trackReleaseCache.set(key,task);return task;
}
const genreCache=new Map();
async function musicBrainzGenre(artist){
 if(genreCache.has(artist.id))return genreCache.get(artist.id);
 const task=(async()=>{
  const name=artist.name.trim();
  const query=encodeURIComponent('artist:"'+name.replace(/"/g,'')+'"');
  const result=await mbFetch('https://musicbrainz.org/ws/2/artist/?query='+query+'&fmt=json&limit=10');
  const normalize=x=>x.normalize('NFKD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9]/gi,'').toLowerCase();
  const matches=(result.artists||[]).filter(x=>normalize(x.name)===normalize(name)&&Number(x.score)>=95);
  if(matches.length!==1)return null;
  const detail=await mbFetch('https://musicbrainz.org/ws/2/artist/'+encodeURIComponent(matches[0].id)+'?inc=genres&fmt=json');
  const genres=(detail.genres||[]).filter(x=>x.name&&x.count>=0).sort((a,b)=>(b.count||0)-(a.count||0));
  return genres[0]?.name||null;
 })().catch(()=>null);
 genreCache.set(artist.id,task);return task;
}
const mbProfileCache=new Map();
async function musicBrainzProfile(artist){
 if(mbProfileCache.has(artist.id))return mbProfileCache.get(artist.id);
 const task=(async()=>{
  const query=encodeURIComponent('artist:"'+artist.name.replace(/"/g,'')+'"');
  const result=await mbFetch('https://musicbrainz.org/ws/2/artist/?query='+query+'&fmt=json&limit=25');
  const norm=x=>x.normalize('NFKD').replace(/[\\u0300-\\u036f]/g,'').replace(/[^a-z0-9]/gi,'').toLowerCase();
  const matches=(result.artists||[]).filter(x=>norm(x.name)===norm(artist.name)&&Number(x.score)>=95);
  if(matches.length!==1)return null;
  const match=matches[0];
  const detail=await mbFetch('https://musicbrainz.org/ws/2/artist/'+encodeURIComponent(match.id)+'?inc=genres+url-rels&fmt=json');
  const spotifyLinks=(detail.relations||[]).filter(x=>x.type==='streaming music'&&/open\\.spotify\\.com\\/artist\\//.test(x.url?.resource||'')).map(x=>x.url.resource);
  if(spotifyLinks.length&&!spotifyLinks.some(url=>url.includes('/artist/'+artist.id)))return null;
  const genres=(detail.genres||[]).filter(x=>x.name).sort((a,b)=>(b.count||0)-(a.count||0));
  return {id:match.id,genre:genres[0]?.name||null,countryCode:detail.country||null,countryName:detail.area?.name||null,type:detail.type||null};
 })().catch(()=>null);
 mbProfileCache.set(artist.id,task);return task;
}
function mbCountry(profile){
 if(!profile?.countryCode||!/^[A-Z]{2}$/.test(profile.countryCode))return null;
 const code=profile.countryCode;
 const flag=String.fromCodePoint(...[...code].map(c=>127397+c.charCodeAt(0)));
 const names={US:'USA',GB:'UK',BE:'Belgium',NL:'Netherlands',FR:'France',DE:'Germany',CA:'Canada',AU:'Australia',IE:'Ireland',IT:'Italy',ES:'Spain',SE:'Sweden',NO:'Norway',DK:'Denmark',FI:'Finland',JP:'Japan',KR:'South Korea',BR:'Brazil',MX:'Mexico'};
 return flag+' '+(names[code]||profile.countryName||code);
}
function spotleGenre(name,info,wd,extraGenre){
 const confirmed={'jelly roll':'Hip-hop','red hot chili peppers':'Rock'};
 const key=(name||'').trim().toLowerCase();
 if(confirmed[key])return confirmed[key];
 const raw=info?.genres?.[0]||wd?.genre||extraGenre||'—';
 if(/^(southern rap|trap|gangsta rap|conscious hip hop|alternative hip hop|pop rap)$/i.test(raw))return 'Hip-hop';
 return raw;
}
function spotleGender(wd,verifiedBand){
 if(verifiedBand?.gender)return verifiedBand.gender;
 const raw=(wd?.gender||'').trim().toLowerCase();
 if(!wd?.human)return wd?.groupGender||'—';
 if(['male','mannelijk','man','masculin','männlich'].includes(raw))return 'Male';
 if(['female','vrouwelijk','vrouw','féminin','weiblich'].includes(raw))return 'Female';
 if(['non-binary','nonbinary','non-binair','non-binaire','non-binary gender','genderqueer'].includes(raw))return 'Non-binair';
 return '—';
}
const verifiedBands={
 'red hot chili peppers':{
  debut:1984,
  popularity:82,
  country:'🇺🇸 USA',
  members:['Anthony Kiedis — zang','Flea — basgitaar','John Frusciante — gitaar','Chad Smith — drums'],
  gender:'Male'
 }
};
function spotleGrid(info,wd,debut,extraGenre,artistName,mbProfile){
 const countryFlags={'Q30':['🇺🇸','USA'],'Q145':['🇬🇧','UK'],'Q16':['🇨🇦','Canada'],'Q408':['🇦🇺','Australia'],'Q31':['🇧🇪','Belgium'],'Q55':['🇳🇱','Netherlands'],'Q142':['🇫🇷','France'],'Q183':['🇩🇪','Germany'],'Q38':['🇮🇹','Italy'],'Q29':['🇪🇸','Spain'],'Q668':['🇮🇳','India'],'Q17':['🇯🇵','Japan'],'Q148':['🇨🇳','China'],'Q155':['🇧🇷','Brazil'],'Q96':['🇲🇽','Mexico'],'Q258':['🇿🇦','South Africa'],'Q34':['🇸🇪','Sweden'],'Q33':['🇫🇮','Finland'],'Q20':['🇳🇴','Norway'],'Q35':['🇩🇰','Denmark'],'Q36':['🇵🇱','Poland'],'Q39':['🇨🇭','Switzerland'],'Q40':['🇦🇹','Austria'],'Q27':['🇮🇪','Ireland'],'Q43':['🇹🇷','Turkey'],'Q159':['🇷🇺','Russia'],'Q414':['🇦🇷','Argentina'],'Q739':['🇨🇴','Colombia'],'Q298':['🇨🇱','Chile'],'Q77':['🇺🇾','Uruguay'],'Q1033':['🇳🇬','Nigeria'],'Q114':['🇰🇪','Kenya'],'Q117':['🇬🇭','Ghana'],'Q79':['🇪🇬','Egypt'],'Q801':['🇮🇱','Israel'],'Q851':['🇸🇦','Saudi Arabia'],'Q45':['🇵🇹','Portugal'],'Q41':['🇬🇷','Greece'],'Q212':['🇺🇦','Ukraine'],'Q213':['🇨🇿','Czechia'],'Q218':['🇷🇴','Romania'],'Q219':['🇧🇬','Bulgaria'],'Q28':['🇭🇺','Hungary'],'Q32':['🇱🇺','Luxembourg'],'Q189':['🇮🇸','Iceland'],'Q37':['🇱🇹','Lithuania'],'Q191':['🇪🇪','Estonia'],'Q21197':['🇱🇻','Latvia'],'Q252':['🇮🇩','Indonesia'],'Q928':['🇵🇭','Philippines'],'Q869':['🇹🇭','Thailand'],'Q884':['🇰🇷','South Korea'],'Q865':['🇹🇼','Taiwan'],'Q833':['🇲🇾','Malaysia'],'Q334':['🇸🇬','Singapore'],'Q664':['🇳🇿','New Zealand']};
 const country=countryFlags[wd?.countryId];
 const verifiedBand=verifiedBands[(artistName||'').trim().toLowerCase()];
 const grid=document.createElement('div');grid.className='spotle-grid';
 const values=[['Debut',verifiedBand?.debut||debut?.year||'—'],['Members',verifiedBand?verifiedBand.members.length:(wd?.human?'Solo':wd?.members?.length||(mbProfile?.type==='Person'?'Solo':'—'))],['Popularity','—'],['Gender',spotleGender(wd,verifiedBand)],['Genre',spotleGenre(artistName,info,wd,extraGenre)],['Country',verifiedBand?.country||(country?country.join(' '):(wd?.country||mbCountry(mbProfile)||'—'))]];
 for(const [label,value] of values){const tile=document.createElement('div');tile.className='spotle-tile';const name=document.createElement('div');name.className='spotle-label';name.textContent=label;const val=document.createElement('div');val.className='spotle-value';val.textContent=value;tile.append(name,val);grid.append(tile);}
 return grid;
}
function dateNL(s){if(!s)return null;const p=s.split('-');return p.length===3?`${p[2]}/${p[1]}/${p[0]}`:p.length===2?`${p[1]}/${p[0]}`:p[0];}
function duration(ms){if(!Number.isFinite(ms))return null;return `${Math.floor(ms/60000)}:${String(Math.floor(ms/1000)%60).padStart(2,'0')}`;}
async function loadTrack(force=false){try{const playing=await spotify('me/player/currently-playing?additional_types=track');if(!playing?.item || playing.item.type!=='track'){message('Er speelt momenteel geen Spotify-nummer. Start een nummer en probeer opnieuw.');return;}const t=playing.item;const sampleQuery='site:whosampled.com '+(t.artists||[]).map(a=>a.name).join(' ')+' '+t.name;const sampleLink=$('sampleSearch');if(sampleLink)sampleLink.href='https://www.google.com/search?q='+encodeURIComponent(sampleQuery);const key=t.id||t.uri;if(!force && key===currentKey)return;currentKey=key;message('Nummer opgehaald.');$('result').hidden=false;$('cover').src=t.album?.images?.[0]?.url||'';$('cover').alt='Albumhoes van '+(t.album?.name||t.name);$('trackTitle').textContent=t.name;$('artistNames').textContent=(t.artists||[]).map(a=>a.name).join(', ');$('spotifyLink').href=t.external_urls?.spotify||'https://open.spotify.com/';addFacts($('trackFacts'),[['Titel',t.name],['Artiest(en)',(t.artists||[]).map(a=>a.name).join(', ')],['Releasedatum Spotify-uitgave',dateNL(t.album?.release_date)],['Album',t.album?.name],['Speelduur',duration(t.duration_ms)],['Tracknummer',t.track_number],['Disc',t.disc_number]]);$('artists').replaceChildren();
const releaseFacts=$('trackFacts');
const releaseTrackKey=key;
if(t.external_ids?.isrc){
 earliestRecordingRelease(t.external_ids.isrc).then(first=>{
  if(!first||currentKey!==releaseTrackKey||!releaseFacts.isConnected)return;
  const spotifyDate=t.album?.release_date;
  if(spotifyDate&&/^\d{4}-\d{2}-\d{2}$/.test(spotifyDate)&&first.date>=spotifyDate)return;
  const node=fact('Vroegste bekende uitgave van deze opname',dateNL(first.date)+' · '+first.title);
  if(!node)return;
  releaseFacts.append(node);
  const source=document.createElement('a');
  source.href='https://musicbrainz.org/recording/'+encodeURIComponent(first.recordingId);
  source.target='_blank';source.rel='noopener noreferrer';
  source.textContent='Bron: MusicBrainz ↗';
  source.className='artist-source';
  releaseFacts.append(source);
 });
}
for(const a of t.artists||[]){const card=document.createElement('article');card.className='artist';const head=document.createElement('button');head.type='button';head.className='artisthead artist-toggle';head.setAttribute('aria-expanded','false');const profile=document.createElement('div');profile.className='artist-profile';profile.hidden=true;head.addEventListener('click',()=>{profile.hidden=!profile.hidden;head.setAttribute('aria-expanded',String(!profile.hidden));});const img=document.createElement('img');img.alt='Foto van '+a.name;const detail=document.createElement('div');const h=document.createElement('h4');h.textContent=a.name;const link=document.createElement('a');link.textContent='Spotify-profiel ↗';link.href=a.external_urls?.spotify||'https://open.spotify.com/';link.target='_blank';link.rel='noopener noreferrer';detail.append(h);head.append(img,detail);card.append(head,profile);const spotifyRow=document.createElement('div');spotifyRow.className='artist-link';spotifyRow.append(link);profile.append(spotifyRow);const knownDebut={'zach bryan':2019,'martin garrix':2012,'john mayer':1999,'red hot chili peppers':1984}[a.name.trim().toLowerCase()];const spotle=spotleGrid(null,null,knownDebut?{year:knownDebut}:null,null,a.name);profile.prepend(spotle);$('artists').append(card);if(a.id){spotify('artists/'+encodeURIComponent(a.id)).then(info=>{img.src=info.images?.[0]?.url||t.album?.images?.[0]?.url||'';const rows=[['Naam',info.name],['Genres',info.genres?.join(', ')||null],['Spotify-volgers',Number.isFinite(info.followers?.total)?info.followers.total.toLocaleString('nl-BE'):null]];const dl=document.createElement('dl');dl.className='facts';addFacts(dl,rows);let artistWd=null,artistDebut=null,artistGenre=null,artistMb=null;let shownGrid=spotleGrid(info,null,null,null,a.name);spotle.replaceWith(shownGrid);profile.prepend(dl);const updateGrid=()=>{if(!card.isConnected)return;const next=spotleGrid(info,artistWd,artistDebut,artistGenre,a.name,artistMb);shownGrid.replaceWith(next);shownGrid=next;};musicBrainzProfile(a).then(profile=>{if(!profile||!card.isConnected)return;artistMb=profile;if(!info.genres?.length)artistGenre=profile.genre;updateGrid();});musicBrainzDebut(a).then(debut=>{if(!debut||!card.isConnected)return;artistDebut=debut;updateGrid();if(debut.link){const link=document.createElement('a');link.href=debut.link;link.target='_blank';link.rel='noopener noreferrer';link.className='artist-source';link.textContent='Debuutbron: MusicBrainz ('+debut.source+') ↗';profile.append(link);}});wikidataArtist(a.name,a.id).then(wd=>{if(!wd||!card.isConnected)return;artistWd=wd;updateGrid();addFacts(dl,[...rows,['Geboortedatum',wd.birth],['Leeftijd',wd.age===null?null:wd.age+' jaar'],['Geboorteplaats',wd.place],['Land',wd.country],['Geslacht',wd.gender],['Genres (Wikidata)',wd.genre],['Actief / opgericht sinds',wd.started],['Huidige bandleden (volgens bron)',verifiedBands[a.name.trim().toLowerCase()]?.members.join(', ')|| (wd.members?.length?wd.members.join(', '):null)],['Voormalige bandleden (volgens bron)',wd.formerMembers?.length?wd.formerMembers.join(', '):null]]);if(wd.memberDetails?.length&&!verifiedBands[a.name.trim().toLowerCase()]){
 const memberSection=document.createElement('details');memberSection.className='member-details';
 const summary=document.createElement('summary');summary.textContent='Bandleden · extra gegevens';memberSection.append(summary);
 const memberList=document.createElement('div');memberList.className='extras';
 for(const member of wd.memberDetails){
  const item=document.createElement('div');item.className='fact';
  const title=document.createElement('dt');title.textContent=member.name+(member.current?' · huidig volgens Wikidata':' · voormalig volgens Wikidata');
  const value=document.createElement('dd');
  const parts=[];
  if(member.instruments?.length)parts.push('Instrumenten: '+member.instruments.join(', '));
  if(member.birth){
   parts.push('Geboren: '+member.birth);
   const p=member.birth.split('/').map(Number);
   const now=new Date();const age=now.getFullYear()-p[2]-(now.getMonth()+1<p[1]||(now.getMonth()+1===p[1]&&now.getDate()<p[0])?1:0);
   if(age>=0&&age<125)parts.push('Leeftijd: '+age+' jaar');
  }
  value.textContent=parts.join(' · ')||'Geen aanvullende biografische gegevens beschikbaar';
  const ref=document.createElement('a');ref.href='https://www.wikidata.org/wiki/'+encodeURIComponent(member.id);ref.target='_blank';ref.rel='noopener noreferrer';ref.textContent='Bekijk lid op Wikidata ↗';
  item.append(title,value,ref);memberList.append(item);
 }
 memberSection.append(memberList);profile.append(memberSection);
}
const source=document.createElement('a');source.href='https://www.wikidata.org/wiki/'+wd.id;source.target='_blank';source.rel='noopener noreferrer';source.textContent='Bron: Wikidata ↗';source.className='artist-source';profile.append(source);});}).catch(()=>{img.src=t.album?.images?.[0]?.url||'';});}}addFacts($('extras'),[['Spotify-albumtype',t.album?.album_type],['ISRC',t.external_ids?.isrc],['Expliciete inhoud',t.explicit?'Ja':'Nee']]);}catch(e){message(e.message||String(e));}}
$('refresh').onclick=()=>loadTrack(true);
function stopAuto(){if(timer!==null)clearInterval(timer);timer=null;$('toggleAuto').textContent='Automatisch starten';}
$('toggleAuto').onclick=()=>{if(timer!==null){stopAuto();message('Automatisch volgen gestopt.');return;}loadTrack(true);timer=setInterval(()=>{if(!document.hidden)loadTrack(false);},12000);$('toggleAuto').textContent='Automatisch stoppen';message('Automatisch volgen gestart.');};
$('logout').onclick=()=>{stopAuto();accessToken=null;expiresAt=0;currentKey=null;['skc_access','skc_exp','skc_refresh','skc_verifier','skc_state'].forEach(k=>sessionStorage.removeItem(k));connected(false);$('result').hidden=true;message('Verbinding op dit tabblad verbroken.');};
async function init(){accessToken=sessionStorage.getItem('skc_access');expiresAt=Number(sessionStorage.getItem('skc_exp')||0);if(sessionStorage.getItem('skc_refresh')||accessToken)connected(true);const u=new URL(location.href);const code=u.searchParams.get('code');const error=u.searchParams.get('error');if(!code&&!error)return;history.replaceState({},'',REDIRECT);if(error){message('Spotify-aanmelding geweigerd: '+error);return;}const state=u.searchParams.get('state');const expected=sessionStorage.getItem('skc_state');const verifier=sessionStorage.getItem('skc_verifier');sessionStorage.removeItem('skc_state');sessionStorage.removeItem('skc_verifier');if(!expected||state!==expected||!verifier){message('Aanmelding afgebroken: ongeldige beveiligingscontrole. Probeer opnieuw.');return;}try{const data=await tokenRequest({grant_type:'authorization_code',code,redirect_uri:REDIRECT,code_verifier:verifier});saveTokens(data);message('Spotify verbonden. Klik op Huidig nummer ophalen of start automatisch volgen.');}catch(e){message(e.message);}}
init();
