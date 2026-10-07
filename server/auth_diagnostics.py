"""Public-network diagnostics only. Never accepts or reads user ID tokens."""
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime
import json
import os
import time

import requests
from firebase_admin import _token_gen


def run():
    started = time.time()
    result = {
        'localUtc': datetime.now(timezone.utc).isoformat(),
        'proxyEnvironmentPresent': any(os.environ.get(key) for key in ('HTTPS_PROXY', 'HTTP_PROXY', 'ALL_PROXY')),
        'customCABundlePresent': any(os.environ.get(key) for key in ('REQUESTS_CA_BUNDLE', 'CURL_CA_BUNDLE', 'SSL_CERT_FILE')),
        'authEmulatorEnabled': bool(os.environ.get('FIREBASE_AUTH_EMULATOR_HOST')),
    }
    try:
        response = requests.get(_token_gen.ID_TOKEN_CERT_URI, timeout=15)
        result['certificateHttpStatus'] = response.status_code
        result['roundTripSeconds'] = round(time.time()-started, 3)
        result['certificateContentType'] = response.headers.get('Content-Type')
        result['httpDate'] = response.headers.get('Date')
        result['httpAgeSeconds'] = response.headers.get('Age')
        if response.headers.get('Date'):
            stamp = parsedate_to_datetime(response.headers['Date']).timestamp()
            age = int(response.headers.get('Age', '0'))
            result['localMinusServerSeconds'] = round(time.time() - (stamp + age), 2)
        if response.ok:
            data = response.json()
            result['publicCertificateCount'] = len(data) if isinstance(data, dict) else 0
            result['certificateFormatValid'] = isinstance(data, dict) and all('BEGIN CERTIFICATE' in str(value) for value in data.values())
        # Exercise the exact SDK's certificate transport (including cache layer).
        sdk_response = _token_gen.CertificateFetchRequest(15)(_token_gen.ID_TOKEN_CERT_URI)
        result['sdkCertificateHttpStatus'] = sdk_response.status
        fresh = requests.get(_token_gen.ID_TOKEN_CERT_URI, params={'diagnostic_timestamp': int(time.time())}, headers={'Cache-Control': 'no-cache'}, timeout=15)
        result['uncachedCertificateHttpStatus'] = fresh.status_code
        result['uncachedHttpDate'] = fresh.headers.get('Date')
        if fresh.headers.get('Date'):
            result['uncachedLocalMinusServerSeconds'] = round(time.time()-parsedate_to_datetime(fresh.headers['Date']).timestamp(), 2)
    except Exception as exc:
        result['failureType'] = type(exc).__name__
        result['safeCode'] = 'public-certificate-network-failed'
    print(json.dumps(result, indent=2))


if __name__ == '__main__':
    run()
