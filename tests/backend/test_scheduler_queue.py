"""Exercise the real Anki scheduler across the web request boundary."""

import time

import pytest
from fastapi.testclient import TestClient

from server.app import create_app
from server.core import LEARN_AHEAD_MIGRATION, LEARN_AHEAD_RESTORE_MIGRATION


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setenv('MODOO_LOCAL_AUTH', '1')
    with TestClient(create_app(tmp_path), base_url='http://127.0.0.1:4190', client=('127.0.0.1', 12345)) as value:
        yield value


def ok(response):
    assert response.status_code == 200, response.text
    return response.json()


def add_words(client, count=18, deck=1):
    model = next(model for model in ok(client.get('/api/models')) if model['name'] == 'Basic')
    return [ok(client.post('/api/notes', json={
        'deckId': deck, 'modelId': model['id'],
        'fields': [f'word-{i:02}', f'meaning-{i:02}'], 'tags': [],
    }))['cardIds'][0] for i in range(count)]


def grade(client, study, rating, request_id):
    card = study['card']
    return ok(client.post('/api/answer', json={
        'cardId': card['id'], 'rating': rating, 'token': card['token'],
        'requestId': request_id, 'elapsedMs': 250,
    }))


def wait_for_due_times(client):
    return ok(client.put('/api/scheduler/preferences', json={'learnAheadMinutes': 0}))


@pytest.mark.parametrize('refresh_before_study', [True, False])
def test_hard_does_not_skip_available_new_cards_during_dashboard_refresh(client, refresh_before_study):
    assert ok(client.get('/api/scheduler/preferences')) == {'learnAheadMinutes': 20}
    cards = add_words(client)
    seen = []
    for i in range(len(cards)):
        if refresh_before_study:
            ok(client.get('/api/bootstrap'))
        study = ok(client.get('/api/study'))
        if not refresh_before_study:
            ok(client.get('/api/bootstrap'))
        seen.append(study['card']['id'])
        grade(client, study, 2, f'hard-{i}')
    assert set(seen) == set(cards)
    assert len(set(seen)) == len(cards)
    col = client.app.state.collections.get('local-device').col
    assert col.db.all('select ease,count(*) from revlog group by ease') == [[2, len(cards)]]


@pytest.mark.parametrize('rating', [1, 2])
def test_native_default_repeats_again_and_hard_after_available_new_cards(client, rating):
    cards = add_words(client, count=6)
    first_round = []
    for index in range(len(cards)):
        study = ok(client.get('/api/study'))
        first_round.append(study['card']['id'])
        grade(client, study, rating, f'initial-{index}')
    assert set(first_round) == set(cards)
    assert len(set(first_round)) == len(cards), 'Do not skip available new cards.'
    for index in range(8):
        study = ok(client.get('/api/study'))
        assert study['card'] is not None, 'Native learn-ahead must continue Again/Hard learning.'
        assert study['card']['id'] in cards
        grade(client, study, rating, f'repeat-{index}')
    col = client.app.state.collections.get('local-device').col
    assert col.db.all('select ease,count(*) from revlog group by ease') == [[rating, len(cards) + 8]]


def test_two_hard_cards_do_not_repeat_early_while_other_learning_cards_wait(client):
    wait_for_due_times(client)
    cards = add_words(client)
    seen = []
    for i in range(len(cards)):
        study = ok(client.get('/api/study'))
        seen.append(study['card']['id'])
        grade(client, study, 2 if i < 2 else 3, f'mixed-{i}')
        ok(client.get('/api/bootstrap'))
    assert set(seen) == set(cards)
    col = client.app.state.collections.get('local-device').col
    assert col.db.scalar('select count(*) from cards where queue=1') == 18
    before = col.db.all('select id,due,queue,reps from cards order by id')
    for _ in range(3):
        study = ok(client.get('/api/study'))
        assert study['card'] is None, 'Do not pull the two Hard cards forward before their native due times.'
        assert study['waiting']['count'] == 18
        assert abs(study['waiting']['nextDueAt'] - min(row[1] for row in before)) < 2
        assert study['limits'] == {'new': False, 'review': False}
    assert col.db.all('select id,due,queue,reps from cards order by id') == before
    assert col.db.scalar('select count(*) from revlog') == 18


def test_waiting_card_returns_when_its_native_due_time_arrives(client):
    wait_for_due_times(client)
    options = ok(client.get('/api/decks/1/options'))
    options['learningSteps'] = '3s'
    ok(client.put('/api/decks/1/options', json=options))
    cards = add_words(client, count=1)
    grade(client, ok(client.get('/api/study')), 1, 'short-again')
    waiting = ok(client.get('/api/study'))
    assert waiting['card'] is None
    assert waiting['waiting']['count'] == 1
    col = client.app.state.collections.get('local-device').col
    card = col.get_card(cards[0])
    before = col.db.all('select * from cards')
    history = col.db.all('select * from revlog')
    # Let real time pass with the already-built native queue, without updating
    # the card, reopening the collection, or otherwise invalidating that queue.
    assert card.due - time.time() < 5
    time.sleep(max(0, card.due - time.time()) + 0.2)
    study = ok(client.get('/api/study'))
    assert study['card']['id'] == card.id
    assert study['counts'] == {'new': 0, 'learn': 1, 'review': 0}
    assert col.db.all('select * from cards') == before
    assert col.db.all('select * from revlog') == history
    grade(client, study, 1, 'again-after-due')
    assert ok(client.get('/api/study'))['card'] is None
    assert col.get_card(card.id).due > time.time()
    assert abs(waiting['waiting']['nextDueAt'] - card.due) < 2


def test_daily_new_limit_is_distinct_from_waiting_learning_cards(client):
    wait_for_due_times(client)
    add_words(client)
    options = ok(client.get('/api/decks/1/options'))
    options['newPerDay'] = 2
    ok(client.put('/api/decks/1/options', json=options))
    for i in range(2):
        grade(client, ok(client.get('/api/study')), 2, f'limited-{i}')
    study = ok(client.get('/api/study'))
    assert study['card'] is None
    assert study['waiting']['count'] == 2
    assert study['limits'] == {'new': True, 'review': False}
    col = client.app.state.collections.get('local-device').col
    assert col.db.scalar('select count(*) from cards where queue=0') == 16


def test_waiting_counts_follow_selected_deck_tree_and_ignore_buried_cards(client):
    wait_for_due_times(client)
    parent = ok(client.post('/api/decks', json={'name': 'Parent'}))['id']
    child = ok(client.post('/api/decks', json={'name': 'Parent::Child'}))['id']
    other = ok(client.post('/api/decks', json={'name': 'Other'}))['id']
    child_cards = add_words(client, count=2, deck=child)
    add_words(client, count=3, deck=other)
    for deck, count in ((child, 2), (other, 3)):
        for i in range(count):
            grade(client, ok(client.get('/api/study', params={'deckId': deck})), 2, f'scope-{deck}-{i}')
    study = ok(client.get('/api/study', params={'deckId': parent}))
    assert study['waiting']['count'] == 2
    col = client.app.state.collections.get('local-device').col
    assert study['waiting']['nextDueAt'] == min(col.get_card(cid).due for cid in child_cards)
    ok(client.post('/api/cards/action', json={'ids': [child_cards[0]], 'action': 'bury'}))
    remaining = ok(client.get('/api/study', params={'deckId': parent}))
    assert remaining['waiting']['count'] == 1
    assert remaining['waiting']['nextDueAt'] == col.get_card(child_cards[1]).due
    assert ok(client.get('/api/study', params={'deckId': other}))['waiting']['count'] == 3


def test_filtered_preview_wait_uses_its_native_timestamp(client):
    wait_for_due_times(client)
    cards = add_words(client, count=1)
    filtered = ok(client.post('/api/filtered-decks', json={'name': 'Preview', 'search': 'is:new', 'limit': 20, 'reschedule': False}))['id']
    grade(client, ok(client.get('/api/study', params={'deckId': filtered})), 1, 'preview-again')
    col = client.app.state.collections.get('local-device').col
    card = col.get_card(cards[0])
    assert card.queue == 4 and card.due > time.time()
    study = ok(client.get('/api/study', params={'deckId': filtered}))
    assert study['card'] is None
    assert study['waiting'] == {'count': 1, 'nextDueAt': card.due}
    assert ok(client.get('/api/study'))['waiting'] == {'count': 0, 'nextDueAt': None}, 'Do not count cards moved into another filtered deck.'


def test_interday_learning_due_is_not_misrepresented_as_a_unix_timestamp(client):
    wait_for_due_times(client)
    options = ok(client.get('/api/decks/1/options'))
    options['learningSteps'] = '1d'
    ok(client.put('/api/decks/1/options', json=options))
    cards = add_words(client, count=1)
    grade(client, ok(client.get('/api/study')), 1, 'next-day')
    col = client.app.state.collections.get('local-device').col
    assert col.get_card(cards[0]).queue == 3
    assert ok(client.get('/api/study'))['waiting']['nextDueAt'] is None


def test_empty_deck_has_no_waiting_or_limits(client):
    study = ok(client.get('/api/study'))
    assert study['card'] is None
    assert study['waiting'] == {'count': 0, 'nextDueAt': None}
    assert study['limits'] == {'new': False, 'review': False}


def test_preference_migration_and_edit_preserve_cards_review_history_and_undo(client):
    add_words(client, count=1)
    grade(client, ok(client.get('/api/study')), 2, 'migration')
    account = client.app.state.collections.get('local-device')
    col = account.col
    # Recreate the app's old forced-zero preference without touching cards.
    col.set_config('collapseTime', 0)
    col.set_config(LEARN_AHEAD_MIGRATION, True)
    col.set_config(LEARN_AHEAD_RESTORE_MIGRATION, False)
    before_cards = col.db.all('select * from cards')
    before_history = col.db.all('select * from revlog')
    before_undo = col.undo_status()
    account.initialize_scheduler_preferences()
    assert ok(client.get('/api/scheduler/preferences')) == {'learnAheadMinutes': 20}
    assert col.db.all('select * from cards') == before_cards
    assert col.db.all('select * from revlog') == before_history
    assert col.undo_status().undo == before_undo.undo
    assert col.undo_status().redo == before_undo.redo
    preferences_before = col.get_preferences()
    assert wait_for_due_times(client) == {'learnAheadMinutes': 0}
    assert col.get_preferences().scheduling.learn_ahead_secs == 0
    preferences_after = col.get_preferences()
    preferences_after.scheduling.learn_ahead_secs = preferences_before.scheduling.learn_ahead_secs
    assert preferences_after == preferences_before
    assert col.db.all('select * from cards') == before_cards
    assert col.db.all('select * from revlog') == before_history
    assert col.undo_status().undo
    account.initialize_scheduler_preferences()
    assert ok(client.get('/api/scheduler/preferences')) == {'learnAheadMinutes': 0}
    assert ok(client.get('/api/study'))['card'] is None, 'An explicit zero choice remains available.'
    ok(client.post('/api/undo'))
    assert ok(client.get('/api/scheduler/preferences')) == {'learnAheadMinutes': 20}
    assert col.db.all('select * from cards') == before_cards
    assert col.db.all('select * from revlog') == before_history
    ok(client.post('/api/undo'))
    assert col.db.scalar('select count(*) from revlog') == 0
    assert col.db.scalar('select reps from cards') == 0


@pytest.mark.parametrize('old_marker,seconds', [(False, 0), (False, 420), (False, 1200), (False, 1800), (True, 300), (True, 1200)])
def test_restoration_preserves_native_imported_and_custom_nonzero_preferences(client, old_marker, seconds):
    ok(client.get('/api/scheduler/preferences'))
    account = client.app.state.collections.get('local-device')
    account.col.set_config('collapseTime', seconds)
    account.col.set_config(LEARN_AHEAD_MIGRATION, old_marker)
    account.col.set_config(LEARN_AHEAD_RESTORE_MIGRATION, False)
    account.initialize_scheduler_preferences()
    assert ok(client.get('/api/scheduler/preferences')) == {'learnAheadMinutes': seconds / 60}
    assert account.col.get_config(LEARN_AHEAD_RESTORE_MIGRATION) is True


def test_preference_changes_an_already_built_queue_immediately(client):
    wait_for_due_times(client)
    add_words(client, count=2)
    for i in range(2):
        grade(client, ok(client.get('/api/study')), 2, f'queue-preference-{i}')
    assert ok(client.get('/api/study'))['card'] is None
    ok(client.put('/api/scheduler/preferences', json={'learnAheadMinutes': 20}))
    assert ok(client.get('/api/study'))['card'] is not None
    ok(client.put('/api/scheduler/preferences', json={'learnAheadMinutes': 0}))
    study = ok(client.get('/api/study'))
    assert study['card'] is None
    assert study['waiting']['count'] == 2


def test_preference_survives_restart_and_preserves_current_answer_token(tmp_path, monkeypatch):
    monkeypatch.setenv('MODOO_LOCAL_AUTH', '1')
    with TestClient(create_app(tmp_path), base_url='http://127.0.0.1:4190', client=('127.0.0.1', 12345)) as client:
        add_words(client, count=1)
        study = ok(client.get('/api/study'))
        wait_for_due_times(client)
        grade(client, study, 2, 'after-preference')
        ok(client.post('/api/undo'))
        col = client.app.state.collections.get('local-device').col
        assert col.db.scalar('select count(*) from revlog') == 0
        assert col.db.scalar('select reps from cards') == 0
    with TestClient(create_app(tmp_path), base_url='http://127.0.0.1:4190', client=('127.0.0.1', 12345)) as client:
        assert ok(client.get('/api/scheduler/preferences')) == {'learnAheadMinutes': 0}


def test_old_forced_zero_is_restored_on_open_only_once(tmp_path, monkeypatch):
    monkeypatch.setenv('MODOO_LOCAL_AUTH', '1')
    with TestClient(create_app(tmp_path), base_url='http://127.0.0.1:4190', client=('127.0.0.1', 12345)) as client:
        add_words(client, count=1)
        grade(client, ok(client.get('/api/study')), 2, 'before-restart')
        col = client.app.state.collections.get('local-device').col
        cards = col.db.all('select * from cards')
        history = col.db.all('select * from revlog')
        col.set_config('collapseTime', 0)
        col.set_config(LEARN_AHEAD_MIGRATION, True)
        col.set_config(LEARN_AHEAD_RESTORE_MIGRATION, False)
    with TestClient(create_app(tmp_path), base_url='http://127.0.0.1:4190', client=('127.0.0.1', 12345)) as client:
        assert ok(client.get('/api/scheduler/preferences')) == {'learnAheadMinutes': 20}
        col = client.app.state.collections.get('local-device').col
        assert col.db.all('select * from cards') == cards
        assert col.db.all('select * from revlog') == history
        assert ok(client.get('/api/study'))['card'] is not None
        wait_for_due_times(client)
    with TestClient(create_app(tmp_path), base_url='http://127.0.0.1:4190', client=('127.0.0.1', 12345)) as client:
        assert ok(client.get('/api/scheduler/preferences')) == {'learnAheadMinutes': 0}
        assert ok(client.get('/api/study'))['card'] is None
        col = client.app.state.collections.get('local-device').col
        assert col.db.all('select * from cards') == cards
        assert col.db.all('select * from revlog') == history


@pytest.mark.parametrize('minutes', [-1, 61, 1.5, True, '20'])
def test_scheduler_preference_validates_minutes(client, minutes):
    assert client.put('/api/scheduler/preferences', json={'learnAheadMinutes': minutes}).status_code == 422
    assert ok(client.get('/api/scheduler/preferences')) == {'learnAheadMinutes': 20}
