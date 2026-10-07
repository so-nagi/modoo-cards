"""Authenticated, non-persistent previews rendered by Anki's native engine."""
from typing import Annotated

from anki.consts import MODEL_CLOZE
from anki.errors import TemplateError
from anki.utils import to_json_bytes
from fastapi import Depends, HTTPException, Query
from pydantic import Field

from .schemas import Input


class PreviewNoteInput(Input):
    modelId: int = Field(gt=0)
    fields: list[Annotated[str, Field(max_length=200000)]] = Field(min_length=1, max_length=100)
    cardOrd: int = Field(default=0, ge=0, le=65534)


def render_preview(account, data: PreviewNoteInput):
    model = account.model(data.modelId)
    if len(data.fields) != len(model['flds']):
        raise HTTPException(422, f'필드는 {len(model["flds"])}개가 필요합니다.')
    # new_note and ephemeral_card keep IDs at zero. Do not add/update/flush,
    # select a deck, or touch the account revision/undo stack during preview.
    note = account.col.new_note(model)
    note.fields = list(data.fields)
    is_cloze = model['type'] == MODEL_CLOZE
    ordinals = sorted(number - 1 for number in note.cloze_numbers_in_fields() if number > 0) if is_cloze else range(len(model['tmpls']))
    cards, warnings = [], []
    for ordinal in ordinals:
        template = dict(model['tmpls'][0 if is_cloze else ordinal])
        template['ord'] = ordinal
        try:
            # The Python ephemeral-card wrapper doesn't expose is_empty. Ask
            # the same pinned native renderer so conditional/reverse templates
            # use Anki's own generation rules, not a second template parser.
            output = account.col._backend.render_uncommitted_card_legacy(
                note=note._to_backend_note(), card_ord=ordinal,
                template=to_json_bytes(template), fill_empty=False, partial_render=True,
            )
        except TemplateError:
            if not warnings:
                warnings.append('카드 형식에 오류가 있어 일부 미리보기를 표시하지 못했어요.')
            continue
        if not output.is_empty:
            cards.append({'ord': ordinal, 'name': f'{template["name"]} ({ordinal + 1})' if is_cloze else template['name']})
    if not cards:
        if not warnings:
            warnings.append('가릴 부분을 {{c1::내용}} 형식으로 입력해 주세요.' if is_cloze else '앞면에 표시할 내용을 입력해 주세요.')
        return {'front': '', 'back': '', 'css': account.rewrite_media(model['css']), 'cardOrd': 0, 'cards': [], 'warnings': warnings}
    chosen = data.cardOrd if any(card['ord'] == data.cardOrd for card in cards) else cards[0]['ord']
    card = note.ephemeral_card(chosen, fill_empty=False)
    front, back, css = account.render(card)
    if not note.fields[0].strip():
        warnings.append('첫 번째 필드를 입력해야 저장할 수 있어요.')
    return {'front': front, 'back': back, 'css': css, 'cardOrd': chosen, 'cards': cards, 'warnings': warnings}


def attach_preview_route(app, account_dependency):
    @app.post('/api/preview-note')
    def preview_note(data: PreviewNoteInput, a=Depends(account_dependency, scope='function')):
        return render_preview(a, data)

    @app.get('/api/decks/{did}/preview')
    def preview_deck(did: int, index: int = Query(default=0, ge=0), a=Depends(account_dependency, scope='function')):
        deck = a.deck(did)
        # Browse membership, not the scheduler's daily queue. Original decks
        # retain cards temporarily borrowed by a filtered deck; filtered decks
        # show only the cards currently in that particular filtered deck.
        if deck.get('dyn'):
            condition, parameters = 'did=?', [did]
        else:
            deck_ids = [did] + [child_id for _, child_id in a.col.decks.children(did)]
            placeholders = ','.join('?' for _ in deck_ids)
            condition = f'(did in ({placeholders}) or odid in ({placeholders}))'
            parameters = deck_ids + deck_ids
        total = a.col.db.scalar(f'select count() from cards where {condition}', *parameters)
        if not total:
            return {'index': 0, 'total': 0, 'card': None}
        index = min(index, total - 1)
        cid = a.col.db.scalar(f'select id from cards where {condition} order by id limit 1 offset ?', *parameters, index)
        row = a.card_row(cid)
        row['css'] = a.render(a.col.get_card(cid))[2]
        return {'index': index, 'total': total, 'card': row}
