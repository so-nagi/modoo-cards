"""Verify a user-supplied APKG without opening any user collection.

Run from the project root: python scripts/verify-apkg.py PATH --expected 480
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import sys
import tempfile

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from fastapi.testclient import TestClient
from server.app import create_app


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('package', type=Path)
    parser.add_argument('--expected', type=int, required=True)
    args = parser.parse_args()
    payload = args.package.read_bytes()
    original_hash = hashlib.sha256(payload).hexdigest()
    os.environ['MODOO_LOCAL_AUTH'] = '1'
    os.environ.pop('MODOO_DATABASE_URL', None)

    def ok(response):
        assert response.status_code == 200, response.text
        return response.json()

    with tempfile.TemporaryDirectory(prefix='modoo-apkg-verify-', dir=Path(__file__).resolve().parents[2]) as folder:
        with TestClient(create_app(Path(folder)), base_url='http://127.0.0.1:4190',
                        client=('127.0.0.1', 12345)) as client:
            boot = ok(client.get('/api/bootstrap'))
            model = next(m['id'] for m in boot['models'] if m['name'] == 'Basic')
            seed = ok(client.post('/api/notes', json={
                'deckId': 1, 'modelId': model, 'fields': ['existing', '보존 확인'], 'tags': ['keep']}))
            current = ok(client.get('/api/study?deckId=1'))['card']
            ok(client.post('/api/answer', json={'cardId': current['id'], 'rating': 4,
                'token': current['token'], 'requestId': 'seed-review', 'elapsedMs': 1500}))
            card_id = seed['cardIds'][0]
            before = ok(client.get(f'/api/cards/{card_id}'))
            first = ok(client.post('/api/import-content', files={'file': (args.package.name, payload)}))
            assert first['added'] == args.expected
            assert first['cardsAdded'] == args.expected
            col = client.app.state.collections.get('local-device').col
            imported_models = [m for m in col.models.all() if col.db.scalar('select count() from notes where mid=?', m['id']) and m['id'] != model]
            assert all(m['css']=='' for m in imported_models)
            counts = {deck.name: len(col.find_cards(f'did:{deck.id}'))
                      for deck in col.decks.all_names_and_ids() if '::DAY' in deck.name}
            second = ok(client.post('/api/import-content', files={'file': (args.package.name, payload)}))
            assert second['added'] == second['cardsAdded'] == 0
            assert col.note_count() == col.card_count() == args.expected + 1
            assert ok(client.get(f'/api/cards/{card_id}')) == before
            assert len(before['history']) == 1
            assert not list(Path(folder).rglob('upload-*'))
            assert hashlib.sha256(args.package.read_bytes()).hexdigest() == original_hash
            print(json.dumps({'engine': ok(client.get('/api/health')), 'bytes': len(payload),
                'sha256': original_hash, 'first': first, 'repeat': second,
                'totalNotesIncludingSeed': col.note_count(), 'totalCardsIncludingSeed': col.card_count(),
                'dayCounts': counts, 'existingCardAndReviewUnchanged': True,
                'sourceTemplatesRemoved': True, 'sourceFileUnchanged': True, 'temporaryUploadsCleaned': True}, ensure_ascii=False, indent=2))


if __name__ == '__main__':
    main()
