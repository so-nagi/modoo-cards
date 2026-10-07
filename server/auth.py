"""Firebase token authentication. Local auth is an explicit loopback-only mode."""
import ipaddress
import json
import logging
import os
import threading
from pathlib import Path
from urllib.parse import urlsplit

from fastapi import HTTPException, Request

ROOT = Path(__file__).resolve().parents[1]
PUBLIC_KEYS = {'apiKey', 'authDomain', 'projectId', 'storageBucket', 'messagingSenderId', 'appId', 'measurementId'}
_firebase_lock = threading.Lock()


def _safe_auth_failure(exc):
    """Diagnostics contain only allowlisted classifications, never JWTs/claims."""
    types = []
    current = exc
    for _ in range(4):
        if current is None or type(current).__name__ in types:
            break
        types.append(type(current).__name__)
        current = getattr(current, 'cause', None) or getattr(current, '__cause__', None)
    reason = {
        'CertificateFetchError': 'certificate-fetch-failed',
        'ExpiredIdTokenError': 'expired-id-token',
        'RevokedIdTokenError': 'revoked-id-token',
        'UserDisabledError': 'user-disabled',
        'DefaultCredentialsError': 'credentials-unavailable',
        'InvalidIdTokenError': 'invalid-id-token',
        'TransportError': 'certificate-network-failed',
    }.get(type(exc).__name__, 'token-validation-failed')
    # Classify known SDK clock diagnostics in memory. Never return/log their text.
    diagnostic = str(exc)
    if 'Token used too early' in diagnostic:
        reason = 'token-issued-in-future'
    elif 'Token expired' in diagnostic:
        reason = 'expired-id-token'
    elif 'incorrect "aud"' in diagnostic:
        reason = 'audience-mismatch'
    elif 'incorrect "iss"' in diagnostic:
        reason = 'issuer-mismatch'
    logging.getLogger('modoo.auth').warning(
        'Firebase token rejected: exception_type=%s safe_code=%s cause_types=%s',
        type(exc).__name__, reason, ','.join(types[1:]) or 'none',
    )


def firebase_config():
    raw = os.environ.get('MODOO_FIREBASE_CONFIG')
    path = ROOT / 'firebase.public.json'
    try:
        value = json.loads(raw) if raw else (json.loads(path.read_text('utf-8-sig')) if path.exists() else None)
    except (ValueError, OSError):
        return None
    if not isinstance(value, dict) or not value.get('projectId'):
        return None
    return {k: str(v) for k, v in value.items() if k in PUBLIC_KEYS}


def auth_mode():
    if os.environ.get('MODOO_LOCAL_AUTH') == '1':
        return 'local'
    return 'firebase' if firebase_config() else 'unconfigured'


def loopback(host):
    try:
        return ipaddress.ip_address(host).is_loopback
    except ValueError:
        return host == 'localhost'


def origin_allowed(request: Request):
    origin = request.headers.get('origin')
    if not origin:
        return request.headers.get('sec-fetch-site') != 'cross-site'
    if origin == 'null':
        return False
    actual = f'{request.url.scheme}://{request.headers.get("host", "")}'
    extra = set(filter(None, os.environ.get('MODOO_ALLOWED_ORIGINS', '').split(',')))
    # A managed HTTPS proxy may reach uvicorn over HTTP. Trust only the exact
    # platform/configured public origin, never a client-supplied forwarded host.
    public_origin = os.environ.get('MODOO_PUBLIC_ORIGIN') or os.environ.get('RENDER_EXTERNAL_URL', '')
    parsed = urlsplit(public_origin)
    if parsed.scheme == 'https' and parsed.netloc and parsed.path in ('', '/') and not parsed.query and not parsed.fragment and not parsed.username and not parsed.password:
        extra.add(f'https://{parsed.netloc}')
    return origin == actual or origin in extra


def verify_firebase_token(token: str):
    import firebase_admin
    from firebase_admin import auth, credentials
    from google.auth.credentials import AnonymousCredentials
    config = firebase_config()
    if not config:
        raise HTTPException(503, 'Google 로그인 구성이 필요합니다.')
    name = 'modoo-' + config['projectId']
    with _firebase_lock:
        try:
            app = firebase_admin.get_app(name)
        except ValueError:
            # Admin SDK 7.7 constructs an administrative HTTP client even for public
            # certificate verification. Supply a deliberately unprivileged credential;
            # ID-token signature/issuer/audience/time verification remains unchanged.
            # This object cannot perform administrative account or Firestore writes.
            class PublicVerificationCredential(credentials.Base):
                def get_credential(self):
                    return AnonymousCredentials()
            credential = credentials.ApplicationDefault() if os.environ.get('GOOGLE_APPLICATION_CREDENTIALS') else PublicVerificationCredential()
            app = firebase_admin.initialize_app(credential, options={'projectId': config['projectId']}, name=name)
    try:
        # Small client/server clock differences are normal. This machine was
        # measured about 15s behind Google's uncached HTTP Date. The SDK supports
        # at most 60s; a bounded 30s tolerance still rejects expired/forged tokens.
        claims = auth.verify_id_token(token, app=app, clock_skew_seconds=30)
        uid = claims.get('uid')
        if not isinstance(uid, str) or not uid:
            raise ValueError('Missing UID')
        return uid
    except Exception as exc:
        _safe_auth_failure(exc)
        raise HTTPException(401, '로그인이 만료되었거나 인증 토큰이 올바르지 않습니다.') from exc


def require_uid(request: Request):
    mode = auth_mode()
    if mode == 'local':
        peer = request.client.host if request.client else ''
        host = urlsplit('//' + request.headers.get('host', '')).hostname or ''
        if not loopback(peer) or not loopback(host):
            raise HTTPException(403, '로컬 계정은 이 기기의 루프백 주소에서만 사용할 수 있습니다.')
        return 'local-device'
    if mode != 'firebase':
        raise HTTPException(503, 'Google 로그인 설정이 필요합니다. 개발용 로컬 모드는 명시적으로 활성화해야 합니다.')
    header = request.headers.get('authorization', '')
    if not header.startswith('Bearer ') or not header[7:].strip():
        raise HTTPException(401, 'Google 로그인이 필요합니다.')
    return verify_firebase_token(header[7:])
