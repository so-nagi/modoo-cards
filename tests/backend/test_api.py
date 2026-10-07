import base64
from concurrent.futures import ThreadPoolExecutor
import io
import json
from pathlib import Path
import re
import sqlite3
import zipfile

import pytest
from fastapi.testclient import TestClient
from server.app import create_app
from server import auth


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setenv('MODOO_LOCAL_AUTH', '1')
    app = create_app(tmp_path)
    with TestClient(app, base_url='http://127.0.0.1:4190', client=('127.0.0.1', 12345)) as c:
        yield c


def ok(response):
    assert response.status_code == 200, response.text
    return response.json()


def model_id(client, name='Basic'):
    return next(m['id'] for m in ok(client.get('/api/models')) if m['name']==name)


def add(client, fields=None, model='Basic', deck=1):
    return ok(client.post('/api/notes', json={'deckId':deck, 'modelId':model_id(client, model), 'fields':fields or ['apple','사과'], 'tags':['word']}))


def answer(client, rating=3, request_id='answer-1'):
    card = ok(client.get('/api/study?deckId=1'))['card']
    body = {'cardId':card['id'], 'rating':rating, 'token':card['token'], 'requestId':request_id, 'elapsedMs':1200}
    return body, client.post('/api/answer', json=body)


def test_empty_bootstrap_and_official_version(client):
    b = ok(client.get('/api/bootstrap'))
    assert b['stats']['totalCards']==0
    assert len(b['models'])==6
    assert ok(client.get('/api/config'))['engineVersion']=='26.9.3'


@pytest.mark.parametrize('rating',[1,2,3,4])
def test_real_scheduler_answer_idempotency_and_undo(client,rating):
    n = add(client)
    body, response = answer(client, rating)
    ok(response)
    ok(client.post('/api/answer',json=body))
    card = ok(client.get('/api/cards/'+str(n['cardIds'][0])))
    assert len(card['history'])==1
    assert card['history'][0]['rating']==rating
    assert card['history'][0]['time']==1200
    assert card['reps']==1
    assert card['queue']==(2 if rating==4 else 1)
    ok(client.post('/api/undo'))
    card = ok(client.get('/api/cards/'+str(n['cardIds'][0])))
    assert card['reps']==0
    assert card['history']==[]


def test_stale_tokens_and_request_id_collision(client):
    add(client)
    s = ok(client.get('/api/study'))['card']
    add(client,['pear','배'])
    assert client.post('/api/answer',json={'cardId':s['id'],'rating':1,'token':s['token'],'requestId':'stale','elapsedMs':0}).status_code==409
    body,r=answer(client);ok(r)
    body['rating']=2
    assert client.post('/api/answer',json=body).status_code==409


def test_flag_keeps_current_study_answer_valid(client):
    add(client)
    card=ok(client.get('/api/study'))['card']
    ok(client.post('/api/cards/action',json={'ids':[card['id']],'action':'flag','value':1}))
    ok(client.post('/api/answer',json={'cardId':card['id'],'rating':3,'token':card['token'],'requestId':'after-flag','elapsedMs':500}))
    info=ok(client.get('/api/cards/'+str(card['id'])))
    assert info['flag']==1 and info['reps']==1


def test_concurrent_answers_cannot_grade_twice(client):
    add(client)
    card=ok(client.get('/api/study'))['card']
    def grade(i):
        return client.post('/api/answer',json={'cardId':card['id'],'rating':3,'token':card['token'],'requestId':'competing-'+str(i),'elapsedMs':100})
    with ThreadPoolExecutor(max_workers=2) as pool:
        results=list(pool.map(grade,[1,2]))
    assert sorted(r.status_code for r in results)==[200,409]
    assert ok(client.get('/api/stats'))['today']==1


def test_fsrs_core_produces_memory_state(client):
    options=ok(client.get('/api/decks/1/options'))
    options['fsrs']=True
    ok(client.put('/api/decks/1/options',json=options))
    note=add(client)
    body,r=answer(client,4);ok(r)
    core=client.app.state.collections.get('local-device').col
    card=core.get_card(note['cardIds'][0])
    assert card.memory_state is not None
    assert card.memory_state.stability>0


def test_bare_utf8_csv_import(client):
    ok(client.post('/api/import',files={'file':('words.csv','apple,사과\npear,배\n'.encode('utf-8'),'text/csv')}))
    rows=ok(client.get('/api/cards'))['cards']
    assert {tuple(r['fields']) for r in rows}=={('apple','사과'),('pear','배')}


def test_batch_is_validated_before_write_and_idempotent(client):
    body={'deckId':1,'modelId':model_id(client),'rows':[{'fields':['apple','사과'],'tags':[]},{'fields':['pear','배'],'tags':[]}],'requestId':'batch-1'}
    first=ok(client.post('/api/notes/batch',json=body))
    assert ok(client.post('/api/notes/batch',json=body))==first
    assert ok(client.get('/api/stats'))['totalNotes']==2
    body['requestId']='bad-batch';body['rows'][1]['fields']=['invalid']
    assert client.post('/api/notes/batch',json=body).status_code==422
    assert ok(client.get('/api/stats'))['totalNotes']==2


def test_note_types_core_generation(client):
    assert len(add(client,model='Basic (and reversed card)')['cardIds'])==2
    assert len(add(client,fields=['{{c1::빛}}과 {{c2::그림자}}','설명'],model='Cloze')['cardIds'])==2
    assert len(add(client,fields=['one','하나','yes'],model='Basic (optional reversed card)')['cardIds'])==2


def test_decks_options_fsrs_filters_and_actions(client):
    did=ok(client.post('/api/decks',json={'name':'영어::기초'}))['id']
    ok(client.patch('/api/decks/'+str(did),json={'name':'영어::단어'}))
    opts={'newPerDay':30,'reviewPerDay':99,'fsrs':True,'desiredRetention':.91,'learningSteps':'30s 5m','relearningSteps':'10m'}
    result=ok(client.put(f'/api/decks/{did}/options',json=opts))
    assert result['newPerDay']==30 and result['fsrs'] is True
    assert ok(client.get('/api/decks/1/options'))['newPerDay']==20
    cid=add(client,deck=did)['cardIds'][0]
    for action,expected in [('suspend',-1),('unsuspend',0),('bury',-3),('unbury',0)]:
        ok(client.post('/api/cards/action',json={'ids':[cid],'action':action}))
        assert ok(client.get(f'/api/cards/{cid}'))['queue']==expected
    ok(client.post('/api/cards/action',json={'ids':[cid],'action':'flag','value':3}))
    assert ok(client.get('/api/cards?q=flag:3'))['total']==1
    filtered=ok(client.post('/api/filtered-decks',json={'name':'오늘 연습','search':'is:new','limit':30,'reschedule':False}))['id']
    assert any(d['filtered'] for d in ok(client.get('/api/bootstrap'))['decks'])
    assert ok(client.get(f'/api/cards/{cid}'))['deckId']==filtered
    ok(client.post(f'/api/filtered-decks/{filtered}/empty'))
    assert ok(client.get(f'/api/cards/{cid}'))['deckId']==did


def test_delete_deck_removes_children_and_is_retry_safe(client):
    child=ok(client.post('/api/decks',json={'name':'삭제할 덱::하위'}))['id']
    decks=ok(client.get('/api/bootstrap'))['decks']
    parent=next(d['id'] for d in decks if d['name']=='삭제할 덱')
    keep=ok(client.post('/api/decks',json={'name':'보존할 덱'}))['id']
    add(client,deck=parent)
    add(client,['child','하위'],deck=child)
    add(client,['keep','보존'],deck=keep)
    result=ok(client.delete(f'/api/decks/{parent}'))
    assert {parent,child}.isdisjoint(d['id'] for d in result['decks'])
    assert keep in {d['id'] for d in result['decks']}
    assert ok(client.get('/api/cards'))['total']==1
    assert ok(client.get('/api/cards'))['cards'][0]['fields'][0]=='keep'
    ok(client.delete(f'/api/decks/{parent}'))
    ok(client.post('/api/undo'))
    assert ok(client.get('/api/cards'))['total']==3


def test_deleted_default_disappears_until_explicitly_reused(client):
    add(client)
    result=ok(client.delete('/api/decks/1'))
    assert result['decks']==[]
    assert ok(client.get('/api/bootstrap'))['decks']==[]
    assert ok(client.get('/api/stats'))['totalCards']==0
    # Anki's fallback is retained internally; creating it explicitly unhides it.
    restored=ok(client.post('/api/decks',json={'name':'Default'}))
    assert restored['id']==1
    assert len(ok(client.get('/api/bootstrap'))['decks'])==1
    ok(client.delete('/api/decks/1'))
    add(client)
    assert len(ok(client.get('/api/bootstrap'))['decks'])==1


def test_default_visibility_undo_tracks_only_its_native_delete(client):
    ok(client.delete('/api/decks/1'))
    assert ok(client.get('/api/bootstrap'))['decks']==[]
    later=ok(client.post('/api/decks',json={'name':'나중 작업'}))['id']
    ok(client.post('/api/undo'))
    assert ok(client.get('/api/bootstrap'))['decks']==[]
    ok(client.post('/api/undo'))
    restored=ok(client.get('/api/bootstrap'))['decks']
    assert [d['id'] for d in restored]==[1]
    assert later not in [d['id'] for d in restored]


def test_default_visibility_restored_after_nonempty_delete_undo(client):
    note=add(client)
    ok(client.delete('/api/decks/1'))
    ok(client.post('/api/undo'))
    ok(client.post('/api/cards/action',json={'ids':note['cardIds'],'action':'delete'}))
    # Undoing the deck deletion cleared its hiding state, so removing a card
    # later does not silently delete the restored empty deck from the UI.
    assert [d['id'] for d in ok(client.get('/api/bootstrap'))['decks']]==[1]


def test_default_visibility_undo_result_survives_restart(tmp_path,monkeypatch):
    monkeypatch.setenv('MODOO_LOCAL_AUTH','1')
    with TestClient(create_app(tmp_path),base_url='http://127.0.0.1:4190',client=('127.0.0.1',123)) as c:
        ok(c.delete('/api/decks/1'))
        ok(c.post('/api/undo'))
    with TestClient(create_app(tmp_path),base_url='http://127.0.0.1:4190',client=('127.0.0.1',123)) as c:
        assert [d['id'] for d in ok(c.get('/api/bootstrap'))['decks']]==[1]


def test_delete_preserves_notes_with_cards_in_other_decks(client):
    remove=ok(client.post('/api/decks',json={'name':'한쪽 카드'}))['id']
    keep=ok(client.post('/api/decks',json={'name':'다른쪽 카드'}))['id']
    note=add(client,model='Basic (and reversed card)',deck=remove)
    ok(client.post('/api/cards/action',json={'ids':[note['cardIds'][1]],'action':'deck','value':keep}))
    ok(client.delete(f'/api/decks/{remove}'))
    cards=ok(client.get('/api/cards'))['cards']
    assert len(cards)==1 and cards[0]['noteId']==note['id']
    assert cards[0]['deckId']==keep


def test_delete_filtered_deck_returns_cards_to_source(client):
    note=add(client)
    filtered=ok(client.post('/api/filtered-decks',json={'name':'임시 복습','search':'is:new','limit':20,'reschedule':False}))['id']
    assert ok(client.get('/api/cards/'+str(note['cardIds'][0])))['deckId']==filtered
    ok(client.delete(f'/api/decks/{filtered}'))
    card=ok(client.get('/api/cards/'+str(note['cardIds'][0])))
    assert card['deckId']==1 and card['fields']==['apple','사과']


def test_model_edit_and_fields_persist(client):
    mid=ok(client.post('/api/models',json={'name':'내 노트','baseId':model_id(client)}))['id']
    payload={'fields':['Front','Back','Example'],'css':'.card {color: red;}','templates':[{'name':'정방향','qfmt':'{{Front}}','afmt':'{{Back}}<br>{{Example}}'}]}
    ok(client.put(f'/api/models/{mid}',json=payload))
    note=ok(client.post('/api/notes',json={'deckId':1,'modelId':mid,'fields':['a','에이','example'],'tags':['new']}))
    card=ok(client.get('/api/cards/'+str(note['cardIds'][0])))
    assert card['fieldNames']==['Front','Back','Example']
    assert 'example' in card['back']
    ok(client.put('/api/notes/'+str(note['id']),json={'fields':['b','비','another'],'tags':['updated']}))
    assert ok(client.get('/api/cards?q=tag:updated'))['total']==1


PNG=base64.b64decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jR1cAAAAASUVORK5CYII=')


def make_occlusion(client, count=5, groups=None, deck=1):
    uploaded=ok(client.post('/api/media',files={'file':('occlusion-test.png',PNG,'image/png')}))
    masks=[{'x':i*.15,'y':.1,'width':.1,'height':.1} for i in range(count)]
    if groups:
        for mask,group in zip(masks,groups):
            if group is not None: mask['groupId']=group
    return ok(client.post('/api/occlusion',json={'deckId':deck,'imageFilename':uploaded['filename'],'masks':masks,'header':'그룹 검사'}))


def enable_sibling_bury(client):
    ok(client.get('/api/bootstrap'))
    col=client.app.state.collections.get('local-device').col
    config=col.decks.config_dict_for_deck_id(1)
    config['new']['bury']=config['rev']['bury']=config['buryInterdayLearning']=True
    col.decks.update_config(config)
    return col


def test_occlusion_all_five_masks_remain_reviewable_with_sibling_bury_enabled(client):
    col=enable_sibling_bury(client)
    assert make_occlusion(client)['added']==5
    original_ids=set(col.db.list('select id from cards'))
    seen=[]
    for i in range(5):
        state=ok(client.get('/api/study'))
        assert state['card'] is not None, 'remaining masks must not disappear after grading a sibling'
        card=state['card'];seen.append(card['id'])
        assert state['counts']['new']>=1
        ok(client.post('/api/answer',json={'cardId':card['id'],'rating':4,'token':card['token'],'requestId':f'occlusion-{i}','elapsedMs':300}))
    assert set(seen)==original_ids
    assert col.db.scalar('select count() from cards')==5
    assert col.db.scalar('select count() from revlog')==5
    assert col.db.scalar('select count() from cards where queue=-2')==0
    assert col.decks.config_dict_for_deck_id(1)['new']['bury'] is True


def test_occlusion_answer_and_unbury_are_one_undo_without_releasing_manual_bury_or_suspend(client):
    col=enable_sibling_bury(client);make_occlusion(client)
    cards=sorted(col.db.all('select ord,id from cards'))
    ok(client.post('/api/cards/action',json={'ids':[cards[3][1]],'action':'bury'}))
    ok(client.post('/api/cards/action',json={'ids':[cards[4][1]],'action':'suspend'}))
    before=col.db.all('select id,queue,type,reps,due from cards order by id')
    body,response=answer(client,4,'occlusion-undo');ok(response)
    after=dict(col.db.all('select id,queue from cards'))
    assert after[cards[1][1]]==0 and after[cards[2][1]]==0
    assert after[cards[3][1]]==-3 and after[cards[4][1]]==-1
    ok(client.post('/api/undo'))
    assert col.db.all('select id,queue,type,reps,due from cards order by id')==before
    assert col.db.scalar('select count() from revlog')==0


def test_regular_cloze_still_obeys_native_sibling_bury(client):
    col=enable_sibling_bury(client)
    add(client,fields=['{{c1::one}} and {{c2::two}}',''],model='Cloze')
    _,response=answer(client,4,'normal-cloze');ok(response)
    assert col.db.scalar('select count() from cards where queue=-2')==1
    assert ok(client.get('/api/study'))['card'] is None


def test_legacy_occlusion_burial_repair_preserves_data_and_is_undoable_once_after_restart(tmp_path,monkeypatch):
    monkeypatch.setenv('MODOO_LOCAL_AUTH','1')
    with TestClient(create_app(tmp_path),base_url='http://127.0.0.1:4190',client=('127.0.0.1',123)) as c:
        col=enable_sibling_bury(c);make_occlusion(c)
        ordered=sorted(col.db.all('select ord,id from cards'))
        col.sched.bury_cards([ordered[3][1]])
        col.sched.suspend_cards([ordered[4][1]])
        # Seed the exact pre-fix state by calling the real native scheduler.
        queued=col.sched.get_queued_cards().cards[0]
        native=col.get_card(queued.card.id);native.start_timer()
        col.sched.answer_card(col.sched.build_answer(card=native,states=queued.states,rating=3))
        assert col.db.scalar('select count() from cards where queue=-2')==2
        before_cards=col.db.all('select id,nid,ord,type,due,ivl,reps,lapses from cards order by id')
        before_notes=col.db.all('select id,flds from notes order by id')
        before_logs=col.db.all('select * from revlog order by id')
    with TestClient(create_app(tmp_path),base_url='http://127.0.0.1:4190',client=('127.0.0.1',123)) as c:
        ok(c.get('/api/bootstrap'));col=c.app.state.collections.get('local-device').col
        assert col.db.scalar('select count() from cards where queue=-2')==2, 'opening the account does not repair unused decks'
        assert ok(c.get('/api/study'))['card'] is not None
        assert col.db.scalar('select count() from cards where queue=-2')==0
        assert col.db.scalar('select count() from cards where queue=-3')==1
        assert col.db.scalar('select count() from cards where queue=-1')==1
        assert col.db.all('select id,nid,ord,type,due,ivl,reps,lapses from cards order by id')==before_cards
        assert col.db.all('select id,flds from notes order by id')==before_notes
        assert col.db.all('select * from revlog order by id')==before_logs
        ok(c.post('/api/undo'))
        assert col.db.scalar('select count() from cards where queue=-2')==2
        assert ok(c.get('/api/study'))['card'] is None, 'explicit undo must not be automatically redone'
    with TestClient(create_app(tmp_path),base_url='http://127.0.0.1:4190',client=('127.0.0.1',123)) as c:
        assert ok(c.get('/api/study'))['card'] is None, 'the once-per-deck repair marker persists'


def test_legacy_occlusion_repair_only_touches_requested_deck_tree(client):
    child=ok(client.post('/api/decks',json={'name':'교정::하위'}))['id']
    parent=next(d['id'] for d in ok(client.get('/api/bootstrap'))['decks'] if d['name']=='교정')
    other=ok(client.post('/api/decks',json={'name':'건드리지 않을 덱'}))['id']
    make_occlusion(client,count=1,deck=child);make_occlusion(client,count=1,deck=other)
    normal=add(client,fields=['{{c1::ordinary}}',''],model='Cloze',deck=child)['cardIds'][0]
    col=client.app.state.collections.get('local-device').col
    buried=col.db.list('select id from cards');col.sched.bury_cards(buried,manual=False)
    assert ok(client.get(f'/api/study?deckId={parent}'))['card'] is not None
    assert col.get_card(normal).queue==-2
    assert col.db.scalar('select queue from cards where did=?',other)==-2
    assert col.db.scalar('select count() from cards where did=? and queue=0',child)==1


def test_occlusion_group_reuses_native_cloze_number_and_reveals_all_group_rectangles(client):
    group='82b86690-f687-4c4d-a12d-877d9dca371a'
    assert make_occlusion(client,count=3,groups=[group,group,None])['added']==2
    rows=ok(client.get('/api/cards'))['cards']
    assert len({row['noteId'] for row in rows})==1
    grouped=next(row for row in rows if row['ord']==0)
    assert grouped['fields'][0].count('{{c1::')==2 and grouped['fields'][0].count('{{c2::')==1
    assert grouped['front'].count('position:absolute')==3
    assert grouped['back'].count('position:absolute')==1
    assert grouped['front'].count('background:#e96652')==2
    _,response=answer(client,4,'grouped-first');ok(response)
    assert ok(client.get('/api/study'))['card']['ord']==1


@pytest.mark.parametrize('group',['','bad-group','{{c1::injected}}',123])
def test_occlusion_rejects_invalid_group_id_before_creating_cards(client,group):
    uploaded=ok(client.post('/api/media',files={'file':('group.png',PNG,'image/png')}))
    response=client.post('/api/occlusion',json={'deckId':1,'imageFilename':uploaded['filename'],'masks':[{'x':0,'y':0,'width':.1,'height':.1,'groupId':group}]})
    assert response.status_code==422
    assert ok(client.get('/api/stats'))['totalCards']==0


def test_empty_deck_preserves_structure_other_deck_siblings_and_undo(client):
    child=ok(client.post('/api/decks',json={'name':'비우기::하위'}))['id']
    decks=ok(client.get('/api/bootstrap'))['decks'];parent=next(d['id'] for d in decks if d['name']=='비우기')
    keep=ok(client.post('/api/decks',json={'name':'다른 덱'}))['id']
    note=add(client,model='Basic (and reversed card)',deck=parent)
    ok(client.post('/api/cards/action',json={'ids':[note['cardIds'][1]],'action':'deck','value':keep}))
    add(client,['child','하위'],deck=child)
    result=ok(client.post(f'/api/decks/{parent}/empty'))
    assert result['removed']==2
    assert {parent,child,keep}.issubset(d['id'] for d in result['decks'])
    cards=ok(client.get('/api/cards'))['cards']
    assert len(cards)==1 and cards[0]['noteId']==note['id'] and cards[0]['deckId']==keep
    assert ok(client.post(f'/api/decks/{parent}/empty'))['removed']==0
    ok(client.post('/api/undo'))
    assert ok(client.get('/api/stats'))['totalCards']==3


def test_empty_default_remains_visible_and_filtered_empty_returns_cards(client):
    add(client)
    assert ok(client.post('/api/decks/1/empty'))['removed']==1
    assert [d['id'] for d in ok(client.get('/api/bootstrap'))['decks']]==[1]
    ok(client.post('/api/undo'));assert ok(client.get('/api/stats'))['totalCards']==1
    filtered=ok(client.post('/api/filtered-decks',json={'name':'필터 비우기','search':'is:new','limit':20,'reschedule':False}))['id']
    assert ok(client.post(f'/api/decks/{filtered}/empty'))['removed']==1
    cards=ok(client.get('/api/cards'))['cards']
    assert len(cards)==1 and cards[0]['deckId']==1
    assert filtered in [d['id'] for d in ok(client.get('/api/bootstrap'))['decks']]
    ok(client.post('/api/undo'))
    assert ok(client.get('/api/cards'))['cards'][0]['deckId']==filtered


def test_empty_hidden_default_explicitly_reveals_it_without_deleting_its_structure(client):
    ok(client.delete('/api/decks/1'))
    assert ok(client.get('/api/bootstrap'))['decks']==[]
    result=ok(client.post('/api/decks/1/empty'))
    assert result['removed']==0 and [d['id'] for d in result['decks']]==[1]
    ok(client.post('/api/undo'))
    assert ok(client.get('/api/bootstrap'))['decks']==[]


def test_deck_favorite_survives_rename_and_keeps_study_token_valid(client):
    add(client);card=ok(client.get('/api/study'))['card']
    marked=ok(client.put('/api/decks/1/favorite',json={'favorite':True}))
    assert marked['id']==1 and marked['favorite'] is True
    assert ok(client.patch('/api/decks/1',json={'name':'중요 덱'}))['favorite'] is True
    card=ok(client.get('/api/study'))['card']
    ok(client.put('/api/decks/1/favorite',json={'favorite':False}))
    ok(client.post('/api/answer',json={'cardId':card['id'],'rating':4,'token':card['token'],'requestId':'favorite-answer','elapsedMs':300}))
    assert ok(client.get('/api/bootstrap'))['decks'][0]['favorite'] is False
    did=ok(client.post('/api/decks',json={'name':'삭제할 중요 덱'}))['id']
    ok(client.put(f'/api/decks/{did}/favorite',json={'favorite':True}));ok(client.delete(f'/api/decks/{did}'))
    assert client.put(f'/api/decks/{did}/favorite',json={'favorite':False}).status_code==404


def test_deck_favorite_persists_restart_and_is_account_isolated(tmp_path,monkeypatch):
    monkeypatch.delenv('MODOO_LOCAL_AUTH',raising=False)
    monkeypatch.setenv('MODOO_FIREBASE_CONFIG',json.dumps({'projectId':'test-project','apiKey':'public-key'}))
    monkeypatch.setattr(auth,'verify_firebase_token',lambda token: {'alice-token':'alice','bob-token':'bob'}[token])
    for restart in range(2):
        with TestClient(create_app(tmp_path),base_url='http://127.0.0.1:4190') as c:
            c.headers['Authorization']='Bearer alice-token'
            if restart==0: ok(c.put('/api/decks/1/favorite',json={'favorite':True}))
            assert ok(c.get('/api/bootstrap'))['decks'][0]['favorite'] is True
            c.headers['Authorization']='Bearer bob-token'
            assert ok(c.get('/api/bootstrap'))['decks'][0]['favorite'] is False


def test_signed_media_and_native_occlusion(client):
    uploaded=ok(client.post('/api/media',files={'file':('study.png',PNG,'image/png')}))
    assert client.get(uploaded['url']).content==PNG
    assert client.get(uploaded['url'].replace('study.png','other.png')).status_code==403
    assert client.post('/api/media',files={'file':('../escape.png',PNG,'image/png')}).status_code==400
    result=ok(client.post('/api/occlusion',json={'deckId':1,'imageFilename':uploaded['filename'],'masks':[{'x':.1,'y':.1,'width':.2,'height':.2},{'x':.5,'y':.5,'width':.2,'height':.2}],'header':'이미지 퀴즈'}))
    assert result['added']==2
    card=ok(client.get('/api/study'))['card']
    assert '/api/media/' in card['front']
    assert 'position:absolute' in card['front']


@pytest.mark.parametrize('fmt',['apkg','colpkg','csv'])
def test_official_package_and_text_roundtrip(client,tmp_path,monkeypatch,fmt):
    upload=ok(client.post('/api/media',files={'file':('word.png',PNG,'image/png')}))
    add(client,['apple<img src="word.png">','사과'])
    body,r=answer(client,4);ok(r)
    response=client.post('/api/export',json={'format':fmt,'includeScheduling':True,'includeMedia':True})
    assert response.status_code==200,response.text
    payload=response.content
    with TestClient(create_app(tmp_path/'imported'),base_url='http://127.0.0.1:4190',client=('127.0.0.1',123)) as target:
        result=target.post('/api/import',files={'file':('roundtrip.'+fmt,payload,'application/octet-stream')})
        ok(result)
        cards=ok(target.get('/api/cards'))['cards']
        assert len(cards)==1
        assert cards[0]['fields']==['apple<img src="word.png">','사과']
        if fmt!='csv':
            info=ok(target.get('/api/cards/'+str(cards[0]['id'])))
            assert info['reps']==1
            assert len(info['history'])==1
            assert info['history'][0]['rating']==4
            signed=re.search(r'src="([^"]+)"',info['front'])[1].replace('&amp;','&')
            assert target.get(signed).content==PNG
        assert ok(target.get('/api/bootstrap'))['stats']['totalNotes']==1


def test_local_auth_cannot_be_used_remotely_and_csrf(client,tmp_path):
    assert client.post('/api/decks',json={'name':'evil'},headers={'Origin':'https://evil.example'}).status_code==403
    assert client.post('/api/decks',json={'name':'evil'},headers={'Origin':'null'}).status_code==403
    with TestClient(create_app(tmp_path/'remote'),base_url='http://127.0.0.1:4190',client=('203.0.113.7',12)) as remote:
        assert remote.get('/api/bootstrap').status_code==403
    with TestClient(create_app(tmp_path/'rebind'),base_url='http://evil.example',client=('127.0.0.1',12)) as rebind:
        assert rebind.get('/api/bootstrap').status_code==403


def test_firebase_verified_uid_isolation(tmp_path,monkeypatch):
    monkeypatch.delenv('MODOO_LOCAL_AUTH',raising=False)
    monkeypatch.setenv('MODOO_FIREBASE_CONFIG',json.dumps({'projectId':'test-project','apiKey':'public-key'}))
    monkeypatch.setattr(auth,'verify_firebase_token',lambda token: {'alice-token':'alice','bob-token':'bob'}[token])
    with TestClient(create_app(tmp_path),base_url='http://127.0.0.1:4190') as c:
        assert c.get('/api/bootstrap').status_code==401
        c.headers['Authorization']='Bearer alice-token'
        n=add(c)
        c.headers['Authorization']='Bearer bob-token'
        assert ok(c.get('/api/stats'))['totalCards']==0
        assert c.get('/api/cards/'+str(n['cardIds'][0])).status_code==404
        c.headers['Authorization']='Bearer alice-token'
        assert ok(c.get('/api/stats'))['totalCards']==1


def test_firebase_sdk_still_verifies_signature_without_admin_key(monkeypatch,caplog):
    """Only certificate transport is stubbed; the real SDK validates each JWT."""
    import time
    from types import SimpleNamespace
    import jwt
    from cryptography.hazmat.primitives.asymmetric import rsa
    from cryptography.hazmat.primitives import serialization
    from firebase_admin import _token_gen
    from fastapi import HTTPException
    monkeypatch.delenv('GOOGLE_APPLICATION_CREDENTIALS',raising=False)
    monkeypatch.delenv('FIREBASE_AUTH_EMULATOR_HOST',raising=False)
    monkeypatch.setenv('MODOO_FIREBASE_CONFIG',json.dumps({'projectId':'cryptographic-test-project'}))
    key=rsa.generate_private_key(public_exponent=65537,key_size=2048)
    public=key.public_key().public_bytes(serialization.Encoding.PEM,serialization.PublicFormat.SubjectPublicKeyInfo).decode()
    monkeypatch.setattr(_token_gen.CertificateFetchRequest,'__call__',lambda *args,**kwargs: SimpleNamespace(status=200,data=json.dumps({'test-key':public}).encode()))
    claims={'iss':'https://securetoken.google.com/cryptographic-test-project','aud':'cryptographic-test-project','sub':'verified-user','iat':int(time.time())-10,'exp':int(time.time())+300}
    token=jwt.encode(claims,key,algorithm='RS256',headers={'kid':'test-key'})
    assert auth.verify_firebase_token(token)=='verified-user'
    slightly_future=jwt.encode(claims|{'iat':int(time.time())+15},key,algorithm='RS256',headers={'kid':'test-key'})
    assert auth.verify_firebase_token(slightly_future)=='verified-user'
    other_key=rsa.generate_private_key(public_exponent=65537,key_size=2048)
    invalid_tokens=[
        jwt.encode(claims,other_key,algorithm='RS256',headers={'kid':'test-key'}),
        jwt.encode(claims|{'aud':'different-project'},key,algorithm='RS256',headers={'kid':'test-key'}),
        jwt.encode(claims|{'exp':int(time.time())-120},key,algorithm='RS256',headers={'kid':'test-key'}),
        jwt.encode(claims|{'iat':int(time.time())+120},key,algorithm='RS256',headers={'kid':'test-key'}),
        jwt.encode(claims,'',algorithm='none',headers={'kid':'test-key'}),
    ]
    for invalid in invalid_tokens:
        with pytest.raises(HTTPException) as rejected:
            auth.verify_firebase_token(invalid)
        assert rejected.value.status_code==401
        assert invalid not in caplog.text
    assert 'verified-user' not in caplog.text
    assert 'safe_code=' in caplog.text


def test_concurrent_batch_retries_produce_once(client):
    body={'deckId':1,'modelId':model_id(client),'rows':[{'fields':['word','뜻'],'tags':[]}],'requestId':'parallel'}
    with ThreadPoolExecutor(max_workers=4) as pool:
        results=list(pool.map(lambda _: client.post('/api/notes/batch',json=body),range(8)))
    for result in results: ok(result)
    assert ok(client.get('/api/stats'))['totalCards']==1


def test_settings_and_collection_survive_restart(tmp_path,monkeypatch):
    monkeypatch.setenv('MODOO_LOCAL_AUTH','1')
    for pass_number in range(2):
        with TestClient(create_app(tmp_path),base_url='http://127.0.0.1:4190',client=('127.0.0.1',123)) as c:
            if pass_number==0:
                add(c)
                ok(c.put('/api/settings',json={'skin':'classic','sounds':False,'volume':.1}))
            else:
                b=ok(c.get('/api/bootstrap'))
                assert b['stats']['totalCards']==1
                assert b['settings']['skin']=='classic' and b['settings']['sounds'] is False


def test_public_settings_use_classic_without_losing_existing_cards_or_preferences(tmp_path,monkeypatch):
    monkeypatch.setenv('MODOO_LOCAL_AUTH','1')
    with TestClient(create_app(tmp_path),base_url='http://127.0.0.1:4190',client=('127.0.0.1',123)) as c:
        add(c)
        ok(c.put('/api/settings',json={'accent':'#123456','sounds':False,'cardFontSize':28}))
    metadata=next(tmp_path.glob('accounts/*/app-state.json'))
    state=json.loads(metadata.read_text('utf-8'))
    state['settings']['skin']='unavailable-legacy-skin'
    metadata.write_text(json.dumps(state),'utf-8')
    with TestClient(create_app(tmp_path),base_url='http://127.0.0.1:4190',client=('127.0.0.1',123)) as c:
        bootstrap=ok(c.get('/api/bootstrap'))
        assert bootstrap['stats']['totalCards']==1
        for settings in (bootstrap['settings'],ok(c.get('/api/settings')),ok(c.put('/api/settings',json={'volume':.6}))):
            assert settings['skin']=='classic'
            assert settings['accent']=='#123456' and settings['cardFontSize']==28 and settings['sounds'] is False
        assert c.put('/api/settings',json={'skin':'unsupported'}).status_code==422


def test_second_server_cannot_share_live_collection_directory(tmp_path,monkeypatch):
    monkeypatch.setenv('MODOO_LOCAL_AUTH','1')
    with TestClient(create_app(tmp_path),base_url='http://127.0.0.1:4190',client=('127.0.0.1',123)) as first:
        ok(first.get('/api/bootstrap'))
        with TestClient(create_app(tmp_path),base_url='http://127.0.0.1:4190',client=('127.0.0.1',123)) as second:
            assert second.get('/api/bootstrap').status_code==503
