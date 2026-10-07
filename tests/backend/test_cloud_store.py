import copy
from contextlib import ExitStack
import hashlib
import importlib
import json
from pathlib import Path
import threading

from fastapi import HTTPException
from fastapi.testclient import TestClient
import pytest

from server import auth
from server.cloud_store import canonical, decode_database, RealtimeStore


class FakeStore:
    def __init__(self):
        self.states, self.blobs = {}, {}
        self.failure = None
        self.barrier = None
        self.lock = threading.Lock()

    def etag(self, uid):
        return hashlib.sha256(canonical(self.states.get(uid))).hexdigest()

    def read(self, uid, token):
        assert token == 'test-token'
        return copy.deepcopy(self.states.get(uid)), self.etag(uid)

    def media(self, uid, token, item):
        return self.blobs[(uid, item['hash'])]

    def commit(self, uid, token, state, previous, etag, folder):
        if self.barrier:
            self.barrier.wait(timeout=20)
        with self.lock:
            if self.failure == 'before':
                raise HTTPException(503, 'test storage offline')
            if etag != self.etag(uid):
                raise HTTPException(409, 'test version conflict')
            for item in state['media']:
                self.blobs[(uid, item['hash'])] = (folder / item['name']).read_bytes()
            value = copy.deepcopy(state)
            if not value['media']:
                del value['media']  # Firebase drops empty arrays.
            self.states[uid] = value
            if self.failure == 'after':
                raise HTTPException(503, 'test lost response after successful commit')


@pytest.fixture
def cloud(tmp_path, monkeypatch):
    module = importlib.import_module('server.app')
    store = FakeStore()
    monkeypatch.setenv('MODOO_LOCAL_AUTH', '0')
    monkeypatch.setenv('MODOO_DATABASE_URL', 'https://example.firebaseio.com')
    monkeypatch.setenv('MODOO_ALLOWED_ORIGINS', 'https://cards.example.com')
    monkeypatch.setattr(module, 'RealtimeStore', lambda url: store)
    with ExitStack() as stack:
        def new(name, uid='owner'):
            app = module.create_app(tmp_path / name)
            app.dependency_overrides[auth.require_uid] = lambda: uid
            client = stack.enter_context(TestClient(app, headers={'Authorization': 'Bearer test-token', 'Origin': 'https://cards.example.com'}))
            return client
        yield store, new


def ok(response):
    assert response.status_code == 200, response.text
    return response.json()


def add(client):
    bootstrap = ok(client.get('/api/bootstrap'))
    mid = next(model['id'] for model in bootstrap['models'] if model['name'] == 'Basic')
    return ok(client.post('/api/notes', json={'deckId': 1, 'modelId': mid, 'fields': ['cloud', '클라우드'], 'tags': []}))


def test_empty_disk_restores_notes_ratings_settings_and_media(cloud):
    store, new = cloud
    client = new('first')
    note = add(client)
    image = b'example media bytes'
    media = ok(client.post('/api/media', files={'file': ('sample.png', image, 'image/png')}))
    ok(client.put('/api/settings', json={'skin': 'classic', 'volume': .6}))
    ok(client.put('/api/decks/1/favorite', json={'favorite': True}))
    card = ok(client.get('/api/study'))['card']
    body = {'cardId': card['id'], 'rating': 2, 'token': card['token'], 'requestId': 'restart-proof', 'elapsedMs': 900}
    ok(client.post('/api/answer', json=body))
    restarted = new('empty-after-restart')
    boot = ok(restarted.get('/api/bootstrap'))
    assert boot['stats']['totalCards'] == 1
    assert boot['settings']['skin'] == 'classic'
    info = ok(restarted.get('/api/cards/' + str(note['cardIds'][0])))
    assert len(info['history']) == 1 and info['history'][0]['rating'] == 2
    ok(restarted.post('/api/answer', json=body))
    assert len(ok(restarted.get('/api/cards/' + str(card['id'])))['history']) == 1
    account = restarted.app.state.collections.accounts['owner']
    assert (account.path / 'collection.media' / media['filename']).read_bytes() == image
    assert account.meta['favoriteDeckIds'] == [1]


def test_failed_commit_returns_failure_and_does_not_survive_reload(cloud):
    store, new = cloud
    client = new('first')
    ok(client.get('/api/bootstrap'))
    store.failure = 'before'
    failed = client.post('/api/decks', json={'name': 'Must not save'})
    assert failed.status_code == 503
    assert failed.headers['access-control-allow-origin'] == 'https://cards.example.com'
    store.failure = None
    assert 'Must not save' not in [d['name'] for d in ok(client.get('/api/bootstrap'))['decks']]


def test_ambiguous_answer_commit_reloads_receipt_without_double_rating(cloud):
    store, new = cloud
    client = new('first')
    add(client)
    card = ok(client.get('/api/study'))['card']
    body = {'cardId': card['id'], 'rating': 1, 'token': card['token'], 'requestId': 'lost-response', 'elapsedMs': 800}
    store.failure = 'after'
    assert client.post('/api/answer', json=body).status_code == 503
    store.failure = None
    ok(client.post('/api/answer', json=body))
    assert len(ok(client.get('/api/cards/' + str(card['id'])))['history']) == 1


def test_live_undo_is_preserved_until_restart(cloud):
    _, new = cloud
    client = new('undo')
    add(client)
    card = ok(client.get('/api/study'))['card']
    ok(client.post('/api/answer', json={'cardId': card['id'], 'rating': 3, 'token': card['token'], 'requestId': 'undo-proof', 'elapsedMs': 100}))
    ok(client.get('/api/bootstrap'))
    ok(client.post('/api/undo'))
    assert ok(client.get('/api/cards/' + str(card['id'])))['history'] == []


def test_accounts_and_server_instances_do_not_overwrite_each_other(cloud):
    _, new = cloud
    first, second, stranger = new('one'), new('two'), new('three', 'other')
    ok(first.post('/api/decks', json={'name': 'First'}))
    ok(second.post('/api/decks', json={'name': 'Second'}))
    assert {'First', 'Second'} <= {d['name'] for d in ok(first.get('/api/bootstrap'))['decks']}
    assert not {'First', 'Second'} & {d['name'] for d in ok(stranger.get('/api/bootstrap'))['decks']}


def test_racing_servers_have_one_commit_and_one_conflict(cloud):
    from concurrent.futures import ThreadPoolExecutor
    store, new = cloud
    first, second = new('one'), new('two')
    ok(first.get('/api/bootstrap'))
    ok(second.get('/api/bootstrap'))
    store.barrier = threading.Barrier(2)
    with ThreadPoolExecutor(2) as pool:
        futures = [pool.submit(client.post, '/api/decks', json={'name': name}) for client, name in [(first, 'Race A'), (second, 'Race B')]]
        assert sorted(f.result().status_code for f in futures) == [200, 409]
    store.barrier = None
    names = {d['name'] for d in ok(first.get('/api/bootstrap'))['decks']}
    assert len(names & {'Race A', 'Race B'}) == 1


def test_corrupt_cloud_snapshot_fails_closed(cloud):
    store, new = cloud
    first = new('one')
    add(first)
    store.states['owner']['database'] = 'corrupted'
    result = new('two').get('/api/bootstrap')
    assert result.status_code == 503
    assert store.states['owner']['database'] == 'corrupted'


def test_storage_network_exception_does_not_include_credentials(monkeypatch):
    import requests
    monkeypatch.setattr(requests, 'request', lambda *args, **kwargs: (_ for _ in ()).throw(requests.ConnectionError('auth=SECRET_TOKEN')))
    with pytest.raises(HTTPException) as failure:
        RealtimeStore('https://example.firebaseio.com').read('owner', 'SECRET_TOKEN')
    assert 'SECRET_TOKEN' not in str(failure.value)


@pytest.mark.parametrize('url', ['http://example.firebaseio.com', 'https://example.firebaseio.com.evil.test', 'https://a:b@example.firebaseio.com', 'https://example.firebaseio.com/path'])
def test_database_url_cannot_redirect_tokens(url):
    with pytest.raises(ValueError):
        RealtimeStore(url)
