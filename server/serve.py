"""Single-process production entrypoint; local development uses start.ps1."""
import os
from pathlib import Path
import time

import uvicorn

from .auth import auth_mode


def runtime_options(environ):
    if environ.get('MODOO_LOCAL_AUTH') == '1':
        raise RuntimeError('Public deployments must use Google authentication.')
    data_dir = environ.get('MODOO_DATA_DIR', '')
    if not data_dir or not Path(data_dir).is_absolute():
        raise RuntimeError('MODOO_DATA_DIR must be an absolute persistent-disk path.')
    if environ.get('RENDER') == 'true' and not environ.get('MODOO_DATABASE_URL'):
        raise RuntimeError('Render deployments require durable Firebase storage before accepting data.')
    port = int(environ.get('PORT', '10000'))
    if not 1 <= port <= 65535:
        raise ValueError('PORT must be between 1 and 65535.')
    return {'host': '0.0.0.0', 'port': port, 'workers': 1}


def main():
    options = runtime_options(os.environ)
    if auth_mode() != 'firebase':
        raise RuntimeError('Firebase public configuration is required for deployment.')
    os.environ.setdefault('TZ', 'Asia/Seoul')
    if hasattr(time, 'tzset'):
        time.tzset()
    Path(os.environ['MODOO_DATA_DIR']).mkdir(parents=True, exist_ok=True)
    # Fail before opening a public port if the volume is unwritable or another
    # server owns it. The API reacquires the same process lock when first used.
    from .core import Collections
    storage = Collections()
    storage.close()
    uvicorn.run('server.app:app', **options)


if __name__ == '__main__':
    main()
