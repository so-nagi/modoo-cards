import copy
import html
import re

import pytest
from fastapi.testclient import TestClient

from server import auth
from server.app import create_app
from server.core import Account
from server.preview import PreviewNoteInput, render_preview


@pytest.fixture
def account(tmp_path):
    value = Account(tmp_path, 'preview-test', b'preview-only-test-secret')
    try:
        yield value
    finally:
        value.close()


def preview(account, name='Basic', fields=None, ordinal=0):
    model = account.col.models.by_name(name)
    return render_preview(account, PreviewNoteInput(modelId=model['id'], fields=['apple', '사과'] if fields is None else fields, cardOrd=ordinal))


def snapshot(account):
    tables = account.col.db.list("select name from sqlite_master where type='table' and name not like 'sqlite_%' order by name")
    return {
        'tables': {name: sorted(account.col.db.all(f'SELECT * FROM "{name}"'), key=repr) for name in tables},
        'undo': account.col.undo_status().SerializeToString(),
        'revision': account.revision, 'tokens': copy.deepcopy(account.tokens), 'meta': copy.deepcopy(account.meta),
    }


def test_basic_preview_renders_real_frontside_and_keeps_all_database_state(account):
    existing = account.col.new_note(account.col.models.by_name('Basic'))
    existing.fields = ['existing', '기존']; account.col.add_note(existing, 1)
    before = snapshot(account)
    result = preview(account, fields=['<b>apple</b>', '사과<br>과일'])
    assert result['front'] == '<b>apple</b>'
    assert '<b>apple</b>' in result['back'] and '사과<br>과일' in result['back']
    assert result['cards'] == [{'ord': 0, 'name': 'Card 1'}]
    assert '.card' in result['css']
    assert result['warnings'] == []
    assert snapshot(account) == before
    account.col.undo()
    assert account.col.db.scalar('select count() from notes') == 0


def test_reverse_and_optional_reverse_follow_native_generation_conditions(account):
    reverse = preview(account, 'Basic (and reversed card)', ordinal=1)
    assert reverse['front'] == '사과'
    assert 'apple' in reverse['back']
    assert [card['ord'] for card in reverse['cards']] == [0, 1]
    optional = preview(account, 'Basic (optional reversed card)', ['apple', '사과', ''], 1)
    assert [card['ord'] for card in optional['cards']] == [0]
    assert optional['cardOrd'] == 0
    enabled = preview(account, 'Basic (optional reversed card)', ['apple', '사과', 'yes'], 1)
    assert enabled['front'] == '사과'
    assert enabled['cardOrd'] == 1


def test_nonconsecutive_cloze_ordinals_use_native_cloze_filters(account):
    before = snapshot(account)
    result = preview(account, 'Cloze', ['{{c1::빛::힌트}}과 {{c3::그림자}}', '설명'], 2)
    assert [card['ord'] for card in result['cards']] == [0, 2]
    assert result['cardOrd'] == 2
    assert '<span class="cloze-inactive" data-ordinal="1">빛</span>' in result['front']
    assert 'data-cloze="그림자"' in result['front'] and '[...]' in result['front']
    assert '<span class="cloze" data-ordinal="3">그림자</span>' in result['back']
    assert '설명' in result['back']
    first = preview(account, 'Cloze', ['{{c3::그림자}}', ''], 0)
    assert first['cardOrd'] == 2
    assert snapshot(account) == before


@pytest.mark.parametrize('name,fields', [('Basic', ['', '']), ('Basic', ['', '뒷면']), ('Cloze', ['가림 없음', '설명'])])
def test_empty_front_or_missing_cloze_is_a_nonpersistent_warning(account, name, fields):
    before = snapshot(account)
    result = preview(account, name, fields)
    assert result['cards'] == [] and result['front'] == '' and result['back'] == ''
    assert result['warnings'] and all(isinstance(value, str) for value in result['warnings'])
    assert snapshot(account) == before


def test_type_answer_keeps_native_markers_and_model_is_unmodified(account):
    before = snapshot(account)
    result = preview(account, 'Basic (type in the answer)')
    assert 'apple' in result['front'] and '[[type:Back]]' in result['front']
    assert '[[type:Back]]' in result['back']
    assert snapshot(account) == before


def test_preview_media_audio_and_css_use_same_signed_account_urls(account):
    model = account.col.models.by_name('Basic')
    model['css'] += '\n.card {background-image:url("_paper.png")}'; account.col.models.update_dict(model)
    before = snapshot(account)
    result = preview(account, fields=['<img src="image.png">[sound:voice.mp3]', '사과'])
    assert re.search(r'/api/media/' + account.key + r'/image.png\?expires=\d+&amp;signature=[a-f0-9]{64}', result['front'])
    assert '<audio controls preload="none"' in result['front']
    assert f'/api/media/{account.key}/voice.mp3?' in html.unescape(result['front'])
    assert f'/api/media/{account.key}/_paper.png?' in result['css']
    assert snapshot(account) == before


def test_preview_api_validates_fields_and_requires_current_authenticated_account(tmp_path, monkeypatch):
    monkeypatch.setenv('MODOO_LOCAL_AUTH', '1')
    app = create_app(tmp_path)
    with TestClient(app, base_url='http://127.0.0.1:4190', client=('127.0.0.1', 12121)) as client:
        models = client.get('/api/models').json()
        model = next(value for value in models if value['name'] == 'Basic')
        body = {'modelId': model['id'], 'fields': ['apple', '사과']}
        assert client.post('/api/preview-note', json=body).status_code == 200
        assert client.post('/api/preview-note', json={**body, 'fields': ['wrong count']}).status_code == 422
        assert client.post('/api/preview-note', json={**body, 'fields': ['a' * 200001, '']}).status_code == 422
        assert client.post('/api/preview-note', json={**body, 'cardOrd': -1}).status_code == 422
        assert client.post('/api/preview-note', json={**body, 'uid': 'other-user'}).status_code == 422
        assert client.post('/api/preview-note', json={**body, 'modelId': 999}).status_code == 404
        assert client.post('/api/preview-note', json=body, headers={'origin': 'https://untrusted.example'}).status_code == 403
        monkeypatch.delenv('MODOO_LOCAL_AUTH')
        monkeypatch.setenv('MODOO_AUTH_MODE', 'firebase')
        assert client.post('/api/preview-note', json=body).status_code == 401
