import pytest
from starlette.requests import Request

from server.auth import origin_allowed
from server.serve import runtime_options


def request(origin, host='cards.example.com', forwarded=None):
    headers = [(b'host', host.encode()), (b'origin', origin.encode())]
    if forwarded:
        headers.append((b'x-forwarded-host', forwarded.encode()))
    return Request({'type': 'http', 'scheme': 'http', 'path': '/api/notes', 'query_string': b'', 'headers': headers})


def test_render_https_origin_is_exact_even_when_upstream_is_http(monkeypatch):
    monkeypatch.delenv('MODOO_PUBLIC_ORIGIN', raising=False)
    monkeypatch.delenv('MODOO_ALLOWED_ORIGINS', raising=False)
    monkeypatch.setenv('RENDER_EXTERNAL_URL', 'https://cards.example.com')
    assert origin_allowed(request('https://cards.example.com'))
    assert not origin_allowed(request('https://cards.example.com.evil.test'))
    assert not origin_allowed(request('https://evil.test', forwarded='evil.test'))


def test_custom_origin_override_does_not_allow_stale_platform_origin(monkeypatch):
    monkeypatch.delenv('MODOO_ALLOWED_ORIGINS', raising=False)
    monkeypatch.setenv('MODOO_PUBLIC_ORIGIN', 'https://cards.example.com/')
    monkeypatch.setenv('RENDER_EXTERNAL_URL', 'https://old.onrender.com')
    assert origin_allowed(request('https://cards.example.com'))
    assert not origin_allowed(request('https://old.onrender.com'))


@pytest.mark.parametrize('origin', ['*', 'http://cards.example.com', 'https://cards.example.com/path', 'https://user:pass@cards.example.com'])
def test_invalid_configured_origins_do_not_expand_allowed_sources(monkeypatch, origin):
    monkeypatch.delenv('MODOO_ALLOWED_ORIGINS', raising=False)
    monkeypatch.setenv('MODOO_PUBLIC_ORIGIN', origin)
    assert not origin_allowed(request('https://cards.example.com'))


def test_production_runtime_uses_one_worker_and_platform_port(tmp_path):
    options = runtime_options({'MODOO_DATA_DIR': str(tmp_path), 'PORT': '12345'})
    assert options == {'host': '0.0.0.0', 'port': 12345, 'workers': 1}


def test_production_runtime_refuses_local_auth_and_ephemeral_default(tmp_path):
    with pytest.raises(RuntimeError, match='Google'):
        runtime_options({'MODOO_DATA_DIR': str(tmp_path), 'MODOO_LOCAL_AUTH': '1'})
    for folder in ('', 'data'):
        with pytest.raises(RuntimeError, match='persistent'):
            runtime_options({'MODOO_DATA_DIR': folder})


@pytest.mark.parametrize('port', ['0', '65536', 'not-a-port'])
def test_production_runtime_refuses_invalid_ports(tmp_path, port):
    with pytest.raises(ValueError):
        runtime_options({'MODOO_DATA_DIR': str(tmp_path), 'PORT': port})
