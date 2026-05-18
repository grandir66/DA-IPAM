"""Fixtures comuni: configurazione agente in dev_mode con token noto."""

from __future__ import annotations

import json
import os
from collections.abc import Iterator

import bcrypt
import pytest
from fastapi.testclient import TestClient


TEST_TOKEN = "test-token-please-rotate"
TEST_TOKEN_RO = "test-token-readonly"
TEST_TOKEN_WILDCARD = "test-token-wildcard"


def _hash(plain: str) -> str:
    return bcrypt.hashpw(plain.encode("utf-8"), bcrypt.gensalt(rounds=4)).decode("utf-8")


@pytest.fixture(autouse=True)
def _agent_env(monkeypatch: pytest.MonkeyPatch) -> Iterator[None]:
    """Forza una config dev: tre token con scope diversi, dev_mode=true."""

    tokens = [
        {
            "label": "test-full",
            "token_hash": _hash(TEST_TOKEN),
            "scopes": ["exec:network", "exec:device", "admin:update"],
        },
        {
            "label": "test-network-only",
            "token_hash": _hash(TEST_TOKEN_RO),
            "scopes": ["exec:network"],
        },
        {
            "label": "test-wildcard",
            "token_hash": _hash(TEST_TOKEN_WILDCARD),
            "scopes": ["*"],
        },
    ]
    monkeypatch.setenv("DA_INVENT_AGENT_TENANT_CODE", "TEST")
    monkeypatch.setenv("DA_INVENT_AGENT_TOKENS", json.dumps(tokens))
    monkeypatch.setenv("DA_INVENT_AGENT_DEV_MODE", "true")
    monkeypatch.setenv("DA_INVENT_AGENT_HUB_URL", "http://localhost")
    monkeypatch.setenv("DA_INVENT_AGENT_CONFIG", os.devnull)

    from da_invent_agent.config import reset_settings_cache

    reset_settings_cache()
    yield
    reset_settings_cache()


@pytest.fixture
def client() -> Iterator[TestClient]:
    from da_invent_agent.main import app

    with TestClient(app) as c:
        yield c


@pytest.fixture
def auth_headers() -> dict[str, str]:
    """Token con tutti gli scope."""
    return {"Authorization": f"Bearer {TEST_TOKEN}"}


@pytest.fixture
def auth_headers_ro() -> dict[str, str]:
    """Token con solo exec:network — usato per testare scope_denied."""
    return {"Authorization": f"Bearer {TEST_TOKEN_RO}"}


@pytest.fixture
def auth_headers_wildcard() -> dict[str, str]:
    """Token con scope '*' — passa qualunque controllo."""
    return {"Authorization": f"Bearer {TEST_TOKEN_WILDCARD}"}
