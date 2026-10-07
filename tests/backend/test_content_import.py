import copy
import re
import pytest
from anki.collection import Collection, ExportAnkiPackageOptions
from test_api import client, ok, add, answer


def styled_package(tmp_path):
    col=Collection(str(tmp_path / 'styled.anki2'))
    try:
        model=copy.deepcopy(col.models.by_name('Basic'))
        model['id']=0
        model['name']='Imported vocabulary'
        col.models.add_field(model,col.models.new_field('Meaning'))
        model['css']='.card { font-family: ExternalFont; color: red; }'
        model['tmpls'][0]['qfmt']='<script>window.unwanted=true</script><div class="external">{{Front}}</div>'
        model['tmpls'][0]['afmt']='{{Back}} {{Meaning}}'
        col.models.add_dict(model)
        model=col.models.by_name('Imported vocabulary')
        note=col.new_note(model)
        note.fields=['<b>apple</b>','[æpl]','사과']
        col.add_note(note,col.decks.id('Vocabulary::DAY01'))
        path=tmp_path / 'styled.apkg'
        col.export_anki_package(out_path=str(path),options=ExportAnkiPackageOptions(with_media=True,with_scheduling=True,legacy=False),limit=None)
        return path.read_bytes()
    finally:
        col.close()


def test_content_import_discards_source_template_preserves_fields_decks_and_repeat(client,tmp_path):
    package=styled_package(tmp_path)
    seed=add(client)['cardIds'][0]
    _,response=answer(client,4);ok(response)
    before=ok(client.get(f'/api/cards/{seed}'))
    result=ok(client.post('/api/import-content',files={'file':('styled.apkg',package)}))
    assert result['added']==result['cardsAdded']==1
    col=client.app.state.collections.get('local-device').col
    cid=col.find_cards('deck:Vocabulary::DAY01')[0]
    detail=ok(client.get(f'/api/cards/{cid}'))
    assert detail['fields']==['<b>apple</b>','[æpl]','사과']
    assert 'apple' in detail['front'] and '사과' in detail['back'] and '[æpl]' in detail['back']
    assert '<b>' not in detail['front'] and 'unwanted' not in detail['front']
    assert 'ExternalFont' not in detail['css']
    model=col.get_card(cid).note().note_type()
    assert model['css']=='' and 'external' not in model['tmpls'][0]['qfmt']
    card=col.get_card(cid);card.reps=9;card.ivl=52;card.type=2;card.queue=2;col.update_card(card)
    repeat=ok(client.post('/api/import-content',files={'file':('styled.apkg',package)}))
    assert repeat['added']==repeat['cardsAdded']==0
    assert col.get_card(cid).reps==9 and col.get_card(cid).ivl==52
    assert ok(client.get(f'/api/cards/{seed}'))==before
    assert not list(client.app.state.collections.get('local-device').path.glob('content-import-*'))


def test_existing_template_change_keeps_card_ids_fields_and_review_history(client):
    cid=add(client)['cardIds'][0]
    _,response=answer(client,4);ok(response)
    before=ok(client.get(f'/api/cards/{cid}'))
    mid=client.app.state.collections.get('local-device').col.get_card(cid).note().mid
    ok(client.put(f'/api/models/{mid}',json={'css':'','templates':[{'name':'Card 1','qfmt':'{{text:Front}}','afmt':'{{FrontSide}}<hr id="answer">{{text:Back}}'}]}))
    after=ok(client.get(f'/api/cards/{cid}'))
    for key in ['id','noteId','deckId','fields','due','interval','reps','lapses','queue','history']:
        assert after[key]==before[key],key


def test_content_reimport_recognizes_previously_imported_styled_cards(client,tmp_path):
    package=styled_package(tmp_path)
    ok(client.post('/api/import',files={'file':('styled.apkg',package)}))
    col=client.app.state.collections.get('local-device').col
    cid=col.find_cards('deck:Vocabulary::DAY01')[0]
    card=col.get_card(cid);card.reps=13;card.ivl=77;card.type=2;card.queue=2;col.update_card(card)
    result=ok(client.post('/api/import-content',files={'file':('styled.apkg',package)}))
    assert result['added']==result['cardsAdded']==0
    assert col.card_count()==1 and col.get_card(cid).reps==13 and col.get_card(cid).ivl==77


@pytest.mark.parametrize('name,fields,count', [('Basic (and reversed card)',['apple','사과'],2),('Cloze',['An {{c1::apple}} is fruit.','사과'],1)])
def test_native_card_identity_and_cloze_behavior(client,tmp_path,name,fields,count):
    source=Collection(str(tmp_path/'other.anki2'))
    try:
        note=source.new_note(source.models.by_name(name));note.fields=fields;source.add_note(note,1)
        path=tmp_path/'other.apkg'
        source.export_anki_package(out_path=str(path),options=ExportAnkiPackageOptions(legacy=False),limit=None)
        payload=path.read_bytes()
    finally:
        source.close()
    result=ok(client.post('/api/import-content',files={'file':('other.apkg',payload)}))
    assert result['cardsAdded']==count
    detail=ok(client.get('/api/cards'))['cards'][0]
    if name=='Cloze':
        assert 'apple' not in re.sub('<[^>]+>', '', detail['front'])
        assert 'apple' in detail['back']
    else:
        assert 'apple' in detail['front'] and '사과' in detail['back']


def test_content_failure_leaves_no_temporary_collection(client):
    add(client)
    result=client.post('/api/import-content',files={'file':('broken.apkg',b'not a package')})
    assert result.status_code==400
    a=client.app.state.collections.get('local-device')
    assert a.col.card_count()==1
    assert not list(a.path.glob('content-import-*')) and not list(a.path.glob('upload-*'))
