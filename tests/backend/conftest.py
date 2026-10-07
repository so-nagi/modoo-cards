"""Tests use a synthetic Firebase project and never depend on an installer's config."""
import json
import pytest


@pytest.fixture(autouse=True)
def isolated_firebase_project(monkeypatch):
    monkeypatch.setenv('MODOO_FIREBASE_CONFIG', json.dumps({'projectId': 'demo-modoo-tests', 'apiKey': 'public-test-key'}))
    monkeypatch.delenv('MODOO_DATABASE_URL', raising=False)
