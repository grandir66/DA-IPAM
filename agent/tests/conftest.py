"""Fixtures comuni: configurazione agente in dev_mode con token noto."""

from __future__ import annotations

import os
from collections.abc import Iterator

import bcrypt
import pytest
from fastapi.testclient import TestClient


TEST_TOKEN = "test-token-please-rotate"


@pytest.fixture(autouse=True)
def _agent_env(monkeypatch: pytest.MonkeyPatch) -> Iterator[None]:
    """Forza una config dev: token noto, dev_mode=true (accetta 127.0.0.1)."""

    token_hash = bcrypt.hashpw(TEST_TOKEN.encode("utf-8"), bcrypt.gensalt(rounds=4)).decode("utf-8")
    monkeypatch.setenv("DA_INVENT_AGENT_TENANT_CODE", "TEST")
    monkeypatch.setenv("DA_INVENT_AGENT_TOKEN_HASH", token_hash)
    monkeypatch.setenv("DA_INVENT_AGENT_DEV_MODE", "true")
    monkeypatch.setenv("DA_INVENT_AGENT_HUB_URL", "http://localhost")
    # Disabilita la lettura del YAML in /etc che non esiste nei test
    monkeypatch.setenv("DA_INVENT_AGENT_CONFIG", "/dev/null")

    # Reset cache di get_settings (lru_cache) per riapplicare le env var
    from da_invent_agent.config import reset_settings_cache

    reset_settings_cache()
    yield
    reset_settings_cache()


@pytest.fixture
def client() -> Iterator[TestClient]:
    # Import deferred: l'app deve essere creata DOPO che le env var sono settate.
    from da_invent_agent.main import app

    with TestClient(app) as c:
        yield c


@pytest.fixture
def auth_headers() -> dict[str, str]:
    return {"Authorization": f"Bearer {TEST_TOKEN}"}


@pytest.fixture
def _tmp_no_etc(monkeypatch: pytest.MonkeyPatch) -> None:
    """Garantisce che il path /etc/da-invent-agent/config.yml non sia letto in CI."""
    monkeypatch.delenv("DA_INVENT_AGENT_CONFIG", raising=False)
    monkeypatch.setenv("DA_INVENT_AGENT_CONFIG", os.devnull)
