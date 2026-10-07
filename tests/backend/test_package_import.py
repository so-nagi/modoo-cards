"""All imports use disposable collections; no real profile is opened."""
import io
import zipfile

import pytest
from anki.collection import Collection, ExportAnkiPackageOptions

from test_api import client, ok, add, answer


@pytest.fixture(params=[True, False], ids=['legacy', 'modern'])
def package(tmp_path, request):
    col = Collection(str(tmp_path / 'source.anki2'))
    try:
        deck = col.decks.id('Package::DAY01')
        note = col.new_note(col.models.by_name('Basic'))
        note.fields = ['package word', '뜻 [발음]<img src="test.png">']
        col.add_note(note, deck)
        col.media.write_data('test.png', b'test media')
        path = tmp_path / 'test.apkg'
        col.export_anki_package(out_path=str(path), options=ExportAnkiPackageOptions(
            with_scheduling=True, with_deck_configs=True, with_media=True,
            legacy=request.param), limit=None)
        return path.read_bytes()
    finally:
        col.close()


def test_apkg_counts_repeat_and_review_preservation(client, package):
    existing = add(client)['cardIds'][0]
    _, response = answer(client, 4)
    ok(response)
    before = ok(client.get(f'/api/cards/{existing}'))
    first = ok(client.post('/api/import', files={'file': ('WORDS.APKG', package)}))
    assert first['added'] == 1
    assert first['cardsAdded'] == 1
    col = client.app.state.collections.get('local-device').col
    imported = col.find_cards('deck:Package::DAY01')[0]
    # A retry after study must not reset the newly studied card or duplicate it.
    card = col.get_card(imported)
    card.reps = 7
    card.ivl = 42
    card.queue = 2
    card.type = 2
    col.update_card(card)
    second = ok(client.post('/api/import', files={'file': ('test.apkg', package)}))
    assert second['added'] == 0
    assert second['cardsAdded'] == 0
    assert col.note_count() == 2 and col.card_count() == 2
    assert col.get_card(imported).reps == 7
    assert col.get_card(imported).ivl == 42
    assert ok(client.get(f'/api/cards/{existing}')) == before
    assert (client.app.state.collections.get('local-device').path / 'collection.media/test.png').read_bytes() == b'test media'
    assert not list(client.app.state.collections.get('local-device').path.glob('upload-*'))


def invalid_zip():
    data = io.BytesIO()
    with zipfile.ZipFile(data, 'w') as archive:
        archive.writestr('collection.anki2', b'not sqlite')
        archive.writestr('media', '{}')
    return data.getvalue()


@pytest.mark.parametrize(('filename', 'data', 'status'), [
    ('unsupported.zip', b'wrong type', 415),
    ('empty.apkg', b'', 400),
    ('broken.apkg', b'not a zip', 400),
    ('broken-db.apkg', invalid_zip(), 400),
], ids=['extension', 'empty', 'corrupt-zip', 'corrupt-database'])
def test_failed_import_preserves_cards_and_allows_retry(client, package, filename, data, status):
    existing = add(client)['cardIds'][0]
    _, response = answer(client, 4)
    ok(response)
    before = ok(client.get(f'/api/cards/{existing}'))
    for _ in range(2):
        result = client.post('/api/import', files={'file': (filename, data)})
        assert result.status_code == status, result.text
        assert result.json()['detail']
        assert ok(client.get(f'/api/cards/{existing}')) == before
        assert ok(client.get('/api/bootstrap'))['stats']['totalNotes'] == 1
    ok(client.post('/api/import', files={'file': ('good.apkg', package)}))
    assert ok(client.get('/api/bootstrap'))['stats']['totalNotes'] == 2
    assert not list(client.app.state.collections.get('local-device').path.glob('upload-*'))


def test_upload_limit_without_content_length_preserves_collection(client, monkeypatch):
    import server.app as server
    add(client)
    monkeypatch.setattr(server, 'MAX_UPLOAD', 1024)
    request = client.build_request('POST', '/api/import', files={'file': ('large.apkg', b'x' * 1025)})
    del request.headers['content-length']
    response = client.send(request)
    assert response.status_code == 413
    assert ok(client.get('/api/bootstrap'))['stats']['totalNotes'] == 1
    assert not list(client.app.state.collections.get('local-device').path.glob('upload-*'))


def test_request_limit_rejects_before_opening_collection(client):
    response = client.post('/api/import', content=b'x', headers={
        'content-type': 'application/octet-stream', 'content-length': str(130 * 1024 * 1024)})
    assert response.status_code == 413
    assert not hasattr(client.app.state, 'collections')
