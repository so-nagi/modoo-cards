"""Run: .venv/Scripts/python.exe -m uvicorn server.app:app --host 127.0.0.1 --port 4190"""
from contextlib import asynccontextmanager
import copy
import hashlib
import html
from importlib.metadata import version
import json
import logging
import mimetypes
import os
from pathlib import Path
import re
import tempfile
import threading
import zipfile

from anki import errors as anki_errors
from anki.collection import DeckIdLimit, ExportAnkiPackageOptions, ImportAnkiPackageRequest, ImportAnkiPackageOptions, ImportCsvRequest
from fastapi import Depends, FastAPI, File, HTTPException, Query, Request, UploadFile
from fastapi.exceptions import RequestValidationError
from fastapi.responses import FileResponse, JSONResponse, Response
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
from starlette.background import BackgroundTask

from .auth import ROOT, auth_mode, firebase_config, origin_allowed, require_uid
from .core import Collections, DEFAULT_SETTINGS, model_json, safe_filename
from .schemas import *
from .preview import attach_preview_route
from .cloud_store import CloudAccounts, RealtimeStore
from .content_import import import_content

MAX_UPLOAD = 128 * 1024 * 1024
MEDIA_EXTENSIONS = {'.png','.jpg','.jpeg','.webp','.gif','.avif','.svg','.mp3','.mp4','.m4a','.ogg','.wav','.webm','.flac','.ttf','.otf','.woff','.woff2'}


def create_app(data_dir=None):
    @asynccontextmanager
    async def lifespan(app):
        yield
        if hasattr(app.state, 'collections'):
            app.state.collections.close()

    app = FastAPI(title='Modoo Anki', version='0.1.0', lifespan=lifespan)
    allowed_origins = list(filter(None, os.environ.get('MODOO_ALLOWED_ORIGINS', '').split(',')))
    if allowed_origins:
        app.add_middleware(CORSMiddleware, allow_origins=allowed_origins,
                           allow_methods=['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
                           allow_headers=['Authorization', 'Content-Type'], max_age=600)
    initialization_lock = threading.Lock()

    def collections():
        with initialization_lock:
            if not hasattr(app.state, 'collections'):
                app.state.collections = Collections(data_dir)
                if os.environ.get('MODOO_DATABASE_URL'):
                    if auth_mode() != 'firebase' or app.state.collections.base in {ROOT / 'data', ROOT / 'data-local'}:
                        raise RuntimeError('Cloud mode requires Firebase auth and a separate disposable cache directory')
                    app.state.cloud_accounts = CloudAccounts(app.state.collections, RealtimeStore(os.environ['MODOO_DATABASE_URL']))
        return app.state.collections

    def account(request: Request, uid=Depends(require_uid)):
        registry = collections()
        if hasattr(app.state, 'cloud_accounts'):
            with app.state.cloud_accounts.account(uid, request.headers['authorization'][7:]) as current:
                yield current
            return
        current = registry.get(uid)
        with current.lock:
            yield current

    attach_preview_route(app, account)

    @app.middleware('http')
    async def protect(request, call_next):
        if request.url.path.startswith('/api'):
            if request.method not in {'GET', 'HEAD', 'OPTIONS'} and not origin_allowed(request):
                return JSONResponse({'detail': '허용되지 않은 출처의 요청입니다.'}, status_code=403)
            try:
                size = int(request.headers.get('content-length', '0'))
            except ValueError:
                return JSONResponse({'detail': '잘못된 요청 크기입니다.'}, status_code=400)
            if size > MAX_UPLOAD + 1024*1024:
                return JSONResponse({'detail': '업로드는 128MB 이하로 해주세요.'}, status_code=413)
            if request.headers.get('content-type', '').startswith('application/json'):
                if len(await request.body()) > 5*1024*1024:
                    return JSONResponse({'detail': '요청 내용이 너무 큽니다.'}, status_code=413)
        response = await call_next(request)
        response.headers['X-Content-Type-Options'] = 'nosniff'
        response.headers['Referrer-Policy'] = 'no-referrer'
        if request.url.path.startswith('/api'):
            response.headers['Cache-Control'] = 'no-store'
        return response

    @app.exception_handler(RequestValidationError)
    async def validation_error(request, exc):
        return JSONResponse({'detail': '입력값을 확인하세요: ' + '; '.join(e['msg'] for e in exc.errors()[:3])}, status_code=422)

    @app.exception_handler(anki_errors.NotFoundError)
    async def not_found(request, exc):
        return JSONResponse({'detail': '요청한 카드·노트·덱을 찾을 수 없습니다.'}, status_code=404)

    @app.exception_handler(anki_errors.AnkiException)
    async def invalid_core_operation(request, exc):
        return JSONResponse({'detail': 'Anki에서 작업을 처리하지 못했습니다: ' + str(exc)}, status_code=400)

    @app.exception_handler(Exception)
    async def core_error(request, exc):
        logging.getLogger('modoo').exception('API operation failed: %s', request.url.path)
        return JSONResponse({'detail': '작업을 완료하지 못했습니다. 입력과 파일 형식을 확인하고 다시 시도하세요.'}, status_code=500)

    @app.get('/api/config')
    def config():
        return {'authMode': auth_mode(), 'firebase': firebase_config(), 'engineVersion': version('anki')}

    @app.get('/health')
    @app.get('/api/health')
    def health():
        return {'ok': True, 'engine': 'anki', 'engineVersion': version('anki'), 'features': {'contentImport': True}}

    @app.get('/api/bootstrap')
    def bootstrap(a=Depends(account, scope='function')):
        return {'decks': a.decks(), 'models': [model_json(m) for m in a.col.models.all()], 'settings': DEFAULT_SETTINGS | a.meta.get('settings', {}) | {'skin': 'classic'}, 'stats': a.stats(), 'revision': a.revision}

    @app.get('/api/version')
    def revision(a=Depends(account, scope='function')):
        return {'revision': a.revision}

    @app.post('/api/decks')
    def create_deck(data: DeckInput, a=Depends(account, scope='function')):
        name = data.name.strip()
        if not name:
            raise HTTPException(422, '덱 이름을 입력하세요.')
        did = a.col.decks.id(name)
        if did == 1:
            a.meta['hideEmptyDefault'] = False
            a.save_meta()
        a.changed()
        return a.deck_summary(did)

    @app.get('/api/decks/{did}')
    def get_deck(did: int, a=Depends(account, scope='function')):
        return a.deck_metadata(did)

    @app.patch('/api/decks/{did}')
    def edit_deck(did: int, data: DeckUpdate, a=Depends(account, scope='function')):
        return a.edit_deck(did, data)

    @app.delete('/api/decks/{did}')
    def delete_deck(did: int, a=Depends(account, scope='function')):
        # A retry after a lost successful response is still a successful deletion.
        # Native Anki retains/recreates ID 1; hide that empty fallback in the web
        # list after an explicit delete, without editing the canonical SQLite DB.
        if a.col.decks.get(did, default=False) is not None:
            if did == 1:
                undo_name = '기본 덱 삭제 / ' + os.urandom(8).hex()
                previous_hidden = bool(a.meta.get('hideEmptyDefault', False))
                undo_target = a.col.add_custom_undo_entry(undo_name)
            a.col.decks.remove([did])
            if did == 1:
                a.col.merge_undo_entries(undo_target)
                a.default_visibility_undo[undo_name] = previous_hidden
                a.meta['hideEmptyDefault'] = True
                a.save_meta()
            a.changed()
        return {'ok': True, 'decks': a.decks()}

    @app.get('/api/decks/{did}/options')
    def get_options(did: int, a=Depends(account, scope='function')):
        return a.options(did)

    @app.put('/api/decks/{did}/favorite')
    def favorite_deck(did: int, data: DeckFavoriteInput, a=Depends(account, scope='function')):
        a.deck(did)
        favorites = set(a.meta.get('favoriteDeckIds', []))
        if data.favorite:
            favorites.add(did)
        else:
            favorites.discard(did)
        a.meta['favoriteDeckIds'] = sorted(favorites)
        a.save_meta()
        # App metadata only: the current Anki study token stays valid.
        return a.deck_summary(did)

    @app.post('/api/decks/{did}/empty')
    def empty_deck(did: int, a=Depends(account, scope='function')):
        deck = a.deck(did)
        if deck.get('dyn'):
            removed = a.col.db.scalar('select count() from cards where did=?', did)
            if removed:
                a.col.sched.empty_filtered_deck(did)
                a.changed()
        else:
            deck_ids = [did] + [child_id for _, child_id in a.col.decks.children(did)]
            placeholders = ','.join('?' for _ in deck_ids)
            ids = a.col.db.list(f'select id from cards where did in ({placeholders}) or odid in ({placeholders})', *deck_ids, *deck_ids)
            removed = len(ids)
            reveal_default = did == 1 and bool(a.meta.get('hideEmptyDefault', False))
            if reveal_default:
                undo_name = '기본 덱 비우기 / ' + os.urandom(8).hex()
                target = a.col.add_custom_undo_entry(undo_name)
            if ids:
                a.col.remove_cards_and_orphaned_notes(ids)
            if reveal_default:
                a.col.merge_undo_entries(target)
                a.default_visibility_undo[undo_name] = True
                a.meta['hideEmptyDefault'] = False
                a.save_meta()
            if ids or reveal_default:
                a.changed()
        return {'ok': True, 'removed': removed, 'decks': a.decks()}

    @app.put('/api/decks/{did}/options')
    def set_options(did: int, data: OptionsInput, a=Depends(account, scope='function')):
        return a.set_options(did, data)

    @app.get('/api/models')
    def models(a=Depends(account, scope='function')):
        return [model_json(m) for m in a.col.models.all()]

    @app.get('/api/models/{mid}')
    def model(mid: int, a=Depends(account, scope='function')):
        return model_json(a.model(mid))

    @app.post('/api/models')
    def add_model(data: ModelInput, a=Depends(account, scope='function')):
        m = a.col.models.copy(a.model(data.baseId), add=False)
        m['name'] = data.name
        a.col.models.add(m)
        a.changed()
        return model_json(m)

    @app.put('/api/models/{mid}')
    def update_model(mid: int, data: ModelUpdate, a=Depends(account, scope='function')):
        m = copy.deepcopy(a.model(mid))
        if data.name is not None:
            m['name'] = data.name
        if data.css is not None:
            m['css'] = data.css
        if data.fields is not None:
            if len(set(data.fields)) != len(data.fields) or any(not x.strip() for x in data.fields):
                raise HTTPException(422, '필드 이름은 비어 있거나 중복될 수 없습니다.')
            fields = []
            for i,name in enumerate(data.fields):
                field = copy.deepcopy(m['flds'][i]) if i<len(m['flds']) else a.col.models.new_field(name)
                field['name'] = name
                fields.append(field)
            m['flds'] = fields
        if data.templates is not None:
            templates = []
            for i,t in enumerate(data.templates):
                template = copy.deepcopy(m['tmpls'][i]) if i<len(m['tmpls']) else a.col.models.new_template(t.name)
                template.update(t.model_dump())
                templates.append(template)
            m['tmpls'] = templates
        a.col.models.update_dict(m)
        a.changed()
        return model_json(a.model(mid))

    @app.post('/api/notes')
    def add_note(data: NoteInput, a=Depends(account, scope='function')):
        return a.add_note(data)

    @app.post('/api/notes/batch')
    def batch_notes(data: BatchInput, a=Depends(account, scope='function')):
        return a.batch(data)

    @app.put('/api/notes/{nid}')
    def update_note(nid: int, data: NoteFields, a=Depends(account, scope='function')):
        n = a.col.get_note(nid)
        if len(data.fields) != len(n.fields) or any(len(x)>200000 for x in data.fields):
            raise HTTPException(422, '필드 개수나 길이를 확인하세요.')
        n.fields, n.tags = data.fields, data.tags
        a.col.update_note(n)
        a.changed()
        return {'id': nid}

    @app.get('/api/cards')
    def cards(q: str = Query(default='', max_length=3000), limit: int = Query(default=200, ge=1, le=2000), deckId: int | None = Query(default=None, gt=0), a=Depends(account, scope='function')):
        return a.browse_cards(q, limit, deckId)

    @app.get('/api/cards/{cid}')
    def card(cid: int, a=Depends(account, scope='function')):
        row = a.card_row(cid)
        history = a.col.db.all('select id,ease,ivl,lastIvl,factor,time,type from revlog where cid=? order by id desc', cid)
        row['history'] = [dict(zip(['id','rating','interval','lastInterval','factor','time','type'], h)) for h in history]
        row['css'] = a.render(a.col.get_card(cid))[2]
        return row

    @app.post('/api/cards/action')
    def card_action(data: ActionInput, a=Depends(account, scope='function')):
        for cid in data.ids:
            a.col.get_card(cid)
        action = data.action
        if action == 'suspend': a.col.sched.suspend_cards(data.ids)
        elif action == 'unsuspend': a.col.sched.unsuspend_cards(data.ids)
        elif action == 'bury': a.col.sched.bury_cards(data.ids)
        elif action == 'unbury': a.col.sched.unbury_cards(data.ids)
        elif action == 'reset': a.col.sched.schedule_cards_as_new(data.ids, reset_counts=True)
        elif action == 'delete': a.col.remove_cards_and_orphaned_notes(data.ids)
        elif action == 'flag':
            if not isinstance(data.value, int) or not 0<=data.value<=7: raise HTTPException(422, '깃발은 0~7입니다.')
            a.col.set_user_flag_for_cards(data.value, data.ids)
        elif action == 'due':
            value = str(data.value)
            if not re.fullmatch(r'-?\d+(?:--?\d+)?!?', value): raise HTTPException(422, '기한은 일수 또는 5-7 형식입니다.')
            a.col.sched.set_due_date(data.ids, value)
        elif action == 'deck':
            if not isinstance(data.value, int): raise HTTPException(422, '덱을 선택하세요.')
            a.deck(data.value)
            a.col.set_deck(data.ids, data.value)
        elif action == 'tags':
            if not isinstance(data.value, str): raise HTTPException(422, '태그를 입력하세요.')
            ids = list({a.col.get_card(cid).nid for cid in data.ids})
            a.col.tags.bulk_add(ids, data.value)
        # Flagging the displayed card is harmless to its scheduling states.
        # Preserve the study token so users can immediately grade that card.
        a.changed(preserve_study=action == 'flag')
        return {'ok': True}

    @app.get('/api/study')
    def study(deckId: int = 1, a=Depends(account, scope='function')):
        return a.study(deckId)

    @app.get('/api/scheduler/preferences')
    def scheduler_preferences(a=Depends(account, scope='function')):
        return a.scheduler_preferences()

    @app.put('/api/scheduler/preferences')
    def set_scheduler_preferences(data: SchedulerPreferencesInput, a=Depends(account, scope='function')):
        return a.set_scheduler_preferences(data)

    @app.post('/api/answer')
    def answer(data: AnswerInput, a=Depends(account, scope='function')):
        return a.answer(data)

    @app.post('/api/undo')
    def undo(a=Depends(account, scope='function')):
        status = a.col.undo_status()
        undo_name = status.undo
        if not undo_name:
            raise HTTPException(409, '되돌릴 작업이 없습니다.')
        a.col.undo()
        visibility_key = status.last_step if status.last_step in a.default_visibility_undo else undo_name
        if visibility_key in a.default_visibility_undo:
            a.meta['hideEmptyDefault'] = a.default_visibility_undo.pop(visibility_key)
            a.save_meta()
        a.changed()
        return {'ok': True}

    @app.get('/api/stats')
    def stats(a=Depends(account, scope='function')):
        return a.stats()

    @app.get('/api/settings')
    def settings(a=Depends(account, scope='function')):
        return DEFAULT_SETTINGS | a.meta.get('settings', {}) | {'skin': 'classic'}

    @app.put('/api/settings')
    def set_settings(data: SettingsInput, a=Depends(account, scope='function')):
        a.meta['settings'] = DEFAULT_SETTINGS | a.meta.get('settings', {}) | {'skin': 'classic'} | data.model_dump(exclude_none=True)
        a.save_meta()
        return a.meta['settings']

    def uploaded(file, folder, media=False):
        name = safe_filename(file.filename or '')
        suffix = Path(name).suffix.lower()
        if media and suffix not in MEDIA_EXTENSIONS:
            raise HTTPException(415, '지원하는 이미지·오디오·비디오·글꼴 파일을 선택하세요.')
        out = folder / ('upload-' + os.urandom(12).hex() + suffix)
        total = 0
        try:
            with out.open('wb') as target:
                while chunk := file.file.read(1024*1024):
                    total += len(chunk)
                    if total > MAX_UPLOAD:
                        raise HTTPException(413, '업로드는 128MB 이하로 해주세요.')
                    target.write(chunk)
            return out, name
        except BaseException:
            out.unlink(missing_ok=True)
            raise

    @app.post('/api/media')
    def upload_media(file: UploadFile = File(...), a=Depends(account, scope='function')):
        path, name = uploaded(file, a.path, media=True)
        try:
            filename = a.col.media.write_data(name, path.read_bytes())
            return {'filename': filename, 'url': a.signed_media(filename)}
        finally:
            path.unlink(missing_ok=True)

    @app.get('/api/media/{key}/{filename}')
    def get_media(key: str, filename: str, expires: int, signature: str):
        path = collections().media_path(key, filename, expires, signature)
        return FileResponse(path, headers={'Content-Security-Policy': "default-src 'none'; sandbox", 'Cross-Origin-Resource-Policy': 'cross-origin', 'Access-Control-Allow-Origin': '*'})

    @app.post('/api/import')
    @app.post('/api/import-content')
    def import_file(request: Request, file: UploadFile = File(...), a=Depends(account, scope='function')):
        path, name = uploaded(file, a.path)
        suffix = Path(name).suffix.lower()
        before = a.col.db.scalar('select count() from notes')
        cards_before = a.col.card_count()
        try:
            if suffix in {'.apkg', '.colpkg'}:
                try:
                    with zipfile.ZipFile(path) as archive:
                        entries = archive.infolist()
                        if len(entries)>200000 or sum(e.file_size for e in entries)>2*1024**3:
                            raise HTTPException(413, '압축 해제 후 파일 크기가 너무 큽니다.')
                        if any('..' in Path(e.filename.replace('\\','/')).parts or e.filename.startswith(('/', '\\')) for e in entries):
                            raise HTTPException(400, '안전하지 않은 패키지 경로입니다.')
                except zipfile.BadZipFile as exc:
                    raise HTTPException(400, '올바른 Anki 패키지가 아닙니다.') from exc
                if suffix == '.colpkg':
                    # Preserve a complete recovery package before replacing the collection.
                    backup = a.path / ('before-import-' + os.urandom(6).hex() + '.colpkg')
                    try:
                        a.col.export_collection_package(str(backup), include_media=True, legacy=False)
                    finally:
                        a.col.reopen()
                    col_path, media_folder = a.col.path, a.col.media.dir()
                    a.col.close()
                    try:
                        a.col._backend.import_collection_package(col_path=col_path, backup_path=str(path), media_folder=media_folder, media_db=media_folder+'.db2')
                    finally:
                        a.col.reopen()
                    a.initialize_scheduler_preferences()
                else:
                    if request.url.path == '/api/import-content':
                        import_content(a.col, path, a.path)
                    else:
                        a.col.import_anki_package(ImportAnkiPackageRequest(package_path=str(path), options=ImportAnkiPackageOptions(merge_notetypes=True, with_scheduling=True, with_deck_configs=True)))
            elif suffix in {'.csv', '.tsv', '.txt'}:
                metadata = a.col.get_csv_metadata(str(path), None)
                a.col.import_csv(ImportCsvRequest(path=str(path), metadata=metadata))
            else:
                raise HTTPException(415, '.apkg, .colpkg, .csv, .tsv, .txt 파일을 선택하세요.')
            a.changed()
            added = max(0, a.col.db.scalar('select count() from notes')-before)
            # A collection restore replaces data; its net delta is not an import count.
            if suffix == '.colpkg':
                return {'message': '컬렉션 복원이 완료되었습니다.'}
            return {'message': '가져오기가 완료되었습니다.', 'added': added,
                    'cardsAdded': max(0, a.col.card_count() - cards_before)}
        finally:
            path.unlink(missing_ok=True)

    @app.post('/api/export')
    def export(data: ExportInput, a=Depends(account, scope='function')):
        if data.deckId is not None:
            a.deck(data.deckId)
        path = a.path / ('export-' + os.urandom(12).hex() + '.' + data.format)
        limit = DeckIdLimit(deck_id=data.deckId) if data.deckId else None
        if data.format == 'apkg':
            a.col.export_anki_package(out_path=str(path), options=ExportAnkiPackageOptions(with_scheduling=data.includeScheduling, with_deck_configs=data.includeScheduling, with_media=data.includeMedia, legacy=False), limit=limit)
        elif data.format == 'colpkg':
            if data.deckId is not None:
                raise HTTPException(422, '컬렉션 패키지는 전체 자료를 내보냅니다. 덱 선택을 해제하세요.')
            try:
                a.col.export_collection_package(str(path), include_media=data.includeMedia, legacy=False)
            finally:
                a.col.reopen()
                a.changed()
        else:
            a.col.export_note_csv(out_path=str(path), limit=limit, with_html=True, with_tags=True, with_deck=True, with_notetype=True, with_guid=True)
        return FileResponse(path, filename='modoo-anki.'+data.format, media_type='application/octet-stream', background=BackgroundTask(path.unlink, missing_ok=True))

    @app.post('/api/filtered-decks')
    def filtered(data: FilteredInput, a=Depends(account, scope='function')):
        if a.col.decks.id_for_name(data.name):
            raise HTTPException(409, '이미 같은 이름의 덱이 있습니다.')
        deck = a.col.sched.get_or_create_filtered_deck(0)
        deck.name = data.name
        deck.config.reschedule = data.reschedule
        del deck.config.search_terms[:]
        deck.config.search_terms.add(search=data.search, limit=data.limit, order=0)
        result = a.col.sched.add_or_update_filtered_deck(deck)
        a.col.sched.rebuild_filtered_deck(result.id)
        a.changed()
        return {'id': result.id}

    @app.post('/api/filtered-decks/{did}/rebuild')
    def rebuild(did: int, a=Depends(account, scope='function')):
        if not a.deck(did).get('dyn'): raise HTTPException(400, '필터 덱을 선택하세요.')
        a.col.sched.rebuild_filtered_deck(did)
        a.changed()
        return {'ok': True}

    @app.post('/api/filtered-decks/{did}/empty')
    def empty(did: int, a=Depends(account, scope='function')):
        if not a.deck(did).get('dyn'): raise HTTPException(400, '필터 덱을 선택하세요.')
        a.col.sched.empty_filtered_deck(did)
        a.changed()
        return {'ok': True}

    @app.post('/api/occlusion')
    def occlusion(data: OcclusionInput, a=Depends(account, scope='function')):
        a.deck(data.deckId)
        name = safe_filename(data.imageFilename)
        path = Path(a.col.media.dir()) / name
        if not path.is_file() or path.is_symlink(): raise HTTPException(404, '먼저 이미지를 올려주세요.')
        if any(m.x+m.width>1.001 or m.y+m.height>1.001 for m in data.masks): raise HTTPException(422, '가림 영역이 이미지 바깥으로 나갔습니다.')
        a.col.add_image_occlusion_notetype()
        model = next((m for m in a.col.models.all() if m.get('originalStockKind') == 6), None)
        if model is None:
            model = next((m for m in a.col.models.all() if m['name']=='Image Occlusion'), None)
        if model is None: raise HTTPException(409, '이미지 가리기 노트 유형을 찾을 수 없습니다.')
        groups = {}
        parts = []
        for i, mask in enumerate(data.masks):
            key = ('group', mask.groupId) if mask.groupId is not None else ('single', i)
            number = groups.setdefault(key, len(groups) + 1)
            parts.append('{{c'+str(number)+'::image-occlusion:rect:left='+str(mask.x)+':top='+str(mask.y)+':width='+str(mask.width)+':height='+str(mask.height)+':oi=1}}')
        masks = ''.join(parts)
        model['did'] = data.deckId
        a.col.models.update_dict(model)
        a.col.decks.select(data.deckId)
        a.col.models.set_current(model)
        before = a.col.db.scalar('select count() from cards')
        a.col.add_image_occlusion_note(notetype_id=model['id'], image_path=str(path), occlusions=masks, header=data.header, back_extra='', tags=[])
        a.changed()
        return {'added': a.col.db.scalar('select count() from cards')-before}

    dist = ROOT / 'dist'
    if dist.is_dir():
        app.mount('/', StaticFiles(directory=dist, html=True), name='frontend')
    return app


app = create_app()
