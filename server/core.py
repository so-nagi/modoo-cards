"""Serialized per-account adapter. Scheduling and writes stay in Anki's core.

Run one API worker per data directory. Collection handles stay open so Anki undo
works across HTTP requests. Account paths are hashes of verified Firebase UIDs.
"""
import copy
import hashlib
import hmac
import html
import json
import os
from pathlib import Path
import re
import secrets
import threading
import time
from datetime import datetime, timedelta
from urllib.parse import quote, unquote, urlsplit

from anki.collection import Collection, AddNoteRequest, DeckIdLimit, ExportAnkiPackageOptions, ImportAnkiPackageRequest, ImportAnkiPackageOptions, ImportCsvRequest
from anki.scheduler.v3 import CardAnswer
from anki.sound import SoundOrVideoTag
from fastapi import HTTPException

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_SETTINGS = {'skin': 'classic', 'theme': 'light', 'accent': '#7b9b86', 'sounds': True, 'volume': .35, 'heatmap': True, 'remainingTime': True, 'zen': False, 'cardFontSize': 20}
LEARN_AHEAD_MIGRATION = 'modooLearnAheadDefaultV1'
LEARN_AHEAD_RESTORE_MIGRATION = 'modooLearnAheadRestoreV2'


def safe_filename(name):
    if not name or name in {'.', '..'} or '/' in name or '\\' in name or ':' in name or '\x00' in name:
        raise HTTPException(400, '파일 이름이 올바르지 않습니다.')
    return name


def model_json(m):
    return {'id': m['id'], 'name': m['name'], 'fields': [f['name'] for f in m['flds']], 'templates': [{k: t[k] for k in ('name', 'qfmt', 'afmt')} for t in m['tmpls']], 'css': m['css'], 'type': m['type']}


def parse_steps(value):
    result = []
    for chunk in value.split():
        match = re.fullmatch(r'(\d+(?:\.\d+)?)(s|m|h|d)?', chunk)
        if not match:
            raise HTTPException(422, '학습 간격은 30s 1m 10m 1d 형식으로 입력하세요.')
        count = float(match[1]) * {'s': 1/60, 'm': 1, 'h': 60, 'd': 1440, None: 1}[match[2]]
        if count <= 0 or count > 36500 * 1440:
            raise HTTPException(422, '학습 간격 범위를 확인하세요.')
        result.append(count)
    return result


class Account:
    def __init__(self, base, uid, secret):
        self.key = hashlib.sha256(uid.encode()).hexdigest()
        self.path = base / 'accounts' / self.key
        self.path.mkdir(parents=True, exist_ok=True)
        # FastAPI may enter/exit a yielded sync dependency on different workers.
        # A plain Lock can be released by that exit worker; RLock cannot.
        self.lock = threading.Lock()
        self.secret = secret
        self.meta_path = self.path / 'app-state.json'
        self.meta = json.loads(self.meta_path.read_text('utf-8')) if self.meta_path.exists() else {'settings': DEFAULT_SETTINGS.copy(), 'receipts': {}}
        self.col = Collection(str(self.path / 'collection.anki2'))
        self.initialize_scheduler_preferences()
        self.revision = secrets.token_urlsafe(16)
        self.tokens = {}
        # Visibility has the same session lifetime as Anki's native undo stack.
        # Unique custom undo labels let intervening operations be undone without
        # accidentally restoring visibility for a different action.
        self.default_visibility_undo = {}

    def initialize_scheduler_preferences(self):
        # Undo only this app's earlier forced zero-minute default, once. New
        # and externally imported collections retain their native preferences.
        # This runs immediately after open/import, before building study queues;
        # a non-undoable config write preserves card data and native undo history.
        if not self.col.get_config(LEARN_AHEAD_RESTORE_MIGRATION, False):
            if self.col.get_config(LEARN_AHEAD_MIGRATION, False) and self.col.get_preferences().scheduling.learn_ahead_secs == 0:
                self.col.set_config('collapseTime', 20 * 60)
            self.col.set_config(LEARN_AHEAD_RESTORE_MIGRATION, True)

    def scheduler_preferences(self):
        return {'learnAheadMinutes': self.col.get_preferences().scheduling.learn_ahead_secs / 60}

    def set_scheduler_preferences(self, data):
        seconds = data.learnAheadMinutes * 60
        preferences = self.col.get_preferences()
        if preferences.scheduling.learn_ahead_secs != seconds:
            # This native operation also invalidates an already-built study
            # queue, unlike a raw collapseTime config write. Other preferences
            # are retained; Anki adds its normal undoable Preferences operation.
            preferences.scheduling.learn_ahead_secs = seconds
            self.col.set_preferences(preferences)
            self.changed(preserve_study=True)
        return self.scheduler_preferences()

    def save_meta(self):
        temp = self.meta_path.with_suffix('.tmp')
        temp.write_text(json.dumps(self.meta, ensure_ascii=False), 'utf-8')
        temp.replace(self.meta_path)

    def changed(self, preserve_study=False):
        self.revision = secrets.token_urlsafe(16)
        if preserve_study:
            for token in self.tokens.values():
                token['revision'] = self.revision
        else:
            self.tokens.clear()

    def close(self):
        with self.lock:
            self.col.close()

    def receipt(self, kind, request_id, payload):
        key = kind + ':' + request_id
        digest = hashlib.sha256(json.dumps(payload, sort_keys=True, ensure_ascii=False).encode()).hexdigest()
        record = self.meta.setdefault('receipts', {}).get(key)
        if record:
            if record['digest'] != digest:
                raise HTTPException(409, '같은 요청 ID에 다른 내용이 전달되었습니다.')
            if record['state'] == 'pending':
                raise HTTPException(409, '이 요청의 이전 처리 결과를 확인해야 합니다. 새로고침 후 등록·복습 기록을 확인하세요.')
            return key, record['result']
        self.meta['receipts'][key] = {'digest': digest, 'state': 'pending', 'at': time.time()}
        # Persist before changing Anki; an interrupted request cannot be silently repeated.
        self.save_meta()
        return key, None

    def finish_receipt(self, key, result):
        self.meta['receipts'][key].update(state='done', result=result)
        self.save_meta()
        return result

    def abort_receipt(self, key):
        self.meta['receipts'].pop(key, None)
        self.save_meta()

    def model(self, mid):
        result = self.col.models.get(mid)
        if result is None:
            raise HTTPException(404, '노트 유형을 찾을 수 없습니다.')
        return result

    def deck(self, did):
        result = self.col.decks.get(did, default=False)
        if result is None:
            raise HTTPException(404, '덱을 찾을 수 없습니다.')
        return result

    def decks(self):
        counts = {}
        favorites = set(self.meta.get('favoriteDeckIds', []))
        def walk(node):
            counts[node.deck_id] = (node.new_count, node.learn_count, node.review_count)
            for child in node.children:
                walk(child)
        walk(self.col.sched.deck_due_tree())
        names = self.col.decks.all_names_and_ids(skip_empty_default=bool(self.meta.get('hideEmptyDefault', False)))
        return [{'id': d.id, 'name': d.name, 'filtered': bool(self.deck(d.id).get('dyn')), 'favorite': d.id in favorites, 'newCount': counts.get(d.id, (0,0,0))[0], 'learnCount': counts.get(d.id, (0,0,0))[1], 'reviewCount': counts.get(d.id, (0,0,0))[2]} for d in names]

    def deck_summary(self, did):
        return next(d for d in self.decks() if d['id'] == did)

    def deck_metadata(self, did):
        deck = self.deck(did)
        return {
            'id': deck['id'], 'name': deck['name'],
            'description': deck.get('desc', ''),
            'descriptionFormat': 'markdown' if deck.get('md') else 'html',
            'canEditDescription': not bool(deck.get('dyn')),
        }

    def edit_deck(self, did, data):
        deck = self.deck(did)
        changes = data.model_dump(exclude_unset=True)
        if not changes or any(value is None for value in changes.values()):
            raise HTTPException(422, '변경할 덱 이름이나 설명을 입력하세요.')
        if 'descriptionFormat' in changes and 'description' not in changes:
            raise HTTPException(422, '설명 형식은 설명과 함께 저장하세요.')
        if deck.get('dyn') and ('description' in changes or 'descriptionFormat' in changes):
            raise HTTPException(422, '필터 덱에서는 이름만 편집할 수 있습니다.')
        updated = copy.deepcopy(deck)
        if 'name' in changes:
            parts = [part.strip() for part in data.name.split('::')]
            if any(not part for part in parts) or any(ord(char) < 32 or ord(char) == 127 for char in data.name):
                raise HTTPException(422, '덱 이름을 입력하세요. 하위 덱은 상위 덱::하위 덱 형식으로 입력하세요.')
            name = '::'.join(parts)
            existing = self.col.decks.id_for_name(name)
            if existing is not None and existing != did:
                # Native update otherwise silently appends '+' to collisions.
                raise HTTPException(409, '이미 같은 이름의 덱이 있습니다.')
            parents = self.col.decks.parents_by_name(name)
            if any(parent['id'] == did for parent in parents):
                raise HTTPException(422, '덱을 자기 자신의 하위 덱으로 옮길 수 없습니다.')
            if any(parent.get('dyn') for parent in parents):
                raise HTTPException(422, '필터 덱 아래에는 하위 덱을 만들 수 없습니다.')
            updated['name'] = name
        if 'description' in changes:
            updated['desc'] = data.description
            if 'descriptionFormat' in changes:
                updated['md'] = data.descriptionFormat == 'markdown'

        reveal_default = did == 1 and bool(self.meta.get('hideEmptyDefault', False))
        if updated != deck:
            # One native transaction changes name, descendants and description;
            # native undo restores all of them together without card rewrites.
            self.col.decks.update_dict(updated)
        if reveal_default:
            if updated == deck:
                self.col.add_custom_undo_entry('기본 덱 표시 / ' + secrets.token_hex(8))
            self.default_visibility_undo[self.col.undo_status().last_step] = True
            self.meta['hideEmptyDefault'] = False
            self.save_meta()
        if updated != deck or reveal_default:
            self.changed()
        return self.deck_summary(did) | self.deck_metadata(did)

    def browse_cards(self, query, limit, deck_id=None):
        if deck_id is not None:
            deck = self.deck(deck_id)
            ids = [deck_id] if deck.get('dyn') else self.col.decks.deck_and_child_ids(deck_id)
            # Anki's exact ID search matches current or original deck IDs.
            # Native grouping keeps a user's OR query inside the selected deck.
            scope = 'did:' + ','.join(str(value) for value in ids)
            query = self.col.build_search_string(scope, query) if query.strip() else scope
        ids = self.col.find_cards(query, order=True)
        return {'cards': [self.card_row(cid) for cid in ids[:limit]], 'total': len(ids)}

    def options(self, did):
        self.deck(did)
        c = self.col.decks.config_dict_for_deck_id(did)
        if c.get('dyn'):
            raise HTTPException(400, '필터 덱은 일반 덱 옵션을 사용하지 않습니다.')
        return {'newPerDay': c['new']['perDay'], 'reviewPerDay': c['rev']['perDay'], 'fsrs': bool(self.col.get_config('fsrs', False)), 'desiredRetention': c.get('desiredRetention', .9), 'learningSteps': ' '.join(f'{s:g}m' for s in c['new']['delays']), 'relearningSteps': ' '.join(f'{s:g}m' for s in c['lapse']['delays'])}

    def set_options(self, did, data):
        deck = self.deck(did)
        if deck.get('dyn'):
            raise HTTPException(400, '필터 덱은 일반 덱 옵션을 사용하지 않습니다.')
        new_steps = parse_steps(data.learningSteps)
        relearn_steps = parse_steps(data.relearningSteps)
        conf = self.col.decks.config_dict_for_deck_id(did)
        # Each web deck gets its own preset on first edit, avoiding hidden changes to other decks.
        if len(self.col.decks.decks_using_config(conf)) > 1:
            conf = self.col.decks.add_config(deck['name'], clone_from=conf)
            self.col.decks.set_config_id_for_deck_dict(deck, conf['id'])
        conf['new']['perDay'] = data.newPerDay
        conf['rev']['perDay'] = data.reviewPerDay
        conf['new']['delays'] = new_steps
        conf['lapse']['delays'] = relearn_steps
        conf['desiredRetention'] = data.desiredRetention
        self.col.decks.update_config(conf)
        self.col.set_config('fsrs', data.fsrs)
        self.changed()
        return self.options(did)

    def prepare_note(self, deck_id, model_id, fields, tags):
        self.deck(deck_id)
        m = self.model(model_id)
        if len(fields) != len(m['flds']):
            raise HTTPException(422, f'필드는 {len(m["flds"])}개가 필요합니다.')
        if not fields[0].strip() or any(len(x) > 200000 for x in fields):
            raise HTTPException(422, '첫 필드가 비어 있거나 필드가 너무 깁니다.')
        note = self.col.new_note(m)
        note.fields = fields
        note.tags = tags
        return note

    def add_note(self, data):
        note = self.prepare_note(data.deckId, data.modelId, data.fields, data.tags)
        self.col.add_note(note, data.deckId)
        self.changed()
        return {'id': note.id, 'cardIds': list(note.card_ids())}

    def batch(self, data):
        # Validate every row before any write; the core bulk API is atomic.
        notes = [self.prepare_note(data.deckId, data.modelId, row.fields, row.tags) for row in data.rows]
        key, cached = self.receipt('batch', data.requestId, data.model_dump())
        if cached is not None:
            return cached
        self.col.add_notes([AddNoteRequest(note=note, deck_id=data.deckId) for note in notes])
        self.changed()
        return self.finish_receipt(key, {'added': len(notes), 'ids': [n.id for n in notes]})

    def signed_media(self, filename):
        filename = safe_filename(filename)
        expires = int(time.time()) + 300
        message = f'{self.key}\n{filename}\n{expires}'
        signature = hmac.new(self.secret, message.encode(), hashlib.sha256).hexdigest()
        origin = os.environ.get('MODOO_PUBLIC_ORIGIN') or os.environ.get('RENDER_EXTERNAL_URL', '')
        return f'{origin.rstrip("/")}/api/media/{self.key}/{quote(filename, safe="")}?expires={expires}&signature={signature}'

    def rewrite_media(self, content):
        def rewrite(value):
            value = html.unescape(value)
            parts = urlsplit(value)
            if parts.scheme or parts.netloc or value.startswith(('/', '#', 'data:')):
                return value
            name = unquote(parts.path)
            try:
                return self.signed_media(name)
            except HTTPException:
                return ''
        content = re.sub(r'(?i)(\b(?:src|poster|data)\s*=\s*)([\"\'])(.*?)\2', lambda m: m[1] + m[2] + html.escape(rewrite(m[3]), quote=True) + m[2], content)
        content = re.sub(r'(?i)url\(\s*([\"\']?)([^)\"\']+)\1\s*\)', lambda m: 'url("' + rewrite(m[2]) + '")', content)
        return content

    def render(self, card):
        output = card.render_output()
        front, back = output.question_text, output.answer_text
        for side, tags in [('front', output.question_av_tags), ('back', output.answer_av_tags)]:
            audio = ''.join(f'<audio controls preload="none" src="{html.escape(self.signed_media(t.filename), quote=True)}"></audio>' for t in tags if isinstance(t, SoundOrVideoTag))
            if side == 'front':
                front += audio
            else:
                back += audio
        # Stock Anki Image Occlusion templates depend on Qt's anki.imageOcclusion
        # JS bridge. Rectangles are displayed with browser overlays while keeping
        # the original native fields/templates unchanged in the collection.
        note = card.note()
        if note.fields and 'image-occlusion:rect:' in note.fields[0] and 'imageOcclusion' in front:
            masks = list(re.finditer(r'\{\{c(\d+)::image-occlusion:rect:([^}]+)\}\}', note.fields[0]))
            image = note.fields[1]
            header = note.fields[2] if len(note.fields) > 2 else ''
            front_masks, back_masks = '', ''
            for mask in masks:
                props = dict(p.split('=', 1) for p in mask[2].split(':') if '=' in p)
                try:
                    x,y,w,h = [float(props[k]) * 100 for k in ('left','top','width','height')]
                except (ValueError, KeyError):
                    continue
                active = int(mask[1]) == card.ord + 1
                overlay = f'<span style="position:absolute;left:{x}%;top:{y}%;width:{w}%;height:{h}%;background:{"#e96652" if active else "#f2cc61"};border:1px solid #555"></span>'
                front_masks += overlay
                if not active:
                    back_masks += overlay
            image = re.sub(r'<img\b', '<img style="display:block;width:100%;height:auto"', image, flags=re.I)
            front = header + '<div style="position:relative;display:inline-block;max-width:100%">' + image + front_masks + '</div>'
            back = header + '<div style="position:relative;display:inline-block;max-width:100%">' + image + back_masks + '</div>' + (note.fields[3] if len(note.fields)>3 else '')
        return self.rewrite_media(front), self.rewrite_media(back), self.rewrite_media(output.css)

    def card_row(self, cid):
        card = self.col.get_card(cid)
        note = card.note()
        model = note.note_type()
        front, back, _ = self.render(card)
        return {'id': card.id, 'noteId': card.nid, 'deckId': card.did, 'deckName': self.col.decks.name(card.did), 'modelName': model['name'], 'fields': note.fields, 'fieldNames': [f['name'] for f in model['flds']], 'tags': note.tags, 'front': front, 'back': back, 'due': card.due, 'interval': card.ivl, 'reps': card.reps, 'lapses': card.lapses, 'queue': card.queue, 'flag': card.user_flag(), 'ord': card.ord}

    def is_image_occlusion(self, card):
        note = card.note()
        return note.note_type().get('originalStockKind') == 6 and bool(note.fields) and 'image-occlusion:' in note.fields[0]

    def restore_legacy_occlusion_siblings(self, did):
        # Repair only the deck being opened (and its descendants), once. A user
        # undo remains authoritative; this marker prevents silently redoing it.
        deck_ids = {did, *(child_id for _, child_id in self.col.decks.children(did))}
        repaired = set(self.meta.get('occlusionUnburyV1DeckIds', []))
        unchecked = deck_ids - repaired
        if not unchecked:
            return
        placeholders = ','.join('?' for _ in unchecked)
        candidates = self.col.db.list(f'select id from cards where queue=-2 and (did in ({placeholders}) or odid in ({placeholders}))', *unchecked, *unchecked)
        ids = [cid for cid in candidates if self.is_image_occlusion(self.col.get_card(cid))]
        if ids:
            target = self.col.add_custom_undo_entry('이미지 가리기 자동 숨김 해제')
            self.col.sched.unbury_cards(ids)
            self.col.merge_undo_entries(target)
            self.changed()
        self.meta['occlusionUnburyV1DeckIds'] = sorted(repaired | unchecked)
        self.save_meta()

    def study(self, did):
        self.deck(did)
        self.restore_legacy_occlusion_siblings(did)
        self.col.decks.select(did)
        queue = self.col.sched.get_queued_cards()
        counts = {'new': queue.new_count, 'learn': queue.learning_count, 'review': queue.review_count}
        if not queue.cards:
            info = self.col.sched.congratulations_info()
            # CongratsInfo clamps short waits to at least 60 seconds and omits
            # filtered preview cards. Read Anki's stored intraday timestamps
            # instead, without changing a due date or rebuilding its queue.
            deck_ids = [did, *(child_id for _, child_id in self.col.decks.children(did))]
            placeholders = ','.join('?' for _ in deck_ids)
            timed_count, next_due = self.col.db.first(
                f'select count(), min(due) from cards where queue in (1,4) and did in ({placeholders})', *deck_ids)
            return {
                'card': None, 'counts': counts, 'revision': self.revision,
                'waiting': {
                    'count': max(info.learn_remaining, timed_count),
                    'nextDueAt': next_due,
                },
                'limits': {'new': info.new_remaining, 'review': info.review_remaining},
            }
        queued = queue.cards[0]
        card = self.col.get_card(queued.card.id)
        token = secrets.token_urlsafe(32)
        self.tokens = {k: v for k, v in self.tokens.items() if v['expires'] > time.time()}
        self.tokens[token] = {'revision': self.revision, 'cardId': card.id, 'deckId': did, 'states': queued.states, 'expires': time.time()+3600}
        front, back, css = self.render(card)
        intervals = self.col.sched.describe_next_states(queued.states)
        return {'card': {'id': card.id, 'noteId': card.nid, 'ord': card.ord, 'front': front, 'back': back, 'css': css, 'modelName': card.note_type()['name'], 'buttons': [{'rating': i+1, 'label': label, 'interval': intervals[i]} for i,label in enumerate(['다시', '어려움', '알맞음', '쉬움'])], 'token': token}, 'counts': counts, 'revision': self.revision}

    def answer(self, data):
        key = 'answer:' + data.requestId
        if key in self.meta.get('receipts', {}):
            return self.receipt('answer', data.requestId, data.model_dump())[1]
        token = self.tokens.get(data.token)
        if not token or token['revision'] != self.revision or token['cardId'] != data.cardId or token['expires'] < time.time():
            raise HTTPException(409, '다른 화면에서 자료가 변경되었습니다. 복습 카드를 새로 불러오세요.')
        card = self.col.get_card(data.cardId)
        self.col.decks.select(token['deckId'])
        self.col.sched.get_queued_cards()
        card.start_timer()
        answer = self.col.sched.build_answer(card=card, states=token['states'], rating=data.rating-1)
        answer.milliseconds_taken = min(data.elapsedMs, card.time_limit())
        siblings = self.col.db.list('select id from cards where nid=? and id!=? and queue>=0', card.nid, card.id) if self.is_image_occlusion(card) else []
        key, _ = self.receipt('answer', data.requestId, data.model_dump())
        self.col.sched.answer_card(answer)
        # Only siblings newly auto-buried by this answer are restored. Manual
        # burial (-3), suspension (-1), and other note types remain untouched.
        restore = [cid for cid in siblings if self.col.get_card(cid).queue == -2]
        if restore:
            target = self.col.undo_status().last_step
            self.col.sched.unbury_cards(restore)
            self.col.merge_undo_entries(target)
        self.changed()
        return self.finish_receipt(key, {'ok': True})

    def stats(self):
        db = self.col.db
        today_start = self.col.sched.day_cutoff - 86400
        today, elapsed = db.first('select count(), coalesce(sum(time),0) from revlog where id>=? and ease>0', today_start*1000)
        logs = db.all('select id,ease from revlog where ease>0 and id>=?', (today_start - 366*86400)*1000)
        history = {}
        rollover = int(self.col.get_config('rollover', 4))
        for stamp, rating in logs:
            date = datetime.fromtimestamp(stamp/1000 - rollover*3600).date().isoformat()
            history[date] = history.get(date, 0) + 1
        day = datetime.fromtimestamp(today_start).date()
        streak = 0
        if day.isoformat() not in history:
            day -= timedelta(days=1)
        while day.isoformat() in history:
            streak += 1
            day -= timedelta(days=1)
        ratings = db.all('select ease,count() from revlog where ease>0 and id>=? group by ease', (today_start - 30*86400)*1000)
        count = sum(row[1] for row in ratings)
        correct = sum(row[1] for row in ratings if row[0]>1)
        queues = dict(db.all('select queue,count() from cards group by queue'))
        forecast = {}
        scheduler_today = self.col.sched.today
        for due, amount in db.all('select due,count() from cards where queue=2 group by due'):
            offset = max(0, due-scheduler_today)
            if offset < 31:
                date = (datetime.fromtimestamp(today_start).date()+timedelta(days=offset)).isoformat()
                forecast[date] = forecast.get(date,0)+amount
        return {'today': today, 'totalCards': db.scalar('select count() from cards'), 'totalNotes': db.scalar('select count() from notes'), 'reviewTime': elapsed, 'streak': streak, 'retention': round(correct/count*100,1) if count else 0, 'history': [{'date': k,'count':v} for k,v in sorted(history.items())], 'forecast': [{'date': k,'count':v} for k,v in sorted(forecast.items())], 'counts': {'new': queues.get(0,0), 'learn': queues.get(1,0)+queues.get(3,0), 'review': queues.get(2,0), 'suspended': queues.get(-1,0)}, 'ratings': [{'rating': k,'count':v} for k,v in ratings]}


class Collections:
    def __init__(self, base=None):
        self.base = Path(base or os.environ.get('MODOO_DATA_DIR', ROOT / 'data')).resolve()
        self.base.mkdir(parents=True, exist_ok=True)
        # Prevent a second API process from maintaining competing Anki queues or
        # request receipts over the same SQLite collections.
        self.ownership = (self.base / '.server-owner.lock').open('a+b')
        self.ownership.seek(0, 2)
        if self.ownership.tell() == 0:
            self.ownership.write(b'0')
            self.ownership.flush()
        self.ownership.seek(0)
        try:
            if os.name == 'nt':
                import msvcrt
                msvcrt.locking(self.ownership.fileno(), msvcrt.LK_NBLCK, 1)
            else:
                import fcntl
                fcntl.flock(self.ownership.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
        except (OSError, BlockingIOError) as exc:
            self.ownership.close()
            raise HTTPException(503, '다른 서버가 이 자료 폴더를 사용 중입니다. 하나의 서버만 실행하세요.') from exc
        secret_file = self.base / '.media-signing-key'
        if secret_file.exists():
            self.secret = secret_file.read_bytes()
        else:
            self.secret = secrets.token_bytes(32)
            secret_file.write_bytes(self.secret)
        self.lock = threading.RLock()
        self.accounts = {}

    def get(self, uid):
        with self.lock:
            if uid not in self.accounts:
                self.accounts[uid] = Account(self.base, uid, self.secret)
            return self.accounts[uid]

    def close(self):
        try:
            for account in self.accounts.values():
                account.close()
            self.accounts.clear()
        finally:
            if not self.ownership.closed:
                self.ownership.seek(0)
                if os.name == 'nt':
                    import msvcrt
                    msvcrt.locking(self.ownership.fileno(), msvcrt.LK_UNLCK, 1)
                else:
                    import fcntl
                    fcntl.flock(self.ownership.fileno(), fcntl.LOCK_UN)
                self.ownership.close()

    def media_path(self, key, filename, expires, signature):
        filename = safe_filename(filename)
        if not re.fullmatch('[0-9a-f]{64}', key) or expires < time.time() or expires > time.time()+305:
            raise HTTPException(403, '미디어 링크가 만료되었습니다.')
        message = f'{key}\n{filename}\n{expires}'
        expected = hmac.new(self.secret, message.encode(), hashlib.sha256).hexdigest()
        if not hmac.compare_digest(expected, signature):
            raise HTTPException(403, '미디어 접근 권한이 없습니다.')
        path = self.base / 'accounts' / key / 'collection.media' / filename
        if not path.is_file() or path.is_symlink():
            raise HTTPException(404, '미디어 파일을 찾을 수 없습니다.')
        return path
