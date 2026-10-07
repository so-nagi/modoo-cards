import base64
import copy
import json

import pytest
from fastapi.testclient import TestClient

from server import auth
from server.app import create_app


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setenv('MODOO_LOCAL_AUTH', '1')
    with TestClient(create_app(tmp_path), base_url='http://127.0.0.1:4190', client=('127.0.0.1', 12345)) as value:
        yield value


def ok(response):
    assert response.status_code == 200, response.text
    return response.json()


def add(client, deck=1, fields=None, model='Basic'):
    mid = next(item['id'] for item in ok(client.get('/api/models')) if item['name'] == model)
    return ok(client.post('/api/notes', json={'deckId': deck, 'modelId': mid, 'fields': fields or ['apple', '사과'], 'tags': []}))['cardIds']


def make_deck(client, name):
    return ok(client.post('/api/decks', json={'name': name}))['id']


def snapshot(account):
    tables = account.col.db.list("select name from sqlite_master where type='table' and name not like 'sqlite_%' order by name")
    return {
        'tables': {name: sorted(account.col.db.all(f'SELECT * FROM "{name}"'), key=repr) for name in tables},
        'undo': account.col.undo_status().SerializeToString(),
        'revision': account.revision, 'tokens': copy.deepcopy(account.tokens), 'meta': copy.deepcopy(account.meta),
        'meta_file': account.meta_path.read_bytes() if account.meta_path.exists() else None,
    }


def test_deck_preview_includes_descendants_and_hidden_cards_beyond_daily_limit_without_mutation(client):
    parent = make_deck(client, 'Parent')
    child = make_deck(client, 'Parent::Child')
    other = make_deck(client, 'Parent with similar name')
    expected = []
    for index in range(25):
        expected.extend(add(client, deck=parent if index % 2 else child, fields=[f'word {index}', f'뜻 {index}']))
    add(client, deck=other)
    ok(client.post('/api/cards/action', json={'ids': [expected[1]], 'action': 'suspend'}))
    ok(client.post('/api/cards/action', json={'ids': [expected[2]], 'action': 'bury'}))
    study = ok(client.get(f'/api/study?deckId={parent}'))['card']
    account = client.app.state.collections.get('local-device')
    before = snapshot(account)
    rows = []
    for index in range(25):
        page = ok(client.get(f'/api/decks/{parent}/preview?index={index}'))
        assert page['index'] == index and page['total'] == 25
        rows.append(page['card'])
    assert [row['id'] for row in rows] == sorted(expected)
    assert {-1, -3}.issubset({row['queue'] for row in rows})
    assert all(row['fieldNames'] == ['Front', 'Back'] and '.card' in row['css'] for row in rows)
    assert snapshot(account) == before
    assert study['token'] in account.tokens
    # Preview did not invalidate the actual displayed review card.
    ok(client.post('/api/answer', json={'cardId': study['id'], 'rating': 4, 'token': study['token'], 'requestId': 'after-preview', 'elapsedMs': 200}))


@pytest.mark.parametrize('model,fields,marker', [
    ('Cloze', ['{{c1::빛}}과 {{c3::그림자}}', '설명'], 'data-cloze='),
    ('Basic (type in the answer)', ['apple', '사과'], '[[type:Back]]'),
])
def test_deck_preview_keeps_native_rendering_and_field_data(client, model, fields, marker):
    ids = add(client, model=model, fields=fields)
    account = client.app.state.collections.get('local-device')
    before = snapshot(account)
    for index, cid in enumerate(sorted(ids)):
        row = ok(client.get(f'/api/decks/1/preview?index={index}'))['card']
        assert row['id'] == cid and row['fields'] == fields
        assert row['ord'] == account.col.get_card(cid).ord
        assert row['modelName'] == model and row['deckName'] == 'Default'
        assert marker in row['front']
    assert snapshot(account) == before


def test_deck_preview_occlusion_uses_the_existing_signed_media_and_group_overlays(client):
    png = base64.b64decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jR1cAAAAASUVORK5CYII=')
    uploaded = ok(client.post('/api/media', files={'file': ('preview.png', png, 'image/png')}))
    group = '82b86690-f687-4c4d-a12d-877d9dca371a'
    masks = [{'x': .1 + i * .2, 'y': .1, 'width': .1, 'height': .1, 'groupId': group if i < 2 else None} for i in range(3)]
    ok(client.post('/api/occlusion', json={'deckId': 1, 'imageFilename': uploaded['filename'], 'masks': masks, 'header': '미리보기'}))
    account = client.app.state.collections.get('local-device')
    before = snapshot(account)
    pages = [ok(client.get(f'/api/decks/1/preview?index={index}')) for index in range(2)]
    assert all(page['total'] == 2 for page in pages)
    cards = [page['card'] for page in pages]
    assert len({card['id'] for card in cards}) == 2
    assert {card['ord'] for card in cards} == {0, 1}
    for card in cards:
        # Native card IDs do not promise cloze-ordinal order. Each answer must
        # reveal its own group, leaving only the other group's masks visible.
        assert card['ord'] == account.col.get_card(card['id']).ord
        assert card['front'].count('position:absolute') == 3
        assert card['back'].count('position:absolute') == {0: 1, 1: 2}[card['ord']]
        assert f'/api/media/{account.key}/' in card['front']
        assert card['fields'][0].count('{{c1::') == 2
        assert card['fields'][0].count('{{c2::') == 1
    assert snapshot(account) == before


def test_deck_preview_filtered_membership_and_original_deck_membership_are_distinct(client):
    source = make_deck(client, 'Source')
    other = make_deck(client, 'Other')
    expected = [add(client, deck=source, fields=[f'source {i}', '뜻'])[0] for i in range(3)]
    unrelated = add(client, deck=other)[0]
    filtered = ok(client.post('/api/filtered-decks', json={'name': 'Temporary', 'search': 'deck:Source', 'limit': 2, 'reschedule': False}))['id']
    account = client.app.state.collections.get('local-device')
    borrowed = sorted(account.col.db.list('select id from cards where did=?', filtered))
    assert len(borrowed) == 2
    before = snapshot(account)
    filtered_pages = [ok(client.get(f'/api/decks/{filtered}/preview?index={i}')) for i in range(2)]
    assert [page['card']['id'] for page in filtered_pages] == borrowed
    assert all(page['total'] == 2 for page in filtered_pages)
    source_pages = [ok(client.get(f'/api/decks/{source}/preview?index={i}')) for i in range(3)]
    assert [page['card']['id'] for page in source_pages] == sorted(expected)
    assert all(page['total'] == 3 and page['card']['id'] != unrelated for page in source_pages)
    assert snapshot(account) == before


def test_deck_preview_handles_empty_deleted_and_out_of_range_indices(client):
    assert ok(client.get('/api/decks/1/preview?index=999')) == {'index': 0, 'total': 0, 'card': None}
    first = add(client)[0]
    second = add(client, fields=['pear', '배'])[0]
    assert ok(client.get('/api/decks/1/preview?index=999'))['card']['id'] == second
    ok(client.post('/api/cards/action', json={'ids': [second], 'action': 'delete'}))
    after_delete = ok(client.get('/api/decks/1/preview?index=1'))
    assert after_delete['index'] == 0 and after_delete['total'] == 1 and after_delete['card']['id'] == first
    assert client.get('/api/decks/1/preview?index=-1').status_code == 422
    assert client.get('/api/decks/1/preview?index=invalid').status_code == 422
    assert client.get('/api/decks/999/preview').status_code == 404


def test_deck_preview_requires_authentication_and_uses_only_current_account(tmp_path, monkeypatch):
    monkeypatch.delenv('MODOO_LOCAL_AUTH', raising=False)
    monkeypatch.setenv('MODOO_FIREBASE_CONFIG', json.dumps({'projectId': 'test-project', 'apiKey': 'public-key'}))
    monkeypatch.setattr(auth, 'verify_firebase_token', lambda token: {'alice-token': 'alice', 'bob-token': 'bob'}[token])
    with TestClient(create_app(tmp_path), base_url='http://127.0.0.1:4190') as client:
        assert client.get('/api/decks/1/preview').status_code == 401
        client.headers['Authorization'] = 'Bearer alice-token'
        did = make_deck(client, 'Alice private')
        cid = add(client, deck=did)[0]
        assert ok(client.get(f'/api/decks/{did}/preview'))['card']['id'] == cid
        client.headers['Authorization'] = 'Bearer bob-token'
        assert client.get(f'/api/decks/{did}/preview').status_code == 404
        assert ok(client.get('/api/decks/1/preview'))['total'] == 0
