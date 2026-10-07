"""Durable RTDB checkpoints around native Anki operations.

Only the caller's verified Firebase ID token is used. No admin key is needed.
The immutable media chunks are written first; the collection, metadata and
media manifest are committed together with a Firebase ETag compare-and-swap.
An API success is sent only after that commit. Local files are a disposable
cache, never the authority in cloud mode.
"""
import base64
from contextlib import contextmanager
import hashlib
import io
import json
from pathlib import Path
import re
import tempfile
import threading
from urllib.parse import quote, urlsplit
import zipfile
import zlib

from anki.collection import Collection
from fastapi import HTTPException
import requests
import zstandard

from .core import Account, safe_filename

CHUNK = 384 * 1024
MAX_DATABASE = 128 * 1024 * 1024
MAX_STATE = 24 * 1024 * 1024
MAX_MEDIA = 256 * 1024 * 1024
HASH = re.compile(r'^[0-9a-f]{64}$')


def digest(data):
    return hashlib.sha256(data).hexdigest()


def canonical(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(',', ':')).encode()


def database_bytes(account):
    # Anki owns an EXCLUSIVE SQLite connection. A second SQLite connection
    # blocks, while raw VACUUM through DBProxy clears native undo. Its official
    # backup API snapshots the collection without either of those side effects.
    folder = account.path / '.cloud-backups'
    folder.mkdir(exist_ok=True)
    created = account.col.create_backup(backup_folder=str(folder), force=True, wait_for_completion=True)
    if not created and hasattr(account, '_cloud_database'):
        return account._cloud_database
    packages = list(folder.glob('*.colpkg'))
    if not packages:
        raise HTTPException(503, 'Anki 컬렉션 백업을 생성하지 못했습니다.')
    latest = max(packages, key=lambda p: p.stat().st_mtime_ns)
    with zipfile.ZipFile(latest) as archive:
        compressed = archive.read('collection.anki21b')
    with zstandard.ZstdDecompressor().stream_reader(io.BytesIO(compressed)) as reader:
        raw = reader.read(MAX_DATABASE + 1)
    if len(raw) > MAX_DATABASE:
        raise HTTPException(413, '무료 클라우드 컬렉션 한도 128MB를 초과했습니다.')
    account._cloud_database = raw
    return raw


def snapshot(account):
    database = database_bytes(account)
    if len(database) > MAX_DATABASE:
        raise HTTPException(413, '무료 클라우드에 저장할 컬렉션 크기를 초과했습니다. 내보내기 후 덱을 나눠 주세요.')
    media, total = [], 0
    folder = account.path / 'collection.media'
    for path in sorted(folder.iterdir()) if folder.exists() else []:
        if not path.is_file() or path.is_symlink():
            raise HTTPException(400, '미디어 폴더에 지원하지 않는 파일이 있습니다.')
        safe_filename(path.name)
        total += path.stat().st_size
        if total > MAX_MEDIA:
            raise HTTPException(413, '무료 클라우드의 계정별 미디어 한도 256MB를 초과했습니다.')
        media.append({'name': path.name, 'hash': digest(path.read_bytes()), 'bytes': path.stat().st_size})
    value = {'format': 1, 'database': base64.b64encode(zlib.compress(database)).decode(),
             'databaseHash': digest(database), 'metadata': canonical(account.meta).decode(), 'media': media}
    value['id'] = digest(canonical(value))
    if len(value['database']) > 9 * 1024 * 1024 or len(canonical(value)) > MAX_STATE:
        raise HTTPException(413, '클라우드 저장 데이터가 너무 큽니다. 컬렉션을 내보낸 뒤 크기를 줄여 주세요.')
    return value


def decode_database(state):
    try:
        value = dict(state)
        expected = value.pop('id')
        # RTDB represents empty JSON arrays as absent children.
        value.setdefault('media', [])
        if value['format'] != 1 or digest(canonical(value)) != expected:
            raise ValueError('manifest checksum')
        compressed = base64.b64decode(value['database'], validate=True)
        decoder = zlib.decompressobj()
        raw = decoder.decompress(compressed, MAX_DATABASE + 1)
        if len(raw) > MAX_DATABASE or not decoder.eof or decoder.unused_data or digest(raw) != value['databaseHash']:
            raise ValueError('database checksum')
        if not raw.startswith(b'SQLite format 3\x00') or not isinstance(json.loads(value['metadata']), dict):
            raise ValueError('invalid snapshot')
        media = value['media']
        if not isinstance(media, list) or len(media) > 20000:
            raise ValueError('media manifest')
        names = set()
        for item in media:
            name = safe_filename(item['name'])
            if name in names or not HASH.fullmatch(item['hash']) or type(item['bytes']) is not int or not 0 <= item['bytes'] <= MAX_MEDIA:
                raise ValueError('media entry')
            names.add(name)
        if sum(item['bytes'] for item in media) > MAX_MEDIA:
            raise ValueError('media quota')
        return raw
    except (ValueError, KeyError, TypeError, zlib.error) as exc:
        raise HTTPException(503, '클라우드 자료의 무결성을 확인하지 못했습니다. 기존 자료는 덮어쓰지 않았습니다.') from None


class RealtimeStore:
    def __init__(self, url):
        parts = urlsplit(url)
        if parts.scheme != 'https' or not parts.hostname or not parts.hostname.endswith(('.firebasedatabase.app', '.firebaseio.com')) or parts.path not in ('', '/') or parts.query or parts.fragment or parts.username or parts.password:
            raise ValueError('MODOO_DATABASE_URL must be an exact HTTPS Firebase database origin')
        self.url = url.rstrip('/')

    def request(self, method, uid, suffix, token, value=None, etag=None):
        path = '/accounts/' + quote(uid, safe='') + '/' + suffix + '.json'
        headers = {'X-Firebase-ETag': 'true'}
        if etag is not None:
            headers['If-Match'] = etag
        try:
            # The REST API requires the end-user ID token in auth. Never expose
            # exception URLs, responses, token values, or requests debug logs.
            response = requests.request(method, self.url + path, params={'auth': token},
                                        json=value, headers=headers, timeout=(10, 45), allow_redirects=False)
            if response.status_code == 412:
                raise HTTPException(409, '다른 기기에서 자료가 변경되었습니다. 새로고침 후 다시 시도하세요.')
            if response.status_code in (401, 403):
                raise HTTPException(401, '클라우드 저장 권한을 확인하지 못했습니다. 다시 로그인해 주세요.')
            if response.status_code != 200:
                raise HTTPException(503, '클라우드 저장소에 연결하지 못했습니다. 이번 작업은 저장 완료되지 않았습니다.')
            if len(response.content) > MAX_STATE + 1024 * 1024:
                raise HTTPException(503, '클라우드 응답 크기를 초과했습니다.')
            return response.json(), response.headers.get('ETag')
        except (requests.RequestException, ValueError):
            raise HTTPException(503, '클라우드 저장 결과를 확인하지 못했습니다. 새로고침하여 기록을 확인하세요.') from None

    def read(self, uid, token):
        state, etag = self.request('GET', uid, 'state', token)
        if not etag:
            raise HTTPException(503, '클라우드 자료의 버전을 확인하지 못했습니다.')
        return state, etag

    def commit(self, uid, token, state, previous, etag, folder):
        known = {item['hash'] for item in (previous or {}).get('media', [])}
        for item in state.get('media', []):
            if item['hash'] in known:
                continue
            data = (folder / item['name']).read_bytes()
            if digest(data) != item['hash']:
                raise HTTPException(409, '저장 중 미디어가 변경되었습니다. 다시 시도하세요.')
            for index in range(max(1, (len(data) + CHUNK - 1) // CHUNK)):
                chunk = base64.b64encode(data[index*CHUNK:(index+1)*CHUNK]).decode()
                self.request('PUT', uid, f'media/{item["hash"]}/{index}', token, chunk)
        self.request('PUT', uid, 'state', token, state, etag)

    def media(self, uid, token, item):
        chunks = []
        for index in range(max(1, (item['bytes'] + CHUNK - 1) // CHUNK)):
            value, _ = self.request('GET', uid, f'media/{item["hash"]}/{index}', token)
            try:
                chunk = base64.b64decode(value, validate=True)
            except (ValueError, TypeError):
                raise HTTPException(503, '클라우드 미디어를 복원하지 못했습니다.') from None
            if len(chunk) > CHUNK:
                raise HTTPException(503, '클라우드 미디어 크기가 올바르지 않습니다.')
            chunks.append(chunk)
        data = b''.join(chunks)
        if len(data) != item['bytes'] or digest(data) != item['hash']:
            raise HTTPException(503, '클라우드 미디어의 무결성을 확인하지 못했습니다.')
        return data


class CloudAccounts:
    def __init__(self, collections, store):
        self.collections, self.store = collections, store
        self.lock = threading.Lock()
        self.locks, self.ids = {}, {}

    def discard(self, uid):
        account = self.collections.accounts.pop(uid, None)
        if account:
            account.col.close()
        self.ids.pop(uid, None)

    def restore(self, uid, token, state):
        base = self.collections.base
        key = hashlib.sha256(uid.encode()).hexdigest()
        destination = base / 'accounts' / key
        # Build and verify before closing/replacing a live cache. Both temporary
        # paths are generated within this disposable cloud cache, never data/.
        with tempfile.TemporaryDirectory(prefix='restore-', dir=base) as temporary:
            stage = Path(temporary) / key
            stage.mkdir()
            if state is not None:
                raw = decode_database(state)
                db = stage / 'collection.anki2'
                db.write_bytes(raw)
                # Native SQLite registers Anki's unicase collation.
                probe = Collection(str(db))
                try:
                    if probe.db.scalar('PRAGMA quick_check') != 'ok':
                        raise HTTPException(503, '클라우드 컬렉션 검사에 실패했습니다.')
                finally:
                    probe.close()
                (stage / 'app-state.json').write_text(state['metadata'], 'utf-8')
                folder = stage / 'collection.media'
                folder.mkdir(exist_ok=True)
                for item in state.get('media', []):
                    cached = destination / 'collection.media' / item['name']
                    if cached.is_file() and not cached.is_symlink() and digest(cached.read_bytes()) == item['hash']:
                        data = cached.read_bytes()
                    else:
                        data = self.store.media(uid, token, item)
                    (folder / item['name']).write_bytes(data)
            self.discard(uid)
            destination.parent.mkdir(exist_ok=True)
            old = Path(temporary) / 'previous-cache'
            if not destination.resolve().is_relative_to(base.resolve()) or destination.is_symlink():
                raise ValueError('Unsafe cache path')
            if destination.exists():
                destination.rename(old)
            try:
                stage.rename(destination)
            except BaseException:
                if old.exists():
                    old.rename(destination)
                raise
        account = self.collections.get(uid)
        self.ids[uid] = state['id'] if state else None
        return account

    @contextmanager
    def account(self, uid, token):
        with self.lock:
            lock = self.locks.setdefault(uid, threading.Lock())
        with lock:
            state, etag = self.store.read(uid, token)
            identity = state['id'] if state else None
            current = self.collections.accounts.get(uid)
            if current is None or self.ids.get(uid) != identity:
                current = self.restore(uid, token, state)
            with current.lock:
                try:
                    yield current
                    updated = snapshot(current)
                    if updated['id'] != identity:
                        self.store.commit(uid, token, updated, state, etag, current.path / 'collection.media')
                        self.ids[uid] = updated['id']
                except BaseException:
                    # Includes ambiguous network completion: the next request
                    # reloads the actual committed state and request receipts.
                    self.discard(uid)
                    raise
