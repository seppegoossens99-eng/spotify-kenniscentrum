#!/usr/bin/env python3
"""Import sourced artist facts from the owner's chart projects without executing their code.

Usage: python3 scripts/import-artist-references.py BILLBOARD_CHECKOUT ULTRATOP_CHECKOUT
The generated snapshot is committed; the website never needs those checkouts or credentials.
"""
import ast
import csv
import json
import re
import subprocess
import sys
from pathlib import Path
from urllib.parse import urlsplit

ROOT = Path(__file__).resolve().parents[1]
UUID = re.compile(r'[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}', re.I)
SPOTIFY = re.compile(r'https://open\.spotify\.com/artist/([A-Za-z0-9]{22})/?(?:\?.*)?')


def rows(path):
    if not path.exists():
        return []
    with path.open(encoding='utf-8-sig', newline='') as handle:
        return list(csv.DictReader(handle))


def literal_mapping(path, variable):
    """Read constants without importing/running code from the other repository."""
    for statement in ast.parse(path.read_text(encoding='utf-8')).body:
        if isinstance(statement, ast.Assign) and any(isinstance(t, ast.Name) and t.id == variable for t in statement.targets):
            return ast.literal_eval(statement.value)
    return {}


def sourced(value, url):
    return {'value': value, 'url': url} if value and urlsplit(url).scheme == 'https' and urlsplit(url).hostname else None


def main(paths):
    records = {}
    sources = []
    for path in paths:
        path = Path(path).resolve()
        repo = path.name
        prefix = 'billboard' if repo == 'billboard-hot-100-reversed' else 'ultratop'
        expected = 'https://github.com/seppegoossens99-eng/' + repo
        remote = subprocess.check_output(['git', '-C', str(path), 'remote', 'get-url', 'origin'], text=True).strip().removesuffix('.git')
        if repo not in ('billboard-hot-100-reversed', 'ultratop-50-reversed') or remote != expected:
            raise ValueError('Unexpected reference repository')
        commit = subprocess.check_output(['git', '-C', str(path), 'rev-parse', 'HEAD'], text=True).strip()
        sources.append({'repository': 'seppegoossens99-eng/' + repo, 'commit': commit})
        extras_file = prefix + '_artist_extra.csv'
        extras_url = expected + '/blob/' + commit + '/' + extras_file
        identities = literal_mapping(path / 'artist_identities.py', 'VERIFIED_ARTIST_IDS')
        resolved = path / 'resolved_identities.json'
        if resolved.exists():
            identities.update(json.loads(resolved.read_text(encoding='utf-8')))
        credits = rows(path / ('billboard_hot_100_artists.csv' if prefix == 'billboard' else 'ultratop_50_artists.csv')) + rows(path / 'seed_artists.csv')
        by_name = {}
        for row in credits:
            by_name.setdefault(row['Artiest'], []).append(row)
        cache = json.loads((path / 'band_members_cache.json').read_text(encoding='utf-8'))
        photos = {row['Artiest']: row for row in rows(path / (prefix + '_artist_profiles.csv'))}
        explicit_spotify = literal_mapping(path / 'collect_artist_profiles.py', 'VERIFIED_SPOTIFY_IDS')
        members = {}
        for row in rows(path / (prefix + '_band_members.csv')):
            count = row.get('Leden (bevestigd huidig)', '')
            if count.isdigit() and row.get('Bron', '').startswith('https://'):
                members[row['Artiest']] = sourced(int(count), row['Bron'])
        for extra in rows(path / extras_file):
            name = extra['Artiest']
            linked = by_name.get(name, [])
            ids = {r['Bron herkomst'].rsplit('/', 1)[-1] for r in linked if r.get('Bron herkomst', '').startswith('https://musicbrainz.org/artist/')}
            if name in identities:
                ids = {identities[name]}
            ids = {identifier for identifier in ids if UUID.fullmatch(identifier)}
            if len(ids) != 1:
                # A namesake or an editorial-only identity must not become a name-only match.
                continue
            mbid = next(iter(ids))
            data = cache.get(mbid, {}).get('data', {})
            if data.get('id', mbid) != mbid:
                raise ValueError('Conflicting cached identity: ' + name)
            spotify_ids = set()
            for relation in data.get('relations', []):
                match = SPOTIFY.fullmatch((relation.get('url') or {}).get('resource', ''))
                if match:
                    spotify_ids.add(match[1])
            profile = photos.get(name, {})
            for url in [profile.get('Bron afbeelding', ''), 'https://open.spotify.com/artist/' + explicit_spotify.get(name, '')]:
                match = SPOTIFY.fullmatch(url)
                if match:
                    spotify_ids.add(match[1])
            record = records.setdefault(mbid, {'name': name, 'musicBrainzId': mbid, 'spotifyIds': [], 'references': []})
            record['spotifyIds'] = sorted(set(record['spotifyIds']) | spotify_ids)
            if extras_url not in record['references']:
                record['references'].append(extras_url)
            genre = sourced(extra.get('Genre'), extra.get('Bron genre', ''))
            year = extra.get('Debuutalbum', '')
            debut = sourced(int(year), extra.get('Bron debuutalbum', '')) if re.fullmatch(r'\d{4}', year) else None
            country_row = next((r for r in linked if r.get('Land') and r.get('Bron herkomst', '').endswith('/' + mbid)), None)
            country = sourced(country_row['Land'], country_row['Bron herkomst']) if country_row else None
            facts = {'genre': genre, 'debut': debut, 'gender': sourced(extra.get('Gender'), extras_url), 'country': country, 'members': members.get(name), 'type': sourced(profile.get('Type'), expected + '/blob/' + commit + '/' + prefix + '_artist_profiles.csv')}
            for field, value in facts.items():
                if not value:
                    continue
                if record.get(field) and record[field]['value'] != value['value']:
                    # Keep both observations visible for review, rather than silently replacing one.
                    record.setdefault('conflicts', {}).setdefault(field, []).append(value)
                else:
                    record[field] = value
    # Reject an ID accidentally assigned to two different identities.
    by_spotify = {}
    for mbid, record in records.items():
        if len(record['spotifyIds']) > 1:
            # Multiple pages can include a namesake. Require live Wikidata identity
            # confirmation before using this profile; never match these IDs directly.
            record['candidateSpotifyIds'] = record['spotifyIds']
            record['spotifyIds'] = []
        for sid in record['spotifyIds']:
            if sid in by_spotify and by_spotify[sid] != mbid:
                raise ValueError('Spotify ID belongs to conflicting artist identities: ' + sid)
            by_spotify[sid] = mbid
    result = {'version': 1, 'sources': sources, 'artists': sorted(records.values(), key=lambda r: r['name'].casefold())}
    output = ROOT / 'data' / 'artist-references.json'
    output.write_text(json.dumps(result, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print(f'Saved {len(records)} identity-linked profiles, {len(by_spotify)} Spotify IDs; {sum(bool(r.get("conflicts")) for r in records.values())} profiles with source differences.')


if __name__ == '__main__':
    if len(sys.argv) != 3:
        raise SystemExit(__doc__)
    main(sys.argv[1:])
