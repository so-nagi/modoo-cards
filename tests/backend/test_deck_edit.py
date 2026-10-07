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


def make_deck(client, name):
    return ok(client.post('/api/decks', json={'name': name}))['id']


def add(client, deck=1, front='apple'):
    mid = next(item['id'] for item in ok(client.get('/api/models')) if item['name'] == 'Basic')
    return ok(client.post('/api/notes', json={'deckId': deck, 'modelId': mid, 'fields': [front, '사과'], 'tags': []}))['cardIds'][0]


def snapshot(account):
    return {
        'decks': sorted(account.col.decks.all(), key=lambda deck: deck['id']),
        'cards': account.col.db.all('select * from cards order by id'),
        'notes': account.col.db.all('select * from notes order by id'),
        'reviews': account.col.db.all('select * from revlog order by id'),
        'undo': account.col.undo_status().SerializeToString(),
        'revision': account.revision,
        'tokens': copy.deepcopy(account.tokens),
        'meta': copy.deepcopy(account.meta),
    }


def test_metadata_read_is_read_only_and_edit_has_single_undo(client):
    parent = make_deck(client, '영어')
    child = make_deck(client, '영어::기초')
    cid = add(client, child)
    study = ok(client.get('/api/study', params={'deckId': parent}))['card']
    ok(client.post('/api/answer', json={'cardId': cid, 'rating': 4, 'token': study['token'], 'requestId': 'metadata-schedule', 'elapsedMs': 250}))
    account = client.app.state.collections.get('local-device')
    before = snapshot(account)
    assert ok(client.get(f'/api/decks/{parent}')) == {
        'id': parent, 'name': '영어', 'description': '', 'descriptionFormat': 'html', 'canEditDescription': True,
    }
    assert snapshot(account) == before
    description = '<b>기본 단어</b><br>뜻 &amp; 예문'
    result = ok(client.patch(f'/api/decks/{parent}', json={'name': '  Vocabulary  ', 'description': description}))
    assert result['name'] == 'Vocabulary' and result['description'] == description
    assert result['canEditDescription'] and result['descriptionFormat'] == 'html'
    assert account.deck(child)['name'] == 'Vocabulary::기초'
    after = snapshot(account)
    for key in ('cards', 'notes', 'reviews'):
        assert after[key] == before[key]
    ok(client.post('/api/undo'))
    assert account.deck(parent)['name'] == '영어' and account.deck(parent)['desc'] == ''
    assert account.deck(child)['name'] == '영어::기초'
    assert account.col.db.all('select * from cards order by id') == before['cards']


@pytest.mark.parametrize('body', [
    {}, {'name': ''}, {'name': '   '}, {'name': '::child'}, {'name': 'parent::'},
    {'name': 'parent::::child'}, {'name': 'bad\nname'}, {'name': None},
    {'description': None}, {'descriptionFormat': 'markdown'}, {'name': 'x' * 201},
])
def test_invalid_edits_leave_deck_description_undo_and_cards_unchanged(client, body):
    add(client)
    account = client.app.state.collections.get('local-device')
    before = snapshot(account)
    assert client.patch('/api/decks/1', json=body).status_code == 422
    assert snapshot(account) == before


@pytest.mark.parametrize('name', ['Already exists', 'already EXISTS', '  Already exists  '])
def test_name_collision_rejects_entire_edit_without_silent_suffix(client, name):
    other = make_deck(client, 'Already exists')
    account = client.app.state.collections.get('local-device')
    before = snapshot(account)
    response = client.patch('/api/decks/1', json={'name': name, 'description': '<b>must not save</b>'})
    assert response.status_code == 409
    assert snapshot(account) == before
    assert account.deck(other)['name'] == 'Already exists'


def test_markdown_import_format_is_preserved_by_name_and_description_edits(client):
    ok(client.get('/api/decks/1'))
    account = client.app.state.collections.get('local-device')
    native = account.deck(1)
    native['desc'], native['md'] = '**원본**\n- 항목', True
    account.col.decks.update_dict(native)
    assert ok(client.get('/api/decks/1'))['descriptionFormat'] == 'markdown'
    renamed = ok(client.patch('/api/decks/1', json={'name': 'Markdown deck'}))
    assert renamed['description'] == '**원본**\n- 항목' and renamed['descriptionFormat'] == 'markdown'
    edited = ok(client.patch('/api/decks/1', json={'description': '**수정**'}))
    assert edited['descriptionFormat'] == 'markdown' and account.deck(1)['md'] is True
    html = ok(client.patch('/api/decks/1', json={'description': '<b>수정</b>', 'descriptionFormat': 'html'}))
    assert html['descriptionFormat'] == 'html' and not account.deck(1).get('md')
    assert ok(client.patch('/api/decks/1', json={'description': ''}))['description'] == ''


def test_filtered_deck_rename_and_validation_preserve_membership(client):
    source = make_deck(client, 'Source')
    cid = add(client, source)
    filtered = ok(client.post('/api/filtered-decks', json={'name': 'Temporary', 'search': 'deck:Source', 'limit': 10, 'reschedule': False}))['id']
    metadata = ok(client.get(f'/api/decks/{filtered}'))
    assert metadata['description'] == '' and metadata['canEditDescription'] is False
    account = client.app.state.collections.get('local-device')
    before = snapshot(account)
    assert client.patch(f'/api/decks/{filtered}', json={'name': 'Should not save', 'description': ''}).status_code == 422
    assert snapshot(account) == before
    assert ok(client.patch(f'/api/decks/{filtered}', json={'name': 'Filtered renamed'}))['name'] == 'Filtered renamed'
    assert account.col.db.all('select * from cards order by id') == before['cards']
    assert account.col.get_card(cid).did == filtered
    before = snapshot(account)
    assert client.patch(f'/api/decks/{source}', json={'name': 'Filtered renamed::child', 'description': 'no'}).status_code == 422
    assert client.patch(f'/api/decks/{source}', json={'name': 'Source::child', 'description': 'no'}).status_code == 422
    assert snapshot(account) == before


def test_default_visibility_is_restored_by_undo(client):
    ok(client.delete('/api/decks/1'))
    assert not any(deck['id'] == 1 for deck in ok(client.get('/api/bootstrap'))['decks'])
    result = ok(client.patch('/api/decks/1', json={'name': 'Default', 'description': '복원'}))
    assert result['id'] == 1 and result['description'] == '복원'
    assert any(deck['id'] == 1 for deck in ok(client.get('/api/bootstrap'))['decks'])
    ok(client.post('/api/undo'))
    assert not any(deck['id'] == 1 for deck in ok(client.get('/api/bootstrap'))['decks'])
    assert ok(client.get('/api/decks/1'))['description'] == ''
    ok(client.patch('/api/decks/1', json={'name': 'Default'}))
    ok(client.post('/api/undo'))
    assert not any(deck['id'] == 1 for deck in ok(client.get('/api/bootstrap'))['decks'])


def test_metadata_persists_restart_and_native_apkg_import(tmp_path, monkeypatch):
    monkeypatch.setenv('MODOO_LOCAL_AUTH', '1')
    description = '<h3>단어장</h3><p>첫 줄<br>둘째 줄 &amp; 기호</p>'
    with TestClient(create_app(tmp_path / 'source'), base_url='http://127.0.0.1:4190', client=('127.0.0.1', 12345)) as client:
        did = make_deck(client, 'Before')
        add(client, did)
        ok(client.patch(f'/api/decks/{did}', json={'name': 'After', 'description': description, 'descriptionFormat': 'html'}))
    with TestClient(create_app(tmp_path / 'source'), base_url='http://127.0.0.1:4190', client=('127.0.0.1', 12345)) as client:
        metadata = ok(client.get(f'/api/decks/{did}'))
        assert metadata['name'] == 'After' and metadata['description'] == description
        response = client.post('/api/export', json={'deckId': did, 'format': 'apkg'})
        assert response.status_code == 200, response.text
        package = response.content
    with TestClient(create_app(tmp_path / 'target'), base_url='http://127.0.0.1:4190', client=('127.0.0.1', 12345)) as client:
        ok(client.post('/api/import', files={'file': ('edited.apkg', package, 'application/octet-stream')}))
        imported = next(deck for deck in ok(client.get('/api/bootstrap'))['decks'] if deck['name'] == 'After')
        metadata = ok(client.get(f'/api/decks/{imported["id"]}'))
        assert metadata['description'] == description and metadata['descriptionFormat'] == 'html'
        assert ok(client.get('/api/cards', params={'deckId': imported['id']}))['total'] == 1


def test_exact_deck_scope_includes_children_and_groups_search_or(client):
    name = 'Quoted "* deck'
    parent = make_deck(client, name)
    child = make_deck(client, name + '::Child')
    other = make_deck(client, 'Other')
    expected = {add(client, parent, 'apple'), add(client, child, 'banana')}
    unrelated = add(client, other, 'banana')
    params = {'deckId': parent, 'q': 'apple OR banana'}
    before = snapshot(client.app.state.collections.get('local-device'))
    result = ok(client.get('/api/cards', params=params))
    assert {card['id'] for card in result['cards']} == expected and result['total'] == 2
    assert unrelated not in {card['id'] for card in result['cards']}
    limited = ok(client.get('/api/cards', params=params | {'limit': 1}))
    assert len(limited['cards']) == 1 and limited['total'] == 2
    assert snapshot(client.app.state.collections.get('local-device')) == before
    ok(client.patch(f'/api/decks/{parent}', json={'name': 'Renamed scope'}))
    assert {card['id'] for card in ok(client.get('/api/cards', params=params))['cards']} == expected
    assert client.get('/api/cards', params={'deckId': 999}).status_code == 404
    assert client.get('/api/cards', params={'deckId': -1}).status_code == 422


def test_deck_scope_preserves_original_and_filtered_membership(client):
    source = make_deck(client, 'Source')
    expected = {add(client, source, 'word 1'), add(client, source, 'word 2')}
    filtered = ok(client.post('/api/filtered-decks', json={'name': 'Temporary', 'search': 'deck:Source', 'limit': 1, 'reschedule': False}))['id']
    original = ok(client.get('/api/cards', params={'deckId': source}))
    borrowed = ok(client.get('/api/cards', params={'deckId': filtered}))
    assert {card['id'] for card in original['cards']} == expected
    assert borrowed['total'] == 1 and borrowed['cards'][0]['id'] in expected


def test_edit_and_scope_are_authenticated_and_account_isolated(tmp_path, monkeypatch):
    monkeypatch.delenv('MODOO_LOCAL_AUTH', raising=False)
    monkeypatch.setenv('MODOO_FIREBASE_CONFIG', json.dumps({'projectId': 'test-project', 'apiKey': 'public-key'}))
    monkeypatch.setattr(auth, 'verify_firebase_token', lambda token: {'alice-token': 'alice', 'bob-token': 'bob'}[token])
    with TestClient(create_app(tmp_path), base_url='http://127.0.0.1:4190', client=('127.0.0.1', 12345)) as client:
        assert client.get('/api/decks/1').status_code == 401
        assert client.patch('/api/decks/1', json={'description': 'private'}).status_code == 401
        client.headers['Authorization'] = 'Bearer alice-token'
        did = make_deck(client, 'Alice private')
        ok(client.patch(f'/api/decks/{did}', json={'description': 'private'}))
        add(client, did)
        client.headers['Authorization'] = 'Bearer bob-token'
        assert client.get(f'/api/decks/{did}').status_code == 404
        assert client.patch(f'/api/decks/{did}', json={'description': 'overwrite'}).status_code == 404
        assert client.get('/api/cards', params={'deckId': did}).status_code == 404
        assert ok(client.get('/api/decks/1'))['description'] == ''
        client.headers['Authorization'] = 'Bearer alice-token'
        assert ok(client.get(f'/api/decks/{did}'))['description'] == 'private'


def test_card_font_size_defaults_bounds_and_restart(tmp_path, monkeypatch):
    monkeypatch.setenv('MODOO_LOCAL_AUTH', '1')
    with TestClient(create_app(tmp_path), base_url='http://127.0.0.1:4190', client=('127.0.0.1', 12345)) as client:
        assert ok(client.get('/api/settings'))['cardFontSize'] == 20
        assert ok(client.get('/api/bootstrap'))['settings']['cardFontSize'] == 20
        for size in (13, 41, 20.5):
            assert client.put('/api/settings', json={'cardFontSize': size}).status_code == 422
        assert ok(client.put('/api/settings', json={'cardFontSize': 28}))['cardFontSize'] == 28
    with TestClient(create_app(tmp_path), base_url='http://127.0.0.1:4190', client=('127.0.0.1', 12345)) as client:
        assert ok(client.get('/api/bootstrap'))['settings']['cardFontSize'] == 28
