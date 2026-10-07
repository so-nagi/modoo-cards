r"""Round-trip only the named editor QA deck through the live local API and Anki.

Run from the app folder: .venv\Scripts\python.exe tests/browser/verify-editor-export.py
The fixed 4192 endpoint must report local auth. No Google collection is opened.
"""
from __future__ import annotations

from collections import Counter
from datetime import datetime, timezone
from hashlib import sha256
import html
import json
from pathlib import Path
import re
import shutil
from urllib.parse import unquote, urlsplit
from uuid import uuid4

import httpx
from anki.collection import Collection, ImportAnkiPackageOptions, ImportAnkiPackageRequest


APP_ROOT = Path(__file__).resolve().parents[2]
WORKSPACE_ROOT = APP_ROOT.parents[1].resolve()
BASE_URL = 'http://127.0.0.1:4192'
FIXTURE_PATH = APP_ROOT / 'tests' / 'browser' / 'qa-input.json'
REPORT_PATH = APP_ROOT / 'logs' / 'qa-editor-export.json'


def json_response(response: httpx.Response):
    response.raise_for_status()
    return response.json()


def model_signature(model):
    # Anki may append '+' when an imported note type name collides with a default.
    fields = model.get('fields') or [field['name'] for field in model['flds']]
    templates = model.get('templates') or model['tmpls']
    identity = {'fields': fields, 'type': model['type'], 'css': model['css'],
                'templates': [{key: template[key] for key in ('name', 'qfmt', 'afmt')} for template in templates]}
    return sha256(json.dumps(identity, ensure_ascii=False, sort_keys=True).encode()).hexdigest()


def field_signature(model_identity, fields, tags):
    return model_identity, tuple(fields), tuple(sorted(tags))


def run():
    fixture = json.loads(FIXTURE_PATH.read_text('utf-8'))
    deck_id, deck_name = int(fixture['deck']['id']), fixture['deck']['name']
    if not deck_name.startswith('QA 편집 '):
        raise ValueError('The fixture must identify the explicitly disposable editor QA deck.')
    temp_root = (WORKSPACE_ROOT / ('.tmp-editor-' + uuid4().hex[:8])).resolve()
    if temp_root.parent != WORKSPACE_ROOT or not temp_root.name.startswith('.tmp-editor-'):
        raise ValueError('Temporary collection must stay in the workspace root.')
    temp_root.mkdir(exist_ok=False)
    collection = None
    report = {'verifiedAt': datetime.now(timezone.utc).isoformat(), 'endpoint': BASE_URL,
              'deckId': deck_id, 'status': 'failed', 'temporaryCollectionRemoved': False}
    try:
        with httpx.Client(base_url=BASE_URL, headers={'Origin': BASE_URL}, timeout=60, follow_redirects=False) as client:
            config = json_response(client.get('/api/config'))
            if config.get('authMode') != 'local':
                raise ValueError('Refusing to export: QA endpoint is not in local auth mode.')
            report['engineVersion'] = config.get('engineVersion')
            decks = json_response(client.get('/api/bootstrap'))['decks']
            source_deck = next((deck for deck in decks if int(deck['id']) == deck_id), None)
            if source_deck is None or source_deck['name'] != deck_name:
                raise ValueError('Fixture deck ID/name no longer matches the QA collection.')
            models = {model['name']: model_signature(model) for model in json_response(client.get('/api/models'))}
            query = 'deck:"' + deck_name.replace('\\', '\\\\').replace('"', '\\"') + '"'
            listed = json_response(client.get('/api/cards', params={'q': query, 'limit': 2000}))
            if listed['total'] != len(listed['cards']) or not listed['cards']:
                raise ValueError('Expected a nonempty complete QA card list.')
            cards = [json_response(client.get(f'/api/cards/{card["id"]}')) for card in listed['cards']]
            if any(int(card['deckId']) != deck_id for card in cards):
                raise ValueError('The QA export query unexpectedly includes other decks.')

            source_notes = {}
            source_model_names = {}
            source_cards = Counter()
            media_urls = {}
            for card in cards:
                signature = field_signature(models[card['modelName']], card['fields'], card['tags'])
                source_notes[card['noteId']] = signature
                source_model_names[card['noteId']] = card['modelName']
                source_cards[(signature, card['ord'])] += 1
                for rendered in [card['front'], card['back'], card.get('css', '')]:
                    for url in re.findall(r'/api/media/[0-9a-f]{64}/[^\s<>\"\')]+', html.unescape(rendered)):
                        parts = urlsplit(url)
                        filename = unquote(parts.path.rsplit('/', 1)[1])
                        if '/' in filename or '\\' in filename or filename in {'.', '..'}:
                            raise ValueError('Invalid QA media filename.')
                        media_urls[filename] = url
            expected_notes = Counter(source_notes.values())
            media = {}
            for filename, url in media_urls.items():
                response = client.get(url)
                response.raise_for_status()
                media[filename] = response.content

            exported = client.post('/api/export', json={'format': 'apkg', 'deckId': deck_id,
                                                        'includeScheduling': True, 'includeMedia': True})
            exported.raise_for_status()
            package = temp_root / 'editor.apkg'
            package.write_bytes(exported.content)
            report['package'] = {'bytes': len(exported.content), 'sha256': sha256(exported.content).hexdigest()}

        collection = Collection(str(temp_root / 'collection.anki2'))
        collection.import_anki_package(ImportAnkiPackageRequest(package_path=str(package), options=ImportAnkiPackageOptions(
            merge_notetypes=True, with_scheduling=True, with_deck_configs=True)))
        restored_notes = Counter()
        restored_cards = Counter()
        restored_model_names = Counter()
        for note_id in collection.db.list('select id from notes order by id'):
            note = collection.get_note(note_id)
            signature = field_signature(model_signature(note.note_type()), note.fields, note.tags)
            restored_notes[signature] += 1
            restored_model_names[note.note_type()['name']] += 1
            for card in note.cards():
                restored_cards[(signature, card.ord)] += 1
                if collection.decks.name(card.did) != deck_name:
                    raise AssertionError('Restored card deck changed.')
        if restored_notes != expected_notes:
            report['noteMismatch'] = {
                'expected': [{'modelSha256': item[0], 'fieldsSha256': sha256(json.dumps(item[1]).encode()).hexdigest(), 'tagCount': len(item[2]), 'count': count} for item, count in expected_notes.items()],
                'restored': [{'modelSha256': item[0], 'fieldsSha256': sha256(json.dumps(item[1]).encode()).hexdigest(), 'tagCount': len(item[2]), 'count': count} for item, count in restored_notes.items()],
            }
        assert restored_notes == expected_notes, 'Note HTML, cloze syntax, tags or note type changed.'
        assert restored_cards == source_cards, 'Card count or cloze/template ordinal changed.'
        media_root = Path(collection.media.dir()).resolve()
        media_checks = []
        for filename, original in sorted(media.items()):
            restored_path = (media_root / filename).resolve()
            if restored_path.parent != media_root:
                raise ValueError('Restored media path escaped its collection.')
            restored = restored_path.read_bytes()
            assert restored == original, f'Exported QA media bytes changed: {filename}'
            media_checks.append({'filename': filename, 'bytes': len(restored), 'sha256': sha256(restored).hexdigest()})
        cloze_notes = sum(1 for signature in source_notes.values() if any(re.search(r'\{\{c[1-9]\d*::', field) for field in signature[1]))
        report.update({'status': 'passed', 'notes': len(source_notes), 'cards': len(cards), 'clozeNotes': cloze_notes,
                       'models': dict(Counter(source_model_names.values())), 'restoredModelNames': dict(restored_model_names),
                       'media': media_checks, 'checks': {'exactFieldHtml': True, 'clozeSyntax': True,
                       'noteTypesAndTags': True, 'cardOrdinalsAndCounts': True, 'deckName': True, 'mediaBytes': True}})
    except Exception as error:
        report['errorType'] = type(error).__name__
        # Do not persist response bodies, signed media URLs or user field contents.
        raise
    finally:
        if collection is not None:
            collection.close()
        checked = temp_root.resolve()
        if checked.parent != WORKSPACE_ROOT or not checked.name.startswith('.tmp-editor-'):
            raise ValueError('Refusing cleanup outside the validated temporary workspace directory.')
        shutil.rmtree(checked)
        report['temporaryCollectionRemoved'] = True
        REPORT_PATH.parent.mkdir(exist_ok=True)
        REPORT_PATH.write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n', 'utf-8')
    print(json.dumps(report, ensure_ascii=False))


if __name__ == '__main__':
    run()
